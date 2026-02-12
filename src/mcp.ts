/**
 * MCP (Model Context Protocol) client.
 *
 * MCP allows connecting external tool servers that expose tools,
 * prompts, and resources over a standardised protocol. ProtoAgent
 * acts as an MCP client — it connects to MCP servers, discovers
 * their tools, and makes them available to the agent.
 *
 * Configuration in `.protoagent/mcp.json`:
 * {
 *   "servers": {
 *     "my-server": {
 *       "command": "npx",
 *       "args": ["-y", "@my/mcp-server"],
 *       "env": { "API_KEY": "..." }
 *     }
 *   }
 * }
 *
 * Each server is spawned as a child process communicating over
 * stdin/stdout using JSON-RPC (the MCP stdio transport).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { logger } from './utils/logger.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';

// ─── MCP Protocol Types ───

interface McpRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: any;
}

interface McpResponse {
  jsonrpc: '2.0';
  id: number;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface McpToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
}

// ─── MCP Server Connection ───

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

class McpConnection {
  private process: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();
  private rl: readline.Interface;
  public serverName: string;
  public tools: McpToolDefinition[] = [];

  constructor(serverName: string, config: McpServerConfig) {
    this.serverName = serverName;

    this.process = spawn(config.command, config.args || [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...config.env },
    });

    this.rl = readline.createInterface({ input: this.process.stdout! });
    this.rl.on('line', (line) => this.handleLine(line));

    this.process.stderr?.on('data', (data: Buffer) => {
      logger.debug(`MCP [${serverName}] stderr: ${data.toString().trim()}`);
    });

    this.process.on('exit', (code) => {
      logger.debug(`MCP [${serverName}] exited with code ${code}`);
    });
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line) as McpResponse;
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(`MCP error: ${msg.error.message}`));
        } else {
          pending.resolve(msg.result);
        }
      }
    } catch {
      // Ignore non-JSON lines
    }
  }

  async send(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const request: McpRequest = { jsonrpc: '2.0', id, method, params };

      this.pending.set(id, { resolve, reject });

      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}`));
      }, 30_000);

      this.pending.set(id, {
        resolve: (val) => { clearTimeout(timeout); resolve(val); },
        reject: (err) => { clearTimeout(timeout); reject(err); },
      });

      this.process.stdin!.write(JSON.stringify(request) + '\n');
    });
  }

  async initialize(): Promise<void> {
    // Send initialize request
    const result = await this.send('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'protoagent', version: '0.0.1' },
    });

    logger.debug(`MCP [${this.serverName}] initialized: ${JSON.stringify(result?.serverInfo)}`);

    // Send initialized notification
    this.process.stdin!.write(JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }) + '\n');

    // List tools
    const toolsResult = await this.send('tools/list', {});
    this.tools = toolsResult?.tools || [];
    logger.info(`MCP [${this.serverName}] discovered ${this.tools.length} tools`);
  }

  async callTool(name: string, args: any): Promise<string> {
    const result = await this.send('tools/call', { name, arguments: args });

    // MCP tool results are arrays of content blocks
    if (Array.isArray(result?.content)) {
      return result.content
        .map((c: any) => {
          if (c.type === 'text') return c.text;
          return JSON.stringify(c);
        })
        .join('\n');
    }

    return JSON.stringify(result);
  }

  close(): void {
    this.rl.close();
    this.process.kill();
  }
}

// ─── MCP Manager ───

const connections = new Map<string, McpConnection>();

/**
 * Load MCP configuration and connect to all configured servers.
 * Registers their tools in the dynamic tool registry.
 */
export async function initializeMcp(): Promise<void> {
  const configPath = path.join(process.cwd(), '.protoagent', 'mcp.json');

  let config: McpConfig;
  try {
    const content = await fs.readFile(configPath, 'utf8');
    config = JSON.parse(content) as McpConfig;
  } catch {
    // No MCP config — that's fine, most projects won't have one
    return;
  }

  if (!config.servers || Object.keys(config.servers).length === 0) return;

  logger.info(`Loading MCP servers from ${configPath}`);

  for (const [name, serverConfig] of Object.entries(config.servers)) {
    try {
      const conn = new McpConnection(name, serverConfig);
      await conn.initialize();
      connections.set(name, conn);

      // Register each MCP tool in the dynamic tool registry
      for (const mcpTool of conn.tools) {
        const toolName = `mcp_${name}_${mcpTool.name}`;

        registerDynamicTool({
          type: 'function' as const,
          function: {
            name: toolName,
            description: `[MCP: ${name}] ${mcpTool.description || mcpTool.name}`,
            parameters: mcpTool.inputSchema as any,
          },
        });

        registerDynamicHandler(toolName, async (args) => {
          return await conn.callTool(mcpTool.name, args);
        });
      }
    } catch (err) {
      logger.error(`Failed to connect to MCP server "${name}": ${err}`);
    }
  }
}

/** Close all MCP connections. */
export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    logger.debug(`Closing MCP connection: ${name}`);
    conn.close();
  }
  connections.clear();
}

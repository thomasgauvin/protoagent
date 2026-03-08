/**
 * MCP (Model Context Protocol) client.
 *
 * Uses the official @modelcontextprotocol/sdk to connect to MCP servers
 * over both stdio (spawned processes) and HTTP transports.
 *
 * Configuration in `.protoagent/mcp.json`:
 * {
 *   "servers": {
 *     "my-stdio-server": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@my/mcp-server"],
 *       "env": { "API_KEY": "..." }
 *     },
 *     "my-http-server": {
 *       "type": "http",
 *       "url": "http://localhost:3000/mcp"
 *     }
 *   }
 * }
 *
 * Stdio servers are spawned as child processes communicating over stdin/stdout.
 * HTTP servers connect to a running server via HTTP POST/GET with SSE streaming.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { logger } from './utils/logger.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';

// ─── MCP Server Configuration ───

interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface HttpServerConfig {
  type: 'http';
  url: string;
}

type McpServerConfig = StdioServerConfig | HttpServerConfig;

interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

// ─── MCP Server Connection Manager ───

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();

/**
 * Create an MCP client connection for a stdio server.
 */
async function connectStdioServer(
  serverName: string,
  config: StdioServerConfig
): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: config.env || {},
  });

  const client = new Client(
    {
      name: 'protoagent',
      version: '0.0.1',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return {
    client,
    serverName,
    transport,
  };
}

/**
 * Create an MCP client connection for an HTTP server.
 */
async function connectHttpServer(
  serverName: string,
  config: HttpServerConfig
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url));

  const client = new Client(
    {
      name: 'protoagent',
      version: '0.0.1',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return {
    client,
    serverName,
    transport,
  };
}

/**
 * Register all tools from an MCP server into the dynamic tool registry.
 */
async function registerMcpTools(conn: McpConnection): Promise<void> {
  try {
    const response = await conn.client.listTools();
    const tools = response.tools || [];

    logger.info(`MCP [${conn.serverName}] discovered ${tools.length} tools`);

    for (const tool of tools) {
      const toolName = `mcp_${conn.serverName}_${tool.name}`;

      registerDynamicTool({
        type: 'function' as const,
        function: {
          name: toolName,
          description: `[MCP: ${conn.serverName}] ${tool.description || tool.name}`,
          parameters: tool.inputSchema as any,
        },
      });

      registerDynamicHandler(toolName, async (args) => {
        const result = await conn.client.callTool({
          name: tool.name,
          arguments: args,
        });

        // MCP tool results are arrays of content blocks
        if (Array.isArray(result.content)) {
          return result.content
            .map((c: any) => {
              if (c.type === 'text') return c.text;
              return JSON.stringify(c);
            })
            .join('\n');
        }

        return JSON.stringify(result);
      });
    }
  } catch (err) {
    logger.error(`Failed to register tools for MCP [${conn.serverName}]: ${err}`);
  }
}

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
      let conn: McpConnection;

      if (serverConfig.type === 'stdio') {
        logger.debug(`Connecting to stdio MCP server: ${name}`);
        conn = await connectStdioServer(name, serverConfig);
      } else if (serverConfig.type === 'http') {
        logger.debug(`Connecting to HTTP MCP server: ${name} (${serverConfig.url})`);
        conn = await connectHttpServer(name, serverConfig);
      } else {
        logger.error(`Unknown MCP server type for "${name}": ${(serverConfig as any).type}`);
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      logger.error(`Failed to connect to MCP server "${name}": ${err}`);
    }
  }
}

/**
 * Close all MCP connections.
 */
export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      logger.debug(`Closing MCP connection: ${name}`);
      await conn.client.close();
    } catch (err) {
      logger.error(`Error closing MCP connection [${name}]: ${err}`);
    }
  }
  connections.clear();
}

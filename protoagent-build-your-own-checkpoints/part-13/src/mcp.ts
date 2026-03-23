// src/mcp.ts
// MCP (Model Context Protocol) client with security controls

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from './runtime-config.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';
import { requestApproval } from './utils/approval.js';

// Security: Allowlist of safe environment variables for MCP servers
// Naive approach: Pass full process.env to MCP servers
// Risk: MCP server can steal API keys, tokens, credentials from environment
const ALLOWED_MCP_ENV_VARS = [
  'PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'LC_CTYPE',
  'LC_MESSAGES', 'TZ', 'SHELL', 'TERM', 'TMPDIR', 'NODE_OPTIONS',
];

// Security: Blocked shell interpreters and dangerous commands
const BLOCKED_SHELLS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash',
  'cmd.exe', 'cmd', 'powershell.exe', 'powershell', 'pwsh', 'pwsh.exe',
]);

// Security: Dangerous patterns in command arguments
const DANGEROUS_ARG_PATTERNS = /[;|&$()`<>]/;

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();
const approvedServers = new Set<string>();

// Security: Validate MCP server command
function validateMcpCommand(command: string, args: string[]): { valid: boolean; error?: string } {
  const baseCommand = command.split('/').pop() || command;
  if (BLOCKED_SHELLS.has(baseCommand.toLowerCase())) {
    return { valid: false, error: `MCP server command "${command}" is a shell interpreter and is blocked.` };
  }
  if (command.includes('..')) {
    return { valid: false, error: `MCP server command "${command}" contains path traversal.` };
  }
  for (const arg of args) {
    if (DANGEROUS_ARG_PATTERNS.test(arg)) {
      return { valid: false, error: `MCP argument contains dangerous characters: "${arg.slice(0, 50)}"` };
    }
  }
  return { valid: true };
}

// Security: Filter environment variables for MCP servers
function filterMcpEnvironment(customEnv?: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of ALLOWED_MCP_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) filtered[key] = value;
  }
  if (customEnv) {
    for (const [key, value] of Object.entries(customEnv)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

// Connects to a stdio-based MCP server and returns the connection.
async function connectStdioServer(serverName: string, config: StdioServerConfig): Promise<McpConnection> {
  // Security: Validate command before spawning
  const validation = validateMcpCommand(config.command, config.args || []);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: filterMcpEnvironment(config.env),
    cwd: config.cwd,
  });

  const client = new Client({ name: 'protoagent', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return { client, serverName, transport };
}

// Connects to an HTTP-based MCP server and returns the connection.
async function connectHttpServer(serverName: string, config: HttpServerConfig): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  const client = new Client({ name: 'protoagent', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return { client, serverName, transport };
}

// Discovers and registers all tools from an MCP connection as dynamic tools.
async function registerMcpTools(conn: McpConnection): Promise<void> {
  try {
    const response = await conn.client.listTools();
    const tools = response.tools || [];

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

      registerDynamicHandler(toolName, async (args: unknown) => {
        const result = await conn.client.callTool({
          name: tool.name,
          arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
        });

        if (Array.isArray(result.content)) {
          return result.content
            .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
        }
        return JSON.stringify(result);
      });
    }
  } catch (err) {
    // Do nothing
  }
}

// Loads runtime config and initializes all configured MCP servers.
export async function initializeMcp(): Promise<void> {
  await loadRuntimeConfig();
  const servers = getRuntimeConfig().mcp?.servers || {};

  if (Object.keys(servers).length === 0) return;

  for (const [name, serverConfig] of Object.entries(servers)) {
    if (serverConfig.enabled === false) {
      continue;
    }

    // Security: Require user approval for MCP servers
    if (!approvedServers.has(name)) {
      const description = serverConfig.type === 'stdio'
        ? `MCP server "${name}" will execute: ${serverConfig.command} ${(serverConfig.args || []).join(' ')}`
        : `MCP server "${name}" will connect to: ${serverConfig.url}`;

      const approved = await requestApproval({
        id: `mcp-${name}-${Date.now()}`,
        type: 'shell_command',
        description: `Connect to MCP server: ${name}`,
        detail: `${description}\n\nMCP servers can execute arbitrary code. Only connect to servers you trust.`,
        sessionId: undefined,
        sessionScopeKey: `mcp:${name}`,
      });

      if (!approved) continue;
      approvedServers.add(name);
    }

    try {
      let conn: McpConnection;

      if (serverConfig.type === 'stdio') {
        conn = await connectStdioServer(name, serverConfig);
      } else if (serverConfig.type === 'http') {
        conn = await connectHttpServer(name, serverConfig);
      } else {
        // Do nothing
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      // Do nothing
    }
  }
}

// Closes all active MCP connections and clears the connection map.
export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      await conn.client.close();
    } catch (err) {
      // Do nothing
    }
  }
  connections.clear();
}
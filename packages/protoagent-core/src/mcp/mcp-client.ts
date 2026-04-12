/**
 * MCP (Model Context Protocol) client with timeout handling.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { toolRegistry, type ToolDefinition } from '../tools/tool-registry.js';

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

interface HttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

type ServerConfig = StdioServerConfig | HttpServerConfig;

const connections = new Map<string, McpConnection>();

// Tools that need shorter timeouts (screenshots, browser operations)
const SCREENSHOT_TOOLS = new Set([
  'mcp_chrome-devtools_take_screenshot',
  'mcp_playwright_browser_take_screenshot',
  'mcp_chrome-devtools_take_snapshot',
]);

// Default timeout for MCP tool calls (30 seconds)
const DEFAULT_MCP_TIMEOUT = 30000;
// Shorter timeout for screenshot operations (10 seconds)
const SCREENSHOT_TIMEOUT = 10000;

async function connectStdioServer(
  serverName: string,
  config: StdioServerConfig
): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
    cwd: config.cwd,
    stderr: 'pipe',
  });

  const client = new Client(
    { name: 'protoagent', version: '0.2.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  // Log stderr for debugging
  (transport as any).stderr?.on('data', (data: Buffer) => {
    const lines = data.toString('utf-8').split('\n').filter(l => l.trim());
    for (const line of lines) {
      console.error(`MCP [${serverName}] ${line}`);
    }
  });

  return { client, serverName, transport };
}

async function connectHttpServer(
  serverName: string,
  config: HttpServerConfig
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(
    new URL(config.url),
    { requestInit: config.headers ? { headers: config.headers } : undefined }
  );

  const client = new Client(
    { name: 'protoagent', version: '0.2.0' },
    { capabilities: {} }
  );

  await client.connect(transport);

  return { client, serverName, transport };
}

async function registerMcpTools(conn: McpConnection): Promise<void> {
  try {
    const response = await conn.client.listTools();
    const tools = response.tools || [];

    console.log(`MCP [${conn.serverName}] discovered ${tools.length} tools`);

    for (const tool of tools) {
      const toolName = `mcp_${conn.serverName}_${tool.name}`;

      const toolDef: ToolDefinition = {
        type: 'function',
        function: {
          name: toolName,
          description: `[MCP: ${conn.serverName}] ${tool.description || tool.name}`,
          parameters: tool.inputSchema as any,
        },
      };

      // Register with timeout-aware handler
      toolRegistry.register(toolDef, async (args, context) => {
        const isScreenshot = SCREENSHOT_TOOLS.has(toolName);
        const timeoutMs = isScreenshot ? SCREENSHOT_TIMEOUT : DEFAULT_MCP_TIMEOUT;

        // Create abortable timeout promise that also respects external abort signal
        const timeoutPromise = new Promise<never>((_, reject) => {
          const timeoutId = setTimeout(() => {
            reject(new Error(
              `MCP tool call timed out after ${timeoutMs}ms. ` +
              (isScreenshot
                ? 'Screenshot operations may require the browser to be running. Try using a shorter timeout or check if the page is loaded.'
                : 'The tool took too long to respond.')
            ));
          }, timeoutMs);

          // Also listen to external abort signal
          if (context.abortSignal) {
            context.abortSignal.addEventListener('abort', () => {
              clearTimeout(timeoutId);
              reject(new Error('MCP tool call aborted'));
            }, { once: true });
          }
        });

        // Create the actual tool call promise
        const toolCallPromise = (async () => {
          const result = await conn.client.callTool({
            name: tool.name,
            arguments: args as Record<string, unknown>,
          });

          // Format result
          if (Array.isArray(result.content)) {
            return result.content
              .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
              .join('\n');
          }
          return JSON.stringify(result);
        })();

        // Race between timeout/abort and tool completion
        try {
          return await Promise.race([toolCallPromise, timeoutPromise]);
        } catch (err: any) {
          // If it's a screenshot timeout, return a helpful error instead of hanging
          if (isScreenshot && err.message.includes('timed out')) {
            return `Error: Screenshot timed out. Common causes:
1. Browser/page not initialized - use mcp_chrome-devtools_new_page first
2. Page still loading - wait for navigation to complete
3. Extension may be unresponsive - try restarting the MCP server`;
          }
          throw err;
        }
      });
    }
  } catch (err) {
    console.error(`Failed to register tools for MCP [${conn.serverName}]:`, err);
  }
}

export async function initializeMcp(servers: Record<string, ServerConfig>): Promise<void> {
  if (Object.keys(servers).length === 0) return;

  console.log('Loading MCP servers from config');

  for (const [name, serverConfig] of Object.entries(servers)) {
    if ((serverConfig as any).enabled === false) {
      console.log(`Skipping disabled MCP server: ${name}`);
      continue;
    }

    try {
      let conn: McpConnection;

      if (serverConfig.type === 'stdio') {
        console.log(`Connecting to stdio MCP server: ${name}`);
        conn = await connectStdioServer(name, serverConfig);
      } else if (serverConfig.type === 'http') {
        console.log(`Connecting to HTTP MCP server: ${name} (${serverConfig.url})`);
        conn = await connectHttpServer(name, serverConfig);
      } else {
        console.error(`Unknown MCP server type for "${name}"`);
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      console.error(`Failed to connect to MCP server "${name}":`, err);
    }
  }
}

export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      console.log(`Closing MCP connection: ${name}`);
      await conn.client.close();
    } catch (err) {
      console.error(`Error closing MCP connection [${name}]:`, err);
    }
  }
  connections.clear();
}

export function getConnectedMcpServers(): string[] {
  return Array.from(connections.keys());
}

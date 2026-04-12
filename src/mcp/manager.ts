/**
 * MCP (Model Context Protocol) Manager — wraps module-level MCP state.
 *
 * Extracted into a class so that each tab can have its own isolated
 * set of MCP connections and registered tools.
 *
 * Each McpManager instance:
 * - Maintains its own `connections` Map
 * - Accepts a ToolRegistry instance to register MCP tools into the correct tab's registry
 * - Can be created fresh for each tab, or shared as a singleton
 *
 * Uses the official @modelcontextprotocol/sdk to connect to MCP servers
 * over both stdio (spawned processes) and HTTP transports.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from '../runtime-config.js';
import { logger } from '../utils/logger.js';
import type { ToolRegistry } from '../tools/registry.js';

// ─── MCP Server Configuration ───

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

// ─── MCP Server Connection Manager ───

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
  config: RuntimeMcpServerConfig;
  isConnected: boolean;
  lastError?: Error;
}

/**
 * McpManager — manages MCP connections and tool registration for a single tab/session.
 */
export class McpManager {
  private connections = new Map<string, McpConnection>();
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Check if a connection is still alive and attempt to reconnect if needed.
   */
  private async ensureConnected(serverName: string): Promise<McpConnection | null> {
    const conn = this.connections.get(serverName);
    if (!conn) return null;

    // If connection claims to be active, assume it's fine
    if (conn.isConnected) {
      return conn;
    }

    // Try to reconnect
    logger.info(`Attempting to reconnect to MCP server: ${serverName}`);
    try {
      // Close the old connection
      try {
        await conn.client.close();
      } catch (e) {
        logger.debug(`Error closing stale connection [${serverName}]: ${e}`);
      }

      // Create a new connection
      let newConn: McpConnection;
      if (conn.config.type === 'stdio') {
        newConn = await this.connectStdioServer(serverName, conn.config as StdioServerConfig);
      } else if (conn.config.type === 'http') {
        newConn = await this.connectHttpServer(serverName, conn.config as HttpServerConfig);
      } else {
        logger.error(`Unknown MCP server type for "${serverName}": ${(conn.config as any).type}`);
        return null;
      }

      newConn.config = conn.config;
      newConn.isConnected = true;
      this.connections.set(serverName, newConn);

      // Re-register tools for the new connection
      await this.registerMcpTools(newConn);
      logger.info(`Successfully reconnected to MCP server: ${serverName}`);
      return newConn;
    } catch (err) {
      conn.isConnected = false;
      conn.lastError = err instanceof Error ? err : new Error(String(err));
      logger.error(`Failed to reconnect to MCP server "${serverName}": ${err}`);
      return null;
    }
  }

  /**
   * Create an MCP client connection for a stdio server.
   */
  private async connectStdioServer(
    serverName: string,
    config: StdioServerConfig
  ): Promise<McpConnection> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: {
        ...process.env,
        ...(config.env || {}),
      } as Record<string, string>,
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
    // bleed through to the terminal and corrupt the TUI.
    (transport as any).stderr?.on('data', (data: Buffer) => {
      for (const line of data.toString('utf-8').split('\n')) {
        if (line.trim()) logger.debug(`MCP [${serverName}] ${line}`);
      }
    });

    return {
      client,
      serverName,
      transport,
      config,
      isConnected: true,
    };
  }

  /**
   * Create an MCP client connection for an HTTP server.
   */
  private async connectHttpServer(
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
      config,
      isConnected: true,
    };
  }

  /**
   * Register all tools from an MCP server into the tool registry.
   */
  private async registerMcpTools(conn: McpConnection): Promise<void> {
    try {
      const response = await conn.client.listTools();
      const tools = response.tools || [];

      logger.info(`MCP [${conn.serverName}] discovered ${tools.length} tools`);

      for (const tool of tools) {
        const toolName = `mcp_${conn.serverName}_${tool.name}`;

        this.toolRegistry.registerDynamicTool({
          type: 'function' as const,
          function: {
            name: toolName,
            description: `[MCP: ${conn.serverName}] ${tool.description || tool.name}`,
            parameters: tool.inputSchema as any,
          },
        });

        this.toolRegistry.registerDynamicHandler(toolName, async (args: unknown) => {
          // Note: Errors from this handler are caught and formatted by
          // handleToolCall() in tools/registry.ts, which wraps all tool calls
          // in a try/catch and returns `Error executing ${toolName}: ${msg}`

          // Ensure the connection is still active
          const activeConn = await this.ensureConnected(conn.serverName);
          if (!activeConn) {
            return `Error executing ${toolName}: MCP server "${conn.serverName}" is disconnected`;
          }

          try {
            const result = await activeConn.client.callTool({
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
          } catch (err) {
            // Mark connection as failed on tool call error
            activeConn.isConnected = false;
            activeConn.lastError = err instanceof Error ? err : new Error(String(err));
            throw err;
          }
        });
      }
    } catch (err) {
      conn.isConnected = false;
      conn.lastError = err instanceof Error ? err : new Error(String(err));
      logger.error(`Failed to register tools for MCP [${conn.serverName}]: ${err}`);
    }
  }

  /**
   * Load MCP configuration and connect to all configured servers.
   * Registers their tools in the tool registry.
   */
  async initialize(): Promise<void> {
    await loadRuntimeConfig();
    const servers = getRuntimeConfig().mcp?.servers || {};

    if (Object.keys(servers).length === 0) return;

    logger.info('Loading MCP servers from merged runtime config');

    for (const [name, serverConfig] of Object.entries(servers)) {
      if (serverConfig.enabled === false) {
        logger.debug(`Skipping disabled MCP server: ${name}`);
        continue;
      }

      try {
        let conn: McpConnection;

        if (serverConfig.type === 'stdio') {
          logger.debug(`Connecting to stdio MCP server: ${name}`);
          conn = await this.connectStdioServer(name, serverConfig);
        } else if (serverConfig.type === 'http') {
          logger.debug(`Connecting to HTTP MCP server: ${name} (${serverConfig.url})`);
          conn = await this.connectHttpServer(name, serverConfig);
        } else {
          logger.error(`Unknown MCP server type for "${name}": ${(serverConfig as any).type}`);
          continue;
        }

        this.connections.set(name, conn);
        await this.registerMcpTools(conn);
      } catch (err) {
        logger.error(`Failed to connect to MCP server "${name}": ${err}`);
      }
    }
  }

  /**
   * Close all MCP connections.
   */
  async close(): Promise<void> {
    for (const [name, conn] of this.connections) {
      try {
        logger.debug(`Closing MCP connection: ${name}`);
        await conn.client.close();
      } catch (err) {
        logger.error(`Error closing MCP connection [${name}]: ${err}`);
      }
    }
    this.connections.clear();
  }

  /**
   * Reconnect all MCP servers.
   */
  async reconnectAll(): Promise<void> {
    logger.info('Attempting to reconnect all MCP servers');
    for (const [serverName] of this.connections) {
      await this.ensureConnected(serverName);
    }
  }

  /**
   * Get connection status for all MCP servers.
   */
  getConnectionStatus(): Record<string, { connected: boolean; error?: string }> {
    const status: Record<string, { connected: boolean; error?: string }> = {};
    for (const [name, conn] of this.connections) {
      status[name] = {
        connected: conn.isConnected,
        error: conn.lastError?.message,
      };
    }
    return status;
  }

  /**
   * Get the names of all connected MCP servers.
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }
}

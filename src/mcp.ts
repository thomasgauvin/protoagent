/**
 * MCP (Model Context Protocol) client.
 *
 * This module now delegates to src/mcp/manager.ts for backwards compatibility.
 * New code should import McpManager from mcp/manager.ts and instantiate it
 * with a ToolRegistry instance.
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
 */

import { McpManager } from './mcp/manager.js';
import { defaultRegistry } from './tools/registry.js';

/**
 * For backwards compatibility: maintain module-level exports that delegate to
 * a default shared McpManager instance. This allows existing code to work without changes,
 * but gradually migrated code will pass McpManager instances around.
 */
const defaultMcpManager = new McpManager(defaultRegistry);

/**
 * Load MCP configuration and connect to all configured servers.
 * Registers their tools in the dynamic tool registry.
 */
export async function initializeMcp(): Promise<void> {
  return defaultMcpManager.initialize();
}

/**
 * Close all MCP connections.
 */
export async function closeMcp(): Promise<void> {
  return defaultMcpManager.close();
}

/**
 * Reconnect all MCP servers.
 */
export async function reconnectAllMcp(): Promise<void> {
  return defaultMcpManager.reconnectAll();
}

/**
 * Get connection status for all MCP servers.
 */
export function getMcpConnectionStatus(): Record<string, { connected: boolean; error?: string }> {
  return defaultMcpManager.getConnectionStatus();
}

/**
 * Get the names of all connected MCP servers.
 */
export function getConnectedMcpServers(): string[] {
  return defaultMcpManager.getConnectedServers();
}

/**
 * Export McpManager class for new code that needs per-tab instances
 */
export { McpManager } from './mcp/manager.js';

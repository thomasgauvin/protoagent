# Part 11: MCP Integration

MCP (Model Context Protocol) turns ProtoAgent from a local coding agent into one that can grow beyond its built-in tools. External tool servers — filesystem, GitHub, browser automation, databases — become available through a standard protocol.

We use the official MCP SDK (`@modelcontextprotocol/sdk`) to handle transport, connectivity, and capability discovery. The SDK manages the low-level protocol details: establishing connections over stdio or HTTP, negotiating capabilities with servers, and routing tool calls. See the SDK docs at https://modelcontextprotocol.io/docs/sdk.

## What you are building

We will allow users to configure MCP servers via the `protoagent.jsonc` file. We will create a specific file `src/runtime-config.ts` to handle this configuration, and clean up duplicated code in `config.tsx`.

Starting from Part 10, you add:

- `src/runtime-config.ts` — active `protoagent.jsonc` configuration loader
- Updated `src/config.tsx` — remove duplicated config paths/types
- `src/mcp.ts` — MCP client that connects to stdio and HTTP servers
- Updated `src/providers.ts` — merges runtime config providers with built-in catalog
- Updated `src/App.tsx` — initializes MCP on startup, closes on unmount

## Install new dependencies

```bash
npm install @modelcontextprotocol/sdk jsonc-parser
```

## Step 1: Create `src/runtime-config.ts`

Create the file:

```bash
touch src/runtime-config.ts
```

This file will become the single source of truth for runtime configuration — handling config file discovery, parsing, caching, and type definitions.

```typescript
// src/runtime-config.ts

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';

export interface RuntimeModelConfig {
  name?: string;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
}

export interface RuntimeProviderConfig {
  name?: string;
  baseURL?: string;
  apiKeyEnvVar?: string;
  models?: Record<string, RuntimeModelConfig>;
  requestDefaults?: Record<string, unknown>;
}

export interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
}

export interface HttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
}

export type RuntimeMcpServerConfig = StdioServerConfig | HttpServerConfig;

export interface RuntimeConfigFile {
  providers?: Record<string, RuntimeProviderConfig>;
  mcp?: {
    servers?: Record<string, RuntimeMcpServerConfig>;
  };
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigFile = {
  providers: {},
  mcp: { servers: {} },
};

let cachedConfig: RuntimeConfigFile | null = null;
let activeConfigPath: string | null = null;

function getProjectConfigPath(cwd: string): string {
  return path.join(cwd, '.protoagent', 'protoagent.jsonc');
}

function getUserConfigPath(): string {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(home, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(home, '.config', 'protoagent', 'protoagent.jsonc');
}

function getActiveRuntimeConfigPath(cwd: string): string {
  const projectPath = getProjectConfigPath(cwd);
  if (existsSync(projectPath)) {
    return projectPath;
  }
  return getUserConfigPath();
}

export function getActiveRuntimeConfigPathCached(): string | null {
  return activeConfigPath;
}

export async function loadRuntimeConfig(cwd?: string): Promise<RuntimeConfigFile> {
  if (cachedConfig) {
    return cachedConfig;
  }

  const cwdPath = cwd ?? process.cwd();
  activeConfigPath = getActiveRuntimeConfigPath(cwdPath);

  try {
    const content = await fs.readFile(activeConfigPath, 'utf-8');
    const errors: import('jsonc-parser').ParseError[] = [];
    const parsed = parse(content, errors, { allowTrailingComma: true });

    if (errors.length > 0) {
      const formattedErrors = errors.slice(0, 5).map((e) => {
        const code = printParseErrorCode(e.error);
        return `  - ${code} at offset ${e.offset}`;
      }).join('\n');
      throw new Error(`JSONC parse errors in ${activeConfigPath}:\n${formattedErrors}`);
    }

    cachedConfig = (parsed as RuntimeConfigFile) ?? DEFAULT_RUNTIME_CONFIG;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      cachedConfig = DEFAULT_RUNTIME_CONFIG;
    } else {
      throw new Error(`Failed to load runtime config from ${activeConfigPath}: ${err.message}`);
    }
  }

  return cachedConfig;
}

export function getRuntimeConfig(): RuntimeConfigFile {
  if (!cachedConfig) {
    throw new Error('Runtime config not loaded. Call loadRuntimeConfig() first.');
  }
  return cachedConfig;
}

export function clearRuntimeConfigCache(): void {
  cachedConfig = null;
  activeConfigPath = null;
}
```

## Step 2: Clean up `src/config.tsx`

Now that we have `src/runtime-config.ts`, we can remove the duplicated config path logic from `src/config.tsx`. Replace the path helper functions:

```typescript
// Replace these imports and functions in config.tsx:
import {
  getUserRuntimeConfigPath,
  getProjectRuntimeConfigPath,
  getActiveRuntimeConfigPath,
} from './runtime-config.js';

// Remove the old implementations of:
// - getUserRuntimeConfigPath()
// - getProjectRuntimeConfigPath()  
// - getActiveRuntimeConfigPath()
```

## Step 3: Create `src/mcp.ts`

Create the file:

```bash
touch src/mcp.ts
```

The MCP client connects to configured servers, discovers their tools, and registers them as dynamic tools.

```typescript
// src/mcp.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from './runtime-config.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();

// Connects to a stdio-based MCP server and returns the connection.
async function connectStdioServer(serverName: string, config: StdioServerConfig): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
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

    console.log(`MCP [${conn.serverName}] discovered ${tools.length} tools`);

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
    console.error(`Failed to register tools for MCP [${conn.serverName}]: ${err}`);
  }
}

// Loads runtime config and initializes all configured MCP servers.
export async function initializeMcp(): Promise<void> {
  await loadRuntimeConfig();
  const servers = getRuntimeConfig().mcp?.servers || {};

  if (Object.keys(servers).length === 0) return;

  console.log('Loading MCP servers from merged runtime config');

  for (const [name, serverConfig] of Object.entries(servers)) {
    if (serverConfig.enabled === false) {
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
        console.error(`Unknown MCP server type for "${name}": ${(serverConfig as any).type}`);
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      console.error(`Failed to connect to MCP server "${name}": ${err}`);
    }
  }
}

// Closes all active MCP connections and clears the connection map.
export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      await conn.client.close();
    } catch (err) {
      console.error(`Error closing MCP connection [${name}]: ${err}`);
    }
  }
  connections.clear();
}
```

## Step 4: Update `src/App.tsx`

Add MCP initialization on startup and cleanup on unmount:

```typescript
// In App.tsx, import:
import { initializeMcp, closeMcp } from './mcp.js';
import { loadRuntimeConfig } from './runtime-config.js';

// In initializeWithConfig, after building the client:
await initializeMcp();
```

Also add cleanup:

```typescript
useEffect(() => {
  return () => {
    closeMcp();
  };
}, []);
```

## Step 5: Update `src/providers.ts`

Merge runtime config providers with built-in providers:

```typescript
import { loadRuntimeConfig } from './runtime-config.js';

export async function initializeProviders(): Promise<void> {
  await loadRuntimeConfig();
  // ... merge logic
}
```

## Verification

Configure an MCP server in your `protoagent.jsonc`:

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/files"]
      }
    }
  }
}
```

Start ProtoAgent and you should see the MCP tools registered.

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-11`.

## Core takeaway

MCP is the bridge between ProtoAgent and external tool ecosystems. Built-in tools handle the common cases, but MCP means the agent can grow to use any tool that speaks the protocol.

## Security Note

MCP servers execute code on your machine. Only connect to servers you trust. The configuration lives in your `protoagent.jsonc` — review it carefully. Future hardening could include:
- Environment variable filtering (to prevent credential theft)
- Command validation (blocking shell interpreters)
- User approval before connecting to new servers

These are left as exercises — the foundation is solid for personal use.

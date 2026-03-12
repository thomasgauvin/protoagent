# Part 11: MCP Integration

MCP (Model Context Protocol) turns ProtoAgent from a local coding agent into one that can grow beyond its built-in tools. External tool servers — filesystem, GitHub, browser automation, databases — become available through a standard protocol.

## What you are building

Starting from Part 10, you add:

- `src/runtime-config.ts` — active `protoagent.jsonc` configuration loader
- `src/mcp.ts` — MCP client that connects to stdio and HTTP servers
- Updated `src/providers.ts` — merges runtime config providers with built-in catalog
- Updated `src/App.tsx` — initializes MCP on startup, closes on unmount

## Install new dependencies

```bash
npm install @modelcontextprotocol/sdk jsonc-parser
```

## Step 1: Create `src/runtime-config.ts`

The runtime config system loads the active `protoagent.jsonc` file. If a project file (`.protoagent/protoagent.jsonc`) exists in the current working directory, ProtoAgent uses that; otherwise it falls back to the shared user file (`~/.config/protoagent/protoagent.jsonc`). There is no merging between the two — one file wins. This is where MCP servers are configured, and where custom providers/models can be added.

```typescript
// src/runtime-config.ts

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';
import { logger } from './utils/logger.js';

export interface RuntimeModelConfig {
  name?: string;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  defaultParams?: Record<string, unknown>;
}

const RESERVED_DEFAULT_PARAM_KEYS = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
]);

export interface RuntimeProviderConfig {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models?: Record<string, RuntimeModelConfig>;
}

interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

interface HttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
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

let runtimeConfigCache: RuntimeConfigFile | null = null;

function getProjectRuntimeConfigPath(): string {
  return path.join(process.cwd(), '.protoagent', 'protoagent.jsonc');
}

function getUserRuntimeConfigPath(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc');
}

/** Returns the active config path: project if it exists, otherwise user. */
export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) return projectPath;
  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) return userPath;
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      logger.warn(`Missing environment variable ${envVar} while loading ${sourcePath}`);
      return '';
    }
    return resolved;
  });
}

function interpolateValue<T>(value: T, sourcePath: string): T {
  if (typeof value === 'string') return interpolateString(value, sourcePath) as T;
  if (Array.isArray(value)) return value.map((entry) => interpolateValue(entry, sourcePath)) as T;
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const interpolated = interpolateValue(entry, sourcePath);
      if (key === 'headers' && isPlainObject(interpolated)) {
        // Drop headers whose values were empty after interpolation
        next[key] = Object.fromEntries(
          Object.entries(interpolated).filter(([, v]) => typeof v !== 'string' || v.length > 0)
        );
        continue;
      }
      next[key] = interpolated;
    }
    return next as T;
  }
  return value;
}

function sanitizeDefaultParamsInConfig(config: RuntimeConfigFile): RuntimeConfigFile {
  const nextProviders = Object.fromEntries(
    Object.entries(config.providers || {}).map(([providerId, provider]) => {
      const providerDefaultParams = Object.fromEntries(
        Object.entries(provider.defaultParams || {}).filter(([key]) => {
          const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
          if (!allowed) logger.warn(`Ignoring reserved provider default param '${key}' for provider ${providerId}`);
          return allowed;
        })
      );

      const nextModels = Object.fromEntries(
        Object.entries(provider.models || {}).map(([modelId, model]) => {
          const modelDefaultParams = Object.fromEntries(
            Object.entries(model.defaultParams || {}).filter(([key]) => {
              const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
              if (!allowed) logger.warn(`Ignoring reserved model default param '${key}' for model ${providerId}/${modelId}`);
              return allowed;
            })
          );
          return [modelId, { ...model, ...(Object.keys(modelDefaultParams).length > 0 ? { defaultParams: modelDefaultParams } : {}) }];
        })
      );

      return [providerId, { ...provider, ...(Object.keys(providerDefaultParams).length > 0 ? { defaultParams: providerDefaultParams } : {}), models: nextModels }];
    })
  );

  return { ...config, providers: nextProviders };
}

function mergeRuntimeConfig(base: RuntimeConfigFile, overlay: RuntimeConfigFile): RuntimeConfigFile {
  const mergedProviders: Record<string, RuntimeProviderConfig> = { ...(base.providers || {}) };
  for (const [providerId, providerConfig] of Object.entries(overlay.providers || {})) {
    const current = mergedProviders[providerId] || {};
    mergedProviders[providerId] = { ...current, ...providerConfig, models: { ...(current.models || {}), ...(providerConfig.models || {}) } };
  }
  const mergedServers: Record<string, RuntimeMcpServerConfig> = { ...(base.mcp?.servers || {}) };
  for (const [name, serverConfig] of Object.entries(overlay.mcp?.servers || {})) {
    const current = mergedServers[name];
    mergedServers[name] = current && isPlainObject(current) ? { ...current, ...serverConfig } : serverConfig;
  }
  return { providers: mergedProviders, mcp: { servers: mergedServers } };
}

async function readRuntimeConfigFile(configPath: string): Promise<RuntimeConfigFile | null> {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      const details = errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join(', ');
      throw new Error(`Failed to parse ${configPath}: ${details}`);
    }
    if (!isPlainObject(parsed)) throw new Error(`Failed to parse ${configPath}: top-level value must be an object`);
    return sanitizeDefaultParamsInConfig(interpolateValue(parsed as RuntimeConfigFile, configPath));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function loadRuntimeConfig(forceReload = false): Promise<RuntimeConfigFile> {
  if (!forceReload && runtimeConfigCache) return runtimeConfigCache;

  const configPath = getActiveRuntimeConfigPath();
  let loaded = DEFAULT_RUNTIME_CONFIG;

  if (configPath) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (fileConfig) {
      logger.debug('Loaded runtime config', { path: configPath });
      loaded = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, fileConfig);
    }
  }

  runtimeConfigCache = loaded;
  return loaded;
}

export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}
```

## Step 2: Create `src/mcp.ts`

The MCP client connects to configured servers, discovers their tools, and registers them as dynamic tools.

```typescript
// src/mcp.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from './runtime-config.js';
import { logger } from './utils/logger.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();

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

async function connectHttpServer(serverName: string, config: HttpServerConfig): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  const client = new Client({ name: 'protoagent', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return { client, serverName, transport };
}

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

        if (Array.isArray(result.content)) {
          return result.content
            .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
            .join('\n');
        }
        return JSON.stringify(result);
      });
    }
  } catch (err) {
    logger.error(`Failed to register tools for MCP [${conn.serverName}]: ${err}`);
  }
}

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
```

## Step 3: Update `src/App.tsx`

Add MCP initialization on startup and cleanup on unmount:

```typescript
// In App.tsx, import:
import { initializeMcp, closeMcp } from './mcp.js';
import { loadRuntimeConfig } from './runtime-config.js';

// In initializeWithConfig, after building the client:
await initializeMcp();

// In the init useEffect, before reading config:
await loadRuntimeConfig();

// In the cleanup return:
return () => {
  clearApprovalHandler();
  closeMcp();
};
```

## Step 4: Configure MCP servers

Create `.protoagent/protoagent.jsonc` in your project:

```jsonc
{
  // MCP server configuration
  "mcp": {
    "servers": {
      // Example: filesystem MCP server
      // "filesystem": {
      //   "type": "stdio",
      //   "command": "npx",
      //   "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
      // }
    }
  }
}
```

## Verification

```bash
npm run dev
```

If you have MCP servers configured, you should see them connecting during startup (visible in debug logs). The discovered tools will be available to the model alongside the built-in tools.

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-11`.

## Core takeaway

MCP is the bridge between ProtoAgent and external tool ecosystems. Built-in tools handle the common cases, but MCP means the agent can grow to use any tool that speaks the protocol.

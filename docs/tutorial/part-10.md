# Part 10: MCP & Sub-agents

These are the two features that move ProtoAgent from "educational project" to "actually extensible tool." MCP lets you plug in external tools without changing agent code. Sub-agents let you delegate tasks without polluting context.

## What you'll build

- An MCP client that reads `.protoagent/mcp.json`, spawns servers, discovers tools, and forwards calls
- A sub-agent tool that creates isolated child conversations with their own message history
- Dynamic tool registration — MCP and sub-agent tools show up alongside built-in tools at runtime

## Key concepts

- **Model Context Protocol** — JSON-RPC over stdio. The agent sends `tools/list` to discover what a server offers, then `tools/call` to use them. It's simpler than it sounds. I wrote about [how MCP works at the protocol level](https://thomasgauvin.com/writing/learning-how-mcp-works-by-reading-logs-and-building-mcp-interceptor) if you want the full picture.
- **Context pollution** — the main reason sub-agents exist. An exploration task can generate dozens of tool calls that clutter the parent's context. Isolating it keeps the parent focused.
- **Dynamic tools** — the tool registry isn't static. Tools can be added at runtime, which is how MCP and sub-agents integrate without special-casing anything.

## MCP: plugging in external tools

MCP stands for Model Context Protocol. It's an open standard for connecting AI agents to external tool servers. The protocol itself is just JSON-RPC 2.0 over stdio — you spawn a process, write JSON to its stdin, read JSON from its stdout. That's it.

The beauty of MCP is that tools are discovered at runtime. You don't hardcode them. A server tells you what it can do, and you make those tools available to the model alongside your built-in ones. Want to add a database tool, a Kubernetes tool, a GitHub tool? Drop a config entry and restart. No code changes.

The config lives in `.protoagent/mcp.json`:

```json
{
  "servers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@my/mcp-server"],
      "env": { "API_KEY": "..." }
    }
  }
}
```

Each entry describes how to spawn a server process. `command` and `args` are what you'd pass to `spawn()`. `env` lets you inject environment variables — API keys, config — without leaking them into your shell.

## The MCP connection

The `McpConnection` class wraps one server process. The constructor spawns it, hooks up the plumbing, and gets ready to exchange messages.

```typescript
class McpConnection {
  private process: ChildProcess;
  private nextId = 1;
  private pending = new Map<number, {
    resolve: (val: any) => void;
    reject: (err: Error) => void;
  }>();
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
}
```

A few things to notice:

- `stdio: ['pipe', 'pipe', 'pipe']` gives us control over stdin, stdout, and stderr. Stdin is our write channel, stdout is our read channel, stderr goes to debug logs.
- We merge `config.env` into `process.env` so the child process inherits the parent's environment plus anything extra the config specifies.
- `readline` gives us line-by-line parsing of stdout. Each JSON-RPC message is one line — that's the MCP stdio transport convention.
- `pending` is a map of in-flight requests. We'll come back to this.

## The send/receive pattern

JSON-RPC is a request/response protocol, but stdio is just a stream. There's no built-in way to match a response to its request. That's what the `id` field and the `pending` map are for.

When you send a request, you generate an ID, stash a promise's `resolve`/`reject` in the map, and write the JSON to stdin:

```typescript
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
```

When a line comes back on stdout, `handleLine` parses it, looks up the matching promise by ID, and resolves or rejects it:

```typescript
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
```

This is a common pattern for multiplexing requests over a single stream. The 30-second timeout prevents leaked promises if a server hangs or crashes without responding. Non-JSON lines get silently ignored — some servers emit log output on stdout, and we don't want that to blow things up.

## Initialization handshake

MCP has a three-step startup sequence. It's like a handshake — both sides confirm they speak the same protocol before doing real work.

```typescript
async initialize(): Promise<void> {
  // Step 1: Send initialize request
  const result = await this.send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'protoagent', version: '0.0.1' },
  });

  // Step 2: Send initialized notification (no response expected)
  this.process.stdin!.write(JSON.stringify({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }) + '\n');

  // Step 3: Discover tools
  const toolsResult = await this.send('tools/list', {});
  this.tools = toolsResult?.tools || [];
}
```

Step 1 is a proper request/response. You tell the server which protocol version you support and who you are. The server responds with its own info and capabilities.

Step 2 is a notification — note there's no `id` field, which means no response is expected. This tells the server "I've processed your init response, we're good to go."

Step 3 is where the interesting part happens. `tools/list` asks the server what tools it provides. The response is an array of tool definitions — name, description, and a JSON schema for the input. This is the same shape we use for OpenAI function calling, which is no coincidence.

## Tool discovery and registration

Once we know what tools a server offers, we need to make them available to the model. That's what `initializeMcp` does — it reads the config, connects to each server, and registers every discovered tool.

```typescript
export async function initializeMcp(): Promise<void> {
  const configPath = path.join(process.cwd(), '.protoagent', 'mcp.json');

  let config: McpConfig;
  try {
    const content = await fs.readFile(configPath, 'utf8');
    config = JSON.parse(content) as McpConfig;
  } catch {
    return; // No config file — that's fine
  }

  for (const [name, serverConfig] of Object.entries(config.servers)) {
    const conn = new McpConnection(name, serverConfig);
    await conn.initialize();
    connections.set(name, conn);

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
  }
}
```

The naming convention is important: `mcp_${serverName}_${toolName}`. If you have a server called `github` with a tool called `create_issue`, it becomes `mcp_github_create_issue`. This prevents name collisions between servers and between MCP tools and built-in tools.

The description gets prefixed with `[MCP: serverName]` so the model knows where the tool comes from. This isn't strictly necessary, but it helps the model make better decisions about which tools to use when.

Each tool gets two registrations: a definition (so it appears in the tools array sent to the model) and a handler (so we know what to do when the model calls it). The handler is a closure over the connection — it captures `conn` and calls `callTool` with the original MCP tool name, stripping the prefix.

If the config file doesn't exist, `initializeMcp` returns silently. Most projects won't have MCP servers configured, and that's fine.

## Calling MCP tools

When the model decides to use an MCP tool, the handler calls `callTool` on the connection:

```typescript
async callTool(name: string, args: any): Promise<string> {
  const result = await this.send('tools/call', { name, arguments: args });

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
```

MCP tool results come back as arrays of content blocks — similar to how Claude's API returns content. Each block has a `type`. We extract the text from `text` blocks and stringify anything else (images, embedded resources, etc.). The blocks get joined with newlines into a single string, which is what our tool result format expects.

This is a lossy conversion. A production client would want to handle image blocks, resource blocks, and other content types properly. But for our purposes, text extraction covers the vast majority of real MCP tools.

## Sub-agents: isolated conversations

Now for the second half of this part. Sub-agents solve a very specific problem: context pollution.

Imagine the model needs to explore a codebase to find where authentication is handled. It might need to read 15 files, search for patterns, list directories. That's easily 30+ tool calls. Every single one of those tool calls and results stays in the conversation history — and the model has to process all of it on every subsequent turn.

Most of that exploration context is irrelevant after the answer is found. The model needed it to arrive at a conclusion, but the conclusion is a paragraph. The journey was 30KB of file contents.

Sub-agents fix this by running the exploration in a separate conversation. The parent says "go figure out where auth is handled." The sub-agent does all the messy exploration in its own message history. When it's done, it returns a summary to the parent. The parent's context stays clean.

## The sub-agent loop

The sub-agent is exposed as a regular tool called `sub_agent`:

```typescript
export const subAgentTool = {
  type: 'function' as const,
  function: {
    name: 'sub_agent',
    description:
      'Spawn an isolated sub-agent to handle a task without polluting the main conversation context. ' +
      'Use this for independent subtasks like exploring a codebase, researching a question, ' +
      'or making changes to a separate area. ' +
      'The sub-agent has access to the same tools but runs in its own conversation.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A detailed description of the task for the sub-agent to complete.',
        },
        max_iterations: {
          type: 'number',
          description: 'Maximum tool-call iterations for the sub-agent. Defaults to 30.',
        },
      },
      required: ['task'],
    },
  },
};
```

The `runSubAgent` function creates an entirely separate conversation. It has its own system prompt, its own message array, its own tool-use loop:

```typescript
export async function runSubAgent(
  client: OpenAI,
  model: string,
  task: string,
  maxIterations = 30,
  onProgress?: (message: string) => void
): Promise<string> {
  const systemPrompt = await generateSystemPrompt();
  const subSystemPrompt = `${systemPrompt}

## Sub-Agent Mode

You are running as a sub-agent. You were given a specific task by the parent agent.
Complete the task thoroughly and return a clear, concise summary of what you did and found.
Do NOT ask the user questions — work autonomously with the tools available.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: subSystemPrompt },
    { role: 'user', content: task },
  ];

  for (let i = 0; i < maxIterations; i++) {
    const response = await client.chat.completions.create({
      model,
      messages,
      tools: getAllTools(),
      tool_choice: 'auto',
    });

    const message = response.choices[0]?.message;
    if (!message) break;

    if (message.tool_calls && message.tool_calls.length > 0) {
      messages.push(message as any);

      for (const toolCall of message.tool_calls) {
        const { name, arguments: argsStr } = (toolCall as any).function;
        onProgress?.(`  [sub-agent] ${name}`);

        try {
          const args = JSON.parse(argsStr);
          const result = await handleToolCall(name, args);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          } as any);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: `Error: ${msg}`,
          } as any);
        }
      }
      continue;
    }

    // Plain text response — we're done
    return message.content || '(sub-agent completed with no response)';
  }

  return '(sub-agent reached iteration limit)';
}
```

A few things worth highlighting:

**The system prompt gets appended, not replaced.** The sub-agent gets the same base system prompt as the parent — same tool instructions, same project context — plus a "Sub-Agent Mode" section telling it to work autonomously and not ask questions. This is important. If you ask a sub-agent a question, there's no user to answer it. It has to figure things out on its own.

**Non-streaming.** The main agentic loop streams responses for better UX. The sub-agent doesn't bother — it uses plain `chat.completions.create` instead of the streaming variant. Nobody's watching the sub-agent type. We do report tool calls via `onProgress` so the user can see something is happening, but the actual text generation is opaque.

**The termination condition is simple.** If the model responds with text (no tool calls), we're done. Return the text. If it keeps calling tools for `maxIterations` rounds, bail out with a limit message. No streaming assembly, no delta tracking — just a straightforward request/response loop.

**It uses the same tools.** `getAllTools()` returns everything — built-in tools, MCP tools, even `sub_agent` itself. Technically a sub-agent could spawn its own sub-agent. In practice, models rarely do this, and the `maxIterations` cap prevents runaway nesting.

## Special handling in the agentic loop

The sub-agent tool needs special handling in the main agentic loop because it doesn't go through the normal `handleToolCall` dispatcher. It needs access to the OpenAI client and model name:

```typescript
// In agentic-loop.ts
if (name === 'sub_agent') {
  result = await runSubAgent(
    client,
    model,
    args.task,
    args.max_iterations,
    (msg) => onEvent({ type: 'text_delta', content: msg + '\n' })
  );
} else {
  result = await handleToolCall(name, args);
}
```

This is the one place where a tool gets special-cased outside the registry. It's a pragmatic choice — `runSubAgent` needs the `client` and `model` that only the agentic loop has, and threading those through the generic handler interface would complicate things for every other tool. Sometimes a small special case is cleaner than a general abstraction.

## Dynamic tools

Both MCP tools and the sub-agent tool plug into the same dynamic tool system in `tools/index.ts`. Here's how it works:

```typescript
// Static tools — always present
export const tools = [
  readFileTool, writeFileTool, editFileTool,
  listDirectoryTool, searchFilesTool, bashTool,
  todoReadTool, todoWriteTool,
];

// Dynamic tools — added at runtime
let dynamicTools: typeof tools = [];

export function registerDynamicTool(tool: (typeof tools)[number]): void {
  dynamicTools.push(tool);
}

export function getAllTools() {
  return [...tools, ...dynamicTools];
}

// Dynamic handlers — for dispatching calls to dynamic tools
const dynamicHandlers = new Map<string, (args: any) => Promise<string>>();

export function registerDynamicHandler(
  name: string,
  handler: (args: any) => Promise<string>
): void {
  dynamicHandlers.set(name, handler);
}
```

When the agentic loop calls `getAllTools()` to send tool definitions to the model, it gets both static and dynamic tools in one array. When a tool call comes back, `handleToolCall` checks the static tools first (via the switch statement), then falls through to the dynamic handlers map.

This is the same pattern that makes MCP tools seamless. The model doesn't know or care whether a tool is built-in or comes from an MCP server. It sees a list of tools with names, descriptions, and schemas. It picks one. The dispatch layer figures out where to send the call.

The sub-agent tool definition gets registered as a dynamic tool during startup. MCP tools get registered when `initializeMcp` runs. By the time the first user message arrives, everything is in the `getAllTools()` array and ready to go.

There's a nice symmetry here: the tool registry is the integration point for everything. Built-in tools define themselves statically. MCP tools discover themselves over the protocol and register dynamically. The sub-agent registers its definition dynamically and gets special handling for dispatch. But from the model's perspective, they're all just tools.

---

## Next up

[Part 11: Polish & UI](/tutorial/part-11) — tool call display, loading states, error recovery, and markdown rendering. The difference between something that works and something that's pleasant to use.

# Part 4: The Agentic Loop

This is the big one. Up to this point, we've had a chatbot — you type, the AI responds, that's it. In this part, we turn it into an agent by adding tool-calling support.

The agentic loop is the core pattern that powers every coding agent. It's surprisingly simple once you see it: call the LLM, check if it wants to use a tool, execute the tool, feed the result back, repeat. That's it. Everything else is just adding more tools.

## What you'll build

- An `AgenticLoop` module that implements the tool-use loop
- A tool registry with a dispatcher
- Streaming response handling with tool call argument accumulation
- Event-based decoupling so the loop doesn't know about the UI

## Key concepts

- **The tool-use loop** — the LLM can either respond with text (done) or request tool calls (keep going). You loop until it stops requesting tools.
- **Tool call streaming** — the LLM doesn't give you the full tool call at once. Arguments arrive as `delta` chunks that you need to accumulate across multiple stream events.
- **Events over direct rendering** — the loop emits events (text deltas, tool calls, results, errors) and the Ink UI subscribes to them. This keeps the core logic testable without any UI.

## The pattern

Here's the entire agentic loop as pseudocode:

```
while true:
    response = call_llm(messages, tools)
    if response has tool_calls:
        for each tool_call:
            result = execute(tool_call)
            messages.push(result)
        continue
    else:
        return response.text
```

That's genuinely it. The LLM either responds with plain text — meaning it's done thinking and wants to talk to the user — or it responds with one or more tool calls, meaning it needs to do something first. You execute those tools, push the results back into the conversation, and call the LLM again so it can see what happened.

The key insight is that the LLM decides when it's done. You don't write logic to determine "should we call another tool?" — the model handles that. Your job is just to faithfully execute whatever it asks for and feed the results back. The loop terminates naturally when the model responds with text instead of tool calls.

We cap iterations at 100 by default as a safety valve, but in practice the model almost always finishes well before that.

## Types and events

Before we get into the loop itself, let's look at how it communicates with the outside world. The loop is a plain TypeScript module — not a React component. It has no idea what Ink is or what the terminal looks like. Instead, it emits events through a callback, and the UI subscribes to those events.

Here's the event type:

```typescript
export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
}

export type AgentEventHandler = (event: AgentEvent) => void;
```

It's a discriminated union on the `type` field. The caller passes in an `onEvent` callback, and the loop calls it whenever something interesting happens:

- `text_delta` — a chunk of text content arrived from the stream. The UI appends this to the current response.
- `tool_call` — the model wants to call a tool. Includes the tool name, args, and a status.
- `tool_result` — a tool finished executing. Status is either `done` or `error`.
- `usage` — token counts and cost estimate after each LLM call.
- `error` — something went wrong (rate limit, server error, etc.).
- `done` — the loop is finished. The model has given its final text response.

Why events instead of, say, returning a big result object? Because we're streaming. The model sends text token by token, and we want the UI to render each token as it arrives — not wait for the entire response. Events give us that incremental rendering for free.

There's also a `ToolCallEvent` type that carries the details of each tool invocation:

```typescript
export interface ToolCallEvent {
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}
```

The `status` field lets the UI show a spinner while a tool is running, then swap it for the result when it's done. Pretty straightforward.

## The loop

Now the main function. `runAgenticLoop` takes the OpenAI client, model name, current conversation history, the new user input, the event callback, and some options. It returns the updated message array.

```typescript
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;

  const updatedMessages: Message[] = [
    ...messages,
    { role: 'user', content: userInput } as Message,
  ];

  let iterationCount = 0;

  while (iterationCount < maxIterations) {
    iterationCount++;
    // ... the interesting stuff
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}
```

A few things to notice. First, we copy the messages array and append the user's input — we don't mutate the caller's array. Second, the while loop is the beating heart. Each iteration is one LLM call. If the model responds with tool calls, we execute them and `continue`. If it responds with text, we `return`. If we somehow hit the iteration cap, we emit an error and bail.

Inside the loop, the first thing we do is build the tools list and make the streaming API call:

```typescript
const allTools = [...getAllTools(), subAgentTool];

const stream = await client.chat.completions.create({
  model,
  messages: updatedMessages,
  tools: allTools,
  tool_choice: 'auto',
  stream: true,
  stream_options: { include_usage: true },
});
```

`getAllTools()` returns the static tools plus any dynamically registered ones (from MCP servers — more on that in a later part). We also tack on the `subAgentTool` for delegating tasks. `tool_choice: 'auto'` means the model decides whether to call tools or just respond with text. And `stream_options: { include_usage: true }` asks the API to send token counts at the end of the stream, which we use for cost tracking.

After the stream finishes, we check what we got. If there are tool calls, we execute them:

```typescript
if (assistantMessage.tool_calls.length > 0) {
  assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
  updatedMessages.push(assistantMessage);

  for (const toolCall of assistantMessage.tool_calls) {
    const { name, arguments: argsStr } = toolCall.function;
    onEvent({ type: 'tool_call', toolCall: { name, args: argsStr, status: 'running' } });

    try {
      const args = JSON.parse(argsStr);
      const result = await handleToolCall(name, args);

      updatedMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      } as any);

      onEvent({ type: 'tool_result', toolCall: { name, args: argsStr, status: 'done', result } });
    } catch (err) {
      // push error result so the LLM knows what happened
    }
  }
  continue; // back to the top of the while loop
}
```

Notice the `filter(Boolean)` — that cleans up any sparse array gaps from the streaming accumulation (we'll get to that in a moment). Each tool result gets pushed as a `tool` role message with the `tool_call_id` linking it back to the request. This is how the OpenAI API knows which result goes with which tool call. Then we `continue` to let the model see the results.

If there are no tool calls, it's a plain text response — we're done:

```typescript
if (assistantMessage.content) {
  updatedMessages.push({
    role: 'assistant',
    content: assistantMessage.content,
  } as Message);
}
onEvent({ type: 'done' });
return updatedMessages;
```

The error handling at the bottom of the try/catch is worth mentioning too. On a 429 (rate limit), we read the `retry-after` header and wait. On 5xx errors, we do exponential backoff. Anything else — bad request, auth failure, etc. — we give up and emit the error. This means the loop is reasonably resilient to transient API issues without needing external retry logic.

```typescript
if (apiError?.status === 429) {
  const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
  const backoff = Math.min(retryAfter * 1000, 60_000);
  onEvent({ type: 'error', error: `Rate limited. Retrying in ${backoff / 1000}s...` });
  await new Promise((r) => setTimeout(r, backoff));
  continue;
}
```

## Tool call streaming

This is the trickiest part of the whole module, and it's easy to get wrong.

When you stream a completion from the OpenAI API, tool calls don't arrive fully formed. They come in as deltas across multiple chunks, just like text content does. But unlike text — where you just concatenate strings — tool calls have structure. Each chunk gives you a partial update: maybe just the tool call ID, then the function name, then the arguments in small pieces.

Here's how the accumulation works:

```typescript
const assistantMessage: any = {
  role: 'assistant',
  content: '',
  tool_calls: [],
};
let streamedContent = '';

for await (const chunk of stream) {
  const delta = chunk.choices[0]?.delta;

  if (delta?.content) {
    streamedContent += delta.content;
    assistantMessage.content = streamedContent;
    onEvent({ type: 'text_delta', content: delta.content });
  }

  if (delta?.tool_calls) {
    hasToolCalls = true;
    for (const tc of delta.tool_calls) {
      const idx = tc.index || 0;
      if (!assistantMessage.tool_calls[idx]) {
        assistantMessage.tool_calls[idx] = {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        };
      }
      if (tc.id) assistantMessage.tool_calls[idx].id = tc.id;
      if (tc.function?.name) assistantMessage.tool_calls[idx].function.name += tc.function.name;
      if (tc.function?.arguments) assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
    }
  }
}
```

The crucial detail is `tc.index`. When the model calls multiple tools in one response, each tool call gets an index. The deltas tell you which tool call they belong to via that index. The first chunk for tool call 0 might give you the ID and function name. Then subsequent chunks give you the arguments string in pieces. Meanwhile, chunks for tool call 1 can be interleaved in.

So you maintain an array, use the index to find the right slot, and concatenate each piece as it arrives. If the slot doesn't exist yet, you initialize it with empty strings. By the time the stream ends, you have the complete tool calls.

The reason `arguments` arrives in pieces is because it's a JSON string, and JSON can be arbitrarily long. For a simple tool like `read_file`, the arguments might be `{"file_path": "src/index.ts"}` — small enough to arrive in one or two chunks. But for `write_file`, the arguments include the entire file content, which could be thousands of tokens.

One gotcha: the `arguments` field is a JSON string, not a parsed object. You need to `JSON.parse()` it yourself after the stream finishes. If parsing fails — maybe the model produced malformed JSON — you'll catch that when you try to execute the tool call.

## The tool registry

Tools live in `src/tools/`, one file per tool. The registry in `src/tools/index.ts` collects them all and provides a dispatcher.

The setup is simple. Import each tool's definition and handler, put the definitions in an array:

```typescript
import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
// ... and so on

export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  bashTool,
  todoReadTool,
  todoWriteTool,
];
```

This array is what gets sent to the LLM. The model reads these definitions to understand what tools it has and how to call them.

Then there's a dispatcher — a switch statement that routes tool calls to the right handler:

```typescript
export async function handleToolCall(toolName: string, args: any): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit);
      case 'write_file':
        return await writeFile(args.file_path, args.content);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements);
      // ...
      default: {
        const handler = dynamicHandlers.get(toolName);
        if (handler) {
          return await handler(args);
        }
        return `Error: Unknown tool "${toolName}"`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${toolName}: ${msg}`;
  }
}
```

There's nothing clever here, and that's on purpose. A switch statement is easy to read, easy to debug, and fast. The `default` case checks the dynamic handlers map — that's where MCP tools end up after they're registered at runtime.

Notice that errors are caught and returned as strings, not thrown. Tool results in the OpenAI API are always strings. If a tool fails, the model needs to see the error message so it can decide what to do — maybe try again with different arguments, or tell the user something went wrong. Throwing would break the loop; returning the error keeps it going.

The registry also supports dynamic tools — tools that get registered at runtime rather than being hardcoded:

```typescript
let dynamicTools: typeof tools = [];

export function registerDynamicTool(tool: (typeof tools)[number]): void {
  dynamicTools.push(tool);
}

export function getAllTools() {
  return [...tools, ...dynamicTools];
}
```

`getAllTools()` merges the static and dynamic arrays every time it's called. This is what the agentic loop calls when building the tools list for each LLM request — so if a new MCP tool gets registered mid-conversation, it'll show up on the next iteration.

## Your first tool: read_file

Let's look at how a tool is actually structured. Each tool file exports two things: a definition (the JSON schema the LLM sees) and a handler (the function that runs when the tool is called).

Here's `read-file.ts` in its entirety:

```typescript
import fs from 'node:fs/promises';
import { validatePath } from '../utils/path-validation.js';

export const readFileTool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers. Use offset and limit to read specific sections of large files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read (relative to working directory).' },
        offset: { type: 'number', description: 'Line number to start reading from (0-based). Defaults to 0.' },
        limit: { type: 'number', description: 'Maximum number of lines to read. Defaults to 2000.' },
      },
      required: ['file_path'],
    },
  },
};

export async function readFile(filePath: string, offset = 0, limit = 2000): Promise<string> {
  const validated = await validatePath(filePath);
  const content = await fs.readFile(validated, 'utf8');
  const lines = content.split('\n');

  const start = Math.max(0, offset);
  const end = Math.min(lines.length, start + limit);
  const slice = lines.slice(start, end);

  const numbered = slice.map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, ' ');
    const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
    return `${lineNum} | ${truncated}`;
  });

  const header = `File: ${filePath} (${lines.length} lines total, showing ${start + 1}-${end})`;
  return `${header}\n${numbered.join('\n')}`;
}
```

The definition follows the OpenAI function-calling schema exactly. The `description` matters a lot — it's what the model uses to decide when to call this tool. The `parameters` block tells the model what arguments it can pass and which ones are required.

The handler is just a regular async function. It validates the path (preventing directory traversal attacks), reads the file, slices it to the requested range, adds line numbers, and returns the whole thing as a string. Line numbers are 1-based because that's what developers expect. Long lines get truncated at 2000 characters because sending megabytes of minified JavaScript to the LLM would just waste tokens.

This is the pattern every tool follows: definition + handler, both exported from the same file. Want to add a new tool? Create a new file with the same shape, import it in `tools/index.ts`, add the definition to the array, add a case to the switch. Five minutes of work.

## Wiring it into the UI

The `App.tsx` component calls `runAgenticLoop` when the user submits input. It passes an `onEvent` callback that updates React state. Here's the rough shape:

```typescript
const messages = useRef<Message[]>([]);

async function handleSubmit(input: string) {
  const updated = await runAgenticLoop(
    client,
    model,
    messages.current,
    input,
    (event) => {
      switch (event.type) {
        case 'text_delta':
          // append to the current response text
          break;
        case 'tool_call':
          // add a tool call to the active tool calls list
          break;
        case 'tool_result':
          // update the tool call status
          break;
        case 'done':
          // finalize the response
          break;
      }
    }
  );
  messages.current = updated;
}
```

The event handler translates loop events into state updates, and Ink re-renders the terminal UI whenever state changes. The loop doesn't import React, doesn't know about Ink, doesn't care what renders its output. You could swap Ink for a web UI, a log file, or nothing at all — the loop would work exactly the same.

This separation is what makes the loop testable. In tests, you can pass a mock `onEvent` that just collects events into an array, then assert on what happened without rendering anything.

## What we left out

If you looked at the source closely, you probably noticed some things we glossed over:

- **Compaction** — the loop checks `getContextInfo()` at the top of each iteration and runs `compactIfNeeded()` if the conversation is getting too long for the model's context window. We'll cover that in Part 6.
- **Sub-agents** — the `sub_agent` tool gets special handling. Instead of going through `handleToolCall`, it calls `runSubAgent()` which spins up a separate agentic loop for a delegated task. Part 7 covers this.
- **MCP tools** — the dynamic tool registration system (`registerDynamicTool`, `registerDynamicHandler`) exists to support Model Context Protocol servers that provide tools at runtime. That's Part 8.
- **The `initializeMessages()` helper** — it creates the initial conversation with a system prompt generated by `generateSystemPrompt()`. We touched on system prompts back in Part 2.

None of these change the fundamental loop. They're features layered on top of the same call-check-execute-repeat pattern.

## Next up

The loop can call tools, but right now we only walked through `read_file`. In [Part 5](/tutorial/part-5), we'll build out the rest of the tool suite — file writing, editing, directory listing, search, and the bash tool — and look at how the approval system prevents the agent from doing dangerous things without your say-so.

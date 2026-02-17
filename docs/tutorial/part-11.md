# Part 11: Polish & UI

The difference between a project that works and a project that's pleasant to use comes down to polish. This part covers the small things that add up — better tool call display, loading states, error recovery, markdown rendering.

## What you'll build

- Tool call display with name, status (running/done/error), and abbreviated results
- A loading spinner while the agent is thinking
- Markdown rendering for assistant responses
- Error recovery — when a tool fails, the error gets fed back to the model so it can try a different approach
- Updated provider list with current models

## Key concepts

- **Ink rendering** — React components map to terminal output. Understanding how Ink re-renders is important for getting smooth streaming and status updates.
- **Graceful error handling** — tools fail. APIs return 429s. The agent should recover, not crash. Feeding errors back to the model as tool results lets it adapt.
- **User experience** — things like truncating long tool outputs, showing progress spinners, and formatting responses as markdown make a real difference in daily use.

## The logger

Here's a thing you might not think about until it ruins your afternoon: where does your debug output go?

ProtoAgent streams LLM responses to stdout. The model's text appears token by token on the user's terminal. If your logger also writes to stdout, those debug messages get interleaved with the model's response. The output becomes garbled. Worse — if you're piping the agent's output somewhere, the log messages corrupt the stream.

The fix is simple: all log output goes to stderr.

```typescript
function log(level: LogLevel, label: string, color: string, message: string, context?: Record<string, unknown>): void {
  if (level > currentLevel) return;
  const ts = timestamp();
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  process.stderr.write(`${color}[${ts}] ${label}${COLORS.reset} ${message}${ctx}\n`);
}
```

`process.stderr.write` instead of `console.log`. That's the entire trick. It means you can run `protoagent "refactor this file" > output.txt` and get clean model output in the file while debug logs still show up in the terminal. Unix convention — stderr is for diagnostics, stdout is for data.

The level system is standard: ERROR (0), WARN (1), INFO (2), DEBUG (3), TRACE (4). Each level includes everything below it — if you set the level to DEBUG, you also get INFO, WARN, and ERROR. The default is INFO, which keeps things quiet unless something interesting happens.

```typescript
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}
```

Each level gets its own ANSI color code — red for errors, yellow for warnings, cyan for debug, gray for trace. The color makes scanning log output fast. You don't read every line — you scan for red.

```typescript
const COLORS = {
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  reset: '\x1b[0m',
} as const;
```

There's also a `timestamp()` helper that formats the current time as `HH:MM:SS.mmm`. Millisecond precision matters when you're debugging timing issues — like why an API call took 3 seconds or why two tool calls overlapped.

The `startOperation` method wraps the common pattern of "log when something starts, log how long it took":

```typescript
startOperation(name: string): { end: () => void } {
  const start = performance.now();
  logger.debug(`${name} started`);
  return {
    end() {
      const ms = (performance.now() - start).toFixed(1);
      logger.debug(`${name} completed`, { durationMs: ms });
    },
  };
},
```

You call `const op = logger.startOperation('LLM call')` at the start and `op.end()` when it's done. The duration gets logged automatically. It's a small convenience, but you end up using it everywhere — around API calls, tool executions, file operations.

The exported `logger` object has methods for each level:

```typescript
export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.ERROR, 'ERROR', COLORS.red, msg, ctx),
  warn:  (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.WARN, 'WARN', COLORS.yellow, msg, ctx),
  info:  (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.INFO, 'INFO', COLORS.reset, msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.DEBUG, 'DEBUG', COLORS.cyan, msg, ctx),
  trace: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.TRACE, 'TRACE', COLORS.gray, msg, ctx),
  startOperation(name: string): { end: () => void } { /* ... */ },
};
```

Each method takes an optional `context` object that gets serialized as JSON at the end of the log line. So you can write `logger.debug('Tool executed', { name: 'read_file', durationMs: 42 })` and get structured data alongside the human-readable message. No log framework, no dependencies — just `process.stderr.write` with some color codes.

## The TODO tool

Most tools let the agent interact with the outside world — reading files, running commands, searching code. The TODO tool is different. It lets the agent interact with itself.

When you ask a coding agent to do something complex — "refactor this module and update all the tests" — it needs to plan. It needs to break the work into steps, track which steps are done, and know what's next. Without a planning tool, the model has to hold all of that in its context window as unstructured text, which it's not great at. The TODO tool gives it a structured place to put that plan.

The data model is minimal:

```typescript
export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}
```

An ID, a description, a status, and a priority. That's it. The items live in a plain array in memory — session-scoped, not persisted to disk. When the conversation ends, the TODO list disappears. This is by design. The list is a scratchpad for the current task, not a persistent project tracker.

There are two tools: `todo_read` and `todo_write`. The read tool takes no arguments — it just dumps the current list:

```typescript
export function readTodos(): string {
  if (todos.length === 0) {
    return 'No TODOs. Use todo_write to create a plan.';
  }

  const statusIcons: Record<string, string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  const lines = todos.map((t) => `${statusIcons[t.status]} [${t.priority}] ${t.content} (${t.id})`);
  return `TODO List (${todos.length} items):\n${lines.join('\n')}`;
}
```

The status icons — `[ ]`, `[~]`, `[x]`, `[-]` — are a nice touch. They render cleanly in the terminal and make it easy for both the model and the user to scan the list at a glance.

The write tool uses a full-replacement pattern rather than individual add/update/delete operations:

```typescript
export function writeTodos(newTodos: TodoItem[]): string {
  todos = newTodos;
  return `TODO list updated (${todos.length} items).`;
}
```

You might wonder why we don't have separate `todo_add`, `todo_update`, `todo_remove` tools. The answer is that full replacement is simpler for the model. It reads the current list, modifies it however it wants, and writes the whole thing back. One tool call instead of potentially many. The downside is that the model sends more data per call, but TODO lists are small — rarely more than 10 items — so it doesn't matter.

This pattern — read-modify-write — is worth noting because it shows up in other contexts too. It avoids the problem of the model needing to specify IDs for incremental updates, which it sometimes gets wrong.

In practice, the system prompt encourages the agent to use the TODO tool when planning complex tasks. The model will typically write a plan at the start, mark items as in-progress as it works through them, and mark them complete as it finishes. It gives the conversation a visible structure and helps the model stay on track across many iterations of the agentic loop.

## Error recovery

Tools fail. Files don't exist. Commands return non-zero. JSON is malformed. This is normal, and the agent needs to handle it without crashing.

The key design decision in ProtoAgent is that tool errors are not exceptions — they're tool results. When a tool throws, the error message gets caught and sent back to the model as a regular tool result:

```typescript
try {
  const args = JSON.parse(argsStr);
  const result = await handleToolCall(name, args);

  updatedMessages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: result,
  } as any);
} catch (err) {
  const errMsg = err instanceof Error ? err.message : String(err);

  updatedMessages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: `Error: ${errMsg}`,
  } as any);
}
```

Look at the catch block. It does the same thing as the success path — pushes a tool result message. The only difference is the content starts with `Error:`. The loop doesn't break. The model sees the error on its next iteration and can react to it.

This is powerful because LLMs are surprisingly good at recovering from errors. If `read_file` fails with "ENOENT: no such file or directory," the model might try listing the directory to find the right filename. If `edit_file` fails because the old string wasn't found, it might re-read the file and try again with the correct content. If a bash command fails, it might try a different approach.

The alternative — crashing on tool errors — would make the agent useless for real work. Real codebases have files that don't exist where you expect them, commands that fail on certain platforms, and edge cases everywhere. An agent that can't recover from a failed `grep` isn't worth much.

There's also a second layer of error handling inside `handleToolCall` itself:

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
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'bash':
        return await bash(args.command);
      case 'todo_read':
        return await todoRead();
      case 'todo_write':
        return await todoWrite(args.todos);
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

Notice that errors are returned as strings, not thrown. The dispatcher catches anything a tool handler throws and converts it to an error string. This means even if a tool has a bug that throws an unexpected exception, the loop keeps going. The model sees the error and adapts. Two layers of defense — one in the dispatcher, one in the loop — so tool failures never crash the agent.

## Retry logic

Tool errors are one thing. API errors are another.

When the LLM API itself fails, you need different strategies depending on the error type. ProtoAgent handles this in the outer try/catch of the agentic loop — the one that wraps the entire `client.chat.completions.create` call.

**429 — Rate Limited.** This is the most common API error. You're sending too many requests. The response usually includes a `retry-after` header telling you exactly how long to wait:

```typescript
if (apiError?.status === 429) {
  const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
  const backoff = Math.min(retryAfter * 1000, 60_000);
  logger.info(`Rate limited, retrying in ${backoff / 1000}s...`);
  onEvent({ type: 'error', error: `Rate limited. Retrying in ${backoff / 1000}s...` });
  await new Promise((r) => setTimeout(r, backoff));
  continue;
}
```

We read `retry-after`, cap it at 60 seconds (in case the header contains something absurd), wait, and `continue` — which means we go back to the top of the while loop and try the LLM call again. The user sees a message about being rate limited, but the agent keeps working. No intervention needed.

**5xx — Server Error.** The provider's servers are having a bad day. This happens more than you'd like, especially with high-demand models. Here we use exponential backoff:

```typescript
if (apiError?.status >= 500) {
  const backoff = Math.min(2 ** iterationCount * 1000, 30_000);
  logger.info(`Server error, retrying in ${backoff / 1000}s...`);
  onEvent({ type: 'error', error: `Server error. Retrying in ${backoff / 1000}s...` });
  await new Promise((r) => setTimeout(r, backoff));
  continue;
}
```

The backoff grows with each iteration — 2s, 4s, 8s, 16s, up to a max of 30 seconds. The idea is that if the server is overloaded, you don't want to hammer it with retries. Give it time to recover. And if it doesn't recover after several tries, you'll eventually hit the max iteration limit and the loop will exit gracefully.

**Everything else — Non-retryable.** A 400 (bad request), 401 (auth failure), 403 (forbidden) — these aren't going to get better if you retry. The agent emits the error and stops:

```typescript
// Non-retryable error
onEvent({ type: 'error', error: errMsg });
onEvent({ type: 'done' });
return updatedMessages;
```

The distinction between retryable and non-retryable errors is important. Without it, you either retry everything (wasting time on auth failures that will never succeed) or retry nothing (giving up on transient network hiccups that would resolve in seconds). The three-tier approach — respect `retry-after` for 429s, exponential backoff for 5xx, immediate failure for everything else — covers the common cases well.

Notice that both retry paths use `continue` to go back to the top of the while loop. This means retries consume iterations from the same `maxIterations` budget. If the API is down and you retry 100 times, you'll hit the iteration cap and exit with "Maximum iteration limit reached." That's the safety valve — the loop always terminates, even under pathological conditions.

## Small things that add up

There are a handful of other polish details scattered across the codebase that don't warrant their own section but are worth pointing out.

**Line number formatting.** When `read_file` returns file contents, each line gets a right-aligned 5-digit line number followed by a pipe:

```typescript
const lineNum = String(start + i + 1).padStart(5, ' ');
const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
return `${lineNum} | ${truncated}`;
```

This seems trivial, but it matters. When the model wants to edit a file, it can reference exact line numbers. When the user is reading tool results, the line numbers help them find the code being discussed. The 5-digit padding keeps things aligned whether you're looking at line 1 or line 10,000.

**Output truncation.** Lines longer than 2,000 characters get truncated. This protects against minified files, binary-ish content, and giant JSON blobs eating up the model's context window. A 50KB minified JavaScript file would waste thousands of tokens if sent in full — tokens that could be used for actual reasoning.

**The overall philosophy.** None of these things — stderr logging, colored output, status icons, line numbers, truncation — are features you'd put on a slide deck. They're the kind of details that separate something you use once from something you use every day. They don't make the agent smarter, but they make it less annoying. And in a tool you're going to sit in front of for hours, that matters a lot.

## What's next

There is no next part. You've built a complete coding agent.

Across these eleven parts, you went from an empty directory to a working AI assistant that can read and write files, run shell commands, search codebases, manage its own task list, connect to external tool servers via MCP, delegate work to sub-agents, track costs, handle long conversations through compaction, and recover gracefully from errors. The whole thing is around 2,000 lines of TypeScript.

More importantly, you understand how it works. Not at a "I read a blog post about it" level — at a "I can read every line" level. The agentic loop, the tool-use pattern, the streaming protocol, the error handling, the context management. These are the same mechanics that power production agents like OpenCode, Codex, and Claude Code. The implementations differ, but the core patterns are the same.

If you want to keep going, here are some directions:

- **Better UI** — syntax highlighting in tool results, collapsible tool call sections, a web frontend instead of the terminal
- **Sandboxing** — run tool calls in a Docker container or VM so the agent can't damage the host system
- **LSP integration** — connect to language servers for type checking and diagnostics instead of relying on the model's knowledge
- **Session branching** — let the user fork a conversation to explore multiple approaches without losing the original thread
- **More tools** — image generation, web browsing, database queries, git operations as first-class tools
- **Prompt caching** — take advantage of provider-specific caching to reduce costs on repeated system prompts

ProtoAgent is intentionally minimal. It's a foundation, not a product. The point was always to understand the mechanics well enough that extending in any direction feels straightforward. If you've followed along, you're there.

Back to the [tutorial index](/tutorial/).

# ProtoAgent Architecture

ProtoAgent is a terminal-based coding agent built around a small number of modules with clear responsibilities:

- a Commander CLI entrypoint
- an Ink app that owns runtime orchestration and rendering
- a streaming agent loop
- a tool registry with static and dynamic tools
- persistence and extension layers for config, sessions, skills, MCP, and sub-agents

This document describes how the current implementation in `src/` actually works.

For the companion feature-and-behavior reference, see `SPEC.md`.

## 1. High-level structure

```text
protoagent CLI
  -> App (Ink)
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools
        -> Dynamic tools from MCP and skills
        -> Special sub-agent execution path
```

At runtime, the user interacts only with the Ink UI. The UI delegates model/tool work to `src/agentic-loop.ts`, which emits events back into the UI rather than rendering directly.

## 2. Module map

### Entry and shell

- `src/cli.tsx`
  - Parses `--dangerously-accept-all`, `--log-level`, `--session`, and the `configure` subcommand.
  - Renders either `App` or `ConfigureComponent`.

### Main application layer

- `src/App.tsx`
  - Main Ink application.
  - Owns config/session/UI state, MCP lifecycle, approval integration, slash commands, current conversation state, and persistence after each turn.
  - Despite its top comment, it is both presentation and orchestration.

### Core runtime

- `src/agentic-loop.ts`
  - Runs the streaming tool-use loop.
  - Refreshes the system prompt, compacts context when needed, streams model output, accumulates tool calls, executes tools, retries transient failures, and returns final message history.

- `src/system-prompt.ts`
  - Builds a dynamic system prompt from cwd, a filtered directory tree, the current tool registry, and discovered skills.

- `src/sub-agent.ts`
  - Defines the `sub_agent` tool and runs isolated child-agent loops.

### Configuration and model metadata

- `src/config.tsx`
  - Stores config under the user's data directory.
  - Provides the standalone config wizard and shared config read/write helpers.

- `src/providers.ts`
  - Provider/model catalog.
  - Supplies base URLs, environment variable names, pricing, and context windows.

### Persistence

- `src/sessions.ts`
  - Creates, loads, saves, lists, and deletes JSON session files.
  - Persists completion messages, provider/model metadata, and per-session TODO state.

### Extension systems

- `src/skills.ts`
  - Discovers validated skill directories.
  - Registers the dynamic `activate_skill` tool.
  - Extends allowed filesystem roots to activated skill directories.

- `src/mcp.ts`
  - Loads merged `protoagent.jsonc` runtime config.
  - Connects to stdio or HTTP MCP servers.
  - Registers MCP tools dynamically.

### Tool system

- `src/tools/index.ts`
  - Static built-in tool registry.
  - Dynamic tool and handler registries.
  - Central dispatch for tool execution.

- Built-in tools in `src/tools/*`
  - `read-file.ts`
  - `write-file.ts`
  - `edit-file.ts`
  - `list-directory.ts`
  - `search-files.ts`
  - `bash.ts`
  - `todo.ts`
  - `webfetch.ts`

### UI components and formatting helpers

- `src/components/FormattedMessage.tsx`
- `src/components/LeftBar.tsx`
- `src/utils/format-message.tsx`

These handle Markdown-ish formatting, left-bar indicators for callouts, and structured message rendering.

### Shared utilities

- `src/utils/approval.ts`
- `src/utils/path-validation.ts`
- `src/utils/compactor.ts`
- `src/utils/cost-tracker.ts`
- `src/utils/logger.ts`

## 3. Startup Flow

### CLI startup

1. `src/cli.tsx` parses arguments.
2. It renders either:
   - `App` for normal interactive use, or
   - `ConfigureComponent` for `protoagent configure`.

### App initialization

When `App` mounts, it performs these steps:

1. sets log level and initializes a log file if logging is enabled
2. enables global auto-approval if `--dangerously-accept-all` was passed
3. registers an interactive approval handler with `src/utils/approval.ts`
4. reads config from disk
5. shows inline first-run setup if config is missing
6. builds the OpenAI client from the chosen provider/model
7. initializes MCP, which may register dynamic tools
8. loads the requested session or creates a new one
9. initializes conversation messages with a fresh system prompt

Cleanup on unmount clears the approval handler and closes MCP connections.

## 4. Turn Execution Flow

### User input path

When the user submits input in `App`:

1. slash commands are handled locally if the message starts with `/`
2. otherwise, the user message is appended immediately for responsive UI feedback
3. an `AbortController` is created for the active completion
4. `runAgenticLoop()` is called with:
   - the OpenAI client
   - the selected model
   - current message history
   - pricing info
   - the abort signal
   - the current session ID
   - an event callback into the UI

### Agent loop path

Inside `src/agentic-loop.ts`, each iteration does the following:

1. abort check
2. refresh the top system prompt
3. compact history if context usage is high
4. build the tool list from:
   - static tools
   - dynamic tools
   - the special `sub_agent` tool
5. call the model with streaming enabled
6. accumulate:
   - assistant text deltas
   - streamed tool call fragments
   - usage information
7. if tool calls are returned:
   - append the assistant tool-call message
   - execute each tool
   - append tool result messages
   - continue looping
8. if plain assistant text is returned:
   - append the final assistant message
   - emit `done`
   - return updated history

### Event channel back to the UI

The loop emits these event types:

- `text_delta`
- `tool_call`
- `tool_result`
- `sub_agent_iteration` — progress from within a running sub-agent (tool name + status per iteration); distinct from `tool_call` so the UI shows it in the spinner only and does not pollute the parent's tool-call message history
- `usage`
- `error`
- `done`
- `iteration_done`

`App` consumes these events to build live assistant messages, render tool output, show retries/errors, and update usage state.

## 5. Message and Session Model

### Conversation state

The canonical in-memory history in the app is `completionMessages`, which uses OpenAI chat-completions message objects.

`App` also keeps an `assistantMessageRef` so streaming UI updates can mutate the currently-rendered assistant message before the final history replacement comes back from the loop.

### Session state

Each session contains:

- `id`
- `title`
- `createdAt`
- `updatedAt`
- `model`
- `provider`
- `todos`
- `completionMessages`

After each successful turn, `App` updates the active session with:

- latest messages
- current TODOs from `src/tools/todo.ts`
- a generated title

and then saves the session to disk.

## 6. Tool Architecture

### Static tools

Built-in tools are always available through `src/tools/index.ts`:

- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `search_files`
- `bash`
- `todo_read`
- `todo_write`
- `webfetch`

### Dynamic tools

Dynamic tools can be registered at runtime by:

- MCP connections in `src/mcp.ts`
- the skills system in `src/skills.ts`

Dynamic tools and dynamic handlers are stored separately so the model-facing schema list and execution dispatch stay in sync.

### Special-case tool: `sub_agent`

`sub_agent` is not part of the normal tool registry. The agent loop appends it when making model requests and handles it specially by calling `runSubAgent()`.

That means:

- the model can use `sub_agent`
- the main tool registry does not dispatch it
- the generated prompt text from `getAllTools()` does not automatically document it

## 7. Safety Model

### Path restrictions

File tools call `validatePath()` from `src/utils/path-validation.ts`.

Current rules:

- paths must resolve inside `process.cwd()`
- symlink targets must still resolve inside an allowed root
- non-existent files are validated by checking the parent directory
- activated skill directories are added as extra allowed roots

### Approval system

`src/utils/approval.ts` holds global approval state:

- `dangerouslyAcceptAll`
- an interactive approval callback supplied by `App`
- a per-session approval cache

Current approval categories are:

- `file_write`
- `file_edit`
- `shell_command`

Tool implementations typically pass a `sessionScopeKey`, so session approvals are narrower than a broad “approve all writes forever” model; in practice they are usually scoped to a file path or exact shell command family.

### Shell execution

`src/tools/bash.ts` uses a three-tier model:

1. hard-blocked dangerous patterns
2. safe commands that auto-run
3. everything else requiring approval

This is not sandboxing. Approved shell commands run through `shell: true` and can access the wider machine.

## 8. Skills Architecture

The skills system in `src/skills.ts` is both discovery and runtime mutation.

### Discovery

It scans project and user skill roots for directories containing `SKILL.md` with YAML frontmatter.

### Validation

It validates:

- skill name
- description
- directory-name match
- optional metadata fields

### Runtime effects

When skills are initialized:

- available skills are discovered
- `activate_skill` may be registered dynamically
- skill directories are added to allowed filesystem roots
- the system prompt gets a catalog of available skills

Because `generateSystemPrompt()` calls `initializeSkillsSupport()`, prompt generation has side effects on tool registration and path permissions.

## 9. MCP Architecture

`src/mcp.ts` reads merged `protoagent.jsonc` config and supports two transport types:

- `stdio`
- `http` via `StreamableHTTPClientTransport`

For each configured server, ProtoAgent:

1. connects the client
2. lists server tools
3. registers each tool as a dynamic namespaced tool
4. registers a matching dynamic handler that calls back into the MCP server

Connections are stored in a process-level map and closed on shutdown.

## 10. Sub-Agent Architecture

`src/sub-agent.ts` creates isolated child runs for focused work.

### Child run behaviour

- generates a fresh system prompt
- appends an extra "Sub-Agent Mode" instruction block
- starts a new message history with that prompt plus the delegated task
- reuses the same OpenAI client and model
- uses `getAllTools()` for child tool access
- loops independently until it returns a final answer or hits its iteration limit

The child does not recursively expose `sub_agent`, so nested delegation is intentionally prevented by implementation shape.

Because child runs use the same process-level tool handlers, file edits and non-safe shell commands can still trigger the normal approval mechanism.

### Abort propagation

The parent's `AbortSignal` is passed to `runSubAgent()`, to the child's `client.chat.completions.create()` call, and to each `handleToolCall()` invocation. Pressing Escape stops the child as soon as the in-flight request or tool call acknowledges the signal.

### UI progress isolation

Sub-agent tool steps are reported to the parent via `onProgress` callbacks, which the agentic loop converts to `sub_agent_iteration` events. The UI handles these by updating the spinner label (`Running sub_agent → bash...`) without adding them to the parent's `completionMessages` or `assistantMessageRef`. This keeps the parent conversation history clean.

## 11. Conversation Compaction and Cost Tracking

### Cost tracking

`src/utils/cost-tracker.ts` provides:

- rough token estimation
- conversation token counting
- estimated dollar cost from provider pricing
- context utilization calculations

### Compaction

`src/utils/compactor.ts` compacts history at 90% context usage by:

1. keeping the first system message
2. keeping a small tail of recent messages verbatim
3. preserving protected skill-content tool messages
4. summarizing older middle history through a dedicated summarization prompt

The output is a rebuilt message list with a synthetic summary system message.

## 12. Terminal UI

### Primary UI responsibilities in `App`

`App` owns:

- config/bootstrap flow
- session load/save state
- live conversation rendering
- slash command handling
- keyboard shortcuts
- approval prompts
- inline setup
- loading and usage display
- MCP initialization/cleanup
- **view cycling between Bot, Queue, and Cron views**

### View Architecture

The UI uses a three-view system, cycled via **Tab key**:

**Bot View** — The main chat interface
- Message history with streaming responses
- Input bar for typing messages
- Status bar showing agent activity
- Tool call displays and approval prompts

**Queue View** — Queue workflow visualization
- ASCII art diagram of the queue workflow
- List of queued messages and interjects
- Shows processing order and pending work

**Cron View** — Cron workflow visualization
- ASCII art diagram of the cron workflow
- Schedule configuration display
- Countdown to next execution
- Last run timestamp

Only one view is visible at a time. The status bar displays the current view (`[bot]`, `[queue]`, `[cron]`) along with the active workflow type indicator.

### View Switching

The `cycleViews()` function handles Tab key navigation:
- Cycles: Bot → Queue → Cron → Bot
- Each view switch updates the `currentView` state
- View-specific content is updated when the view becomes active
- The workflow type is also cycled to match: queue → loop → cron

### Rendering helpers

- `FormattedMessage` parses mixed text/table/code output
- `LeftBar` renders a bold green `│` bar on the left side of callout content (tool calls, approvals, errors, code blocks)

### Rendering helpers

- `FormattedMessage` parses mixed text/table/code output
- `LeftBar` renders a bold green `│` bar on the left side of callout content (tool calls, approvals, errors, code blocks)

Tool results are rendered as compact one-line summaries: `▶ tool_name: result...`

### LeftBar: why not Box borders

The obvious way to draw a left-side visual indicator in Ink is `<Box borderStyle="single">`, but Box borders add lines on all four sides and contribute extra rows to Ink's managed output region. Because Ink erases by line count on every re-render, every extra row increases the chance of ghosting artifacts when the terminal is resized — stale lines are left behind if the new frame is shorter than the old one.

`LeftBar` avoids this entirely. It is a plain flex row: a narrow `<Text>` column on the left that renders `│` repeated once per content row, and a `flexGrow` content column on the right. The height of the bar is derived by measuring the content box after each render with Ink's built-in `measureElement`, then setting the bar string to `Array(height).fill('│').join('\n')`. No Box border, no extra rows — the total line count of the component is exactly equal to the line count of its children.

### Why stock Ink causes flickering and ghosting

Ink renders a React tree to a string on every state change, then uses `log-update` to erase the previous output and write the new string. It tracks how many lines the last render produced and moves the cursor up by that many lines to overwrite. This strategy has a failure mode on terminal resize: Ink only erases the number of lines it thinks it owns. On terminal width *decreases* it clears the screen; on width *increases* it does not — it just re-renders at the new width using its stored (stale) line count. If the frame was previously taller at a narrower width and is now shorter at a wider width, old lines remain on screen below the new output (ghosting).

## 13. Important Implementation Nuances

These details are easy to miss but matter for an accurate mental model:

- `App.tsx` is the real runtime coordinator, not just a presentational wrapper.
- the system prompt is regenerated on startup, on resume, and again at the start of every turn
- skills initialization mutates both the tool registry and allowed path roots
- `sub_agent` is available to the model but not part of `getAllTools()`
- approved shell commands are powerful and not sandboxed
- `validatePath()` requires the parent directory of a new file to already exist, even though `write_file` later calls `mkdir(..., recursive: true)`
- `handleToolCall()` usually returns error strings instead of throwing, so many tool failures flow back to the model as normal tool results
- `/quit` persists and shows a resume command, while `Ctrl-C` exits immediately
- `/help` appends a `system` message into history rather than rendering a temporary overlay
- session resume replaces the first saved system prompt with a freshly generated one
- some helper state exists without full UI surfacing yet, such as log buffering and session list/delete helpers

## 14. Shutdown and Lifecycle Boundaries

There are two main exit paths:

- graceful quit via `/quit` or `/exit`, which saves session state and shows a resume command
- immediate `Ctrl-C`, which exits without the same quit UX

On component cleanup, `App`:

- unsubscribes log listeners
- clears the approval handler
- closes MCP connections

## 15. Extension Points

The cleanest places to extend the system are:

- `src/providers.ts` for new providers/models
- `src/tools/*` plus `src/tools/index.ts` for new built-in tools
- `src/skills.ts` for richer skill metadata or enforcement
- `src/mcp.ts` for more MCP lifecycle features
- `src/sub-agent.ts` for richer delegated execution models
- `src/components/*` and `src/utils/format-message.tsx` for richer terminal presentation

The overall design stays small by pushing most behavior into explicit modules rather than hiding logic behind a framework or plugin runtime.

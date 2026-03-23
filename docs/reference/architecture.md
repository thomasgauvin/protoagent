# Architecture

This page is the docs-site companion to the root `ARCHITECTURE.md`.

If you are reading the repo directly, `ARCHITECTURE.md` is the fuller source of truth. This page is the shorter walkthrough for when you mostly want to understand how the pieces fit together.

For the companion behavior reference, see `/reference/spec` or the root `SPEC.md`.

## 1. High-level Structure

```text
protoagent CLI
  -> App (Ink)
     -> Agentic Loop
        -> OpenAI SDK client
        -> 9 built-in tools
        -> Dynamic tools from MCP and skills
        -> Special sub-agent execution path
```

At runtime, the user interacts with the Ink app, while the agent loop handles model/tool orchestration and emits events back to the UI.

## 2. Module Map

Main implementation areas:

- `src/cli.tsx` — CLI entry point, Commander-based argument parsing
- `src/App.tsx` — Ink TUI, session lifecycle, approvals, slash commands, config flows, MCP lifecycle
- `src/agentic-loop.ts` — Tool-use loop with streaming, error recovery, sub-agent routing, compaction
- `src/system-prompt.ts` — Dynamic prompt with directory tree, tool descriptions, skills catalog
- `src/sub-agent.ts` — Isolated child agent runs
- `src/config.tsx` — Config persistence, legacy format support, API key resolution, ConfigureComponent wizard
- `src/providers.ts` — Provider catalog with OpenAI, Anthropic, Google Gemini, Cerebras
- `src/sessions.ts` — Session persistence with UUID IDs and hardened permissions
- `src/skills.ts` — SKILL.md discovery from 5 roots, YAML frontmatter parsing, validation, activation
- `src/mcp.ts` — MCP client for stdio and HTTP servers using `@modelcontextprotocol/sdk`
- `src/runtime-config.ts` — Merged `protoagent.jsonc` from 3 locations with env var interpolation
- `src/tools/index.ts` — 9 static tools + dynamic tool registry
- `src/tools/*` — Individual tool implementations
- `src/components/*` — Ink UI components: CollapsibleBox, LeftBar
- `src/utils/logger.ts` — File-based logger with levels (ERROR/WARN/INFO/DEBUG/TRACE) and in-memory buffer (last 100 entries)
- `src/utils/cost-tracker.ts` — Token estimation (~4 chars/token), cost calculation
- `src/utils/compactor.ts` — Conversation compaction at 90% context utilization
- `src/utils/approval.ts` — Approval system: per-operation, per-session, or --dangerously-skip-permissions
- `src/utils/path-validation.ts` — Path security with allowedRoots for skills
- `src/utils/file-time.ts` — Read-before-edit staleness guard (per-session file modification tracking)

## 3. Startup Flow

Current startup path:

1. `src/cli.tsx` parses arguments with Commander.
2. `App` initializes logging and sets up approval handling.
3. Runtime config is loaded from the active `protoagent.jsonc` file (project if present, otherwise user).
4. Config is loaded or inline setup is shown.
5. The OpenAI client is created from provider metadata.
6. MCP is initialized, which connects servers and registers dynamic tools.
7. A saved session is resumed or a new session is created.
8. The initial system prompt is generated (which also initializes skills).

## 4. Turn Execution Flow

For a normal user message:

1. `App` appends the user message immediately.
2. `runAgenticLoop()` refreshes the system prompt and compacts history if needed.
3. The model streams assistant text and/or tool calls.
4. Tool calls are executed through the tool system, except `sub_agent`, which is handled specially in the loop.
5. Tool results are appended to history.
6. The loop repeats until plain assistant text is returned.
7. `App` saves the session and TODO state.

The loop communicates back to the UI via these event types: `text_delta`, `tool_call`, `tool_result`, `sub_agent_iteration`, `usage`, `error`, `done`, `iteration_done`.

`sub_agent_iteration` carries sub-agent progress (tool name + status) separately from `tool_call` so the UI can show it in the spinner without adding entries to the parent's tool-call message history.

## 5. Message and Session Model

The core app state centers on:

- `completionMessages` — the full message history
- the current session object (UUID, title, timestamps, provider, model, TODOs)
- per-session TODO state (in memory, persisted with session)
- a live `assistantMessageRef` used during streaming updates

Sessions are stored at `~/.local/share/protoagent/sessions/` with `0o600` file permissions.

## 6. Tool Architecture

Static built-ins come from `src/tools/index.ts` and `src/tools/*`:

- `read_file`, `write_file`, `edit_file`, `list_directory`, `search_files`
- `bash`
- `todo_read`, `todo_write`
- `webfetch`

Dynamic tools can be registered by:

- `src/mcp.ts` — registers `mcp_<server>_<tool>` tools
- `src/skills.ts` — registers `activate_skill` tool

`sub_agent` is a special-case tool exposed by the agentic loop rather than the normal registry.

## 7. Safety Model

The current safety model combines:

- path validation for file tools (working directory + skill roots, symlink-aware)
- read-before-edit staleness guard (file-time tracking per session)
- approval prompts for writes, edits, and non-safe shell commands
- three-tier shell security: hard-blocked patterns, auto-approved safe commands, approval-required everything else
- fail-closed behavior when no approval handler is registered

Approved shell commands are not sandboxed.

## 8. Skills Architecture

The skills system:

1. discovers validated `SKILL.md` directories from 5 roots
2. may register `activate_skill` as a dynamic tool
3. extends allowed file roots to skill directories (via `setAllowedPathRoots`)
4. builds a catalog section for the system prompt

Because skill initialization happens during system-prompt generation, it has runtime side effects on both tool registration and path-access roots.

## 9. MCP Architecture

`src/mcp.ts` reads the active `protoagent.jsonc` runtime config, connects stdio (`StdioClientTransport`) or HTTP (`StreamableHTTPClientTransport`) MCP servers, discovers their tools via `listTools()`, and registers them dynamically with `registerDynamicTool` and `registerDynamicHandler`.

Tool names are prefixed: `mcp_<server>_<tool>`. Tool results are flattened from content blocks to strings.

## 10. Sub-Agent Architecture

`src/sub-agent.ts` runs isolated child loops with a fresh prompt and message history. Children use the normal built-in and dynamic tools via `getAllTools()`, but do not recursively expose `sub_agent`. Default iteration limit is 100. Child TODOs are ephemeral (keyed by `sub-agent-<uuid>`) and cleared on completion.

**Abort propagation:** the parent's `AbortSignal` is passed through to `runSubAgent()`, to the child's `client.chat.completions.create()` call, and to each `handleToolCall()` invocation. Pressing Escape stops the child as soon as the in-flight request or tool call acknowledges the signal.

**AbortSignal listener limit:** the same `AbortSignal` is shared across every API call in the loop. The OpenAI SDK attaches one `abort` listener per call, so on a long run the default Node.js limit of 10 listeners per `EventTarget` is exceeded, producing a `MaxListenersExceededWarning`. `AbortSignal` is a Web API `EventTarget` with no `.setMaxListeners()` instance method, so the fix uses the standalone `setMaxListeners(0, abortSignal)` from `node:events`, which supports both `EventEmitter` and `EventTarget`. This is called once at the start of `runAgenticLoop`, scoped to that signal only.

**UI progress isolation:** sub-agent tool steps are reported via `onProgress` callbacks that the agentic loop converts to `sub_agent_iteration` events. The UI handles these by updating the spinner label only — never touching `completionMessages` or `assistantMessageRef` — keeping the parent conversation history clean.

## 11. Conversation Compaction and Cost Tracking

ProtoAgent estimates token usage (~4 chars/token), tracks context-window usage, and compacts old conversation history at 90% utilization. Compaction preserves protected skill payloads (messages containing `<skill_content`) and the 5 most recent messages. The compaction prompt produces a structured `<state_snapshot>` summary.

If the API returns a 400 error indicating the prompt is too long (e.g. `prompt too long`, `context length exceeded`), the loop attempts forced compaction by treating current usage as 100% of the context window, then falls back to truncating oversized `role: 'tool'` messages exceeding 20,000 characters. This handles large MCP tool results such as base64 screenshot blobs.

## 12. Terminal UI

`src/App.tsx` is both the visible UI layer and the runtime coordinator for:

- slash commands (`/help`, `/quit`, `/exit`)
- session lifecycle (create, save, resume, clear)
- approvals (interactive prompt with approve-once, approve-session, reject)
- config flows (inline first-run setup)
- MCP lifecycle (initialize, close)
- event-driven rendering of the agentic loop

The UI also includes collapsible message boxes, grouped tool rendering, formatted assistant output, usage display, debounced text input, spinner, and terminal resize handling.

### LeftBar

Tool calls, approvals, errors, and code blocks are visually offset with a bold `│` bar on the left (`src/components/LeftBar.tsx`), similar to a GitHub callout block.

This is deliberately not a `<Box borderStyle>`. Box borders add lines on all four sides, which increases Ink's managed line count and makes resize ghosting worse — Ink erases by line count, so any extra rows it doesn't expect to own can leave stale lines on screen. `LeftBar` instead renders a plain `<Text>` column containing `│` repeated once per content row. The row count comes from `measureElement` called after each render, so the bar always matches the content height exactly. Total line count equals the children's line count with no overhead.

### Static scrollback

Completed conversation turns are flushed to Ink's `<Static>` component, which writes them once above the managed region and removes them from the re-render cycle. Full history is available via session resume (`--session`).

## 13. Important Implementation Nuances

These are the details that are easy to miss if you only skim the file tree:

- `App.tsx` is not just presentation — it coordinates session, MCP, config, and approval lifecycles
- the system prompt is regenerated repeatedly (on each loop iteration)
- skills initialization mutates runtime state (tool registration and path roots)
- `sub_agent` is not part of `getAllTools()` — it is injected by the agentic loop
- some tool failures flow back as tool-result strings rather than thrown errors
- the agentic loop sanitizes malformed tool calls (normalizes/repairs malformed JSON, detects repeated string patterns)
- error recovery includes retry logic for 400 (context-too-long), 429, and 5xx responses
- `sub_agent_iteration` events are handled by `App` in a separate case that only updates the spinner; they never touch `completionMessages` or `assistantMessageRef`
- the loop includes retrigger logic: after tool calls complete, if the model returns an empty response, the loop auto-retries rather than returning to the user
- a sub-agent that calls tools but produces no final text returns the sentinel string `'(sub-agent completed with no response)'`; this is logged at debug level and is not an error

## 14. Shutdown and Lifecycle Boundaries

Graceful quit (`/quit` or `/exit`) saves the session and shows a resume command. Immediate `Ctrl-C` exits without that quit flow. App cleanup clears approval handlers and closes MCP connections.

## 15. Extension Points

The main extension surfaces are:

- `src/providers.ts` — add built-in providers
- `src/tools/*` — add built-in tools
- `src/skills.ts` — skill discovery and activation
- `src/mcp.ts` — MCP server integration
- `src/sub-agent.ts` — child agent execution
- `src/components/*` — UI components
- `protoagent.jsonc` — runtime provider, model, and MCP configuration

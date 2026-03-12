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
- `src/config.tsx` — Config persistence, legacy format support, 5-step API key resolution, ConfigureComponent wizard
- `src/providers.ts` — Provider catalog with OpenAI, Anthropic, Google Gemini, Cerebras
- `src/sessions.ts` — Session persistence with UUID IDs and hardened permissions
- `src/skills.ts` — SKILL.md discovery from 5 roots, YAML frontmatter parsing, validation, activation
- `src/mcp.ts` — MCP client for stdio and HTTP servers using `@modelcontextprotocol/sdk`
- `src/runtime-config.ts` — Merged `protoagent.jsonc` from 3 locations with env var interpolation
- `src/tools/index.ts` — 9 static tools + dynamic tool registry
- `src/tools/*` — Individual tool implementations
- `src/components/*` — CollapsibleBox, ConsolidatedToolMessage, FormattedMessage, ConfigDialog
- `src/utils/logger.ts` — File-based logger with levels (ERROR/WARN/INFO/DEBUG/TRACE)
- `src/utils/cost-tracker.ts` — Token estimation (~4 chars/token), cost calculation
- `src/utils/compactor.ts` — Conversation compaction at 90% context utilization
- `src/utils/approval.ts` — Approval system: per-operation, per-session, or --dangerously-accept-all
- `src/utils/path-validation.ts` — Path security with allowedRoots for skills
- `src/utils/file-time.ts` — Read-before-edit staleness guard

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
- read-before-edit staleness guard (file-time tracking)
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

`src/sub-agent.ts` runs isolated child loops with a fresh prompt and message history. Children use the normal built-in and dynamic tools via `getAllTools()`, but do not recursively expose `sub_agent`. Default iteration limit is 30. Child TODOs are ephemeral (keyed by `sub-agent-<uuid>`) and cleared on completion.

## 11. Conversation Compaction and Cost Tracking

ProtoAgent estimates token usage (~4 chars/token), tracks context-window usage, and compacts old conversation history at 90% utilization. Compaction preserves protected skill payloads (messages containing `<skill_content`) and the 5 most recent messages. The compaction prompt produces a structured `<state_snapshot>` summary.

## 12. Terminal UI

`src/App.tsx` is both the visible UI layer and the runtime coordinator for:

- slash commands (`/clear`, `/collapse`, `/expand`, `/help`, `/quit`, `/exit`)
- session lifecycle (create, save, resume, clear)
- approvals (interactive prompt with approve-once, approve-session, reject)
- config flows (inline first-run setup)
- MCP lifecycle (initialize, close)
- event-driven rendering of the agentic loop

The UI also includes collapsible message boxes, grouped tool rendering, formatted assistant output, usage display, debounced text input, spinner, and terminal resize handling.

## 13. Important Implementation Nuances

These are the details that are easy to miss if you only skim the file tree:

- `App.tsx` is not just presentation — it coordinates session, MCP, config, and approval lifecycles
- the system prompt is regenerated repeatedly (on each loop iteration)
- skills initialization mutates runtime state (tool registration and path roots)
- `sub_agent` is not part of `getAllTools()` — it is injected by the agentic loop
- some tool failures flow back as tool-result strings rather than thrown errors
- the agentic loop sanitizes malformed tool names and JSON from streamed responses
- error recovery includes retry logic for 400, 429, and 5xx responses

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

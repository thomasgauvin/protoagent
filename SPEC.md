# ProtoAgent Specification

ProtoAgent is a minimal, tutorial-friendly coding agent CLI. It implements the
core mechanics found in production agents (OpenCode, Codex, pi) but keeps
every layer small enough to read in one sitting. The codebase is designed to be
extended and hacked by anyone who wants to learn how coding agents work.

## Reference Codebases

These three production agents are the primary references for every design
decision. Before building any component, study how each reference implements
it first.

| Name | Local path | Key strength |
|---|---|---|
| **OpenCode** | `../opencode-ref` | Richest feature set (MCP, skills, sub-agents, sessions, 9 edit strategies, permission system). TypeScript. |
| **Codex** | `../codex-ref` | Strongest security model (sandboxing). Collaboration/sub-agent system. Skills with dependencies. Rust core, legacy TypeScript/Ink CLI. |
| **pi-mono** | `../pi-mono-ref` | Cleanest TypeScript architecture. Layered packages. Extension system. Skills following the Agent Skills standard. Session branching. |

---

## 1. Goals

1. **Educational** -- every architectural decision favours clarity over
   cleverness. A developer should be able to read the full source in an
   afternoon.
2. **Functional** -- it must actually be useful as a day-to-day coding
   assistant, not just a toy.
3. **Extensible** -- the code is structured so a reader can bolt on new tools,
   providers, or UI features without understanding the entire codebase.

## 2. Architecture Overview

```
┌──────────────────────────────────────────────────────┐
│                    CLI (Commander)                     │
│   parse args → dispatch to App or Configure           │
└─────────────────────┬────────────────────────────────┘
                      │
           ┌──────────▼──────────┐
           │     Ink React TUI    │
           │  App.tsx (main view) │
           │  config.tsx (setup)  │
           └──────────┬──────────┘
                      │ user submits message
           ┌──────────▼──────────┐
           │    Agentic Loop      │
           │  (agentic-loop.ts)   │
           │                      │
           │  while (tool_calls)  │
           │    → call LLM        │
           │    → execute tools   │
           │    → append results  │
           │    → loop            │
           └──┬────┬────┬────┬───┘
              │    │    │    │
    ┌─────────▼┐ ┌─▼────▼─┐ │
    │ LLM      │ │ Tools  │ │
    │ (OpenAI  │ │ (built │ │
    │  SDK)    │ │  -in)  │ │
    └──────────┘ └────────┘ │
              ┌──────┬──────┘
              ▼      ▼
         ┌────────┐ ┌────────────┐
         │  MCP   │ │ Sub-agents │
         │ Tools  │ │ (isolated  │
         │(remote)│ │  sessions) │
         └────────┘ └────────────┘
```

### Layers

| Layer | Files | Responsibility |
|---|---|---|
| **CLI** | `cli.tsx` | Argument parsing, version, subcommand routing |
| **UI** | `App.tsx` | Ink-based terminal UI: welcome banner, message list, text input, streaming display, tool-call display, approval prompts |
| **Config** | `config.tsx`, `providers.ts` | Interactive setup wizard, config persistence |
| **Agentic Loop** | `agentic-loop.ts` | Core agent loop: send messages to LLM, handle tool calls, iterate until the model stops calling tools |
| **Tools** | `tools/*.ts` | Individual tool implementations: each file exports a tool definition (JSON schema) and a handler function |
| **System Prompt** | `system-prompt.ts` | Constructs the system message with project context, tool descriptions, and skills |
| **MCP** | `mcp.ts` | MCP client: connect to external tool servers, discover and invoke their tools |
| **Sub-agents** | `sub-agent.ts` | Spawn isolated child sessions for self-contained subtasks |
| **Sessions** | `sessions.ts` | Save/load/list/delete conversation history |
| **Skills** | `skills.ts` | Load domain-specific instructions from `.md` files |
| **Utilities** | `utils/*.ts` | Cost tracking, conversation compaction, file-operation approval, path validation, logging |

## 3. The Agentic Loop

> **Before building**: Study how each reference codebase implements its agent loop.
> - OpenCode: `packages/opencode/src/session/prompt.ts` -- loop writes to storage, TUI subscribes to Bus events.
> - Codex: `codex-rs/core/src/` -- the `Op`/`Event` submission/event queue pattern decouples the loop from the UI.
> - pi-mono: `packages/coding-agent/src/core/agent-session.ts` -- pub/sub event system; interactive mode subscribes.

This is the heart of the agent. It implements the standard **tool-use loop**
pattern used by all major coding agents:

1. User types a message.
2. Append it to the conversation as a user message.
3. Call the LLM with the full conversation plus tool definitions.
4. If the response contains tool calls: execute each tool, append results,
   go back to step 3.
5. If the response is plain text: display it to the user, return to step 1.

### Key details

- **Streaming**: The LLM response is streamed token-by-token. Text content is
  rendered to the Ink UI as it arrives. Tool call arguments are accumulated
  across chunks before execution.
- **Max iterations**: A safety limit (default 100) prevents infinite tool loops.
- **Error handling**: API errors (401, 403, 429, etc.) surface helpful messages.
  Tool execution errors are fed back to the model as tool results so it can
  recover.
- **Event-based decoupling**: The loop emits typed events (text deltas, tool
  calls, tool results, usage stats, errors, done) rather than writing to the
  UI directly. The Ink component subscribes to these events and updates React
  state. This keeps the core logic testable without the UI.

## 4. Tool System

> **Before building**: Study the tool registry and dispatch patterns in each reference.
> - OpenCode: `packages/opencode/src/tool/` -- `Tool.define()` with Zod validation, automatic output truncation, context object with abort signal and permission checks.
> - Codex: `codex-rs/core/src/tools/` -- `ToolSpec` definitions with JSON schemas, `ToolHandler` trait, `handlers/` directory for implementations.
> - pi-mono: `packages/coding-agent/src/tools/` -- tool definitions with descriptions and parameter schemas, handler functions.

Each tool is defined as:

1. A **JSON schema** (OpenAI function-calling format) describing name,
   description, and parameters.
2. A **handler function** that executes the tool and returns a text result.

The tool registry (`tools/index.ts`) collects all definitions into a `tools`
array and provides a `handleToolCall(name, args)` dispatcher. The registry
also supports dynamic tool registration for MCP tools and sub-agent tools.

### Core Tools

| Tool | Purpose |
|---|---|
| `read_file` | Read file contents with optional offset/limit. Path-restricted to cwd. |
| `write_file` | Create or overwrite a file. Requires user approval. |
| `edit_file` | Find-and-replace in an existing file. Requires user approval. |
| `list_directory` | List directory contents with [FILE]/[DIR] prefixes. |
| `search_files` | Recursive text search with extension filtering. |
| `bash` | Execute a shell command. Has a safe-command whitelist; other commands require approval. |
| `todo_read` / `todo_write` | In-memory task tracking so the agent can plan multi-step work. |

### Path security

All file tools validate that the resolved path is within `process.cwd()`.
Symlinks are resolved before checking. This prevents the agent from reading
or writing outside the project directory.

## 5. Provider & Model Support

> **Before building**: Study how each reference handles multi-provider support.
> - OpenCode: `packages/opencode/src/provider/` -- uses Vercel AI SDK for provider abstraction (we skip this, but study the provider registry pattern).
> - Codex: `codex-rs/core/src/` -- OpenAI Responses API with model routing.
> - pi-mono: `packages/ai/src/` -- standalone multi-provider LLM client (`pi-ai` package) with provider-specific adapters.

ProtoAgent uses the **OpenAI SDK** as a universal client. Providers that expose
OpenAI-compatible endpoints (Gemini, Anthropic via proxy, etc.) work by
changing the `baseURL` and API key.

The config stores the selected provider, model, and credentials. Adding a new
provider means adding an entry to `providers.ts` and (if needed) setting the
`baseURL` in the client constructor.

Supported providers: **OpenAI**, **Google Gemini** (via OpenAI-compatible
endpoint), **Anthropic** (via OpenAI-compatible endpoint), **Cerebras**
(via OpenAI-compatible endpoint).

## 6. Configuration System

> **Before building**: Study config persistence patterns in each reference.
> - OpenCode: `packages/opencode/src/config/` -- JSONC config files with project-level overrides, environment variable support.
> - Codex: `codex-rs/core/src/config.rs` -- layered config (global, project, CLI flags) with TOML format.
> - pi-mono: `packages/coding-agent/src/core/settings.ts` -- settings with project-level `.pi/settings.json` and global `~/.pi/settings.json`.

- Stored at `~/.local/share/protoagent/config.json` (macOS/Linux) or
  `%USERPROFILE%/AppData/Local/protoagent/config.json` (Windows).
- The `protoagent configure` subcommand launches an Ink wizard that walks
  through model selection and API key entry.
- The App reads config on startup and creates an OpenAI client from it.

## 7. Terminal UI (Ink)

> **Before building**: Study the TUI architecture in each reference.
> - OpenCode: `packages/opencode/src/cli/cmd/tui/` -- SolidJS-based TUI with component hierarchy, dialogs, and route system.
> - Codex (legacy): `codex-cli/src/components/` -- Ink/React TUI (closest architectural match to ProtoAgent).
> - pi-mono: `packages/coding-agent/src/modes/interactive/` -- custom terminal UI with component system, layout management.

The UI is built with **Ink** (React for the terminal). This was chosen over
raw `inquirer` prompts because:
- It supports streaming updates (re-rendering as tokens arrive).
- It's composable: each UI piece is a React component.
- It's familiar to anyone who knows React.

### Components

| Component | Description |
|---|---|
| `App` | Main view: welcome banner, message history, streaming response display, text input, tool-call display, approval prompts |
| `ConfigureComponent` | Multi-step wizard: model selection, API key input, result display |

### Rendering messages

Messages are rendered in a scrollable list. User messages are dimmed with a
`>` prefix. Assistant messages are full-brightness with an `Agent:` prefix.
Tool calls are displayed with the tool name and an abbreviated result.

## 8. System Prompt

> **Before building**: Study system prompt construction in each reference.
> - OpenCode: `packages/opencode/src/session/system.ts` -- dynamic prompt with tool descriptions, project context, permissions, environment info.
> - Codex: `codex-rs/core/src/prompt.rs` -- system prompt with platform info, sandbox status, skill injections.
> - pi-mono: `packages/coding-agent/src/core/system-prompt.ts` -- dynamic prompt with tool descriptions, project tree, skill content.

The system prompt is generated dynamically at startup. It includes:

1. **Role description** -- who ProtoAgent is, what it can do.
2. **Project context** -- the working directory and a filtered directory tree
   (depth 3, excludes node_modules/dist/.git etc.).
3. **Tool descriptions** -- auto-generated from tool JSON schemas.
4. **Skill content** -- domain-specific instructions loaded from skill files.
5. **Behavioural guidelines** -- rules about when to use edit vs write,
   when to read before editing, how to handle shell commands, and mandatory
   TODO tracking for multi-step tasks.

## 9. Conversation Compaction

> **Before building**: Study compaction/summarisation in each reference.
> - OpenCode: `packages/opencode/src/session/prompt.ts` -- context window management with message truncation and summarisation.
> - pi-mono: `packages/coding-agent/src/core/agent-session.ts` -- compaction with structured state snapshots, configurable triggers.

When the conversation approaches the model's context window limit (90%
utilisation), the agent automatically compacts the history:

1. Summarise the conversation so far using a separate LLM call.
2. Replace the old messages with a single summary message.
3. Continue the conversation with the compacted context.

This allows long-running sessions without hitting token limits.

## 10. User Approval System

> **Before building**: Study approval and permission patterns in each reference.
> - OpenCode: `packages/opencode/src/permission/` -- wildcard pattern rules (allow/deny/ask) per tool, with session-level persistence.
> - Codex: `codex-rs/core/src/` -- sandbox-based security model with approval policies.
> - pi-mono: `packages/coding-agent/src/tools/` -- per-tool approval with session memory.

Destructive operations require explicit user approval:

- **File writes and edits**: The user is shown a diff/preview and asked to
  confirm.
- **Shell commands**: Commands not on the safe whitelist require approval.
  The user can approve once, approve for the session, or reject.
- **`--dangerously-accept-all`**: A CLI flag that skips all approval prompts
  (for automation or power users).

## 11. Cost Tracking

> **Before building**: Study token tracking in each reference.
> - OpenCode: `packages/opencode/src/session/cost.ts` -- tracks input/output/cache tokens with per-model pricing.
> - pi-mono: `packages/ai/src/` -- token counting and cost estimation in the `pi-ai` package.

The agent estimates token usage for each LLM call and logs:
- Input/output tokens
- Estimated cost (based on model pricing from `providers.ts`)
- Context window utilisation percentage

This helps users understand their API spending.

## 12. MCP Support (Model Context Protocol)

> **Before building**: Study MCP implementations in the reference codebases carefully.
> - OpenCode: `packages/opencode/src/mcp/index.ts` -- full MCP client with stdio/HTTP transport, tool discovery, lifecycle management. Also `src/mcp/auth.ts` for OAuth and `src/server/routes/mcp.ts` for API management.
> - Codex: `codex-rs/core/src/mcp_connection_manager.rs` -- connection manager owning one client per server, aggregated tool namespace with fully-qualified names. Also `codex-rs/core/src/mcp_tool_call.rs` for dispatching calls and `codex-rs/core/src/mcp/` for auth and skill dependencies.
> - pi-mono: Does not implement MCP by design (relies on skills + CLI tools instead). Study their rationale in `packages/coding-agent/README.md` to understand the trade-offs.

MCP allows ProtoAgent to connect to external tool servers without modifying
the agent's own code. A user can configure MCP servers (e.g., a database
explorer, a documentation searcher, a custom API) and the agent discovers and
uses their tools automatically.

### How it works

1. **Configuration**: The user defines MCP servers in `.protoagent/mcp.json`,
   specifying the command to launch each server and any arguments/environment.
2. **Server lifecycle**: On startup, ProtoAgent spawns each configured server
   as a child process using stdio transport (JSON-RPC over stdin/stdout).
3. **Tool discovery**: ProtoAgent sends a `tools/list` request to each server
   and registers the returned tools in the tool registry with namespaced names
   (e.g., `servername__toolname`).
4. **Tool invocation**: When the LLM calls an MCP tool, ProtoAgent forwards
   the call to the appropriate server via `tools/call` and returns the result.
5. **Shutdown**: When ProtoAgent exits, it cleanly shuts down all MCP server
   processes.

### Scope

ProtoAgent implements a minimal MCP client -- stdio transport only, no OAuth,
no HTTP streaming. This covers the most common use case (local tool servers)
while keeping the implementation small.

## 13. Sub-agents

> **Before building**: Study sub-agent/task spawning in the reference codebases carefully.
> - OpenCode: `packages/opencode/src/tool/task.ts` -- `TaskTool` spawns sub-agent sessions with agent-type selection, parent-child relationships, and session resumption via `task_id`. Also `src/tool/task.txt` for the prompt and `src/agent/agent.ts` for agent type definitions.
> - Codex: `codex-rs/core/src/tools/handlers/collab.rs` -- `CollabHandler` with `spawn_agent`, `send_input`, `resume_agent`, `wait`, and `close_agent` tools for multi-agent collaboration. Also `codex-rs/core/src/thread_manager.rs` for managing concurrent threads.
> - pi-mono: Does not implement built-in sub-agents but provides an example extension at `packages/coding-agent/examples/extensions/subagent/` showing how to spawn separate pi processes with isolated context.

Sub-agents prevent **context pollution** -- a key problem in long agent
sessions. When the parent agent needs to complete a self-contained subtask
(e.g., "explore how error handling works in this codebase"), it can spawn a
child session rather than cluttering its own context with the exploration.

### How it works

1. The main agent calls the `sub_agent` tool with a task description.
2. ProtoAgent creates an isolated child conversation with its own message
   history and a fresh system prompt.
3. The child runs autonomously (no user interaction) with a configurable
   iteration limit.
4. When the child finishes, its final response is returned to the parent
   as the tool result.
5. The child's full message history is discarded (or optionally persisted
   as a session), keeping the parent's context clean.

### Design considerations

- The child inherits the parent's tool set and config but has its own message
  history.
- A maximum iteration limit prevents runaway child sessions.
- The child operates without user approval prompts (it inherits the parent's
  approval state or runs in auto-approve mode).

## 14. Session Persistence

> **Before building**: Study session persistence in the reference codebases carefully.
> - OpenCode: `packages/opencode/src/session/index.ts` -- session CRUD with message persistence, forking, archiving. Also `src/session/message-v2.ts` for serialisation format and `src/storage/storage.ts` for the file-system storage layer.
> - Codex: `codex-rs/core/src/rollout/` -- JSONL rollout files with a session index (`session_index.jsonl`) for listing/resuming. Also `src/rollout/recorder.rs` for persistence and `src/message_history.rs` for global cross-session history.
> - pi-mono: `packages/coding-agent/src/core/session-manager.ts` -- JSONL format with tree-structured entries (id/parentId) supporting branching, compaction, and version migration. Also `src/core/agent-session.ts` for high-level session lifecycle.

Session persistence lets users resume conversations across restarts. Without
it, all context is lost when the process exits.

### How it works

1. **Save**: After each agent turn, the full conversation (messages array) is
   serialised to a JSON file in `~/.local/share/protoagent/sessions/`.
2. **Title generation**: The session title is auto-generated from the first
   user message (truncated to a reasonable length).
3. **List**: The user can list past sessions (showing title, date, message
   count).
4. **Load**: The user can resume a session via `--session <id>`, which
   restores the messages array and continues the conversation.
5. **Delete**: Old sessions can be deleted to free disk space.

### Scope

ProtoAgent implements simple JSON file persistence. It does not implement
session branching (pi), JSONL streaming (Codex), or database-backed storage
(OpenCode). These are noted as upgrade paths.

## 15. Skills

> **Before building**: Study skill systems in the reference codebases carefully.
> - OpenCode: `packages/opencode/src/skill/skill.ts` -- discovers skills from project directories (`.opencode/`, `.claude/`, `.agents/`), parses `SKILL.md` frontmatter, caches metadata. Also `src/tool/skill.ts` for the skill tool that loads content on-demand.
> - Codex: `codex-rs/core/src/skills/` -- full skills subsystem with `loader.rs` (loads from global/project directories, parses frontmatter), `manager.rs` (caching), `injection.rs` (prompt injection), `render.rs` (rendering into prompts), `remote.rs` (remote skills from URLs), `system.rs` (built-in system skills).
> - pi-mono: `packages/coding-agent/src/core/skills.ts` -- discovers from global (`~/.pi/agent/skills/`), project (`.pi/skills/`), and package directories. Follows the Agent Skills standard. Parses frontmatter. Registers as slash commands (`/skill:name`).

Skills let users inject domain-specific instructions into the agent's system
prompt without modifying code. For example, a project might have a skill that
says "always use pnpm instead of npm" or "follow this specific code style."

### How it works

1. **Discovery**: On startup, ProtoAgent scans two directories for `.md` files:
   - `.protoagent/skills/` in the project directory (project-level skills)
   - `~/.config/protoagent/skills/` (global skills)
2. **Priority**: Project skills override global skills with the same filename.
3. **Injection**: The content of each discovered skill file is appended to
   the system prompt under a "Skills" section.
4. **Format**: Each skill is a plain Markdown file. The filename (minus
   extension) is the skill name. No frontmatter is required (but could be
   supported as an extension).

### Scope

ProtoAgent implements the simplest useful version of skills: file discovery
and system prompt injection. It does not implement frontmatter parsing, skill
dependencies (Codex), on-demand loading via a tool (OpenCode), slash-command
registration (pi), or remote skill fetching (Codex). These are noted as
upgrade paths.

## 16. Documentation Site (VitePress)

ProtoAgent includes a VitePress-powered documentation site in `docs/` that
serves as both a project landing page and comprehensive documentation.

### Structure

- **Landing page**: Hero section introducing ProtoAgent, feature highlights
  (tools, MCP, sub-agents, skills, sessions), and a quick-start snippet.
- **Guide**: Practical how-to pages covering installation, configuration,
  built-in tools, skills authoring, MCP server setup, session management,
  and sub-agent usage.
- **Tutorial**: The DIY tutorial series (Parts 1-11), teaching readers how
  to build a coding agent from scratch.
- **Reference**: The full specification, architecture overview, and CLI
  flags/commands reference.

### Why VitePress

- Markdown-native: the tutorial content and spec are already Markdown.
- Zero-config defaults with good navigation, search, and dark mode.
- Static output: easy to deploy to GitHub Pages or any static host.

---

## Appendix: What ProtoAgent Intentionally Omits

These features exist in production agents but are **out of scope** for
ProtoAgent. They are noted here so a reader knows what to explore next.

| Feature | Found in | Notes |
|---|---|---|
| **Sandboxing** | Codex | OS-level sandboxing (macOS Seatbelt, Linux Landlock) for shell commands. |
| **Multiple edit fallback strategies** | OpenCode | 9 progressively looser matching strategies for find-and-replace. |
| **Git-based file snapshots / Undo** | OpenCode | Shadow git repo to snapshot and revert file changes. |
| **Wildcard permission patterns** | OpenCode | Pattern-based allow/deny/ask rules per tool (beyond our simple approval system). |
| **Plugin / Extension system** | OpenCode, pi | Loading custom tools, hooks, and commands from user files. |
| **LSP integration** | OpenCode | Running diagnostics after edits via Language Server Protocol. |
| **Web search / Code search** | OpenCode | External search APIs for finding documentation or code. |
| **Session branching / Forking** | pi | Branching conversation history like a git tree. |
| **Multiple run modes** | pi | Interactive, single-shot (print), headless (RPC). |
| **Vercel AI SDK abstraction** | OpenCode | Multi-provider abstraction (unnecessary since we use OpenAI-compatible endpoints). |
| **Web/Desktop UI** | OpenCode | Out of scope -- we focus on the CLI. |
| **OpenTelemetry** | Codex | Observability with traces and metrics. |
| **Theming** | pi | Configurable color schemes for the TUI. |
| **MCP OAuth / HTTP transport** | OpenCode, Codex | We implement stdio-only MCP for simplicity. |
| **Skill frontmatter / dependencies** | Codex | Skill metadata, remote fetching, MCP dependencies. |

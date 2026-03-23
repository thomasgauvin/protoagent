# Specification

This page is the docs-site companion to the root `SPEC.md`.

If you are reading the repo directly, `SPEC.md` is the fuller source of truth. This page keeps the same shape, but trims it down to the parts you usually want when you are trying to understand how ProtoAgent works right now.

For the companion runtime/module walkthrough, see `/reference/architecture` or the root `ARCHITECTURE.md`.

## 1. Goals

ProtoAgent is designed to stay:

- readable
- useful for real coding work
- extensible through tools, skills, MCP, and delegated runs

## 2. Architecture Overview

```text
CLI (Commander)
  -> Ink TUI
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools (9 static)
        -> Dynamic tools from skills and MCP
        -> Special sub-agent tool
```

Main implementation areas live in:

- `src/cli.tsx`
- `src/App.tsx`
- `src/agentic-loop.ts`
- `src/tools/*`
- `src/sessions.ts`
- `src/skills.ts`
- `src/mcp.ts`
- `src/sub-agent.ts`
- `src/runtime-config.ts`

## 3. CLI and Interaction Model

Current entry points and flags:

- `protoagent`
- `protoagent configure`
- `--dangerously-skip-permissions`
- `--log-level <level>` (default: `INFO`)
- `--session <id>`
- `--version`

Current slash commands:

- `/help`
- `/quit`
- `/exit` (alias for `/quit`)

Keyboard shortcuts:

- `Esc` aborts the current completion
- `Ctrl-C` exits immediately

## 4. Configuration System

ProtoAgent uses a single configuration file: `protoagent.jsonc`.

Active config lookup is:

1. `<cwd>/.protoagent/protoagent.jsonc` if it exists
2. otherwise the shared user config at `~/.config/protoagent/protoagent.jsonc` on macOS/Linux or `%USERPROFILE%/AppData/Local/protoagent/protoagent.jsonc` on Windows

The first provider entry in the file is treated as the active provider, and the first model entry inside that provider is treated as the active model.

`protoagent.jsonc` may define:

- provider additions or overrides
- model metadata overrides
- request default parameters
- MCP server configuration

Environment variables remain higher priority than file-based transport and auth config.

The current implementation supports:

- inline first-run setup
- `protoagent configure`
- provider environment-variable fallback
- JSONC-based runtime provider and MCP extension
- environment variable interpolation with `${VAR}` syntax

## 5. Provider and Model Support

Built-in providers ship in `src/providers.ts`:

| Provider | Models |
|---|---|
| **OpenAI** | GPT-5.4, GPT-5.4 Pro, GPT-5.2, GPT-5 Mini, GPT-5 Nano, GPT-4.1 |
| **Anthropic Claude** | Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5 |
| **Google Gemini** | Gemini 3 Flash (Preview), Gemini 3 Pro (Preview), Gemini 2.5 Flash, Gemini 2.5 Pro |

The active runtime registry is the result of built-in providers plus the active `protoagent.jsonc` file.

Providers may be added or overridden by ID. Each model entry includes context-window and pricing metadata and may also define per-model request defaults. Reserved request fields are stripped from config defaults.

## 6. Agentic Loop

The loop in `src/agentic-loop.ts`:

1. refreshes the system prompt
2. compacts history if needed (at 90% context utilization)
3. sends messages and tools to the model
4. streams assistant text and tool calls
5. executes tools and appends results
6. retries selected transient failures (400 context-too-long, 429 rate limit, 5xx server errors)
7. returns when the model emits plain assistant text

It sanitizes malformed streamed tool names and JSON payloads before retrying. Sub-agent calls are routed through the loop rather than the normal tool registry.

## 7. Tool System

Current built-ins (9 tools):

- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `search_files`
- `bash`
- `todo_read`
- `todo_write`
- `webfetch`

Dynamic tools:

- `activate_skill` — registered when skills are discovered
- `sub_agent` — exposed specially by the loop
- `mcp_<server>_<tool>` — registered from MCP servers

## 8. File and Path Safety

Current rules include:

- file access limited to the working directory plus allowed skill roots
- symlink-aware validation
- parent-directory checks for non-existent files
- staleness guard requiring read-before-edit (tracked per session via file-time)

## 9. Approval Model

ProtoAgent uses three approval categories:

- `file_write`
- `file_edit`
- `shell_command`

Approval can be granted:

- per-operation (one-time)
- per-type for the session
- globally via `--dangerously-skip-permissions`

Hard-blocked shell patterns are always denied, even with `--dangerously-skip-permissions`. If no approval handler is registered, operations fail closed (rejected).

## 10. Session Persistence

Sessions are stored at `~/.local/share/protoagent/sessions/` as JSON files named by UUID.

Sessions persist:

- completion messages
- provider/model metadata
- timestamps and title
- TODO state

They are resumed with `--session <id>`.

## 11. Cost Tracking and Compaction

ProtoAgent estimates token usage (~4 chars/token heuristic), calculates cost from provider pricing metadata, tracks context utilization percentage, and compacts old conversation state at 90% context usage. Compaction preserves protected skill payloads and recent messages (last 5 kept verbatim).

## 12. Skills

Skills are validated local directories containing `SKILL.md` with YAML frontmatter. They are discovered from 5 roots (3 user, 2 project) and activated on demand via `activate_skill`. Skill directories are added as allowed path roots for file access.

## 13. MCP Support

ProtoAgent supports:

- stdio MCP servers (spawned as child processes via `StdioClientTransport`)
- HTTP / Streamable HTTP MCP servers (via `StreamableHTTPClientTransport`)

MCP server config is sourced from the active `protoagent.jsonc` runtime config. Remote tools are discovered via `listTools()` and registered dynamically at startup with names like `mcp_<server>_<tool>`.

## 14. Web Fetching

`webfetch` supports output formats:

- `text`
- `markdown`
- `html`

with URL, timeout, redirect, MIME, and size limits enforced in `src/tools/webfetch.ts`.

## 15. Sub-agents

`sub_agent` creates isolated child runs with their own message history and system prompt. Children use the normal tool stack but do not recursively expose `sub_agent`. Default iteration limit is 100. Child TODOs are ephemeral and cleared on completion.

## 16. Terminal UI

The current UI includes:

- collapsible long messages
- consolidated tool rendering
- formatted assistant output with markdown
- inline approvals
- inline first-run setup flow
- usage display (tokens, cost, context percentage)
- visible log file path
- debounced text input
- spinner during processing
- terminal resize handling

## 17. Logging

Logging is file-backed and supports levels:

- `ERROR`
- `WARN`
- `INFO`
- `DEBUG`
- `TRACE`

## 18. Known Omissions and Intentional Limits

Intentional omissions include:

- sandboxing
- skill permission enforcement
- MCP OAuth
- session branching
- non-interactive RPC/server modes

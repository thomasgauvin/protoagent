# Specification

This page is the docs-site companion to the root `SPEC.md`.

If you are reading the repo directly, `SPEC.md` is the fuller source of truth. This page mirrors its structure in a shorter form.

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
        -> Built-in tools
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

## 3. CLI and Interaction Model

Current entry points and flags:

- `protoagent`
- `protoagent configure`
- `--dangerously-accept-all`
- `--log-level <level>`
- `--session <id>`

Current slash commands:

- `/clear`
- `/collapse`
- `/config`
- `/expand`
- `/help`
- `/quit`
- `/exit`

Keyboard shortcuts:

- `Esc` aborts the current completion
- `Ctrl-C` exits immediately

## 4. Configuration System

Config is stored in the ProtoAgent data directory and contains:

- provider
- model
- optional API key

The current implementation supports:

- inline first-run setup
- `protoagent configure`
- in-app `/config`
- provider environment-variable fallback
- legacy config compatibility

## 5. Provider and Model Support

Current providers in `src/providers.ts`:

- OpenAI
- Anthropic Claude
- Google Gemini
- Cerebras

Each model entry includes context-window and pricing metadata.

## 6. Agentic Loop

The loop in `src/agentic-loop.ts`:

1. refreshes the system prompt
2. compacts history if needed
3. sends messages and tools to the model
4. streams assistant text and tool calls
5. executes tools and appends results
6. retries selected transient failures
7. returns when the model emits plain assistant text

It also repairs malformed streamed tool payloads from providers before retrying.

## 7. Tool System

Current built-ins:

- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `search_files`
- `bash`
- `todo_read` / `todo_write`
- `webfetch`

Dynamic tools can also be registered by MCP and the skills system. `sub_agent` is exposed specially by the loop.

## 8. File and Path Safety

Current rules include:

- file access limited to the working directory plus activated skill roots
- symlink-aware validation
- parent-directory checks for non-existent files

## 9. Approval Model

ProtoAgent currently uses approval categories for:

- `file_write`
- `file_edit`
- `shell_command`

Writes, edits, and non-safe shell commands require approval unless auto-approved. Some shell patterns are always blocked.

## 10. Session Persistence

Sessions persist:

- completion messages
- provider/model metadata
- TODO state

They are resumed with `--session <id>`.

## 11. Cost Tracking and Compaction

ProtoAgent estimates token usage and cost, tracks context utilization, and compacts old conversation state at high context usage while preserving protected skill payloads.

## 12. Skills

Skills are validated local directories containing `SKILL.md` with YAML frontmatter. They are discovered from project and user roots and activated on demand via `activate_skill`.

## 13. MCP Support

ProtoAgent supports:

- stdio MCP servers
- HTTP / Streamable HTTP MCP servers

Remote tools are discovered and registered dynamically at startup.

## 14. Web Fetching

`webfetch` supports:

- `text`
- `markdown`
- `html`

with URL, timeout, redirect, MIME, and size limits enforced in `src/tools/webfetch.ts`.

## 15. Sub-agents

`sub_agent` creates isolated child runs with their own message history and system prompt. Children use the normal tool stack but do not recursively expose `sub_agent`.

## 16. Terminal UI

The current UI includes:

- collapsible long messages
- consolidated tool rendering
- formatted assistant output
- inline approvals
- inline setup and config flows
- usage display
- visible log file path

## 17. Logging

Logging is file-backed and supports:

- `ERROR`
- `WARN`
- `INFO`
- `DEBUG`
- `TRACE`

## 18. Known Omissions and Intentional Limits

Intentional omissions include:

- sandboxing
- advanced edit fallback strategies
- skill permission enforcement
- MCP OAuth
- session branching
- non-interactive RPC/server modes

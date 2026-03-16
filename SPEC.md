# ProtoAgent Specification

ProtoAgent is a small TypeScript coding agent CLI built to be readable, hackable, and useful enough for real project work.

This spec describes what the current implementation in `src/` actually does.

For the companion runtime/module walkthrough, see `ARCHITECTURE.md`.

## 1. Goals

1. **Readable** — the core system should stay compact enough to understand without a framework tour.
2. **Useful** — it should support real coding workflows: reading code, editing files, running commands, resuming sessions, and consulting external context.
3. **Extensible** — new tools, providers, skills, and MCP integrations should fit naturally into the existing structure.

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

### Main modules

| Area | Files | Responsibility |
|---|---|---|
| CLI | `src/cli.tsx` | Parses flags, starts the main app, or launches `configure` |
| UI | `src/App.tsx`, `src/components/*` | Renders the conversation, approvals, collapsible output, formatted messages |
| Loop | `src/agentic-loop.ts` | Runs the streaming tool-use loop and retry logic |
| Config | `src/config.tsx`, `src/providers.ts` | Stores config, loads providers/models, resolves API keys |
| Tools | `src/tools/*` | Built-in tool schemas and handlers |
| Sessions | `src/sessions.ts` | Saves and resumes messages and TODO state |
| Skills | `src/skills.ts` | Discovers validated skill directories and exposes `activate_skill` |
| MCP | `src/mcp.ts` | Loads MCP servers and registers their tools dynamically |
| Utilities | `src/utils/*` | Approval, compaction, cost estimation, logging, message formatting, path validation |

## 3. CLI and Interaction Model

### CLI entry points

- `protoagent`
- `protoagent configure`

### CLI flags

- `--dangerously-accept-all`
- `--log-level <level>`
- `--session <id>`

### Interactive slash commands

Inside the TUI, the current app supports:

- `/collapse`
- `/expand`
- `/help`
- `/quit`
- `/exit`

The UI also supports aborting an in-flight completion with `Esc`.

## 4. Configuration System

ProtoAgent uses two configuration layers:

- persisted user selection in `config.json`
- extensibility and runtime overrides in `protoagent.jsonc`

### Persisted session config

ProtoAgent stores user selection at:

- macOS/Linux: `~/.local/share/protoagent/config.json`
- Windows: `%USERPROFILE%/AppData/Local/protoagent/config.json`

Stored fields:

```json
{
  "provider": "openai",
  "model": "gpt-5-mini",
  "apiKey": "..."
}
```

This file remains intentionally small. It stores the selected provider, selected model, and an optional explicit API key.

### Unified extensibility config

ProtoAgent also reads `protoagent.jsonc` from these locations:

- `<process.cwd()>/.protoagent/protoagent.jsonc`
- `~/.config/protoagent/protoagent.jsonc`

All files are optional. If multiple files are present, they are merged in this order:

1. built-in defaults from source
2. `~/.config/protoagent/protoagent.jsonc`
3. `<process.cwd()>/.protoagent/protoagent.jsonc`

Later entries win on conflict.

### Top-level shape

```jsonc
{
  "providers": {
    "openai": {
      "name": "OpenAI",
      "apiKeyEnvVar": "OPENAI_API_KEY",
      "models": {
        "gpt-5.2": {
          "name": "GPT-5.2",
          "contextWindow": 200000,
          "inputPricePerMillion": 6.0,
          "outputPricePerMillion": 24.0
        }
      }
    },
    "cf-openai": {
      "name": "OpenAI via CF Gateway",
      "baseURL": "https://opencode.cloudflare.dev/openai/",
      "apiKey": "none",
      "headers": {
        "cf-access-token": "${CF_ACCESS_TOKEN}",
        "X-Requested-With": "xmlhttprequest"
      },
      "defaultParams": {
        "store": false
      },
      "models": {
        "gpt-4o": {
          "name": "GPT-4o",
          "contextWindow": 128000,
          "inputPricePerMillion": 2.5,
          "outputPricePerMillion": 10.0
        }
      }
    }
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
      }
    }
  }
}
```

### Provider rules

- `providers` may define entirely new providers or override built-in providers by ID.
- Provider IDs must be unique after merge.
- Provider `models` are keyed by model ID and merge by key.
- Project config overrides user config for both provider metadata and model metadata.
- JSONC comments are allowed in source files but are ignored at runtime.

### Environment interpolation

Any string value in `protoagent.jsonc` may include `${VAR_NAME}` placeholders.

- interpolation happens at load time
- missing variables resolve to an empty string
- missing variables log a warning
- empty header values are dropped after interpolation

### Runtime precedence

Environment variables remain first-class runtime overrides and take precedence over file config.

Resolution order:

- API key:
  1. `config.apiKey`
  2. explicit environment override for the active provider
  3. `PROTOAGENT_API_KEY`
  4. `provider.apiKey`
  5. `process.env[provider.apiKeyEnvVar]`
  6. `'none'` when the provider uses header-based auth and no bearer token is required
  7. otherwise throw
- base URL:
  1. `PROTOAGENT_BASE_URL`
  2. `provider.baseURL`
  3. built-in default
- headers:
  1. `PROTOAGENT_CUSTOM_HEADERS`
  2. `provider.headers`
  3. built-in default headers

### Request parameter defaults

Providers and models may declare request defaults:

- provider-level `defaultParams`
- model-level `defaultParams`

Model defaults override provider defaults.

These defaults may tune request behavior such as:

- `temperature`
- `top_p`
- `max_tokens`
- `store`
- `parallel_tool_calls`

Reserved request fields must not be overridden by config:

- `model`
- `messages`
- `tools`
- `tool_choice`
- `stream`
- `stream_options`

ProtoAgent should validate these keys and warn or reject invalid config rather than silently changing core agent behavior.

### Interactive setup

- If no `config.json` exists, the main app shows an inline first-run setup flow.
- `protoagent configure` launches the standalone wizard.
- Interactive setup uses the merged provider registry from built-ins plus `protoagent.jsonc`.
- Providers that already resolve auth from env vars or header-based config should not require a placeholder API key prompt.

### Migration stance

- `.protoagent/providers.json` and `.protoagent/mcp.json` are replaced by `.protoagent/protoagent.jsonc`.
- Backwards-compatible env vars remain supported during development.
- Since ProtoAgent is still in development, file-format cleanup and provider cleanup can be done without preserving old config shapes long term.

## 5. Provider and Model Support

ProtoAgent uses the OpenAI SDK directly.

Built-in providers ship in source, but the runtime provider registry is the merged result of:

- built-in providers
- user `protoagent.jsonc`
- project `protoagent.jsonc`

Each provider may declare:

- provider ID
- human-readable provider name
- optional OpenAI-compatible `baseURL`
- optional `apiKey`
- optional `apiKeyEnvVar`
- optional default headers
- optional request `defaultParams`
- one or more models

Each model entry may declare:

- model ID
- human-readable name
- context window
- per-million input pricing
- per-million output pricing
- model-level `defaultParams`

The model picker and all provider lookups operate on this merged runtime registry rather than a hardcoded provider list alone.

## 6. Agentic Loop

The core loop in `src/agentic-loop.ts` works like this:

1. Start from the current message history.
2. Refresh or insert the system prompt.
3. Send the conversation and tool definitions to the model.
4. Stream text and tool call deltas.
5. If tool calls are returned, execute them and append tool results.
6. Repeat until the model returns plain assistant text.

### Important implementation details

- Responses stream token-by-token.
- Tool calls are accumulated across chunks.
- Tool call names and JSON arguments are sanitized when providers emit malformed streamed fragments.
- Usage data is captured from streaming responses when available.
- The loop emits typed UI events instead of rendering directly.
- The default max iteration limit is 100.

### Retry behavior

The loop currently retries on:

- `429` rate limits
- `408`, `409`, and `425`
- `5xx` server failures
- selected network transport errors like `ECONNRESET`, `ETIMEDOUT`, and `EAI_AGAIN`

It also has a repair path for provider rejections caused by malformed tool payload round-trips.

## 7. Tool System

Each built-in tool exports:

1. a JSON schema
2. a handler function

`src/tools/index.ts` collects built-ins and dispatches calls. It also supports runtime registration for dynamic tools.

### Built-in tools

| Tool | Purpose |
|---|---|
| `read_file` | Read file contents with line slicing |
| `write_file` | Create or overwrite a file |
| `edit_file` | Exact-string replacement in an existing file |
| `list_directory` | List directory contents |
| `search_files` | Recursive literal-text search with extension filters |
| `bash` | Run shell commands with safe/ask/deny behavior |
| `todo_read` / `todo_write` | Session-scoped task tracking |
| `webfetch` | Fetch one web URL as text, markdown, or raw HTML |

### Dynamic tools

Two systems can register runtime tools:

- **MCP** tools from configured servers
- **Skills** via the dynamic `activate_skill` tool

### Special tool

`sub_agent` is exposed by the agent loop itself rather than the normal tool registry.

## 8. File and Path Safety

All file tools validate requested paths through `src/utils/path-validation.ts`.

### Current behavior

- paths must resolve inside `process.cwd()`
- symlinks are resolved before the final allow check
- for files that do not exist yet, the parent directory is validated
- activated skill directories are added as extra allowed roots

## 9. Approval Model

ProtoAgent requires approval for risky operations.

### Approval categories

- `file_write`
- `file_edit`
- `shell_command`

### Current behavior

- approvals can be granted once or for the current session scope
- approval keys are scoped by session ID plus operation scope
- if `--dangerously-accept-all` is enabled, normal approvals are skipped
- if no approval handler is registered, the system fails closed and rejects the request

### Shell command safety tiers

`src/tools/bash.ts` uses three tiers:

1. safe commands that auto-run
2. hard-blocked dangerous patterns that always fail
3. everything else requiring approval

## 10. Session Persistence

Sessions are stored as JSON files in:

- macOS/Linux: `~/.local/share/protoagent/sessions/`
- Windows: `%USERPROFILE%/AppData/Local/protoagent/sessions/`

### Session contents

- UUID session ID
- title
- created/updated timestamps
- provider and model
- full completion message history
- TODO state

### Current behavior

- session files are permission-hardened on Unix-like systems
- session IDs are validated before file access
- resuming a session refreshes the system prompt at the top of the message list
- helper functions exist for list/load/save/delete, though the main user-facing flow is `--session <id>`

## 11. Cost Tracking and Compaction

### Cost tracking

`src/utils/cost-tracker.ts` provides:

- rough token estimation using a character heuristic
- conversation token estimation
- cost calculation from provider pricing
- context utilization estimates

### Compaction

`src/utils/compactor.ts` compacts conversations at 90% context usage.

Current strategy:

- keep the current system prompt
- summarize older middle messages with a dedicated compression prompt
- preserve recent messages verbatim
- preserve protected skill tool messages containing `<skill_content ...>`

## 12. Skills

ProtoAgent supports validated local skills.

### Discovery roots

Project-level:

- `.agents/skills/`
- `.protoagent/skills/`

User-level:

- `~/.agents/skills/`
- `~/.protoagent/skills/`
- `~/.config/protoagent/skills/`

### Skill format

Each skill is a directory containing `SKILL.md` with YAML frontmatter.

Required metadata:

- `name`
- `description`

Current validation also supports:

- `compatibility`
- `license`
- `metadata`
- `allowed-tools`

### Runtime behavior

- project skills override user skills with the same name
- the system prompt includes a catalog of available skills
- ProtoAgent registers `activate_skill` dynamically when skills exist
- activating a skill returns the skill body plus bundled resource listings
- skill resources can come from `scripts/`, `references/`, and `assets/`

`allowed-tools` is parsed but not enforced as a hard permission boundary.

## 13. MCP Support

ProtoAgent reads MCP configuration from the merged `protoagent.jsonc` runtime config and supports:

- **stdio** MCP servers
- **HTTP / Streamable HTTP** MCP servers

### Current behavior

- configured servers are connected on app initialization
- discovered MCP tools are registered dynamically as namespaced tools
- tool results are normalized into text output when possible
- connections are closed on cleanup

Recommended MCP config shape:

```jsonc
{
  "mcp": {
    "servers": {
      "my-stdio-server": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@my/mcp-server"]
      },
      "my-http-server": {
        "type": "http",
        "url": "http://localhost:3000/mcp"
      }
    }
  }
}
```

Future-compatible server fields may include:

- `enabled`
- `cwd`
- `env`
- `headers`
- `timeoutMs`

OAuth is not implemented.

## 14. Web Fetching

`webfetch` fetches one HTTP(S) URL and returns structured output.

### Supported formats

- `text`
- `markdown`
- `html`

### Current limits

- max URL length: 4096
- default timeout: 30s
- max timeout: 120s
- max redirects: 10
- max response size: 5 MB
- max output size: 2 MB
- text-like MIME types only

For HTML content, ProtoAgent converts to text or Markdown when requested.

## 15. Sub-agents

ProtoAgent exposes a `sub_agent` tool for isolated child work.

### Current behavior

- child runs get a fresh system prompt and isolated message history
- they use the normal built-in and dynamic tools
- `sub_agent` is not recursively re-exposed inside child runs
- `max_iterations` defaults to 30
- only the child's final answer is returned to the parent

Because child runs share the same process-level handlers, normal approvals can still appear for writes, edits, and non-safe shell commands.

## 16. Terminal UI

The Ink UI in `src/App.tsx` currently provides:

- message rendering for user, assistant, system, and tool messages
- collapsible boxes for long system and tool output
- consolidated tool-call/result rendering
- formatted assistant output via `FormattedMessage`
- table-friendly rendering helpers
- inline approval prompts
- inline first-run setup
- session-aware quit flow that shows a resume command
- usage and cost display
- recent log capture for UI display

## 17. Logging

`src/utils/logger.ts` provides file-backed logging with levels:

- `ERROR`
- `WARN`
- `INFO`
- `DEBUG`
- `TRACE`

Logs are written under the user's ProtoAgent data directory rather than printed directly into the Ink render stream.

## 18. Known Omissions and Intentional Limits

ProtoAgent intentionally does not currently implement:

- sandboxing
- git-based undo/snapshots
- advanced edit fallback strategies
- skill dependency resolution or enforced allowed-tool constraints
- built-in web search APIs
- session branching
- MCP OAuth
- non-interactive RPC/server modes

Those are reasonable extension points, but they are outside the current scope of the code in `src/`.

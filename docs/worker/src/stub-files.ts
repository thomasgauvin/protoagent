/**
 * Stub files for the virtual filesystem
 * Auto-generated at deploy time from protoagent source
 * Run: node scripts/sync-protoagent-stubs.mjs
 */

interface StubFile {
  path: string;
  content: string;
}

export const stubFiles: StubFile[] = [
  {
    path: "ARCHITECTURE.md",
    content: `# ProtoAgent Architecture

ProtoAgent is a terminal-based coding agent built around a small number of modules with clear responsibilities:

- a Commander CLI entrypoint
- an Ink app that owns runtime orchestration and rendering
- a streaming agent loop
- a tool registry with static and dynamic tools
- persistence and extension layers for config, sessions, skills, MCP, and sub-agents

This document describes how the current implementation in \`src/\` actually works.

For the companion feature-and-behavior reference, see \`SPEC.md\`.

## 1. High-level structure

\`\`\`text
protoagent CLI
  -> App (Ink)
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools
        -> Dynamic tools from MCP and skills
        -> Special sub-agent execution path
\`\`\`

At runtime, the user interacts only with the Ink UI. The UI delegates model/tool work to \`src/agentic-loop.ts\`, which emits events back into the UI rather than rendering directly.

## 2. Module map

### Entry and shell

- \`src/cli.tsx\`
  - Parses \`--dangerously-accept-all\`, \`--log-level\`, \`--session\`, and the \`configure\` subcommand.
  - Renders either \`App\` or \`ConfigureComponent\`.

### Main application layer

- \`src/App.tsx\`
  - Main Ink application.
  - Owns config/session/UI state, MCP lifecycle, approval integration, slash commands, current conversation state, and persistence after each turn.
  - Despite its top comment, it is both presentation and orchestration.

### Core runtime

- \`src/agentic-loop.ts\`
  - Runs the streaming tool-use loop.
  - Refreshes the system prompt, compacts context when needed, streams model output, accumulates tool calls, executes tools, retries transient failures, and returns final message history.

- \`src/system-prompt.ts\`
  - Builds a dynamic system prompt from cwd, a filtered directory tree, the current tool registry, and discovered skills.

- \`src/sub-agent.ts\`
  - Defines the \`sub_agent\` tool and runs isolated child-agent loops.

### Configuration and model metadata

- \`src/config.tsx\`
  - Stores config under the user's data directory.
  - Provides the standalone config wizard and shared config read/write helpers.

- \`src/providers.ts\`
  - Provider/model catalog.
  - Supplies base URLs, environment variable names, pricing, and context windows.

### Persistence

- \`src/sessions.ts\`
  - Creates, loads, saves, lists, and deletes JSON session files.
  - Persists completion messages, provider/model metadata, and per-session TODO state.

### Extension systems

- \`src/skills.ts\`
  - Discovers validated skill directories.
  - Registers the dynamic \`activate_skill\` tool.
  - Extends allowed filesystem roots to activated skill directories.

- \`src/mcp.ts\`
  - Loads merged \`protoagent.jsonc\` runtime config.
  - Connects to stdio or HTTP MCP servers.
  - Registers MCP tools dynamically.

### Tool system

- \`src/tools/index.ts\`
  - Static built-in tool registry.
  - Dynamic tool and handler registries.
  - Central dispatch for tool execution.

- Built-in tools in \`src/tools/*\`
  - \`read-file.ts\`
  - \`write-file.ts\`
  - \`edit-file.ts\`
  - \`list-directory.ts\`
  - \`search-files.ts\`
  - \`bash.ts\`
  - \`todo.ts\`
  - \`webfetch.ts\`

### UI components and formatting helpers

- \`src/components/CollapsibleBox.tsx\`
- \`src/components/ConsolidatedToolMessage.tsx\`
- \`src/components/FormattedMessage.tsx\`
- \`src/components/Table.tsx\`
- \`src/utils/format-message.tsx\`

These handle collapsible long output, grouped tool rendering, Markdown-ish formatting, and table rendering.

### Shared utilities

- \`src/utils/approval.ts\`
- \`src/utils/path-validation.ts\`
- \`src/utils/compactor.ts\`
- \`src/utils/cost-tracker.ts\`
- \`src/utils/logger.ts\`

## 3. Startup Flow

### CLI startup

1. \`src/cli.tsx\` parses arguments.
2. It renders either:
   - \`App\` for normal interactive use, or
   - \`ConfigureComponent\` for \`protoagent configure\`.

### App initialization

When \`App\` mounts, it performs these steps:

1. sets log level and initializes a log file if logging is enabled
2. enables global auto-approval if \`--dangerously-accept-all\` was passed
3. registers an interactive approval handler with \`src/utils/approval.ts\`
4. reads config from disk
5. shows inline first-run setup if config is missing
6. builds the OpenAI client from the chosen provider/model
7. initializes MCP, which may register dynamic tools
8. loads the requested session or creates a new one
9. initializes conversation messages with a fresh system prompt

Cleanup on unmount clears the approval handler and closes MCP connections.

## 4. Turn Execution Flow

### User input path

When the user submits input in \`App\`:

1. slash commands are handled locally if the message starts with \`/\`
2. otherwise, the user message is appended immediately for responsive UI feedback
3. an \`AbortController\` is created for the active completion
4. \`runAgenticLoop()\` is called with:
   - the OpenAI client
   - the selected model
   - current message history
   - pricing info
   - the abort signal
   - the current session ID
   - an event callback into the UI

### Agent loop path

Inside \`src/agentic-loop.ts\`, each iteration does the following:

1. abort check
2. refresh the top system prompt
3. compact history if context usage is high
4. build the tool list from:
   - static tools
   - dynamic tools
   - the special \`sub_agent\` tool
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
   - emit \`done\`
   - return updated history

### Event channel back to the UI

The loop emits these event types:

- \`text_delta\`
- \`tool_call\`
- \`tool_result\`
- \`sub_agent_iteration\` — progress from within a running sub-agent (tool name + status per iteration); distinct from \`tool_call\` so the UI shows it in the spinner only and does not pollute the parent's tool-call message history
- \`usage\`
- \`error\`
- \`done\`
- \`iteration_done\`

\`App\` consumes these events to build live assistant messages, render tool output, show retries/errors, and update usage state.

## 5. Message and Session Model

### Conversation state

The canonical in-memory history in the app is \`completionMessages\`, which uses OpenAI chat-completions message objects.

\`App\` also keeps an \`assistantMessageRef\` so streaming UI updates can mutate the currently-rendered assistant message before the final history replacement comes back from the loop.

### Session state

Each session contains:

- \`id\`
- \`title\`
- \`createdAt\`
- \`updatedAt\`
- \`model\`
- \`provider\`
- \`todos\`
- \`completionMessages\`

After each successful turn, \`App\` updates the active session with:

- latest messages
- current TODOs from \`src/tools/todo.ts\`
- a generated title

and then saves the session to disk.

## 6. Tool Architecture

### Static tools

Built-in tools are always available through \`src/tools/index.ts\`:

- \`read_file\`
- \`write_file\`
- \`edit_file\`
- \`list_directory\`
- \`search_files\`
- \`bash\`
- \`todo_read\`
- \`todo_write\`
- \`webfetch\`

### Dynamic tools

Dynamic tools can be registered at runtime by:

- MCP connections in \`src/mcp.ts\`
- the skills system in \`src/skills.ts\`

Dynamic tools and dynamic handlers are stored separately so the model-facing schema list and execution dispatch stay in sync.

### Special-case tool: \`sub_agent\`

\`sub_agent\` is not part of the normal tool registry. The agent loop appends it when making model requests and handles it specially by calling \`runSubAgent()\`.

That means:

- the model can use \`sub_agent\`
- the main tool registry does not dispatch it
- the generated prompt text from \`getAllTools()\` does not automatically document it

## 7. Safety Model

### Path restrictions

File tools call \`validatePath()\` from \`src/utils/path-validation.ts\`.

Current rules:

- paths must resolve inside \`process.cwd()\`
- symlink targets must still resolve inside an allowed root
- non-existent files are validated by checking the parent directory
- activated skill directories are added as extra allowed roots

### Approval system

\`src/utils/approval.ts\` holds global approval state:

- \`dangerouslyAcceptAll\`
- an interactive approval callback supplied by \`App\`
- a per-session approval cache

Current approval categories are:

- \`file_write\`
- \`file_edit\`
- \`shell_command\`

Tool implementations typically pass a \`sessionScopeKey\`, so session approvals are narrower than a broad “approve all writes forever” model; in practice they are usually scoped to a file path or exact shell command family.

### Shell execution

\`src/tools/bash.ts\` uses a three-tier model:

1. hard-blocked dangerous patterns
2. safe commands that auto-run
3. everything else requiring approval

This is not sandboxing. Approved shell commands run through \`shell: true\` and can access the wider machine.

## 8. Skills Architecture

The skills system in \`src/skills.ts\` is both discovery and runtime mutation.

### Discovery

It scans project and user skill roots for directories containing \`SKILL.md\` with YAML frontmatter.

### Validation

It validates:

- skill name
- description
- directory-name match
- optional metadata fields

### Runtime effects

When skills are initialized:

- available skills are discovered
- \`activate_skill\` may be registered dynamically
- skill directories are added to allowed filesystem roots
- the system prompt gets a catalog of available skills

Because \`generateSystemPrompt()\` calls \`initializeSkillsSupport()\`, prompt generation has side effects on tool registration and path permissions.

## 9. MCP Architecture

\`src/mcp.ts\` reads merged \`protoagent.jsonc\` config and supports two transport types:

- \`stdio\`
- \`http\` via \`StreamableHTTPClientTransport\`

For each configured server, ProtoAgent:

1. connects the client
2. lists server tools
3. registers each tool as a dynamic namespaced tool
4. registers a matching dynamic handler that calls back into the MCP server

Connections are stored in a process-level map and closed on shutdown.

## 10. Sub-Agent Architecture

\`src/sub-agent.ts\` creates isolated child runs for focused work.

### Child run behaviour

- generates a fresh system prompt
- appends an extra "Sub-Agent Mode" instruction block
- starts a new message history with that prompt plus the delegated task
- reuses the same OpenAI client and model
- uses \`getAllTools()\` for child tool access
- loops independently until it returns a final answer or hits its iteration limit

The child does not recursively expose \`sub_agent\`, so nested delegation is intentionally prevented by implementation shape.

Because child runs use the same process-level tool handlers, file edits and non-safe shell commands can still trigger the normal approval mechanism.

### Abort propagation

The parent's \`AbortSignal\` is passed to \`runSubAgent()\`, to the child's \`client.chat.completions.create()\` call, and to each \`handleToolCall()\` invocation. Pressing Escape stops the child as soon as the in-flight request or tool call acknowledges the signal.

### UI progress isolation

Sub-agent tool steps are reported to the parent via \`onProgress\` callbacks, which the agentic loop converts to \`sub_agent_iteration\` events. The UI handles these by updating the spinner label (\`Running sub_agent → bash...\`) without adding them to the parent's \`completionMessages\` or \`assistantMessageRef\`. This keeps the parent conversation history clean.

## 11. Conversation Compaction and Cost Tracking

### Cost tracking

\`src/utils/cost-tracker.ts\` provides:

- rough token estimation
- conversation token counting
- estimated dollar cost from provider pricing
- context utilization calculations

### Compaction

\`src/utils/compactor.ts\` compacts history at 90% context usage by:

1. keeping the first system message
2. keeping a small tail of recent messages verbatim
3. preserving protected skill-content tool messages
4. summarizing older middle history through a dedicated summarization prompt

The output is a rebuilt message list with a synthetic summary system message.

## 12. Terminal UI

### Primary UI responsibilities in \`App\`

\`App\` owns:

- config/bootstrap flow
- session load/save state
- live conversation rendering
- slash command handling
- keyboard shortcuts
- approval prompts
- inline setup
- loading and usage display
- MCP initialization/cleanup

### Rendering helpers

- \`CollapsibleBox\` truncates long system/tool output with \`/expand\` and \`/collapse\`
- \`ConsolidatedToolMessage\` groups assistant tool calls with following tool results
- \`FormattedMessage\` parses mixed text/table/code output
- \`Table\` renders JSON or Markdown-table data with terminal-width-aware wrapping
- \`formatMessage()\` applies simple Markdown-style bold/italic formatting
- \`LeftBar\` renders a bold green \`│\` bar on the left side of callout content (tool calls, approvals, errors, code blocks)

### LeftBar: why not Box borders

The obvious way to draw a left-side visual indicator in Ink is \`<Box borderStyle="single">\`, but Box borders add lines on all four sides and contribute extra rows to Ink's managed output region. Because Ink erases by line count on every re-render, every extra row increases the chance of ghosting artifacts when the terminal is resized — stale lines are left behind if the new frame is shorter than the old one.

\`LeftBar\` avoids this entirely. It is a plain flex row: a narrow \`<Text>\` column on the left that renders \`│\` repeated once per content row, and a \`flexGrow\` content column on the right. The height of the bar is derived by measuring the content box after each render with Ink's built-in \`measureElement\`, then setting the bar string to \`Array(height).fill('│').join('\\n')\`. No Box border, no extra rows — the total line count of the component is exactly equal to the line count of its children.

### Why stock Ink causes flickering and ghosting

Ink renders a React tree to a string on every state change, then uses \`log-update\` to erase the previous output and write the new string. It tracks how many lines the last render produced and moves the cursor up by that many lines to overwrite. This strategy has a failure mode on terminal resize: Ink only erases the number of lines it thinks it owns. On terminal width *decreases* it clears the screen; on width *increases* it does not — it just re-renders at the new width using its stored (stale) line count. If the frame was previously taller at a narrower width and is now shorter at a wider width, old lines remain on screen below the new output (ghosting).

## 13. Important Implementation Nuances

These details are easy to miss but matter for an accurate mental model:

- \`App.tsx\` is the real runtime coordinator, not just a presentational wrapper.
- the system prompt is regenerated on startup, on resume, and again at the start of every turn
- skills initialization mutates both the tool registry and allowed path roots
- \`sub_agent\` is available to the model but not part of \`getAllTools()\`
- approved shell commands are powerful and not sandboxed
- \`validatePath()\` requires the parent directory of a new file to already exist, even though \`write_file\` later calls \`mkdir(..., recursive: true)\`
- \`handleToolCall()\` usually returns error strings instead of throwing, so many tool failures flow back to the model as normal tool results
- \`/quit\` persists and shows a resume command, while \`Ctrl-C\` exits immediately
- \`/help\` appends a \`system\` message into history rather than rendering a temporary overlay
- session resume replaces the first saved system prompt with a freshly generated one
- some helper state exists without full UI surfacing yet, such as log buffering and session list/delete helpers

## 14. Shutdown and Lifecycle Boundaries

There are two main exit paths:

- graceful quit via \`/quit\` or \`/exit\`, which saves session state and shows a resume command
- immediate \`Ctrl-C\`, which exits without the same quit UX

On component cleanup, \`App\`:

- unsubscribes log listeners
- clears the approval handler
- closes MCP connections

## 15. Extension Points

The cleanest places to extend the system are:

- \`src/providers.ts\` for new providers/models
- \`src/tools/*\` plus \`src/tools/index.ts\` for new built-in tools
- \`src/skills.ts\` for richer skill metadata or enforcement
- \`src/mcp.ts\` for more MCP lifecycle features
- \`src/sub-agent.ts\` for richer delegated execution models
- \`src/components/*\` and \`src/utils/format-message.tsx\` for richer terminal presentation

The overall design stays small by pushing most behavior into explicit modules rather than hiding logic behind a framework or plugin runtime.
`,
  },
  {
    path: "README.md",
    content: `\`\`\`
█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █
\`\`\`

A minimal, educational AI coding agent CLI written in TypeScript. It stays small enough to read in an afternoon, but it still has the core pieces you expect from a real coding agent: a streaming tool-use loop, approvals, sessions, MCP, skills, sub-agents, and cost tracking.

## Features

- **Multi-provider chat** — OpenAI, Anthropic, Google Gemini, and Cerebras via the OpenAI SDK
- **Built-in tools** — Read, write, edit, list, search, run shell commands, manage todos, and fetch web pages with \`webfetch\`
- **Approval system** — Inline confirmation for file writes, file edits, and non-safe shell commands
- **Session persistence** — Conversations and TODO state are saved automatically and can be resumed with \`--session\`
<!-- - **Dynamic extensions** — Load skills on demand and add external tools through MCP servers -->
- **Sub-agents** — Delegate self-contained tasks to isolated child conversations
- **Usage tracking** — Live token, context, and estimated cost display in the TUI

## Quick Start

\`\`\`bash
npm install -g protoagent
protoagent
\`\`\`

On first run, ProtoAgent shows an inline setup flow where you pick a provider/model pair and enter an API key. ProtoAgent stores that selection in \`protoagent.jsonc\`.

Runtime config lookup is simple:

- if \`<cwd>/.protoagent/protoagent.jsonc\` exists, ProtoAgent uses it
- otherwise it falls back to the shared user config at \`~/.config/protoagent/protoagent.jsonc\` on macOS/Linux and \`~/AppData/Local/protoagent/protoagent.jsonc\` on Windows

You can also run the standalone wizard directly:

\`\`\`bash
protoagent configure
\`\`\`

Or configure a specific target non-interactively:

\`\`\`bash
protoagent configure --project --provider openai --model gpt-5-mini
protoagent configure --user --provider anthropic --model claude-sonnet-4-6
\`\`\`

To create a runtime config file for the current project or your shared user config, run:

\`\`\`bash
protoagent init
\`\`\`

\`protoagent init\` creates \`protoagent.jsonc\` in either \`<cwd>/.protoagent/protoagent.jsonc\` or your shared user config location and prints the exact path it used.

For scripts or non-interactive setup, use:

\`\`\`bash
protoagent init --project
protoagent init --user
protoagent init --project --force
\`\`\`

## Interactive Commands

- \`/help\` — Show available slash commands
- \`/collapse\` — Collapse long system and tool output
- \`/expand\` — Expand collapsed messages
- \`/quit\` or \`/exit\` — Save and exit

Other useful shortcuts:

- \`Esc\` — Abort the current in-flight completion
- \`Ctrl-C\` — Exit immediately

## Building From Source

\`\`\`bash
npm install
npm run build
npm run dev
\`\`\`

## Documentation

Full guides and tutorials live in \`docs/\`:

- \`docs/guide/getting-started.md\`
- \`docs/guide/configuration.md\`
- \`docs/guide/tools.md\`
- \`docs/guide/sessions.md\`
- \`docs/guide/skills.md\`
- \`docs/guide/sub-agents.md\`
- \`docs/guide/mcp.md\`

Build the docs site locally:

\`\`\`bash
npm run docs:dev
npm run docs:build
\`\`\`

Top-level technical references:

- \`SPEC.md\` — current implementation specification
- \`ARCHITECTURE.md\` — current runtime architecture and module relationships

## Architecture

The codebase is organized so each part is easy to trace:

- \`src/cli.tsx\` — CLI flags and the \`configure\` subcommand
- \`src/App.tsx\` — Ink app shell, runtime orchestration, slash commands, approvals, session display
- \`src/agentic-loop.ts\` — Streaming tool-use loop and error handling
- \`src/tools/\` — Built-in tools such as file I/O, shell, todo tracking, and \`webfetch\`
- \`src/config.tsx\` — Config persistence and setup wizard
- \`src/providers.ts\` — Provider/model catalog and pricing metadata
- \`src/sessions.ts\` — Session save/load and TODO persistence
- \`src/skills.ts\` — Skill discovery and dynamic \`activate_skill\` tool registration
- \`src/mcp.ts\` — MCP server loading and dynamic tool registration
- \`src/sub-agent.ts\` — Isolated child agent execution

## Supported Providers

### OpenAI
- GPT-5.2
- GPT-5 Mini
- GPT-4.1

### Anthropic Claude
- Claude Opus 4.6
- Claude Sonnet 4.6
- Claude Haiku 4.5

### Google Gemini
- Gemini 3 Flash (Preview)
- Gemini 3 Pro (Preview)
- Gemini 2.5 Flash
- Gemini 2.5 Pro

### Cerebras
- Cerebras — Llama 4 Scout 17B

## Why ProtoAgent?

ProtoAgent is not trying to be a giant framework. It is a compact reference implementation for how coding agents work in practice: configuration, dynamic system prompts, a streaming agent loop, tool registries, approvals, sessions, MCP, skills, and delegated sub-agents.

If you want to learn by reading source instead of magic abstractions, this repo is built for that.

## License

MIT
`,
  },
  {
    path: "SPEC.md",
    content: `# ProtoAgent Specification

ProtoAgent is a small TypeScript coding agent CLI built to be readable, hackable, and useful enough for real project work.

This spec describes what the current implementation in \`src/\` actually does.

For the companion runtime/module walkthrough, see \`ARCHITECTURE.md\`.

## 1. Goals

1. **Readable** — the core system should stay compact enough to understand without a framework tour.
2. **Useful** — it should support real coding workflows: reading code, editing files, running commands, resuming sessions, and consulting external context.
3. **Extensible** — new tools, providers, skills, and MCP integrations should fit naturally into the existing structure.

## 2. Architecture Overview

\`\`\`text
CLI (Commander)
  -> Ink TUI
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools
        -> Dynamic tools from skills and MCP
        -> Special sub-agent tool
\`\`\`

### Main modules

| Area | Files | Responsibility |
|---|---|---|
| CLI | \`src/cli.tsx\` | Parses flags, starts the main app, or launches \`configure\` |
| UI | \`src/App.tsx\`, \`src/components/*\` | Renders the conversation, approvals, collapsible output, formatted messages |
| Loop | \`src/agentic-loop.ts\` | Runs the streaming tool-use loop and retry logic |
| Config | \`src/config.tsx\`, \`src/providers.ts\` | Stores config, loads providers/models, resolves API keys |
| Tools | \`src/tools/*\` | Built-in tool schemas and handlers |
| Sessions | \`src/sessions.ts\` | Saves and resumes messages and TODO state |
| Skills | \`src/skills.ts\` | Discovers validated skill directories and exposes \`activate_skill\` |
| MCP | \`src/mcp.ts\` | Loads MCP servers and registers their tools dynamically |
| Utilities | \`src/utils/*\` | Approval, compaction, cost estimation, logging, message formatting, path validation |

## 3. CLI and Interaction Model

### CLI entry points

- \`protoagent\`
- \`protoagent configure\`

### CLI flags

- \`--dangerously-accept-all\`
- \`--log-level <level>\`
- \`--session <id>\`

### Interactive slash commands

Inside the TUI, the current app supports:

- \`/collapse\`
- \`/expand\`
- \`/help\`
- \`/quit\`
- \`/exit\`

The UI also supports aborting an in-flight completion with \`Esc\`.

## 4. Configuration System

ProtoAgent uses two configuration layers:

- persisted user selection in \`config.json\`
- extensibility and runtime overrides in \`protoagent.jsonc\`

### Persisted session config

ProtoAgent stores user selection at:

- macOS/Linux: \`~/.local/share/protoagent/config.json\`
- Windows: \`%USERPROFILE%/AppData/Local/protoagent/config.json\`

Stored fields:

\`\`\`json
{
  "provider": "openai",
  "model": "gpt-5-mini",
  "apiKey": "..."
}
\`\`\`

This file remains intentionally small. It stores the selected provider, selected model, and an optional explicit API key.

### Unified extensibility config

ProtoAgent also reads \`protoagent.jsonc\` from these locations:

- \`<process.cwd()>/.protoagent/protoagent.jsonc\`
- \`~/.config/protoagent/protoagent.jsonc\`

All files are optional. If multiple files are present, they are merged in this order:

1. built-in defaults from source
2. \`~/.config/protoagent/protoagent.jsonc\`
3. \`<process.cwd()>/.protoagent/protoagent.jsonc\`

Later entries win on conflict.

### Top-level shape

\`\`\`jsonc
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
        "cf-access-token": "\${CF_ACCESS_TOKEN}",
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
\`\`\`

### Provider rules

- \`providers\` may define entirely new providers or override built-in providers by ID.
- Provider IDs must be unique after merge.
- Provider \`models\` are keyed by model ID and merge by key.
- Project config overrides user config for both provider metadata and model metadata.
- JSONC comments are allowed in source files but are ignored at runtime.

### Environment interpolation

Any string value in \`protoagent.jsonc\` may include \`\${VAR_NAME}\` placeholders.

- interpolation happens at load time
- missing variables resolve to an empty string
- missing variables log a warning
- empty header values are dropped after interpolation

### Runtime precedence

Environment variables remain first-class runtime overrides and take precedence over file config.

Resolution order:

- API key:
  1. \`config.apiKey\`
  2. explicit environment override for the active provider
  3. \`PROTOAGENT_API_KEY\`
  4. \`provider.apiKey\`
  5. \`process.env[provider.apiKeyEnvVar]\`
  6. \`'none'\` when the provider uses header-based auth and no bearer token is required
  7. otherwise throw
- base URL:
  1. \`PROTOAGENT_BASE_URL\`
  2. \`provider.baseURL\`
  3. built-in default
- headers:
  1. \`PROTOAGENT_CUSTOM_HEADERS\`
  2. \`provider.headers\`
  3. built-in default headers

### Request parameter defaults

Providers and models may declare request defaults:

- provider-level \`defaultParams\`
- model-level \`defaultParams\`

Model defaults override provider defaults.

These defaults may tune request behavior such as:

- \`temperature\`
- \`top_p\`
- \`max_tokens\`
- \`store\`
- \`parallel_tool_calls\`

Reserved request fields must not be overridden by config:

- \`model\`
- \`messages\`
- \`tools\`
- \`tool_choice\`
- \`stream\`
- \`stream_options\`

ProtoAgent should validate these keys and warn or reject invalid config rather than silently changing core agent behavior.

### Interactive setup

- If no \`config.json\` exists, the main app shows an inline first-run setup flow.
- \`protoagent configure\` launches the standalone wizard.
- Interactive setup uses the merged provider registry from built-ins plus \`protoagent.jsonc\`.
- Providers that already resolve auth from env vars or header-based config should not require a placeholder API key prompt.

### Migration stance

- \`.protoagent/providers.json\` and \`.protoagent/mcp.json\` are replaced by \`.protoagent/protoagent.jsonc\`.
- Backwards-compatible env vars remain supported during development.
- Since ProtoAgent is still in development, file-format cleanup and provider cleanup can be done without preserving old config shapes long term.

## 5. Provider and Model Support

ProtoAgent uses the OpenAI SDK directly.

Built-in providers ship in source, but the runtime provider registry is the merged result of:

- built-in providers
- user \`protoagent.jsonc\`
- project \`protoagent.jsonc\`

Each provider may declare:

- provider ID
- human-readable provider name
- optional OpenAI-compatible \`baseURL\`
- optional \`apiKey\`
- optional \`apiKeyEnvVar\`
- optional default headers
- optional request \`defaultParams\`
- one or more models

Each model entry may declare:

- model ID
- human-readable name
- context window
- per-million input pricing
- per-million output pricing
- model-level \`defaultParams\`

The model picker and all provider lookups operate on this merged runtime registry rather than a hardcoded provider list alone.

## 6. Agentic Loop

The core loop in \`src/agentic-loop.ts\` works like this:

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

- \`429\` rate limits
- \`408\`, \`409\`, and \`425\`
- \`5xx\` server failures
- selected network transport errors like \`ECONNRESET\`, \`ETIMEDOUT\`, and \`EAI_AGAIN\`

It also has a repair path for provider rejections caused by malformed tool payload round-trips.

## 7. Tool System

Each built-in tool exports:

1. a JSON schema
2. a handler function

\`src/tools/index.ts\` collects built-ins and dispatches calls. It also supports runtime registration for dynamic tools.

### Built-in tools

| Tool | Purpose |
|---|---|
| \`read_file\` | Read file contents with line slicing |
| \`write_file\` | Create or overwrite a file |
| \`edit_file\` | Exact-string replacement in an existing file |
| \`list_directory\` | List directory contents |
| \`search_files\` | Recursive literal-text search with extension filters |
| \`bash\` | Run shell commands with safe/ask/deny behavior |
| \`todo_read\` / \`todo_write\` | Session-scoped task tracking |
| \`webfetch\` | Fetch one web URL as text, markdown, or raw HTML |

### Dynamic tools

Two systems can register runtime tools:

- **MCP** tools from configured servers
- **Skills** via the dynamic \`activate_skill\` tool

### Special tool

\`sub_agent\` is exposed by the agent loop itself rather than the normal tool registry.

## 8. File and Path Safety

All file tools validate requested paths through \`src/utils/path-validation.ts\`.

### Current behavior

- paths must resolve inside \`process.cwd()\`
- symlinks are resolved before the final allow check
- for files that do not exist yet, the parent directory is validated
- activated skill directories are added as extra allowed roots

## 9. Approval Model

ProtoAgent requires approval for risky operations.

### Approval categories

- \`file_write\`
- \`file_edit\`
- \`shell_command\`

### Current behavior

- approvals can be granted once or for the current session scope
- approval keys are scoped by session ID plus operation scope
- if \`--dangerously-accept-all\` is enabled, normal approvals are skipped
- if no approval handler is registered, the system fails closed and rejects the request

### Shell command safety tiers

\`src/tools/bash.ts\` uses three tiers:

1. safe commands that auto-run
2. hard-blocked dangerous patterns that always fail
3. everything else requiring approval

## 10. Session Persistence

Sessions are stored as JSON files in:

- macOS/Linux: \`~/.local/share/protoagent/sessions/\`
- Windows: \`%USERPROFILE%/AppData/Local/protoagent/sessions/\`

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
- helper functions exist for list/load/save/delete, though the main user-facing flow is \`--session <id>\`

## 11. Cost Tracking and Compaction

### Cost tracking

\`src/utils/cost-tracker.ts\` provides:

- rough token estimation using a character heuristic
- conversation token estimation
- cost calculation from provider pricing
- context utilization estimates

### Compaction

\`src/utils/compactor.ts\` compacts conversations at 90% context usage.

Current strategy:

- keep the current system prompt
- summarize older middle messages with a dedicated compression prompt
- preserve recent messages verbatim
- preserve protected skill tool messages containing \`<skill_content ...>\`

## 12. Skills

ProtoAgent supports validated local skills.

### Discovery roots

Project-level:

- \`.agents/skills/\`
- \`.protoagent/skills/\`

User-level:

- \`~/.agents/skills/\`
- \`~/.protoagent/skills/\`
- \`~/.config/protoagent/skills/\`

### Skill format

Each skill is a directory containing \`SKILL.md\` with YAML frontmatter.

Required metadata:

- \`name\`
- \`description\`

Current validation also supports:

- \`compatibility\`
- \`license\`
- \`metadata\`
- \`allowed-tools\`

### Runtime behavior

- project skills override user skills with the same name
- the system prompt includes a catalog of available skills
- ProtoAgent registers \`activate_skill\` dynamically when skills exist
- activating a skill returns the skill body plus bundled resource listings
- skill resources can come from \`scripts/\`, \`references/\`, and \`assets/\`

\`allowed-tools\` is parsed but not enforced as a hard permission boundary.

## 13. MCP Support

ProtoAgent reads MCP configuration from the merged \`protoagent.jsonc\` runtime config and supports:

- **stdio** MCP servers
- **HTTP / Streamable HTTP** MCP servers

### Current behavior

- configured servers are connected on app initialization
- discovered MCP tools are registered dynamically as namespaced tools
- tool results are normalized into text output when possible
- connections are closed on cleanup

Recommended MCP config shape:

\`\`\`jsonc
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
\`\`\`

Future-compatible server fields may include:

- \`enabled\`
- \`cwd\`
- \`env\`
- \`headers\`
- \`timeoutMs\`

OAuth is not implemented.

## 14. Web Fetching

\`webfetch\` fetches one HTTP(S) URL and returns structured output.

### Supported formats

- \`text\`
- \`markdown\`
- \`html\`

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

ProtoAgent exposes a \`sub_agent\` tool for isolated child work.

### Current behavior

- child runs get a fresh system prompt and isolated message history
- they use the normal built-in and dynamic tools
- \`sub_agent\` is not recursively re-exposed inside child runs
- \`max_iterations\` defaults to 30
- only the child's final answer is returned to the parent

Because child runs share the same process-level handlers, normal approvals can still appear for writes, edits, and non-safe shell commands.

## 16. Terminal UI

The Ink UI in \`src/App.tsx\` currently provides:

- message rendering for user, assistant, system, and tool messages
- collapsible boxes for long system and tool output
- consolidated tool-call/result rendering
- formatted assistant output via \`FormattedMessage\`
- table-friendly rendering helpers
- inline approval prompts
- inline first-run setup
- session-aware quit flow that shows a resume command
- usage and cost display
- recent log capture for UI display

## 17. Logging

\`src/utils/logger.ts\` provides file-backed logging with levels:

- \`ERROR\`
- \`WARN\`
- \`INFO\`
- \`DEBUG\`
- \`TRACE\`

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

Those are reasonable extension points, but they are outside the current scope of the code in \`src/\`.
`,
  },
  {
    path: "docs/.vitepress/config.ts",
    content: `import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'ProtoAgent',
  titleTemplate: ':title - A DIY coding agent CLI',
  description: 'Build your own AI coding agent. ProtoAgent is a readable, production-ready implementation with multi-step tool loops, MCP support, sessions, and sub-agents. Small enough to understand, simple enough to build.',

  appearance: false,
  cleanUrls: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],

    // Open Graph
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'ProtoAgent - A DIY coding agent CLI' }],
    ['meta', { property: 'og:description', content: 'Build your own AI coding agent. ProtoAgent is a readable, production-ready implementation with multi-step tool loops, MCP support, sessions, and sub-agents.' }],
    ['meta', { property: 'og:site_name', content: 'ProtoAgent' }],

    // Twitter Card
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'ProtoAgent - A DIY coding agent CLI' }],
    ['meta', { name: 'twitter:description', content: 'Build your own AI coding agent. ProtoAgent is a readable, production-ready implementation with multi-step tool loops, MCP support, sessions, and sub-agents.' }],

    // SEO
    ['meta', { name: 'keywords', content: 'AI coding agent, CLI, build your own, MCP, LLM tools, coding assistant, AI agent tutorial, TypeScript' }],
    ['meta', { name: 'author', content: 'ProtoAgent' }],
    ['meta', { name: 'theme-color', content: '#0a180e' }],
  ],

  themeConfig: {
    nav: [
      { text: 'Try it out', link: '/try-it-out/getting-started' },
      { text: 'Build Your Own', link: '/build-your-own/' },
      { text: 'Reference', link: '/reference/spec' },
    ],

    sidebar: {
      '/try-it-out/': [
        {
          text: 'Try it out',
          items: [
            { text: 'Getting Started', link: '/try-it-out/getting-started' },
            { text: 'Configuration', link: '/try-it-out/configuration' },
            { text: 'Tools', link: '/try-it-out/tools' },
            { text: 'Skills', link: '/try-it-out/skills' },
            { text: 'MCP Servers', link: '/try-it-out/mcp' },
            { text: 'Sessions', link: '/try-it-out/sessions' },
            { text: 'Sub-agents', link: '/try-it-out/sub-agents' },
          ],
        },
      ],
      '/build-your-own/': [
        {
          text: 'Build Your Own',
          items: [
            { text: 'Overview', link: '/build-your-own/' },
            { text: 'Part 1: Scaffolding', link: '/build-your-own/part-1' },
            { text: 'Part 2: AI Integration', link: '/build-your-own/part-2' },
            { text: 'Part 3: Configuration Management', link: '/build-your-own/part-3' },
            { text: 'Part 4: Agentic Loop', link: '/build-your-own/part-4' },
            { text: 'Part 5: Core Tools', link: '/build-your-own/part-5' },
            { text: 'Part 6: Shell & Approvals', link: '/build-your-own/part-6' },
            { text: 'Part 7: System Prompt & Policy', link: '/build-your-own/part-7' },
            { text: 'Part 8: Compaction & Cost', link: '/build-your-own/part-8' },
            { text: 'Part 9: Skills & Agents.md', link: '/build-your-own/part-9' },
            { text: 'Part 10: Sessions', link: '/build-your-own/part-10' },
            { text: 'Part 11: MCP Integration', link: '/build-your-own/part-11' },
            { text: 'Part 12: Sub-agents', link: '/build-your-own/part-12' },
            { text: 'Part 13: Polish, Rendering & Logging', link: '/build-your-own/part-13' },
          ],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'Specification', link: '/reference/spec' },
            { text: 'Architecture', link: '/reference/architecture' },
            { text: 'CLI Reference', link: '/reference/cli' },
            { text: 'Acknowledgements', link: '/reference/acknowledgements' },
          ],
        },
      ],
    },

    socialLinks: [],

    footer: {
      message: 'Built to teach how production-style coding agents actually work.',
    },
  },
})
`,
  },
  {
    path: "docs/.vitepress/theme/Layout.vue",
    content: `<script setup lang="ts">
import { useData } from 'vitepress'
import { computed } from 'vue'
import NavBar from './components/NavBar.vue'
import Sidebar from './components/Sidebar.vue'
import Home from './components/Home.vue'
import DocLayout from './components/DocLayout.vue'
import FooterBar from './components/FooterBar.vue'

const { page } = useData()

const isHome = computed(() => page.value.relativePath === 'index.md')
</script>

<template>
  <div class="vp-container">
    <NavBar />
    <div class="vp-wrapper" :class="{ 'is-docs': !isHome }">
      <Sidebar v-if="!isHome" />
      <main class="vp-main">
        <Home v-if="isHome" />
        <DocLayout v-else />
      </main>
    </div>
    <FooterBar />
  </div>
</template>

<style scoped>
.vp-container {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.vp-wrapper {
  display: flex;
  flex: 1;
  width: 100%;
}

.vp-wrapper.is-docs {
  max-width: var(--content-width);
  margin: 0 auto;
}

.vp-main {
  flex: 1;
  min-width: 0;
}

@media (max-width: 1100px) {
  .vp-wrapper {
    flex-direction: column;
  }
}
</style>
`,
  },
  {
    path: "docs/.vitepress/theme/components/DocLayout.vue",
    content: `<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
</script>

<template>
  <!-- Render the full VitePress layout (navbar is hidden via CSS) -->
  <DefaultTheme.Layout />
</template>

<style>
/* Hide duplicated VitePress chrome; custom docs shell provides it. */
.VPNav,
.VPSidebar,
.VPLocalNav {
  display: none !important;
}
</style>
`,
  },
  {
    path: "docs/.vitepress/theme/components/FooterBar.vue",
    content: `<template>
  <footer class="pa-footer">
    <span>PROTOAGENT//DOCS v0.0.1</span>
  </footer>
</template>

<style scoped>
.pa-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 8px 28px;
  border-top: 1px solid var(--border-strong);
  background: rgba(4, 9, 6, 0.94);
  backdrop-filter: blur(10px);
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: var(--text-xs);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

@media (max-width: 1180px) {
  .pa-footer {
    padding-left: 24px;
    padding-right: 24px;
    font-size: calc(var(--text-xs) - 0.07rem);
    letter-spacing: 0.12em;
  }
}
</style>
`,
  },
  {
    path: "docs/.vitepress/theme/components/Home.vue",
    content: `<script setup lang="ts">
import { computed, ref, onMounted } from 'vue'
import { useData } from 'vitepress'

const { frontmatter } = useData()

const hero = computed(() => frontmatter.value.hero || {})
const features = computed(() => frontmatter.value.features || [])

const marqueeItems = [
  { desktop: 'BUILD-IT-YOURSELF AI CODING AGENT', mobile: 'DIY AI CODING AGENT' },
  { desktop: 'MULTI-STEP TOOL LOOPS', mobile: 'TOOL LOOPS' },
  { desktop: 'MCP + SKILLS SUPPORT', mobile: 'MCP + SKILLS' },
  { desktop: 'SESSION PERSISTENCE', mobile: 'SESSIONS' },
  { desktop: 'SUB-AGENTS FOR CLEAN CONTEXT', mobile: 'SUB-AGENTS' },
]

const stats = [
  { label: '// readable codebase', value: 'SMALL', width: '78%' },
  { label: '// build it yourself', value: 'SIMPLE', width: '92%' },
  { label: '// use it in real projects', value: 'USABLE', width: '100%' },
]

// Initial static lines (shown immediately for full height)
const initialLines = [
  { type: 'dim', text: 'Model: OpenAI / gpt-5-mini' },
  { type: 'dim', text: '[System prompt loaded]' },
  { type: 'gap', text: '' },
]

// Lines to stream in (the conversation)
const streamingLines = [
  { type: 'prompt', text: '> hi' },
  { type: 'dim', text: 'Hi — how can I help you today?' },
  { type: 'gap', text: '' },
  { type: 'prompt', text: '> create index.html with hello world' },
  { type: 'gap', text: '' },
  { type: 'dim', text: 'Tool: write_file({"file_path":"index.html","content":"<!doctype html>...', instant: true },
  { type: 'gap', text: '' },
  { type: 'ok', text: 'Successfully wrote 12 lines to index.html' },
  { type: 'gap', text: '' },
  { type: 'dim', text: 'Done — I created index.html with "hello world".' },
  { type: 'dim', text: 'Would you like any styling or additional content?' },
]

// Streaming animation state
const displayedLines = ref<{ type: string; text: string; visible: boolean }[]>([
  ...initialLines.map(line => ({ ...line, visible: true })),
  ...streamingLines.map(line => ({ ...line, visible: false }))
])
const currentLineIndex = ref(initialLines.length)
const currentCharIndex = ref(0)
const isStreaming = ref(true)

onMounted(() => {
  const streamNextChar = () => {
    const streamingStartIndex = initialLines.length
    if (currentLineIndex.value >= displayedLines.value.length) {
      isStreaming.value = false
      return
    }

    const targetLine = streamingLines[currentLineIndex.value - streamingStartIndex]
    const displayedLine = displayedLines.value[currentLineIndex.value]

    // Make line visible if not already
    if (!displayedLine.visible) {
      displayedLine.visible = true
    }

    // Instant lines (tool calls) appear all at once
    if ('instant' in targetLine && targetLine.instant) {
      displayedLine.text = targetLine.text
      currentLineIndex.value++
      currentCharIndex.value = 0
      setTimeout(streamNextChar, 300)
      return
    }

    // Stream characters
    if (currentCharIndex.value < targetLine.text.length) {
      displayedLine.text = targetLine.text.slice(0, currentCharIndex.value + 1)
      currentCharIndex.value++
      const delay = targetLine.type === 'gap' ? 50 : Math.random() * 30 + 20
      setTimeout(streamNextChar, delay)
    } else {
      // Move to next line
      currentLineIndex.value++
      currentCharIndex.value = 0
      const lineDelay = targetLine.type === 'gap' ? 100 : 400
      setTimeout(streamNextChar, lineDelay)
    }
  }

  // Start streaming after a brief delay
  setTimeout(streamNextChar, 600)
})
</script>

<template>
  <div class="pa-home">
    <section class="pa-marquee" aria-label="ProtoAgent highlights">
      <div class="pa-marquee-track">
        <span v-for="(item, index) in [...marqueeItems, ...marqueeItems]" :key="\`\${item.desktop}-\${index}\`" class="pa-marquee-item">
          <span>★</span>
          <span class="marquee-desktop">{{ item.desktop }}</span>
          <span class="marquee-mobile">{{ item.mobile }}</span>
        </span>
      </div>
    </section>

    <section class="pa-hero">
      <div class="pa-hero-copy">
        <div class="pa-hero-eyebrow">{{ hero.eyebrow }}</div>

        <pre class="pa-logo" aria-label="ProtoAgent wordmark">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</pre>

        <div class="pa-hero-sub">{{ hero.title }}</div>
        <p class="pa-hero-text">{{ hero.text }}</p>
        <p class="pa-hero-subtext">{{ hero.subtext }}</p>

        <div class="pa-actions">
          <a
            v-for="action in hero.actions"
            :key="action.text"
            :href="action.link"
            class="pa-btn"
            :class="action.theme === 'brand' ? 'is-brand' : 'is-ghost'"
          >
            {{ action.text }}
          </a>
        </div>

        <div class="pa-stats">
          <div v-for="stat in stats" :key="stat.label" class="pa-stat">
            <div class="pa-stat-label">{{ stat.label }}</div>
            <div class="pa-stat-value">{{ stat.value }}</div>
            <div class="pa-stat-bar"><span :style="{ width: stat.width }"></span></div>
          </div>
        </div>
      </div>

      <div class="pa-terminal">
        <div class="pa-terminal-head">
          <span>TRY IT OUT</span>
          <span>NPM INSTALL -G PROTOAGENT</span>
        </div>
        <div class="pa-terminal-body">
          <div class="pa-terminal-line is-shell">\$ npm i -g protoagent</div>
          <div class="pa-terminal-line is-shell">\$ protoagent</div>
          <div class="pa-terminal-line is-gap"></div>
          <div class="pa-terminal-line is-gap"></div>
          <pre class="pa-terminal-banner">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</pre>
          <div class="pa-terminal-line is-gap"></div>
          <div
            v-for="(line, index) in displayedLines"
            :key="index"
            class="pa-terminal-line"
            :class="[\`is-\${line.type}\`, { 'is-hidden': !line.visible, 'is-cursor': index === currentLineIndex && isStreaming }]"
          >
            {{ line.text }}<span v-if="index === currentLineIndex && isStreaming && line.type !== 'gap'" class="pa-cursor"></span>
          </div>
          <div class="pa-terminal-line is-gap"></div>
          <div class="pa-terminal-line is-input-line">
            <span class="pa-input-box" :class="{ 'is-active': !isStreaming }">
              {{ isStreaming ? '' : 'Type your message...' }}<span v-if="isStreaming" class="pa-cursor"></span>
            </span>
          </div>
        </div>
      </div>
    </section>

    <section class="pa-features">
      <div class="pa-section-bar">// SYSTEM CAPABILITIES -- MODULE INDEX</div>
      <div class="pa-feature-grid">
        <article v-for="(feature, index) in features" :key="feature.title" class="pa-feature-card">
          <div class="pa-feature-num">{{ String(index + 1).padStart(2, '0') }}</div>
          <h2 class="pa-feature-title">{{ feature.title }}</h2>
          <p class="pa-feature-text">{{ feature.details }}</p>
          <div v-if="feature.tag" class="pa-feature-tag">{{ feature.tag }}</div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pa-home {
  padding-bottom: 64px;
}

.pa-marquee {
  overflow: hidden;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: rgba(10, 24, 14, 0.9);
}

.pa-marquee-track {
  display: flex;
  width: max-content;
  animation: marquee 24s linear infinite;
}

.pa-marquee-item {
  flex: none;
  padding: 10px 22px;
  color: var(--text-dim);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: var(--text-xs);
}

.pa-marquee-item span {
  color: var(--green);
}

.pa-hero,
.pa-features {
  max-width: var(--content-width);
  margin: 0 auto;
  padding-left: clamp(18px, 3vw, 28px);
  padding-right: clamp(18px, 3vw, 28px);
}

.pa-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.08fr) minmax(280px, 0.92fr);
  gap: clamp(24px, 4vw, 42px);
  padding-top: clamp(32px, 5vw, 54px);
  padding-bottom: clamp(32px, 5vw, 54px);
  border-bottom: 2px solid var(--border-strong);
}

.pa-hero-eyebrow {
  margin-bottom: 16px;
  color: var(--text-dim);
  font-size: var(--text-sm);
  letter-spacing: 0.24em;
  text-transform: uppercase;
}

.pa-logo {
  margin: 0 0 20px;
  color: var(--green);
  font-family: monospace;
  font-size: clamp(0.76rem, 1.4vw, 1.05rem);
  line-height: 1;
  text-shadow: 0 0 10px var(--green-glow), 0 0 34px rgba(114, 255, 140, 0.12);
  max-width: 100%;
  overflow: hidden;
}

.pa-hero-sub {
  margin-bottom: 16px;
  padding-left: 14px;
  border-left: 3px solid var(--green);
  color: var(--green-bright);
  font-family: var(--display);
  font-size: clamp(1.5rem, 3.1vw, 2.5rem);
  letter-spacing: 0.08em;
  line-height: 0.96;
  text-transform: uppercase;
}

.pa-hero-text,
.pa-hero-subtext {
  max-width: 640px;
  font-family: var(--sans);
  font-size: clamp(var(--text-base), 1vw, 0.95rem);
  line-height: 1.75;
}

.pa-hero-text {
  color: var(--text);
  margin: 0 0 12px;
}

.pa-hero-subtext {
  color: var(--text-dim);
  margin: 0 0 28px;
}

.pa-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.pa-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 52px;
  padding: 14px 20px;
  text-decoration: none;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: var(--text-sm);
  transition: all 0.15s ease;
}

.pa-btn.is-brand {
  border: 2px solid var(--green);
  color: var(--bg);
  background: var(--green);
  box-shadow: 0 0 24px rgba(114, 255, 140, 0.18);
}

.pa-btn.is-brand:hover {
  background: var(--green-bright);
  border-color: var(--green-bright);
}

.pa-btn.is-ghost {
  border: 2px solid var(--border-strong);
  color: var(--green);
  background: transparent;
}

.pa-btn.is-ghost:hover {
  border-color: var(--green);
  box-shadow: 0 0 22px rgba(114, 255, 140, 0.1);
}

.pa-stats {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
  margin-top: 28px;
  padding-top: 24px;
  border-top: 1px solid var(--border);
}

.pa-stat-label {
  color: var(--text-dim);
  font-size: var(--text-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pa-stat-value {
  margin-top: 6px;
  color: var(--green-bright);
  font-family: var(--display);
  font-size: clamp(1.7rem, 2.7vw, 2.2rem);
  line-height: 1;
  letter-spacing: 0.05em;
  text-shadow: 0 0 10px var(--green-glow);
}

.pa-stat-bar {
  height: 4px;
  margin-top: 10px;
  background: rgba(114, 255, 140, 0.08);
}

.pa-stat-bar span {
  display: block;
  height: 100%;
  background: var(--green);
  box-shadow: 0 0 10px rgba(114, 255, 140, 0.3);
}

.pa-terminal {
  border: 2px solid var(--border-strong);
  background: linear-gradient(180deg, rgba(6, 14, 8, 0.97), rgba(3, 8, 5, 0.98));
  box-shadow: 0 0 32px rgba(114, 255, 140, 0.08), inset 0 0 44px rgba(114, 255, 140, 0.03);
}

.pa-terminal-head {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  padding: 10px 16px;
  background: var(--green);
  color: var(--bg);
  font-size: var(--text-sm);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.pa-terminal-body {
  min-height: 100%;
  padding: clamp(16px, 2vw, 20px);
  font-size: clamp(0.65rem, 0.85vw, 0.76rem);
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.pa-terminal-banner {
  margin: 0 0 8px;
  color: var(--green);
  font-family: monospace;
  font-size: clamp(0.55rem, 0.75vw, 0.68rem);
  line-height: 1.1;
  text-shadow: 0 0 8px var(--green-glow), 0 0 20px rgba(114, 255, 140, 0.1);
  overflow: hidden;
}

.pa-terminal-line.is-prompt {
  color: var(--green);
}

.pa-terminal-line.is-dim {
  color: var(--text-dim);
}

.pa-terminal-line.is-shell {
  color: var(--text);
}

.pa-terminal-line.is-ok {
  color: var(--green-bright);
}

.pa-terminal-line.is-gap {
  min-height: 12px;
}

.pa-terminal-line.is-hidden {
  opacity: 0;
}

.pa-terminal-line.is-input-line {
  color: var(--text-dim);
}

.pa-input-box {
  display: inline-block;
  border: 1px solid var(--border-strong);
  background: rgba(0, 0, 0, 0.3);
  padding: 6px 14px;
  width: 100%;
  border-radius: 2px;
}

.pa-cursor {
  display: inline-block;
  width: 8px;
  height: 14px;
  margin-left: 2px;
  vertical-align: middle;
  background: var(--green);
  box-shadow: 0 0 10px var(--green-glow);
  animation: terminalBlink 0.9s step-end infinite;
}

/* Marquee text swap for mobile */
.marquee-mobile {
  display: none;
}

@media (max-width: 640px) {
  .marquee-desktop {
    display: none;
  }
  
  .marquee-mobile {
    display: inline;
  }
}

@keyframes terminalBlink {
  0%, 46%, 100% { opacity: 1; }
  47%, 99% { opacity: 0; }
}

.pa-features {
  padding-top: 0;
}

.pa-section-bar {
  margin: 0 0 24px;
  padding: 8px 14px;
  background: var(--green);
  color: var(--bg);
  font-family: var(--display);
  font-size: clamp(0.8rem, 1.8vw, 1.05rem);
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.pa-feature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border: 1px solid var(--border-strong);
}

.pa-feature-card {
  min-height: 100%;
  padding: 18px 16px;
  border-right: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
  background: rgba(7, 17, 10, 0.88);
  transition: background 0.15s ease;
}

.pa-feature-card:nth-child(3n) {
  border-right: 0;
}

.pa-feature-card:nth-last-child(-n + 3) {
  border-bottom: 0;
}

.pa-feature-card:hover {
  background: rgba(12, 27, 16, 0.95);
}

.pa-feature-num {
  display: inline-block;
  margin-bottom: 8px;
  padding: 1px 7px;
  border: 1px solid var(--text-faint);
  color: var(--text-faint);
  font-family: var(--display);
  font-size: clamp(1.05rem, 1.8vw, 1.3rem);
  line-height: 1;
}

.pa-feature-title {
  margin: 0 0 6px;
  color: var(--green-bright);
  font-family: var(--display);
  font-size: clamp(0.95rem, 1.6vw, 1.2rem);
  letter-spacing: 0.08em;
  line-height: 0.92;
  text-transform: uppercase;
}

.pa-feature-text {
  margin: 0;
  color: var(--text);
  font-family: var(--sans);
  font-size: var(--text-sm);
  line-height: 1.7;
}

.pa-feature-tag {
  margin-top: 10px;
  color: var(--green);
  font-size: var(--text-xs);
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.pa-feature-tag::before {
  content: '> ';
}

@keyframes marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

@media (max-width: 1180px) {
  .pa-hero {
    grid-template-columns: 1fr;
  }

  .pa-feature-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .pa-feature-card:nth-child(3n) {
    border-right: 1px solid var(--border);
  }

  .pa-feature-card:nth-child(2n) {
    border-right: 0;
  }

  .pa-feature-card:nth-last-child(-n + 3) {
    border-bottom: 1px solid var(--border);
  }

  .pa-feature-card:nth-last-child(-n + 2) {
    border-bottom: 0;
  }
}

@media (max-width: 960px) {
  .pa-hero {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .pa-hero-copy {
    display: contents;
  }

  .pa-hero-eyebrow {
    order: 1;
  }

  .pa-logo {
    order: 2;
  }

  .pa-hero-sub {
    order: 3;
    margin-bottom: 24px;
  }

  .pa-terminal {
    order: 4;
    margin-bottom: 24px;
  }

  .pa-hero-text {
    order: 5;
  }

  .pa-hero-subtext {
    order: 6;
  }

  .pa-actions {
    order: 7;
  }

  .pa-stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    order: 8;
  }

  .pa-feature-grid {
    grid-template-columns: 1fr;
  }

  .pa-feature-card,
  .pa-feature-card:nth-child(3n) {
    border-right: 0;
  }

  .pa-feature-card:nth-last-child(-n + 3) {
    border-bottom: 1px solid var(--border);
  }

  .pa-feature-card:last-child {
    border-bottom: 0;
  }
}

@media (max-width: 640px) {
  .pa-hero {
    padding-top: 30px;
    gap: 0;
  }

  .pa-actions,
  .pa-stats {
    flex-direction: column;
  }

  .pa-btn {
    width: 100%;
  }

  .pa-stats {
    display: grid;
    grid-template-columns: 1fr;
  }

  .pa-terminal-head {
    padding: 10px 12px;
    font-size: 0.58rem;
    letter-spacing: 0.12em;
  }

  .pa-terminal-body {
    padding: 14px;
    font-size: var(--text-sm);
  }
}
</style>
`,
  },
  {
    path: "docs/.vitepress/theme/components/NavBar.vue",
    content: `<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vitepress'

const router = useRouter()

const navLinks = [
  { text: 'TRY IT OUT', link: '/try-it-out/getting-started', match: '/try-it-out/' },
  { text: 'BUILD YOUR OWN', link: '/build-your-own/', match: '/build-your-own/' },
  { text: 'REFERENCE', link: '/reference/spec', match: '/reference/' },
]

const mobileMenuBreakpoint = 680
const mobileMenuOpen = ref(false)

function handleResize() {
  if (window.innerWidth > mobileMenuBreakpoint) {
    mobileMenuOpen.value = false
  }
}

onMounted(() => {
  handleResize()
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

const currentPath = computed(() => router.route.path)

const isActive = (match: string) => currentPath.value.startsWith(match)

watch(currentPath, () => {
  mobileMenuOpen.value = false
})
</script>

<template>
  <header class="pa-nav">
    <div class="pa-nav-main">
      <a class="pa-nav-brand" href="/" aria-label="ProtoAgent home">
        <pre class="pa-nav-logo">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</pre>
        <span class="pa-nav-sub">// BUILD-YOUR-OWN CODING AGENT //</span>
      </a>

      <button
        class="pa-nav-toggle"
        type="button"
        :aria-expanded="mobileMenuOpen"
        aria-controls="pa-mobile-nav"
        @click="mobileMenuOpen = !mobileMenuOpen"
      >
        {{ mobileMenuOpen ? '[CLOSE]' : '[MENU]' }}
      </button>

      <nav class="pa-nav-links" aria-label="Primary">
        <a
          v-for="link in navLinks"
          :key="link.text"
          :href="link.link"
          :class="{ active: isActive(link.match) }"

        >
          {{ link.text }}
        </a>
      </nav>

    </div>

    <div v-if="mobileMenuOpen" id="pa-mobile-nav" class="pa-nav-mobile">
      <div class="pa-nav-mobile-inner">
        <nav class="pa-nav-mobile-links" aria-label="Mobile primary">
          <a
            v-for="link in navLinks"
            :key="\`mobile-\${link.text}\`"
            :href="link.link"
            :class="{ active: isActive(link.match) }"
  
          >
            {{ link.text }}
          </a>
        </nav>
      </div>
    </div>
  </header>
</template>

<style scoped>
.pa-nav {
  position: sticky;
  top: 0;
  z-index: 100;
  border-bottom: 1px solid var(--border-strong);
  background: rgba(4, 9, 6, 0.94);
  backdrop-filter: blur(10px);
  box-shadow: 0 4px 28px rgba(114, 255, 140, 0.08);
}

.pa-nav-main {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 12px 28px 14px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px 28px;
  align-items: center;
}

.pa-nav-brand {
  min-width: 0;
  text-decoration: none;
  padding-top: 8px;
}

.pa-nav-toggle {
  display: none;
  align-items: center;
  justify-content: center;
  min-height: 42px;
  padding: 10px 14px;
  border: 1px solid var(--border-strong);
  background: rgba(114, 255, 140, 0.06);
  color: var(--green);
  font-family: var(--mono);
  font-size: var(--text-sm);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
}

.pa-nav-toggle:hover {
  background: rgba(114, 255, 140, 0.12);
}

.pa-nav-logo {
  margin: 0;
  color: var(--green);
  font-family: monospace;
  font-size: var(--text-xs);
  line-height: 1;
  letter-spacing: 0;
  text-shadow: 0 0 10px var(--green-glow), 0 0 22px rgba(114, 255, 140, 0.2);
  max-width: 100%;
  overflow: hidden;
}

.pa-nav-sub {
  display: block;
  margin-top: 2px;
  color: var(--text-dim);
  font-size: var(--text-xs);
  letter-spacing: 0.22em;
  text-transform: uppercase;
}

.pa-nav-links {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  justify-self: end;
  border: 1px solid var(--border);
}

.pa-nav-links a {
  padding: 8px 12px;
  border-right: 1px solid var(--border);
  color: var(--text-dim);
  text-decoration: none;
  font-size: var(--text-sm);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  transition: all 0.15s ease;
}

.pa-nav-links a:last-child {
  border-right: 0;
}

.pa-nav-links a:hover,
.pa-nav-links a.active {
  background: var(--green);
  color: var(--bg);
  text-shadow: none;
  box-shadow: 0 0 18px rgba(114, 255, 140, 0.24);
}

.pa-nav-mobile {
  display: none;
}

@media (max-width: 680px) {
  .pa-nav-main {
    grid-template-columns: auto minmax(0, 1fr);
    justify-items: start;
  }

  .pa-nav-brand {
    grid-column: 1 / -1;
  }

  .pa-nav-links {
    justify-self: stretch;
  }

  .pa-nav-main {
    padding-left: 24px;
    padding-right: 24px;
  }

  .pa-nav-logo {
    font-size: calc(var(--text-xs) - 0.12rem);
  }

  .pa-nav-main {
    gap: 14px;
    padding-top: 10px;
    padding-bottom: 12px;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    justify-items: unset;
  }

  .pa-nav-brand {
    grid-column: auto;
  }

  .pa-nav-toggle {
    display: inline-flex;
  }

  .pa-nav-links {
    display: none;
  }

  .pa-nav-mobile {
    display: block;
    border-top: 1px solid var(--border);
  }

  .pa-nav-mobile-inner {
    max-width: var(--content-width);
    margin: 0 auto;
    padding: 12px 24px 24px;
  }

  .pa-nav-mobile-links {
    display: grid;
    border: 1px solid var(--border);
  }

  .pa-nav-mobile-links a {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--text-dim);
    text-decoration: none;
    font-size: var(--text-sm);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .pa-nav-mobile-links a:last-child {
    border-bottom: 0;
  }

  .pa-nav-mobile-links a.active {
    background: var(--green);
    color: var(--bg);
  }
}

</style>
`,
  },
  {
    path: "docs/.vitepress/theme/components/Sidebar.vue",
    content: `<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useData, useRouter } from 'vitepress'

const { site, page } = useData()
const router = useRouter()
const mobileMenuOpen = ref(false)

const pageTitle = computed(() => page.value.title)

const activeSidebar = computed(() => {
  const sidebarInfo = (site.value.themeConfig as any).sidebar || {}
  const path = router.route.path

  for (const [prefix, items] of Object.entries(sidebarInfo)) {
    if (path.startsWith(prefix)) return items as any[]
  }

  return []
})

const flatItems = computed(() => {
  const result: Array<{ text: string; link?: string; level: 0 | 1 }> = []

  activeSidebar.value.forEach((item: any) => {
    if (item.items?.length) {
      result.push({ text: item.text, level: 0 })
      item.items.forEach((child: any) => {
        result.push({ text: child.text, link: child.link, level: 1 })
      })
    }
  })

  return result
})

const currentPath = computed(() => router.route.path)

const activeSectionTitle = computed(() => activeSidebar.value[0]?.text || 'Pages')

const isActive = (link?: string) => {
  if (!link) return false
  const normalize = (p: string) => p.replace(/\\.html\$/, '').replace(/\\/\$/, '')
  return normalize(currentPath.value) === normalize(link)
}

watch(currentPath, () => {
  mobileMenuOpen.value = false
})
</script>

<template>
  <aside class="pa-sidebar">
    <button
      class="pa-sidebar-mobile-toggle"
      type="button"
      :aria-expanded="mobileMenuOpen"
      aria-controls="pa-sidebar-mobile-nav"
      @click="mobileMenuOpen = !mobileMenuOpen"
    >
      <span class="pa-breadcrumb" v-if="pageTitle">// {{ activeSectionTitle.toUpperCase() }} <span class="pa-dim">&gt;</span> {{ pageTitle.toUpperCase() }}</span>
      <span class="pa-breadcrumb" v-else>// {{ activeSectionTitle.toUpperCase() }}</span>
      <span>{{ mobileMenuOpen ? '[CLOSE]' : '[PAGES]' }}</span>
    </button>

    <div class="pa-sidebar-inner">
      <template v-for="item in flatItems" :key="\`\${item.level}-\${item.text}\`">
        <div v-if="item.level === 0" class="pa-sidebar-group">{{ item.text }}</div>
        <a
          v-else
          :href="item.link"
          class="pa-sidebar-link"
          :class="{ active: isActive(item.link) }"

        >
          {{ item.text }}
        </a>
      </template>
    </div>

    <div v-if="mobileMenuOpen" id="pa-sidebar-mobile-nav" class="pa-sidebar-mobile-panel">
      <template v-for="item in flatItems" :key="\`mobile-\${item.level}-\${item.text}\`">
        <div v-if="item.level === 0" class="pa-sidebar-mobile-group">{{ item.text }}</div>
        <a
          v-else
          :href="item.link"
          class="pa-sidebar-mobile-link"
          :class="{ active: isActive(item.link) }"

        >
          {{ item.text }}
        </a>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.pa-sidebar {
  position: sticky;
  top: calc(var(--nav-height) - 1px);
  flex-shrink: 0;
  width: var(--sidebar-width);
  height: calc(100vh - var(--nav-height) + 1px);
  border-right: 1px solid var(--border-strong);
  background: transparent;
  box-shadow: inset -1px 0 0 rgba(114, 255, 140, 0.04);
  overflow-y: auto;
}

.pa-sidebar-mobile-toggle,
.pa-sidebar-mobile-panel {
  display: none;
}

.pa-sidebar-inner {
  padding: 8px 0 24px;
}

.pa-sidebar-title,
.pa-sidebar-group {
  padding: 8px 20px;
  color: var(--text-dim);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.pa-sidebar-title {
  font-family: var(--display);
  font-size: var(--text-xl);
  color: var(--green);
  text-shadow: 0 0 10px var(--green-glow);
}

.pa-sidebar-group {
  margin-top: 4px;
  font-size: 0.78rem;
}

.pa-sidebar-link {
  display: block;
  padding: 9px 20px 9px 24px;
  border-left: 2px solid transparent;
  color: var(--text);
  text-decoration: none;
  font-family: var(--sans);
  font-size: var(--text-base);
  line-height: 1.4;
  transition: all 0.15s ease;
}

.pa-sidebar-link:hover {
  background: rgba(114, 255, 140, 0.06);
  color: var(--green-bright);
}

.pa-sidebar-link.active {
  border-left-color: var(--green);
  background: rgba(114, 255, 140, 0.08);
  color: var(--green);
  text-shadow: 0 0 8px rgba(114, 255, 140, 0.18);
}

@media (max-width: 1100px) {
  .pa-sidebar {
    position: static;
    top: auto;
    width: 100%;
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border-strong);
    background: transparent;
    box-shadow: none;
    overflow: visible;
  }

  .pa-sidebar-inner {
    display: none;
  }

  .pa-sidebar-mobile-toggle {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    border: 0;
    background: transparent;
    color: var(--green);
    font-family: var(--mono);
    font-size: var(--text-sm);
    letter-spacing: 0.16em;
    text-transform: uppercase;
    cursor: pointer;
  }

  .pa-sidebar-mobile-panel {
    display: grid;
    padding: 0 20px 18px;
    border-top: 1px solid var(--border);
  }

  .pa-sidebar-mobile-group {
    padding: 14px 0 8px;
    color: var(--text-dim);
    font-size: var(--text-xs);
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  .pa-sidebar-mobile-link {
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-top: 0;
    color: var(--text);
    text-decoration: none;
    font-size: var(--text-sm);
    line-height: 1.35;
    background: rgba(114, 255, 140, 0.03);
  }

  .pa-sidebar-mobile-group + .pa-sidebar-mobile-link {
    border-top: 1px solid var(--border);
  }

  .pa-sidebar-mobile-link.active {
    background: rgba(114, 255, 140, 0.12);
    color: var(--green);
  }

  .pa-breadcrumb {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-align: left;
  }
  
  .pa-dim {
    color: var(--text-dim);
  }
}
</style>
`,
  },
  {
    path: "docs/.vitepress/theme/custom.css",
    content: `@import url('https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&family=Inter:wght@400;500;600&display=swap');

:root {
  --green: #72ff8c;
  --green-bright: #b7ff6a;
  --green-dim: #2c8a49;
  --green-deep: #12311d;
  --green-glow: rgba(114, 255, 140, 0.45);
  --green-glow-soft: rgba(114, 255, 140, 0.14);
  --bg: #030805;
  --bg-soft: #07100a;
  --surface: rgba(8, 19, 12, 0.92);
  --surface-strong: rgba(11, 26, 16, 0.96);
  --border: rgba(114, 255, 140, 0.22);
  --border-strong: rgba(114, 255, 140, 0.48);
  --text: #baf8c7;
  --text-dim: #5ba36c;
  --text-faint: #356043;
  --danger: #ff7a7a;
  --warning: #ffe37a;
  --sans: 'Inter', system-ui, sans-serif;
  --mono: 'Share Tech Mono', monospace;
  --display: 'VT323', monospace;
  --sidebar-width: clamp(210px, 20vw, 240px);
  --nav-height: 98px;
  --content-width: 1120px;
  
  --text-xs: 0.6rem;
  --text-sm: 0.72rem;
  --text-base: 0.84rem;
  --text-lg: 1.05rem;
  --text-xl: 1.3rem;
}

* {
  box-sizing: border-box;
}

html {
  color-scheme: dark !important;
  scroll-behavior: smooth;
}

body {
  margin: 0;
  background:
    radial-gradient(circle at top center, rgba(114, 255, 140, 0.1), transparent 36%),
    linear-gradient(180deg, #06110a 0%, var(--bg) 40%, #020502 100%);
  color: var(--text);
  font-family: var(--mono);
  overflow-x: hidden;
  text-shadow: 0 0 10px rgba(114, 255, 140, 0.03);
}

body::before {
  content: '';
  position: fixed;
  inset: 0;
  background: repeating-linear-gradient(
    0deg,
    rgba(0, 0, 0, 0.24) 0,
    rgba(0, 0, 0, 0.24) 1px,
    transparent 1px,
    transparent 3px
  );
  pointer-events: none;
  z-index: 9998;
}

body::after {
  content: '';
  position: fixed;
  inset: 0;
  background: radial-gradient(ellipse at center, transparent 52%, rgba(0, 0, 0, 0.74) 100%);
  pointer-events: none;
  z-index: 9997;
}

a {
  color: inherit;
}

#app,
.Layout {
  position: relative;
  z-index: 1;
}

.vp-doc,
.VPDoc,
.VPContent,
.VPFooter {
  font-family: var(--sans);
}

.vp-doc a,
.VPDoc a {
  color: var(--green) !important;
  text-decoration: underline;
  text-decoration-color: rgba(114, 255, 140, 0.45);
  text-underline-offset: 3px;
}

.vp-doc a:hover,
.VPDoc a:hover {
  color: var(--green-bright) !important;
}

.vp-doc h1,
.VPDoc h1 {
  font-family: var(--display);
  color: var(--green-bright);
  font-size: clamp(1.85rem, 3.8vw, 2.9rem);
  line-height: 0.95;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-shadow: 0 0 12px var(--green-glow);
}

.vp-doc h2,
.VPDoc h2 {
  border-top: 1px solid var(--border);
  padding-top: 1.2rem;
  margin-top: 2.2rem;
  font-family: var(--display);
  font-size: 1.5rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--green);
}

.vp-doc h3,
.vp-doc h4,
.VPDoc h3,
.VPDoc h4 {
  color: var(--green-bright);
  font-family: var(--sans);
  font-size: 1.2rem;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.vp-doc p,
.vp-doc li,
.VPDoc p,
.VPDoc li {
  color: #c9eacb;
  line-height: 1.7;
  font-family: var(--sans);
  font-size: 0.88rem;
  letter-spacing: 0.01em;
}

.vp-doc strong,
.VPDoc strong {
  color: var(--green-bright);
}

.vp-doc :not(pre) > code,
.VPDoc :not(pre) > code {
  color: var(--green-bright) !important;
  background: rgba(114, 255, 140, 0.08) !important;
  border: 1px solid var(--border) !important;
  border-radius: 0 !important;
  padding: 2px 6px !important;
  font-family: var(--mono) !important;
}

.vp-doc div[class*='language-'],
.VPDoc div[class*='language-'] {
  background: linear-gradient(180deg, rgba(8, 18, 11, 0.98), rgba(5, 11, 7, 0.98)) !important;
  border: 1px solid var(--border-strong) !important;
  border-radius: 0 !important;
  box-shadow: 0 0 28px rgba(114, 255, 140, 0.08), inset -24px 0 24px -20px rgba(114, 255, 140, 0.15), inset 0 0 36px rgba(114, 255, 140, 0.04) !important;
}

.vp-doc div[class*='language-']::before,
.VPDoc div[class*='language-']::before {
  color: var(--text-dim) !important;
  font-family: var(--mono) !important;
}

.vp-doc .shiki,
.VPDoc .shiki {
  background: transparent !important;
}

.vp-doc .shiki .line,
.VPDoc .shiki .line {
  color: var(--text) !important;
}

.vp-doc .shiki .k,
.vp-doc .shiki .kw,
.vp-doc .shiki .nb,
.VPDoc .shiki .k,
.VPDoc .shiki .kw,
.VPDoc .shiki .nb {
  color: var(--green) !important;
}

.vp-doc .shiki .s,
.vp-doc .shiki .sr,
.VPDoc .shiki .s,
.VPDoc .shiki .sr {
  color: var(--green-bright) !important;
}

.vp-doc .shiki .c,
.vp-doc .shiki .cm,
.VPDoc .shiki .c,
.VPDoc .shiki .cm {
  color: var(--text-faint) !important;
}

.vp-doc table,
.VPDoc table {
  width: 100%;
  border-collapse: collapse;
  border: 1px solid var(--border-strong);
  background: rgba(6, 15, 9, 0.86);
  display: block;
  overflow-x: auto;
}

.vp-doc th,
.vp-doc td,
.VPDoc th,
.VPDoc td {
  border: 1px solid var(--border);
  padding: 12px 14px;
}

.vp-doc td,
.VPDoc td {
  white-space: nowrap;
}

.vp-doc th,
.VPDoc th {
  color: var(--green-bright);
  font-family: var(--display);
  font-size: 1.15rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  background: rgba(114, 255, 140, 0.08);
}

.vp-doc tr:hover td,
.VPDoc tr:hover td {
  background: rgba(114, 255, 140, 0.05);
}

.vp-doc blockquote,
.VPDoc blockquote {
  border-left: 3px solid var(--green);
  background: rgba(114, 255, 140, 0.06);
  padding: 12px 16px;
  color: var(--text);
}

.vp-doc .custom-block,
.VPDoc .custom-block {
  border: 1px solid var(--border-strong);
  border-left-width: 4px;
  border-radius: 0;
  background: rgba(9, 21, 12, 0.9);
}

.vp-doc .custom-block.tip,
.VPDoc .custom-block.tip {
  border-left-color: var(--green);
}

.vp-doc .custom-block.warning,
.VPDoc .custom-block.warning {
  border-left-color: var(--warning);
}

.vp-doc .custom-block.danger,
.VPDoc .custom-block.danger {
  border-left-color: var(--danger);
}

.VPContent,
.VPDoc {
  background: transparent !important;
}

/* Reset built-in layout spacing since we use our custom grid wrapper */
.VPContent,
.VPContent.has-sidebar {
  padding: 0 !important;
  margin: 0 !important;
}

.VPDoc .container {
  max-width: 100% !important;
}

.VPDoc.has-aside .content-container,
.VPDoc .content-container,
.VPContent .content-container {
  max-width: var(--content-width) !important;
}

.VPDoc .content,
.VPContent .content {
  padding: 20px 28px 64px !important;
}

.VPDocOutlineDropdown,
.VPLocalNav,
.VPNav,
.VPSidebar {
  display: none !important;
}

.VPDocAside {
  padding-top: 0 !important;
  margin-top: -16px;
}

.VPDocAsideOutline {
  border-left: 1px solid var(--border) !important;
}

.VPDocAsideOutline .outline-title {
  color: var(--text-dim) !important;
  font-family: var(--mono) !important;
  font-size: 0.78rem !important;
  letter-spacing: 0.16em !important;
  text-transform: uppercase !important;
  margin-top: 0 !important;
}

.VPDocAsideOutline .outline-link {
  color: var(--text-dim) !important;
  font-family: var(--sans) !important;
}

.VPDocAsideOutline .outline-link:hover,
.VPDocAsideOutline .outline-link.active {
  color: var(--green) !important;
}

.VPDocAsideOutline .outline-marker {
  background: var(--green) !important;
}

.pager-link {
  border: 1px solid var(--border-strong) !important;
  background: rgba(114, 255, 140, 0.05) !important;
  border-radius: 0 !important;
}

.pager-link:hover {
  background: rgba(114, 255, 140, 0.1) !important;
  box-shadow: 0 0 22px rgba(114, 255, 140, 0.1);
}

.pager-link .title {
  color: var(--green) !important;
}

.pager-link .desc {
  color: var(--text-dim) !important;
}

.VPFooter {
  border-top: 1px solid var(--border-strong) !important;
  background: rgba(4, 8, 5, 0.95) !important;
}

.VPFooter .container {
  padding-top: 22px !important;
  padding-bottom: 22px !important;
}

.VPFooter .message,
.VPFooter .copyright {
  color: var(--text-dim) !important;
  font-family: var(--mono) !important;
}

/* Remove scrollbars from logo elements */
.pa-nav-logo,
.pa-logo {
  overflow: hidden !important;
}

::-webkit-scrollbar {
   width: 8px;
   height: 8px;
 }
 
 ::-webkit-scrollbar-track {
   background: var(--bg);
 }
 
 ::-webkit-scrollbar-thumb {
   background: rgba(114, 255, 140, 0.25);
   border: 1px solid rgba(114, 255, 140, 0.15);
 }
 
 ::-webkit-scrollbar-thumb:hover {
   background: rgba(114, 255, 140, 0.45);
 }

::selection {
  background: rgba(114, 255, 140, 0.18);
  color: #fff;
}

@keyframes terminalBlink {
  0%, 46%, 100% { opacity: 1; }
  47%, 99% { opacity: 0; }
}

@media (max-width: 1100px) {
  :root {
    --nav-height: 116px;
  }

  .VPDoc .content,
  .VPContent .content {
    padding: 18px 24px 56px !important;
  }

  .VPDocAside {
    display: none !important;
  }
}

@media (max-width: 960px) {
  :root {
    --nav-height: 102px;
  }

  .VPDoc .content,
  .VPContent .content {
    padding-top: 16px !important;
  }
}

@media (max-width: 640px) {
  :root {
    --nav-height: 96px;
  }

  .vp-doc h1,
  .VPDoc h1 {
    font-size: 1.7rem;
  }

  .vp-doc h2,
  .VPDoc h2 {
    font-size: 1.3rem;
  }

  .VPDoc .content,
  .VPContent .content {
    padding: 16px 24px 48px !important;
  }
}
`,
  },
  {
    path: "docs/.vitepress/theme/env.d.ts",
    content: `declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}
`,
  },
  {
    path: "docs/.vitepress/theme/index.ts",
    content: `import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import Layout from './Layout.vue'
import './custom.css'

if (typeof window !== 'undefined') {
  // Force dark mode
  document.documentElement.classList.remove('light')
  document.documentElement.classList.add('dark')
}

export default {
  extends: DefaultTheme,
  Layout,
} satisfies Theme
`,
  },
  {
    path: "docs/build-your-own/index.md",
    content: `# Build Your Own Coding Agent

ProtoAgent was built to understand how coding agents actually work, not just use them.

If you've used tools like Claude Code, Cursor, or Copilot, you have probably had that same moment: it reads files, runs commands, edits code, and somehow keeps the whole loop together. It feels a bit magical.

This tutorial is about removing that magic.

Every chapter includes complete, copy-pasteable code for every file at every stage. You can rebuild the entire project from scratch by following the parts in order.

## How to use this tutorial

Each part has two jobs:

- explain why that layer exists
- give you the exact code to build it

Every chapter is cumulative. Start at Part 1 and move forward in order.

For each stage, you should end up with a folder that matches one of these snapshots, available in the GitHub repository:

- \`protoagent-build-your-own-checkpoints/part-1\`
- \`protoagent-build-your-own-checkpoints/part-2\`
- \`protoagent-build-your-own-checkpoints/part-3\`
- \`protoagent-build-your-own-checkpoints/part-4\`
- \`protoagent-build-your-own-checkpoints/part-5\`
- \`protoagent-build-your-own-checkpoints/part-6\`
- \`protoagent-build-your-own-checkpoints/part-7\`
- \`protoagent-build-your-own-checkpoints/part-8\`
- \`protoagent-build-your-own-checkpoints/part-9\`
- \`protoagent-build-your-own-checkpoints/part-10\`
- \`protoagent-build-your-own-checkpoints/part-11\`
- \`protoagent-build-your-own-checkpoints/part-12\`
- \`protoagent-build-your-own-checkpoints/part-13\`

The snapshots are the verification path. If a part says you should match \`protoagent-build-your-own-checkpoints/part-6\`, that folder represents the completed result of following Parts 1 through 6 in order.

## Before you start

You'll want:

- Node.js 22+
- npm
- an API key for one of the supported providers (OpenAI, Anthropic, or Google)
- basic TypeScript knowledge
- a terminal you are comfortable working in

## The parts

### Foundation

1. **[Scaffolding](/build-your-own/part-1)** — Commander, Ink, and the basic CLI shell
2. **[AI Integration](/build-your-own/part-2)** — OpenAI SDK streaming and message flow
3. **[Configuration Management](/build-your-own/part-3)** — provider/model selection, persisted config, and API key resolution

### Core runtime

4. **[The Agentic Loop](/build-your-own/part-4)** — the tool-use loop, streaming events, retries, and termination
5. **[Core Tools: Files, TODOs, and Web Fetching](/build-your-own/part-5)** — path validation, approval system, file tools, TODO tracking, and web fetching
6. **[Shell Commands & Approvals](/build-your-own/part-6)** — \`bash\` tool with three-tier security (hard-blocked, auto-approved, requires approval)
7. **[System Prompt & Runtime Policy](/build-your-own/part-7)** — dynamic system prompt with directory tree and tool descriptions
8. **[Compaction & Cost Tracking](/build-your-own/part-8)** — token estimation, cost display, logger, and long-context compaction

### Persistence and reuse

9. **[Skills & AGENTS.md](/build-your-own/part-9)** — \`SKILL.md\` and \`AGENTS.md\` discovery, validation, activation, and catalog generation
10. **[Sessions](/build-your-own/part-10)** — persisted conversations, TODO restore, and resume flows

### Extensibility

11. **[MCP Integration](/build-your-own/part-11)** — runtime config, MCP client for stdio and HTTP servers, dynamic tool registration
12. **[Sub-agents](/build-your-own/part-12)** — isolated child agent execution for context-heavy tasks

### UI and operations

13. **[Polish, Rendering & Logging](/build-your-own/part-13)** — components, formatted output, grouped tool rendering, slash commands, fuzzy edit matching, and the final App

## Philosophy

ProtoAgent is intentionally small. It has persisted sessions, TODO state, web fetching, skills, MCP, sub-agents, compaction, and a rich terminal UI.

That is exactly why this tutorial exists. Once you understand the core loop and the runtime boundaries, the rest of the codebase stops feeling mysterious.

By the end, the tutorial should not just make the codebase feel understandable. It should make it reproducible.
`,
  },
  {
    path: "docs/build-your-own/part-1.md",
    content: `# Part 1: Scaffolding

By the end of this part you will have a working terminal app: a Commander-based CLI that launches an Ink TUI with a message area and a text input. No AI yet — just the interactive shell that every later feature will grow inside.

## What you are building

- A TypeScript CLI package (\`package.json\` with ESM, build scripts)
- A compiled \`dist/cli.js\` entrypoint
- A Commander-based command parser
- An Ink React app with a title, message list, and input box

## Files to create

| File | Purpose |
|------|---------|
| \`package.json\` | Node package, scripts, dependencies |
| \`tsconfig.json\` | TypeScript compiler config |
| \`src/cli.tsx\` | CLI entrypoint — parses args, renders the Ink app |
| \`src/App.tsx\` | Main UI component — message list + input |

## Step 1: \`package.json\`

Create the file:

\`\`\`bash
touch package.json
\`\`\`

\`\`\`json
{
  "name": "protoagent",
  "version": "0.0.1",
  "description": "A simple coding agent CLI.",
  "bin": "dist/cli.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "build:watch": "tsc --watch"
  },
  "files": [
    "dist"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "commander": "^14.0.1",
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
    "react": "^19.1.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2"
  }
}
\`\`\`

Key points:
- \`"type": "module"\` enables ESM imports throughout the project
- \`"bin": "dist/cli.js"\` makes the compiled CLI the executable entrypoint
- \`tsx\` runs TypeScript directly for development (\`npm run dev\`)
- \`tsc\` compiles to \`dist/\` for production (\`npm run build\`)

## Step 2: \`tsconfig.json\`

Create the file:

\`\`\`bash
touch tsconfig.json
\`\`\`

\`\`\`json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
\`\`\`

The \`"jsx": "react-jsx"\` setting tells TypeScript to transform JSX without requiring explicit React imports. This is the modern approach supported in React 17+.

## Step 3: \`src/cli.tsx\`

Create the file:

\`\`\`bash
mkdir -p src && touch src/cli.tsx
\`\`\`

This file does three things: reads the package version, creates the Commander program, and renders the Ink app.

\`\`\`tsx
#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';

// Read version from package.json relative to the compiled file location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .parse(process.argv);

const options = program.opts();

render(<App options={options} />);
\`\`\`

Note the import path: \`./App.js\`, not \`./App.tsx\`. When TypeScript compiles, \`.tsx\` files become \`.js\` files in \`dist/\`, so all imports must reference the compiled extension.

## Step 4: \`src/App.tsx\`

Create the file:

\`\`\`bash
touch src/App.tsx
\`\`\`

The first version of \`App\` is just a terminal chat shell — no AI, no tools. It keeps an array of messages and an input box. When you submit text, it appears in the message area.

\`\`\`tsx
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';

export interface AppProps {
  options?: Record<string, any>;
}

export const App: React.FC<AppProps> = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, trimmed]);
    setInputText('');
    setInputKey((prev) => prev + 1);
  };

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      <Text dimColor italic>A simple, hackable coding agent CLI.</Text>
      <Text> </Text>

      {/* Message area */}
      <Box flexDirection="column" flexGrow={1}>
        {messages.map((msg, i) => (
          <Text key={i}>
            <Text color="green" bold>{'> '}</Text>
            <Text>{msg}</Text>
          </Text>
        ))}
      </Box>

      {/* Input */}
      <Box borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>{'> '}</Text>
        <TextInput
          key={inputKey}
          defaultValue={inputText}
          onChange={setInputText}
          placeholder="Type your message..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
\`\`\`

The \`inputKey\` trick forces the \`TextInput\` to remount and clear its internal state after each submit. Without it, the input field would keep the old text.

## Verification

Install dependencies and build:

\`\`\`bash
npm install
npm run build
node dist/cli.js --help
\`\`\`

Then launch the dev version:

\`\`\`bash
npm run dev
\`\`\`

You should see:
- The **ProtoAgent** title rendered in large text
- A text input at the bottom
- Submitted messages appear in the message area
- \`Ctrl-C\` exits the app

\`\`\`
 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


A simple, hackable coding agent CLI.

> hi
> how are you
╭─────────────────────────────────────────────────────────────╮
│ > Type your message...                                      │
╰─────────────────────────────────────────────────────────────╯
\`\`\`

## Snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-1\`.

## Pitfalls

- Forgetting \`"type": "module"\` causes ESM import failures
- Using \`"jsx": "react-jsx"\` instead of \`"jsx": "react"\` breaks Ink rendering
- Importing \`./App.tsx\` instead of \`./App.js\` from compiled code fails at runtime
- Reading \`package.json\` from the wrong relative path after compilation

## What comes next

Part 2 adds the OpenAI SDK and streaming — the first time the app actually talks to an AI model. Everything you build after this point grows inside the shell you just created.
`,
  },
  {
    path: "docs/build-your-own/part-10.md",
    content: `# Part 10: Sessions

Sessions make ProtoAgent feel like a workspace instead of a one-shot demo. Without them, closing the terminal loses everything: the conversation, the TODO list, what files were touched, and what work remains.

## What you are building

Starting from Part 9, you add:

- \`src/sessions.ts\` — session creation, save/load, listing, and title generation
- Updated \`src/cli.tsx\` — adds \`--session <id>\` flag
- Updated \`src/App.tsx\` — session lifecycle (create, load, save, resume)

## Step 1: Create \`src/sessions.ts\`

Create the file:

\`\`\`bash
touch src/sessions.ts
\`\`\`

Sessions are stored as JSON files in \`~/.local/share/protoagent/sessions/\`. Each has an 8-character alphanumeric ID, title, timestamps, model info, TODO state, and the full message history.

\`\`\`typescript
// src/sessions.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chmodSync } from 'node:fs';
import type OpenAI from 'openai';
import type { TodoItem } from './tools/todo.js';

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$/i;
const SHORT_ID_PATTERN = /^[0-9a-z]{8}\$/i;

// Generate a short, readable session ID (8 alphanumeric characters).
function generateSessionId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Sets restrictive file/directory permissions (non-Windows only).
function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

// Validates that the session ID matches the expected format.
function assertValidSessionId(id: string): void {
  // Accept both legacy UUIDs and new short IDs
  if (!SESSION_ID_PATTERN.test(id) && !SHORT_ID_PATTERN.test(id)) {
    throw new Error(\`Invalid session ID: \${id}\`);
  }
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: string;
  todos: TodoItem[];
  completionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// Ensures the system prompt is at the top of the messages array.
export function ensureSystemPromptAtTop(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  systemPrompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const firstSystemIndex = messages.findIndex((message) => message.role === 'system');

  if (firstSystemIndex === -1) {
    return [{ role: 'system', content: systemPrompt } as OpenAI.Chat.Completions.ChatCompletionMessageParam, ...messages];
  }

  const firstSystemMessage = messages[firstSystemIndex];
  const normalizedSystemMessage = {
    ...firstSystemMessage,
    role: 'system',
    content: systemPrompt,
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;

  return [
    normalizedSystemMessage,
    ...messages.slice(0, firstSystemIndex),
    ...messages.slice(firstSystemIndex + 1),
  ];
}

// Returns the platform-specific directory path for storing sessions.
function getSessionsDir(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'sessions');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'sessions');
}

// Creates the sessions directory if it doesn't exist and hardens its permissions.
async function ensureSessionsDir(): Promise<string> {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true, mode: SESSION_DIR_MODE });
  hardenPermissions(dir, SESSION_DIR_MODE);
  return dir;
}

// Returns the full file path for a session JSON file given its ID.
function sessionPath(id: string): string {
  assertValidSessionId(id);
  return path.join(getSessionsDir(), \`\${id}.json\`);
}

// Create a new session.
export function createSession(model: string, provider: string): Session {
  return {
    id: generateSessionId(),
    title: 'New session',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    provider,
    todos: [],
    completionMessages: [],
  };
}

// Persists a session to disk as JSON with restricted permissions.
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  const filePath = sessionPath(session.id);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: SESSION_FILE_MODE });
  hardenPermissions(filePath, SESSION_FILE_MODE);
}

// Loads a session from disk by ID, returning null if not found or invalid.
export async function loadSession(id: string): Promise<Session | null> {
  try {
    const content = await fs.readFile(sessionPath(id), 'utf8');
    const session = JSON.parse(content) as Partial<Session>;
    return {
      id: session.id ?? id,
      title: session.title ?? 'New session',
      createdAt: session.createdAt ?? new Date().toISOString(),
      updatedAt: session.updatedAt ?? new Date().toISOString(),
      model: session.model ?? '',
      provider: session.provider ?? '',
      todos: Array.isArray(session.todos) ? session.todos : [],
      completionMessages: Array.isArray(session.completionMessages) ? session.completionMessages : [],
    };
  } catch {
    return null;
  }
}

// Lists all saved sessions sorted by most recently updated.
export async function listSessions(): Promise<SessionSummary[]> {
  const dir = getSessionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), 'utf8');
      const session = JSON.parse(content) as Session;
      summaries.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.completionMessages.length,
      });
    } catch {
      // Skip corrupt session files
    }
  }

  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}

// Deletes a session file by ID, returning true if successful.
export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

// Generates a session title from the first user message content.
export function generateTitle(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg || !('content' in firstUserMsg) || typeof firstUserMsg.content !== 'string') {
    return 'New session';
  }
  const content = firstUserMsg.content;
  if (content.length <= 60) return content;
  return content.slice(0, 57) + '...';
}
\`\`\`

## Step 2: Update \`src/cli.tsx\`

Add the \`--session\` flag for resuming sessions.

\`\`\`typescript
// src/cli.tsx
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, readConfig, writeConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: error, warn, info, debug, trace')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    render(<App dangerouslySkipPermissions={options.dangerouslySkipPermissions || false} logLevel={options.logLevel || 'info'} sessionId={options.session || null} />);
  });

program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(\`\${selected.provider} / \${selected.model}\`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program.parse(process.argv);
\`\`\`

## Step 3: Update \`src/App.tsx\`

The main App now manages session lifecycle:

1. On startup: load the requested session (if \`--session\` provided) or create a new one
2. On each turn: save the session after the agentic loop completes
3. Display the current session ID in the UI

Add the session imports and update AppProps:

\`\`\`typescript
// Import sessions
import {
  createSession,
  ensureSystemPromptAtTop,
  saveSession,
  loadSession,
  generateTitle,
  type Session,
} from './sessions.js';
import { clearTodos, getTodosForSession, setTodosForSession } from './tools/todo.js';
import { generateSystemPrompt } from './system-prompt.js';

// Add sessionId to AppProps
export interface AppProps {
  dangerouslySkipPermissions?: boolean;
  logLevel?: string;
  sessionId?: string;
}
\`\`\`

Update the component signature to accept \`sessionId\`:

\`\`\`typescript
export const App: React.FC<AppProps> = ({ dangerouslySkipPermissions = false, logLevel = 'info', sessionId }) => {
\`\`\`

Add session state in the \`App\`:

\`\`\`typescript
// Add session state
const [session, setSession] = useState<Session | null>(null);
\`\`\`

Replace the \`initializeWithConfig\` callback to add session handling:

\`\`\`typescript
const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
  setConfig(loadedConfig);
  clientRef.current = buildClient(loadedConfig);

  // Session handling:
  let loadedSession: Session | null = null;
  if (sessionId) {
    loadedSession = await loadSession(sessionId);
    if (loadedSession) {
      const systemPrompt = await generateSystemPrompt();
      loadedSession.completionMessages = ensureSystemPromptAtTop(
        loadedSession.completionMessages,
        systemPrompt
      );
      setTodosForSession(loadedSession.id, loadedSession.todos);
      setSession(loadedSession);
      setCompletionMessages(loadedSession.completionMessages);
    }
  }

  if (!loadedSession) {
    const initialMessages = await initializeMessages();
    setCompletionMessages(initialMessages);
    const newSession = createSession(loadedConfig.model, loadedConfig.provider);
    clearTodos(newSession.id);
    newSession.completionMessages = initialMessages;
    setSession(newSession);
  }

  setNeedsSetup(false);
  setInitialized(true);
}, []);
\`\`\`


Replace the \`handleSubmit\` callback to add session saving after successful agentic loop completion:

\`\`\`typescript
const handleSubmit = useCallback(async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || loading || !clientRef.current || !config) return;

  setInputText('');
  setInputResetKey((prev) => prev + 1);
  setLoading(true);
  setError(null);

  const userMessage: Message = { role: 'user', content: trimmed };
  setCompletionMessages((prev) => [...prev, userMessage]);

  try {
    const pricing = getModelPricing(config.provider, config.model);
    const requestDefaults = getRequestDefaultParams(config.provider, config.model);

    // Create abort controller for this completion
    abortControllerRef.current = new AbortController();

    const updatedMessages = await runAgenticLoop(
      clientRef.current,
      config.model,
      [...completionMessages, userMessage],
      trimmed,
      (event: AgentEvent) => {
        switch (event.type) {
          case 'text_delta':
            setCompletionMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (event.content || '') }];
              }
              return [...prev, { role: 'assistant', content: event.content || '' }];
            });
            break;
          case 'tool_call':
            if (event.toolCall) {
              setCompletionMessages((prev) => {
                const assistantMsg = {
                  role: 'assistant' as const,
                  content: '',
                  tool_calls: [{
                    id: event.toolCall!.id,
                    type: 'function' as const,
                    function: { name: event.toolCall!.name, arguments: event.toolCall!.args },
                  }],
                };
                return [...prev, assistantMsg as any];
              });
            }
            break;
          case 'tool_result':
            if (event.toolCall) {
              setCompletionMessages((prev) => [
                ...prev,
                {
                  role: 'tool',
                  tool_call_id: event.toolCall!.id,
                  content: event.toolCall!.result || '',
                } as any,
              ]);
            }
            break;
          case 'usage':
            if (event.usage) {
              setLastUsage(event.usage);
              setTotalCost((prev) => prev + event.usage!.cost);
            }
            break;
          case 'iteration_done':
            // Reset assistant message tracker between iterations
            break;
          case 'error':
            setError(event.error || 'Unknown error');
            break;
          case 'done':
            break;
        }
      },
      {
        pricing: pricing || undefined,
        abortSignal: abortControllerRef.current.signal,
        requestDefaults,
      }
    );

    // Update session
    if (session) {
      session.completionMessages = updatedMessages;
      session.todos = getTodosForSession(session.id);
      session.title = generateTitle(updatedMessages);
      await saveSession(session);
    }

    setCompletionMessages(updatedMessages);
  } catch (err: any) {
    setError(\`Error: \${err.message}\`);
  } finally {
    setLoading(false);
  }
}, [loading, config, completionMessages]);
\`\`\`

Add session ID display in the UI (after the usage display):

\`\`\`typescript
{session && (
  <Box marginTop={1}>
    <Text dimColor>Session: {session.id}</Text>
  </Box>
)}
\`\`\`

## Verification

\`\`\`bash
npm run dev
\`\`\`

Have a conversation, then press Ctrl+C to quit. Check that a session file was created in \`~/.local/share/protoagent/sessions/\` (or \`AppData/Local/protoagent/sessions\` on Windows). The filename should be an 8-character alphanumeric ID like \`a1b2c3d4.json\`.

Resume the session:

\`\`\`bash
npm run dev -- --session a1b2c3d4
\`\`\`

Replace \`a1b2c3d4\` with your actual session ID. You should see prior messages restored and the conversation continuing from where you left off.

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-10\`.

## Core takeaway

Sessions are not just storage. They are what let a long-running coding task survive real life — terminals close, machines restart, but the work continues.
`,
  },
  {
    path: "docs/build-your-own/part-11.md",
    content: `# Part 11: MCP Integration

MCP (Model Context Protocol) turns ProtoAgent from a local coding agent into one that can grow beyond its built-in tools. External tool servers — filesystem, GitHub, browser automation, databases — become available through a standard protocol.

We use the official MCP SDK (\`@modelcontextprotocol/sdk\`) to handle transport, connectivity, and capability discovery. The SDK manages the low-level protocol details: establishing connections over stdio or HTTP, negotiating capabilities with servers, and routing tool calls. See the SDK docs at https://modelcontextprotocol.io/docs/sdk. For a deeper understanding of how MCP works under the hood, see [How MCP Works: A Visualization](https://thomasgauvin.com/writing/learning-how-mcp-works-by-reading-logs-and-building-mcp-interceptor/).

## What you are building

We will allow users to configure MCP servers via the \`protoagent.jsonc\` file. We will create a specific file \`src/runtime-config.ts\` to handle this configuration, and clean up duplicated code in \`config.tsx\`.

Starting from Part 10, you add:

- \`src/runtime-config.ts\` — active \`protoagent.jsonc\` configuration loader
- Updated \`src/config.tsx\` — remove duplicated config paths/types (now imported from runtime-config.ts)
- \`src/mcp.ts\` — MCP client that connects to stdio and HTTP servers
- Updated \`src/providers.ts\` — merges runtime config providers with built-in catalog
- Updated \`src/App.tsx\` — initializes MCP on startup, closes on unmount

## Install new dependencies

\`\`\`bash
npm install @modelcontextprotocol/sdk jsonc-parser
\`\`\`

## Step 1: Create \`src/runtime-config.ts\`

Create the file:

\`\`\`bash
touch src/runtime-config.ts
\`\`\`

This file will become the single source of truth for runtime configuration — handling config file discovery, parsing, caching, and type definitions. This lets us remove duplicated logic from \`config.tsx\`.

The runtime config system loads the active \`protoagent.jsonc\` file. If a project file (\`.protoagent/protoagent.jsonc\`) exists in the current working directory, ProtoAgent uses that; otherwise it falls back to the shared user file (\`~/.config/protoagent/protoagent.jsonc\`). There is no merging between the two — one file wins. This is where MCP servers are configured, and where custom providers/models can be added.

\`\`\`typescript
// src/runtime-config.ts

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';

export interface RuntimeModelConfig {
  name?: string;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  defaultParams?: Record<string, unknown>;
}

const RESERVED_DEFAULT_PARAM_KEYS = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
]);

export interface RuntimeProviderConfig {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models?: Record<string, RuntimeModelConfig>;
}

interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

interface HttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

export type RuntimeMcpServerConfig = StdioServerConfig | HttpServerConfig;

export interface RuntimeConfigFile {
  providers?: Record<string, RuntimeProviderConfig>;
  mcp?: {
    servers?: Record<string, RuntimeMcpServerConfig>;
  };
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigFile = {
  providers: {},
  mcp: { servers: {} },
};

let runtimeConfigCache: RuntimeConfigFile | null = null;

// Returns the path to the project-level runtime config file.
function getProjectRuntimeConfigPath(): string {
  return path.join(process.cwd(), '.protoagent', 'protoagent.jsonc');
}

// Returns the path to the user-level runtime config file based on the OS.
function getUserRuntimeConfigPath(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc');
}

// Returns the active config path: project if it exists, otherwise user.
export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) return projectPath;
  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) return userPath;
  return null;
}

// Checks if a value is a plain object (not an array or null).
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Replaces environment variable placeholders in a string with their values.
function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\\\$\\{([A-Z0-9_]+)\\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      return '';
    }
    return resolved;
  });
}

// Recursively interpolates environment variables in any value type.
function interpolateValue<T>(value: T, sourcePath: string): T {
  if (typeof value === 'string') return interpolateString(value, sourcePath) as T;
  if (Array.isArray(value)) return value.map((entry) => interpolateValue(entry, sourcePath)) as T;
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const interpolated = interpolateValue(entry, sourcePath);
      if (key === 'headers' && isPlainObject(interpolated)) {
        // Drop headers whose values were empty after interpolation
        next[key] = Object.fromEntries(
          Object.entries(interpolated).filter(([, v]) => typeof v !== 'string' || v.length > 0)
        );
        continue;
      }
      next[key] = interpolated;
    }
    return next as T;
  }
  return value;
}

// Removes reserved parameter keys from provider and model defaultParams.
function sanitizeDefaultParamsInConfig(config: RuntimeConfigFile): RuntimeConfigFile {
  const nextProviders = Object.fromEntries(
    Object.entries(config.providers || {}).map(([providerId, provider]) => {
      const providerDefaultParams = Object.fromEntries(
        Object.entries(provider.defaultParams || {}).filter(([key]) => {
          const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
          return allowed;
        })
      );

      const nextModels = Object.fromEntries(
        Object.entries(provider.models || {}).map(([modelId, model]) => {
          const modelDefaultParams = Object.fromEntries(
            Object.entries(model.defaultParams || {}).filter(([key]) => {
              const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
              return allowed;
            })
          );
          return [modelId, { ...model, ...(Object.keys(modelDefaultParams).length > 0 ? { defaultParams: modelDefaultParams } : {}) }];
        })
      );

      return [providerId, { ...provider, ...(Object.keys(providerDefaultParams).length > 0 ? { defaultParams: providerDefaultParams } : {}), models: nextModels }];
    })
  );

  return { ...config, providers: nextProviders };
}

// Merges two runtime configs, with overlay taking precedence.
function mergeRuntimeConfig(base: RuntimeConfigFile, overlay: RuntimeConfigFile): RuntimeConfigFile {
  const mergedProviders: Record<string, RuntimeProviderConfig> = { ...(base.providers || {}) };
  for (const [providerId, providerConfig] of Object.entries(overlay.providers || {})) {
    const current = mergedProviders[providerId] || {};
    mergedProviders[providerId] = { ...current, ...providerConfig, models: { ...(current.models || {}), ...(providerConfig.models || {}) } };
  }
  const mergedServers: Record<string, RuntimeMcpServerConfig> = { ...(base.mcp?.servers || {}) };
  for (const [name, serverConfig] of Object.entries(overlay.mcp?.servers || {})) {
    const current = mergedServers[name];
    mergedServers[name] = current && isPlainObject(current) ? { ...current, ...serverConfig } : serverConfig;
  }
  return { providers: mergedProviders, mcp: { servers: mergedServers } };
}

// Reads and parses a runtime config file with interpolation and validation.
async function readRuntimeConfigFile(configPath: string): Promise<RuntimeConfigFile | null> {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      const details = errors.map((e) => \`\${printParseErrorCode(e.error)} at offset \${e.offset}\`).join(', ');
      throw new Error(\`Failed to parse \${configPath}: \${details}\`);
    }
    if (!isPlainObject(parsed)) throw new Error(\`Failed to parse \${configPath}: top-level value must be an object\`);
    return sanitizeDefaultParamsInConfig(interpolateValue(parsed as RuntimeConfigFile, configPath));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

// Loads the runtime config from file or cache, merging with defaults.
export async function loadRuntimeConfig(forceReload = false): Promise<RuntimeConfigFile> {
  if (!forceReload && runtimeConfigCache) return runtimeConfigCache;

  const configPath = getActiveRuntimeConfigPath();
  let loaded = DEFAULT_RUNTIME_CONFIG;

  if (configPath) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (fileConfig) {
      loaded = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, fileConfig);
    }
  }

  runtimeConfigCache = loaded;
  return loaded;
}

// Returns the cached runtime config or the default config.
export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

// Clears the runtime config cache for testing purposes.
export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}
\`\`\`

## Step 2: Clean up \`src/config.tsx\`

Now that \`runtime-config.ts\` is the single source of truth for config paths and types, we need to remove the duplicated code from \`config.tsx\`. Replace the relevant sections:

1. Add the import at the top:
\`\`\`typescript
import { getActiveRuntimeConfigPath, type RuntimeConfigFile, type RuntimeProviderConfig } from './runtime-config.js';
\`\`\`

2. Remove these duplicate functions and interfaces:
   - \`getUserRuntimeConfigPath()\` — now imported from runtime-config.ts
   - \`getProjectRuntimeConfigPath()\` — now computed inline where needed  
   - \`getActiveRuntimeConfigPath()\` — now imported from runtime-config.ts
   - Inline \`RuntimeProviderConfig\` interface — now imported type
   - Inline \`RuntimeConfigFile\` interface — now imported type

3. Update \`getInitConfigPath()\` to compute paths directly:
\`\`\`typescript
export const getInitConfigPath = (target: InitConfigTarget, cwd = process.cwd()) => {
  const projectPath = path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc');
  const userPath = path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc');
  return target === 'project' ? projectPath : userPath;
};
\`\`\`

4. Update \`ConfigureComponent\` Select options to use inline paths:
\`\`\`typescript
options={[
  { label: \`Project config — \${path.join(getProjectRuntimeConfigDirectory(), 'protoagent.jsonc')}\`, value: 'project' },
  { label: \`Shared user config — \${path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc')}\`, value: 'user' },
]}
\`\`\`

The \`isPlainObject()\` helper stays in config.tsx since it's still used by \`readRuntimeConfigFileSync()\`.

## Step 3: Create \`src/mcp.ts\`

The MCP client connects to configured servers, discovers their tools, and registers them as dynamic tools.

\`\`\`typescript
// src/mcp.ts

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from './runtime-config.js';
import { logger } from './utils/logger.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();

// Connects to a stdio-based MCP server and returns the connection.
async function connectStdioServer(serverName: string, config: StdioServerConfig): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
    cwd: config.cwd,
  });

  const client = new Client({ name: 'protoagent', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return { client, serverName, transport };
}

// Connects to an HTTP-based MCP server and returns the connection.
async function connectHttpServer(serverName: string, config: HttpServerConfig): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  const client = new Client({ name: 'protoagent', version: '0.0.1' }, { capabilities: {} });
  await client.connect(transport);
  return { client, serverName, transport };
}

// Discovers and registers all tools from an MCP connection as dynamic tools.
async function registerMcpTools(conn: McpConnection): Promise<void> {
  try {
    const response = await conn.client.listTools();
    const tools = response.tools || [];

    logger.info(\`MCP [\${conn.serverName}] discovered \${tools.length} tools\`);

    for (const tool of tools) {
      const toolName = \`mcp_\${conn.serverName}_\${tool.name}\`;

      registerDynamicTool({
        type: 'function' as const,
        function: {
          name: toolName,
          description: \`[MCP: \${conn.serverName}] \${tool.description || tool.name}\`,
          parameters: tool.inputSchema as any,
        },
      });

      registerDynamicHandler(toolName, async (args: unknown) => {
        const result = await conn.client.callTool({
          name: tool.name,
          arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
        });

        if (Array.isArray(result.content)) {
          return result.content
            .map((c: any) => (c.type === 'text' ? c.text : JSON.stringify(c)))
            .join('\\n');
        }
        return JSON.stringify(result);
      });
    }
  } catch (err) {
    logger.error(\`Failed to register tools for MCP [\${conn.serverName}]: \${err}\`);
  }
}

// Loads runtime config and initializes all configured MCP servers.
export async function initializeMcp(): Promise<void> {
  await loadRuntimeConfig();
  const servers = getRuntimeConfig().mcp?.servers || {};

  if (Object.keys(servers).length === 0) return;

  logger.info('Loading MCP servers from merged runtime config');

  for (const [name, serverConfig] of Object.entries(servers)) {
    if (serverConfig.enabled === false) {
      logger.debug(\`Skipping disabled MCP server: \${name}\`);
      continue;
    }

    try {
      let conn: McpConnection;

      if (serverConfig.type === 'stdio') {
        logger.debug(\`Connecting to stdio MCP server: \${name}\`);
        conn = await connectStdioServer(name, serverConfig);
      } else if (serverConfig.type === 'http') {
        logger.debug(\`Connecting to HTTP MCP server: \${name} (\${serverConfig.url})\`);
        conn = await connectHttpServer(name, serverConfig);
      } else {
        logger.error(\`Unknown MCP server type for "\${name}": \${(serverConfig as any).type}\`);
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      logger.error(\`Failed to connect to MCP server "\${name}": \${err}\`);
    }
  }
}

// Closes all active MCP connections and clears the connection map.
export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      logger.debug(\`Closing MCP connection: \${name}\`);
      await conn.client.close();
    } catch (err) {
      logger.error(\`Error closing MCP connection [\${name}]: \${err}\`);
    }
  }
  connections.clear();
}
\`\`\`

## Step 4: Update \`src/App.tsx\`

Add MCP initialization on startup and cleanup on unmount:

\`\`\`typescript
// In App.tsx, import:
import { initializeMcp, closeMcp } from './mcp.js';
import { loadRuntimeConfig } from './runtime-config.js';

// In initializeWithConfig, after building the client:
await initializeMcp();
\`\`\`

Replace the init \`useEffect\`:

\`\`\`typescript
  useEffect(() => {
    const init = async () => {
      if (dangerouslySkipPermissions) {
        setDangerouslySkipPermissions(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      await loadRuntimeConfig();

      const loadedConfig = readConfig();
      if (!loadedConfig) {
        setNeedsSetup(true);
        return;
      }

      await initializeWithConfig(loadedConfig);
    };

    init().catch((err) => {
      setError(\`Initialization failed: \${err.message}\`);
    });

    return () => {
      clearApprovalHandler();
      closeMcp();
    };
  }, []);
\`\`\`

## Step 5: Configure MCP servers

Create \`.protoagent/protoagent.jsonc\` in your project and configure a sample MCP server. 

\`\`\`jsonc
{
  // MCP server configuration
  "mcp": {
    "servers": {
      "chrome-devtools": {
        "type": "stdio",
        "command": "npx",
        "args": [
          "-y",
          "chrome-devtools-mcp@latest",
        ]
      }
    }
  }
}
\`\`\`

## Verification

\`\`\`bash
npm run dev
\`\`\`

If you have MCP servers configured, you should see them connecting during startup (visible in debug logs). The discovered tools will be available to the model alongside the built-in tools.

\`\`\`
 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> open hacker news with chrome mcp
Tool: mcp_chrome-devtools_new_page({"url":"https://news.ycombinator.com","background
":false})
## Pages
1: about:blank
2: https://news.ycombinator.com/ [selected]
BEEP BEEP

✅ Opened Hacker News in a new Chrome tab (page 2).

tokens: 3216↓ 16↑ | ctx: 0% | cost: \$0.0017

Session: k7pyp4ua
╭────────────────────────────────────────────────────────────╮
│ > Type your message...                                     │
╰────────────────────────────────────────────────────────────╯
\`\`\`

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-11\`.

## Core takeaway

MCP is the bridge between ProtoAgent and external tool ecosystems. Built-in tools handle the common cases, but MCP means the agent can grow to use any tool that speaks the protocol.
`,
  },
  {
    path: "docs/build-your-own/part-12.md",
    content: `# Part 12: Sub-agents

Sub-agents solve context pollution. Sometimes the model needs to do noisy work — search a repo, read ten files, compare implementations — just to answer one question. Without sub-agents, all that intermediate work stays in the parent conversation forever. Sub-agents push it into an isolated child run that returns only a summary.

## What you are building

Starting from Part 11, you add:

- \`src/sub-agent.ts\` — isolated child agent execution
- Updated \`src/agentic-loop.ts\` — imports and registers the sub-agent tool, routes \`sub_agent\` tool calls to the child runner

## Step 1: Create \`src/sub-agent.ts\`

Create the file:

\`\`\`bash
touch src/sub-agent.ts
\`\`\`

The \`sub-agent.ts\` file will look very similar to the existing \`agentic-loop.ts\` file. That is because it has it's own loop, with a few variations. For instance, the \`sub-agent.ts\` must run autonomously and be a background agent, while the main \`agentic-loop.ts\` interacts with the user.The sub-agent gets its own message history, system prompt, and tool access.

This is the analogy: With subagents, the parent delegates a research task to a specialist. That specialist might read 20 files, run grep, compare implementations — messy exploratory work. All those intermediate steps stay in the specialist's notebook. When they're done, they hand the parent a single summary. The parent never sees the messy drafts, only the clean result.

\`\`\`typescript
// src/sub-agent.ts

import type OpenAI from 'openai';
import crypto from 'node:crypto';
import { handleToolCall, getAllTools } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { clearTodos } from './tools/todo.js';
import { ModelPricing } from './utils/cost-tracker.js';

export interface SubAgentUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface SubAgentResult {
  response: string;
  usage: SubAgentUsage;
}

// Defines sub-agents as a tool that the main coding agent can invoke
export const subAgentTool = {
  type: 'function' as const,
  function: {
    name: 'sub_agent',
    description:
      'Spawn an isolated sub-agent to handle a task without polluting the main conversation context. ' +
      'Use this for independent subtasks like exploring a codebase, researching a question, or making changes to a separate area. ' +
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
          description: 'Maximum tool-call iterations for the sub-agent. Defaults to 500.',
        },
      },
      required: ['task'],
    },
  },
};

export type SubAgentProgressHandler = (event: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> }) => void;

// Spawns an isolated sub-agent to handle a task independently from the main conversation context.
export async function runSubAgent(
  client: OpenAI,
  model: string,
  task: string,
  maxIterations = 500,
  requestDefaults: Record<string, unknown> = {},
  onProgress?: SubAgentProgressHandler,
  abortSignal?: AbortSignal,
  pricing?: ModelPricing
): Promise<SubAgentResult> {
  const subAgentSessionId = \`sub-agent-\${crypto.randomUUID()}\`;

  const systemPrompt = await generateSystemPrompt();
  const subSystemPrompt = \`\${systemPrompt}

## Sub-Agent Mode

You are running as a sub-agent. You were given a specific task by the parent agent.
Complete the task thoroughly and return a clear, concise summary of what you did and found.
Do NOT ask the user questions — work autonomously with the tools available.\`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: subSystemPrompt },
    { role: 'user', content: task },
  ];

  // Track cumulative usage across all API calls in the sub-agent
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  try {
    for (let i = 0; i < maxIterations; i++) {
      // Check abort at the top of each iteration
      if (abortSignal?.aborted) {
        return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }

      let assistantMessage: any;
      let hasToolCalls = false;

      try {
        const stream = await client.chat.completions.create({
          ...requestDefaults,
          model,
          messages,
          tools: getAllTools(),
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }, { signal: abortSignal });

        // Accumulate the streamed response
        assistantMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [],
        };
        let streamedContent = '';
        hasToolCalls = false;
        let actualUsage: OpenAI.CompletionUsage | undefined;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (chunk.usage) {
            actualUsage = chunk.usage;
          }

          // Stream text content
          if (delta?.content) {
            streamedContent += delta.content;
            assistantMessage.content = streamedContent;
          }

          // Accumulate tool calls across stream chunks
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
              if (tc.function?.name) {
                assistantMessage.tool_calls[idx].function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }

        // Accumulate usage for this iteration
        const iterationInputTokens = actualUsage?.prompt_tokens || 0;
        const iterationOutputTokens = actualUsage?.completion_tokens || 0;
        totalInputTokens += iterationInputTokens;
        totalOutputTokens += iterationOutputTokens;

        // Calculate cost if pricing is available
        if (pricing && (iterationInputTokens > 0 || iterationOutputTokens > 0)) {
          const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
          if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
            const uncachedTokens = iterationInputTokens - cachedTokens;
            totalCost += uncachedTokens * pricing.inputPerToken + cachedTokens * pricing.cachedPerToken + iterationOutputTokens * pricing.outputPerToken;
          } else {
            totalCost += iterationInputTokens * pricing.inputPerToken + iterationOutputTokens * pricing.outputPerToken;
          }
        }
      } catch (err) {
        // If aborted during streaming, return gracefully
        if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
          return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
        }
        throw err;
      }

      const message = assistantMessage;
      if (!message) break;

      // Check for tool calls
      if (hasToolCalls && assistantMessage.tool_calls.length > 0) {
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        // Filter out tool calls with malformed JSON arguments (can happen if stream aborted mid-tool-call)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return true; // No args is valid
          try {
            JSON.parse(args);
            return true;
          } catch {
            return false;
          }
        });
        // Only add message if we have valid tool calls
        if (assistantMessage.tool_calls.length === 0) {
          hasToolCalls = false;
        } else {
          messages.push(message as any);
        }

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
          }

          const { name, arguments: argsStr } = toolCall.function;
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(argsStr);
          } catch {
            args = {};
          }
          onProgress?.({ tool: name, status: 'running', iteration: i, args });

          try {
            const result = await handleToolCall(name, args, { sessionId: subAgentSessionId, abortSignal });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
            onProgress?.({ tool: name, status: 'done', iteration: i });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: \`Error: \${msg}\`,
            } as any);
            onProgress?.({ tool: name, status: 'error', iteration: i });
          }
        }
        continue;
      }

      // Plain text response — we're done
      if (message.content) {
        messages.push({
          role: 'assistant',
          content: message.content,
        });
        return { response: message.content, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }
      return { response: '(sub-agent completed with no response)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
    }

    return { response: '(sub-agent reached iteration limit)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
  } finally {
    clearTodos(subAgentSessionId);
  }
}
\`\`\`

## Step 2: Update \`src/tools/index.ts\`

Add \`abortSignal\` to \`ToolCallContext\` so tools can honor cancellation when a sub-agent is aborted:

\`\`\`typescript
export interface ToolCallContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
}
\`\`\`

## Step 3: Update \`src/agentic-loop.ts\`

Import the sub-agent tool and types, add \`sub_agent_iteration\` event type, and wire up special handling for \`sub_agent\` tool calls.

Add the import at the top:

\`\`\`typescript
import { subAgentTool, runSubAgent, type SubAgentProgressHandler, SubAgentResult } from './sub-agent.js';
\`\`\`

Update \`AgentEvent\` to include sub-agent progress and usage:

\`\`\`typescript
export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done' | 'sub_agent_iteration';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
  transient?: boolean;
  subAgentTool?: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> };
  subAgentUsage?: { inputTokens: number; outputTokens: number; cost: number };
}
\`\`\`

Include \`subAgentTool\` in the tools list sent to the API:

\`\`\`typescript
const allTools = [...getAllTools(), subAgentTool];
\`\`\`

In your tool execution section (above where \`handleToolCall\` is called), add special handling for \`sub_agent\`:

\`\`\`typescript
let result: string;

// Handle sub-agent tool specially
if (name === 'sub_agent') {
  const subProgress: SubAgentProgressHandler = (evt) => {
    onEvent({
      type: 'sub_agent_iteration',
      subAgentTool: { tool: evt.tool, status: evt.status, iteration: evt.iteration, args: evt.args },
    });
  };
  const subResult = await runSubAgent(
    client,
    model,
    args.task,
    args.max_iterations,
    requestDefaults,
    subProgress,
    abortSignal,
    pricing,
  );
  result = subResult.response;
  // Emit sub-agent usage for the UI to add to total cost
  if (subResult.usage.inputTokens > 0 || subResult.usage.outputTokens > 0) {
    onEvent({
      type: 'sub_agent_iteration',
      subAgentUsage: subResult.usage,
    });
  }
} else {
  result = await handleToolCall(name, args, { sessionId, abortSignal });
}
\`\`\`

## Verification

\`\`\`bash
npm run dev
\`\`\`

Try a prompt that benefits from delegation:

\`\`\`text
Investigate how the config system works in this project using a sub-agent and summarize the flow.
\`\`\`

You should see:
- A \`sub_agent\` tool call in the parent conversation
- The spinner briefly showing \`sub_agent → bash\` (or whichever tool the sub-agent is using) — these are \`sub_agent_iteration\` events that update the spinner without adding entries to the parent's message history
- Only the summary returned to the parent transcript

\`\`\`

 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> use a subagent to understand this codebase
Tool: todo_write({"todos":[{"id":"analyze-subagent","content":"Spawn sub-agent to 
analyze the codebase: list files, r)
TODO List Updated (2 items):
[~] [high] Spawn sub-agent to analyze the codebase: list files, read package.json 
and AGENTS.md, scan src/, summarize each module, identify entry points, build/test 
script...
Tool: sub_agent({"task":"Analyze the TypeScript codebase in 
/Users/thomasgauvin/work-in-progress/2025/protoagent/pro)
BEEP BEEP
{
  "files_listed": {
    "root": [
      ".env",
      ".protoagent",
      "agents.md",
      "dist",
      "node_modules",
      "package-lock.json",
      "package.json",
      "src",
  ...
BEEP BEEP

✅ Sub-agent completed analysis.

Summary (concise):
- I spawned a sub-agent that listed files, read package.json, AGENTS.md,
tsconfig.json, and key source files.
- The sub-agent produced per-file summaries, identified entry points (src/cli.tsx
and dist/cli.js), listed scripts, and proposed follow-up tasks.

Key findings:
- package.json scripts: "build" (tsc), "dev" (tsx src/cli.tsx), "build:watch". No
"test" script despite AGENTS.md recommending npm test.
- TypeScript config: strict mode enabled, NodeNext module resolution, outDir dist,
rootDir src.
- Main entry: src/cli.tsx (dev) and compiled dist/cli.js (bin).
- Notable modules: agentic-loop (core streaming logic), tools/index (tool registry),
 skills (dynamic skill discovery), mcp (Model Context Protocol integration),
sub-agent (spawns isolated agents), App.tsx (Ink UI).
- Several modules silently swallow errors (skills, mcp, session load) — add
logging/diagnostics.
- Tests and CI are missing; add unit tests for streaming/tool-calls and
runtime-config.

Next recommended tasks (pick one and I'll proceed):
- Add a test script and initial unit tests (I can scaffold tests for agentic-loop or
 tools).
- Improve error logging in skills loading and MCP initialization.
- Create README and document build/test workflow.
- Run project build (npm run build) to confirm compile status.

Which follow-up task do you want me to take next?

tokens: 7373↓ 352↑ | ctx: 1% | cost: \$0.0043

Session: 1h32x5xy
╭────────────────────────────────────────────────────╮
│ > Type your message...                             │
╰────────────────────────────────────────────────────╯
\`\`\`

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-12\`.

## Core takeaway

Sub-agents keep the main conversation clean by running noisy investigation work in an isolated context. The parent gets a focused summary instead of hundreds of intermediate tool calls polluting its history.
`,
  },
  {
    path: "docs/build-your-own/part-13.md",
    content: `# Part 13: Polish, Rendering & Logging

This last part is pretty involved because it's a series of incremental improvements to individual tools that have been made after using ProtoAgent and refining it. 

It's what makes the full final project have richer rendering, grouped tool output, collapsible messages, slash commands, formatted output, and the complete final module layout.

## What you are building

Starting from Part 12, you add:

- \`src/utils/logger.ts\` — logging utility with levels and file output
- \`src/utils/format-message.tsx\` — markdown-to-ANSI formatting
- \`src/utils/file-time.ts\` — staleness guard for edit_file

There are also new files to create to adjust the UI:
- \`src/components/LeftBar.tsx\` — left-side bar indicator for callouts (no Box border)
- \`src/components/CollapsibleBox.tsx\` — expand/collapse for long content
- \`src/components/ConsolidatedToolMessage.tsx\` — grouped tool call rendering
- \`src/components/FormattedMessage.tsx\` — markdown tables, code blocks, text formatting
- \`src/components/ConfigDialog.tsx\` — mid-session config changes

And many existing files are upgraded to be more robust:
- Updated \`src/tools/edit-file.ts\` — fuzzy match cascade + unified diff output
- Updated \`src/tools/read-file.ts\` — similar-path suggestions + file-time tracking
- Updated \`src/tools/search-files.ts\` — ripgrep support when available
- Updated \`src/App.tsx\` — final version with all features
- Updated \`src/cli.tsx\` — adds \`init\` subcommand for creating runtime configs

## Step 1: Create \`src/utils/logger.ts\`

Create the logging utility that powers all debug output:

\`\`\`bash
touch src/utils/logger.ts
\`\`\`

\`\`\`typescript
// src/utils/logger.ts

/**
 * Logger utility with configurable log levels.
 *
 * Levels (from least to most verbose):
 *   ERROR (0) → WARN (1) → INFO (2) → DEBUG (3) → TRACE (4)
 *
 * Set the level via \`setLogLevel()\` or the \`--log-level\` CLI flag.
 * Logs are written to a file to avoid interfering with Ink UI rendering.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

let currentLevel: LogLevel = LogLevel.INFO;
let logFilePath: string | null = null;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

let logBuffer: LogEntry[] = [];
let logListeners: Array<(entry: LogEntry) => void> = [];

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function onLog(listener: (entry: LogEntry) => void): () => void {
  logListeners.push(listener);
  return () => {
    logListeners = logListeners.filter(l => l !== listener);
  };
}

export function getRecentLogs(count: number = 50): LogEntry[] {
  return logBuffer.slice(-count);
}

export function initLogFile(): string {
  const logsDir = join(homedir(), '.local', 'share', 'protoagent', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFilePath = join(logsDir, \`protoagent-\${timestamp}.log\`);

  writeToFile(\`\\n\${'='.repeat(80)}\\nProtoAgent Log - \${new Date().toISOString()}\\n\${'='.repeat(80)}\\n\`);

  return logFilePath;
}

function writeToFile(message: string): void {
  if (!logFilePath) {
    initLogFile();
  }
  try {
    appendFileSync(logFilePath!, message);
  } catch (err) {
    // Silently fail if we can't write to log file
  }
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return \`\${hh}:\${mm}:\${ss}.\${ms}\`;
}

function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  if (level > currentLevel) return;
  const ts = timestamp();

  const entry: LogEntry = {
    timestamp: ts,
    level,
    message,
    context,
  };

  logBuffer.push(entry);
  if (logBuffer.length > 100) {
    logBuffer.shift();
  }

  logListeners.forEach(listener => listener(entry));

  const ctx = context ? \` \${JSON.stringify(context)}\` : '';
  writeToFile(\`[\${ts}] \${label.padEnd(5)} \${message}\${ctx}\\n\`);
}

export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.ERROR, 'ERROR', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.WARN, 'WARN', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.INFO, 'INFO', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.DEBUG, 'DEBUG', msg, ctx),
  trace: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.TRACE, 'TRACE', msg, ctx),

  startOperation(name: string): { end: () => void } {
    const start = performance.now();
    logger.debug(\`\${name} started\`);
    return {
      end() {
        const ms = (performance.now() - start).toFixed(1);
        logger.debug(\`\${name} completed\`, { durationMs: ms });
      },
    };
  },

  getLogFilePath(): string | null {
    return logFilePath;
  },
};
\`\`\`

## Step 2: Create \`src/utils/format-message.tsx\`

Create the file:

\`\`\`bash
touch src/utils/format-message.tsx
\`\`\`

Adds support for markdown-style formatting (**bold**, *italic*, ***bold italic***) using Ink \`<Text>\` components with proper props.

\`\`\`typescript
// src/utils/format-message.tsx

import React from 'react';
import { Text } from 'ink';

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const cleaned = text.replace(/^#+\\s+/gm, '');
  const pattern = /(\\*\\*\\*[^*]+?\\*\\*\\*|\\*\\*[^*]+?\\*\\*|\\*[^\\s*][^*]*?\\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: cleaned.slice(lastIndex, match.index) });
    }
    const fullMatch = match[0];
    const content = fullMatch.slice(fullMatch.startsWith('***') ? 3 : 2, fullMatch.startsWith('***') ? -3 : -2);
    if (fullMatch.startsWith('***')) {
      segments.push({ text: content, bold: true, italic: true });
    } else if (fullMatch.startsWith('**')) {
      segments.push({ text: content, bold: true });
    } else {
      segments.push({ text: content, italic: true });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < cleaned.length) {
    segments.push({ text: cleaned.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ text: cleaned }];
}

/** Render formatted text as Ink Text elements. */
export function renderFormattedText(text: string): React.ReactNode {
  const segments = parseSegments(text);
  if (segments.length === 1 && !segments[0].bold && !segments[0].italic) {
    return segments[0].text;
  }
  return segments.map((seg, i) => (
    <Text key={i} bold={seg.bold} italic={seg.italic}>{seg.text}</Text>
  ));
}
\`\`\`

## Step 3: Create \`src/utils/file-time.ts\`

Create the file:

\`\`\`bash
touch src/utils/file-time.ts
\`\`\`

Staleness guard: ensures the model has read a file before editing it, and that the file hasn't changed on disk since.

\`\`\`typescript
// src/utils/file-time.ts

import fs from 'node:fs';

const readTimes = new Map<string, number>(); // key: "sessionId:absolutePath" → epoch ms

/**
 * Record that a file was read at the current time.
 */
export function recordRead(sessionId: string, absolutePath: string): void {
  readTimes.set(\`\${sessionId}:\${absolutePath}\`, Date.now());
}

/**
 * Check that a file was previously read and hasn't changed on disk since.
 * Returns an error string if the check fails, or null if all is well.
 * Use this instead of assertReadBefore so staleness errors surface as normal
 * tool return values rather than exceptions.
 */
export function checkReadBefore(sessionId: string, absolutePath: string): string | null {
  const key = \`\${sessionId}:\${absolutePath}\`;
  const lastRead = readTimes.get(key);

  if (!lastRead) {
    return \`You must read '\${absolutePath}' before editing it. Call read_file first.\`;
  }

  try {
    const mtime = fs.statSync(absolutePath).mtimeMs;
    if (mtime > lastRead + 100) {
      readTimes.delete(key);
      return \`'\${absolutePath}' has changed on disk since you last read it. Re-read it before editing.\`;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      readTimes.delete(key);
      return \`'\${absolutePath}' no longer exists on disk.\`;
    }
  }

  return null;
}

/**
 * @deprecated Use checkReadBefore instead — it returns a string rather than
 * throwing, so the error surfaces cleanly as a tool result.
 */
export function assertReadBefore(sessionId: string, absolutePath: string): void {
  const err = checkReadBefore(sessionId, absolutePath);
  if (err) throw new Error(err);
}

/**
 * Clear all read-time entries for a session (e.g. on session end).
 */
export function clearSession(sessionId: string): void {
  for (const key of readTimes.keys()) {
    if (key.startsWith(\`\${sessionId}:\`)) {
      readTimes.delete(key);
    }
  }
}
\`\`\`

## Step 4: Create UI components

### \`src/components/LeftBar.tsx\`

Create the file:

\`\`\`bash
mkdir -p src/components && touch src/components/LeftBar.tsx
\`\`\`

A left-side bar indicator used by all callout-style components (tool calls, approvals, errors, code blocks). Renders a bold \`│\` character that stretches to match the full height of its content.

**Why not \`<Box borderStyle>\`?** Box borders add lines on all four sides and inflate Ink's managed line count. Ink erases by line count on every re-render, so extra rows increase the chance of resize ghosting — stale lines left on screen when the new frame is shorter than the old one. \`LeftBar\` uses a plain \`<Text>\` column instead, so the total line count is exactly equal to the children's line count with no overhead.

The bar height is derived by attaching a \`ref\` to the content box and calling Ink's built-in \`measureElement\` after each render to get the actual rendered row count.

\`\`\`typescript
// src/components/LeftBar.tsx

import React, { useRef, useState, useLayoutEffect } from 'react';
import { Box, Text, measureElement } from 'ink';
import type { DOMElement } from 'ink';

export interface LeftBarProps {
  color?: string;
  children: React.ReactNode;
  marginTop?: number;
  marginBottom?: number;
}

export const LeftBar: React.FC<LeftBarProps> = ({
  color = 'green',
  children,
  marginTop = 0,
  marginBottom = 0,
}) => {
  const contentRef = useRef<DOMElement>(null);
  const [height, setHeight] = useState(1);

  useLayoutEffect(() => {
    if (contentRef.current) {
      try {
        const { height: h } = measureElement(contentRef.current);
        if (h > 0) setHeight(h);
      } catch {
        // measureElement can throw before layout is complete; keep previous height
      }
    }
  });

  const bar = Array.from({ length: height }, () => '│').join('\\n');

  return (
    <Box flexDirection="row" marginTop={marginTop} marginBottom={marginBottom}>
      <Box flexDirection="column" marginRight={1}>
        <Text color={color} bold>{bar}</Text>
      </Box>
      <Box ref={contentRef} flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
};
\`\`\`

### \`src/components/CollapsibleBox.tsx\`

Create the file:

\`\`\`bash
mkdir -p src/components && touch src/components/CollapsibleBox.tsx
\`\`\`

Hides long content behind expand/collapse. Used for system prompts, tool results, and verbose output.

\`\`\`typescript
// src/components/CollapsibleBox.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { LeftBar } from './LeftBar.js';

export interface CollapsibleBoxProps {
  title: string;
  content: string;
  titleColor?: string;
  dimColor?: boolean;
  maxPreviewLines?: number;
  maxPreviewChars?: number;
  expanded?: boolean;
  marginBottom?: number;
}

export const CollapsibleBox: React.FC<CollapsibleBoxProps> = ({
  title, content, titleColor, dimColor = false,
  maxPreviewLines = 3, maxPreviewChars = 500,
  expanded = false, marginBottom = 0,
}) => {
  const lines = content.split('\\n');
  const isLong = lines.length > maxPreviewLines || content.length > maxPreviewChars;

  if (!isLong) {
    return (
      <LeftBar color={titleColor ?? 'white'} marginBottom={marginBottom}>
        <Text color={titleColor} dimColor={dimColor} bold>{title}</Text>
        <Text dimColor={dimColor}>{content}</Text>
      </LeftBar>
    );
  }

  let preview: string;
  if (expanded) {
    preview = content;
  } else {
    const linesTruncated = lines.slice(0, maxPreviewLines).join('\\n');
    preview = linesTruncated.length > maxPreviewChars
      ? linesTruncated.slice(0, maxPreviewChars)
      : linesTruncated;
  }

  return (
    <LeftBar color={titleColor ?? 'white'} marginBottom={marginBottom}>
      <Text color={titleColor} dimColor={dimColor} bold>
        {expanded ? '▼' : '▶'} {title}
      </Text>
      <Text dimColor={dimColor}>{preview}</Text>
      {!expanded && <Text dimColor={true}>... (use /expand to see all)</Text>}
    </LeftBar>
  );
};
\`\`\`

### \`src/components/ConsolidatedToolMessage.tsx\`

Create the file:

\`\`\`bash
mkdir -p src/components && touch src/components/ConsolidatedToolMessage.tsx
\`\`\`

Groups a tool call with its result into a single consolidated view.

\`\`\`typescript
// src/components/ConsolidatedToolMessage.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { FormattedMessage } from './FormattedMessage.js';
import { LeftBar } from './LeftBar.js';

export interface ConsolidatedToolMessageProps {
  toolCalls: Array<{ id: string; name: string }>;
  toolResults: Map<string, { content: string; name: string }>;
  expanded?: boolean;
}

export const ConsolidatedToolMessage: React.FC<ConsolidatedToolMessageProps> = ({
  toolCalls, toolResults, expanded = false,
}) => {
  const toolNames = toolCalls.map((tc) => tc.name);
  const title = \`Called: \${toolNames.join(', ')}\`;
  const containsTodoTool = toolCalls.some((tc) => tc.name === 'todo_read' || tc.name === 'todo_write');
  const titleColor = containsTodoTool ? 'green' : 'cyan';
  const isExpanded = expanded || containsTodoTool;

  if (isExpanded) {
    return (
      <LeftBar color={titleColor}>
        <Text color={titleColor} bold>▼ {title}</Text>
        {toolCalls.map((tc, idx) => {
          const result = toolResults.get(tc.id);
          if (!result) return null;
          return (
            <Box key={idx} flexDirection="column">
              <Text color="cyan" bold>[{result.name}]:</Text>
              <FormattedMessage content={result.content} />
            </Box>
          );
        })}
      </LeftBar>
    );
  }

  const compactLines = toolCalls.flatMap((tc) => {
    const result = toolResults.get(tc.id);
    if (!result) return [];
    return [\`[\${result.name}] \${result.content.replace(/\\s+/g, ' ').trim()}\`];
  });

  const compactPreview = compactLines.join(' | ');
  const preview = compactPreview.length > 180
    ? \`\${compactPreview.slice(0, 180).trimEnd()}... (use /expand)\`
    : compactPreview;

  return (
    <LeftBar color="white">
      <Text color={titleColor} dimColor bold>▶ {title}</Text>
      <Text dimColor>{preview}</Text>
    </LeftBar>
  );
};
\`\`\`

### \`src/components/FormattedMessage.tsx\`

Create the file:

\`\`\`bash
mkdir -p src/components && touch src/components/FormattedMessage.tsx
\`\`\`

Renders markdown tables as preformatted monospace text, code blocks with a left-bar indicator, and applies text formatting. Uses proper grapheme clustering for accurate width calculation with Unicode text.

\`\`\`typescript
// src/components/FormattedMessage.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { renderFormattedText } from '../utils/format-message.js';
import { LeftBar } from './LeftBar.js';

interface FormattedMessageProps {
  content: string;
  deferTables?: boolean;
}

export const DEFERRED_TABLE_PLACEHOLDER = 'table loading';

const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

const COMBINING_MARK_PATTERN = /\\p{Mark}/u;
const ZERO_WIDTH_PATTERN = /[\\u200B-\\u200D\\uFE0E\\uFE0F]/u;
const DOUBLE_WIDTH_PATTERN = /[\\u1100-\\u115F\\u2329\\u232A\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE10-\\uFE19\\uFE30-\\uFE6F\\uFF00-\\uFF60\\uFFE0-\\uFFE6\\u{1F300}-\\u{1FAFF}\\u{1F900}-\\u{1F9FF}\\u{1F1E6}-\\u{1F1FF}]/u;

function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

function getGraphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (ZERO_WIDTH_PATTERN.test(grapheme)) return 0;
  if (COMBINING_MARK_PATTERN.test(grapheme)) return 0;
  if (/^[\\u0000-\\u001F\\u007F-\\u009F]\$/.test(grapheme)) return 0;
  if (DOUBLE_WIDTH_PATTERN.test(grapheme)) return 2;
  return 1;
}

function getTextWidth(text: string): number {
  return splitGraphemes(text).reduce((width, grapheme) => width + getGraphemeWidth(grapheme), 0);
}

function padToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - getTextWidth(text));
  return text + ' '.repeat(padding);
}

function parseMarkdownTableToRows(markdown: string): string[][] | null {
  const lines = markdown.trim().split('\\n');
  if (lines.length < 3) return null;

  const parseRow = (row: string) =>
    row.split('|')
      .map((cell) => cell.trim())
      .filter((cell, index, array) => {
        if (index === 0 && cell === '') return false;
        if (index === array.length - 1 && cell === '') return false;
        return true;
      });

  const header = parseRow(lines[0]);
  const separator = parseRow(lines[1]);
  if (header.length === 0 || separator.length === 0) return null;
  if (!separator.every((cell) => /^:?-{3,}:?\$/.test(cell.replace(/\\s+/g, '')))) return null;

  const rows = lines.slice(2).map(parseRow);
  return [header, ...rows];
}

function renderPreformattedTable(markdown: string): string {
  const rows = parseMarkdownTableToRows(markdown);
  if (!rows || rows.length === 0) {
    return markdown.trim();
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  );
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...normalizedRows.map((row) => getTextWidth(row[index])))
  );

  const formatRow = (row: string[]) => row
    .map((cell, index) => padToWidth(cell, widths[index]))
    .join('  ')
    .trimEnd();

  const header = formatRow(normalizedRows[0]);
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = normalizedRows.slice(1).map(formatRow);

  return [header, divider, ...body].join('\\n');
}

export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content, deferTables = false }) => {
  if (!content) return null;

  const lines = content.split('\\n');
  const blocks: Array<{ type: 'text' | 'table' | 'code'; content: string }> = [];

  let currentBlockContent: string[] = [];
  let currentBlockType: 'text' | 'table' | 'code' = 'text';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 1. Handle Code Blocks
    if (currentBlockType === 'code') {
      currentBlockContent.push(line);
      if (trimmedLine.startsWith('\`\`\`')) {
        blocks.push({ type: 'code', content: currentBlockContent.join('\\n') });
        currentBlockContent = [];
        currentBlockType = 'text';
      }
      continue;
    }

    // Start Code Block
    if (trimmedLine.startsWith('\`\`\`')) {
      if (currentBlockContent.length > 0) {
        blocks.push({ type: 'text', content: currentBlockContent.join('\\n') });
      }
      currentBlockContent = [line];
      currentBlockType = 'code';
      continue;
    }

    // 2. Handle Tables
    if (currentBlockType === 'table') {
      if (trimmedLine.startsWith('|')) {
        currentBlockContent.push(line);
        continue;
      } else {
        blocks.push({ type: 'table', content: currentBlockContent.join('\\n') });
        currentBlockContent = [];
        currentBlockType = 'text';
      }
    }

    // Start Table Block check
    const isTableStart = trimmedLine.startsWith('|');
    const nextLine = lines[i+1];
    const isNextLineSeparator = nextLine && nextLine.trim().startsWith('|') && nextLine.includes('---');

    if (isTableStart && isNextLineSeparator) {
      if (currentBlockContent.length > 0) {
        blocks.push({ type: 'text', content: currentBlockContent.join('\\n') });
      }
      currentBlockContent = [line];
      currentBlockType = 'table';
      continue;
    }

    // 3. Handle Text
    currentBlockContent.push(line);
  }

  // Push final block
  if (currentBlockContent.length > 0) {
    blocks.push({ type: currentBlockType, content: currentBlockContent.join('\\n') });
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        if (block.type === 'table') {
          if (!block.content.trim()) return null;
          if (deferTables) {
            return (
              <Box key={index} marginY={1}>
                <Text dimColor>{DEFERRED_TABLE_PLACEHOLDER}</Text>
              </Box>
            );
          }
          return (
            <LeftBar key={index} color="gray" marginTop={1} marginBottom={1}>
              <Text>{renderPreformattedTable(block.content)}</Text>
            </LeftBar>
          );
        }

        if (block.type === 'code') {
           return (
             <LeftBar key={index} color="gray" marginTop={1} marginBottom={1}>
               <Text dimColor>{block.content}</Text>
             </LeftBar>
           );
        }

        // Text Block
        if (!block.content.trim()) return null;
        return (
          <Box key={index} marginBottom={0}>
             <Text>{renderFormattedText(block.content)}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
\`\`\`

### \`src/components/ConfigDialog.tsx\`

Create the file:

\`\`\`bash
mkdir -p src/components && touch src/components/ConfigDialog.tsx
\`\`\`

Modal-like dialog for changing config mid-conversation. Allows users to update provider, model, or API key without losing chat history.

\`\`\`typescript
// src/components/ConfigDialog.tsx

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PasswordInput, Select } from '@inkjs/ui';
import { getAllProviders, getProvider } from '../providers.js';
import { resolveApiKey, type Config } from '../config.js';

export interface ConfigDialogProps {
  currentConfig: Config;
  onComplete: (newConfig: Config) => void;
  onCancel: () => void;
}

export const ConfigDialog: React.FC<ConfigDialogProps> = ({
  currentConfig,
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<'select_provider' | 'enter_api_key'>('select_provider');
  const [selectedProviderId, setSelectedProviderId] = useState(currentConfig.provider);
  const [selectedModelId, setSelectedModelId] = useState(currentConfig.model);

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: \`\${provider.name} - \${model.name}\`,
      value: \`\${provider.id}:::\${model.id}\`,
    })),
  );

  const currentProvider = getProvider(currentConfig.provider);

  // Provider selection step
  if (step === 'select_provider') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          Change Configuration
        </Text>
        <Text dimColor>Current: {currentProvider?.name} / {currentConfig.model}</Text>
        <Text dimColor>Select a new provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setStep('enter_api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  // API key entry step
  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green" bold>
        Confirm Configuration
      </Text>
      <Text dimColor>
        Provider: {provider?.name} / {selectedModelId}
      </Text>
      <Text>{hasResolvedAuth ? 'Optional API key (leave empty to keep resolved auth):' : 'Enter your API key:'}</Text>
      <PasswordInput
        placeholder={\`Paste your \${provider?.apiKeyEnvVar || 'API'} key\`}
        onSubmit={(value) => {
          const finalApiKey = value.trim().length > 0 ? value.trim() : currentConfig.apiKey;
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(finalApiKey?.trim() ? { apiKey: finalApiKey.trim() } : {}),
          };
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};
\`\`\`

## Step 5: Upgrade \`src/tools/edit-file.ts\`

The final version adds a 5-strategy fuzzy match cascade (exact, line-trimmed, indent-flexible, whitespace-normalized, trimmed-boundary) and returns a unified diff on success. It also enforces the read-before-edit staleness guard via \`file-time.ts\`.

See \`src/tools/edit-file.ts\` in the source tree for the complete implementation. The key additions over the Part 5 version:

- Import \`assertReadBefore\` and \`recordRead\` from \`../utils/file-time.js\`
- \`findWithCascade()\` tries 5 match strategies in order
- \`computeUnifiedDiff()\` generates a diff for the tool result
- Re-reads the file after write and records the read time

## Step 6: Upgrade \`src/tools/read-file.ts\`

The final version adds:
- \`findSimilarPaths()\` — suggests similar paths when a file isn't found
- \`recordRead()\` — tracks reads for the staleness guard

See \`src/tools/read-file.ts\` in the source tree for the complete implementation.

## Step 7: Upgrade \`src/tools/search-files.ts\`

The final version adds ripgrep (\`rg\`) support when available, falling back to the JS implementation. Ripgrep results are sorted by modification time (most recently changed files first).

See \`src/tools/search-files.ts\` in the source tree for the complete implementation.

## Step 8: Upgrade \`src/agentic-loop.ts\`

The final version adds extensive error recovery, logging, and robustness improvements:

**AbortSignal Handling:**
- \`setMaxListeners(0, abortSignal)\` — Prevents MaxListenersExceededWarning on long runs
- \`sleepWithAbort()\` — Cancellable delays with proper cleanup
- \`emitAbortAndFinish()\` — Clean abort handling

**Tool Call Sanitization (Critical for Reliability):**
- \`appendStreamingFragment()\` — Handles overlapping stream deltas correctly
- \`collapseRepeatedString()\` — Fixes models that repeat tool names
- \`normalizeToolName()\` — Matches tool names even when malformed
- \`extractFirstCompleteJsonValue()\` — Extracts valid JSON from garbage
- \`repairInvalidEscapes()\` — Fixes invalid JSON escapes like \`\\|\` from grep regex
- \`sanitizeToolCall()\` / \`sanitizeMessagesForRetry()\` — Comprehensive repair of malformed tool calls

**Retry & Recovery Logic:**
- \`repairRetryCount\` — Retries with sanitized messages on 400 errors
- \`contextRetryCount\` — Forces compaction on context-too-long errors
- \`retriggerCount\` / \`MAX_RETRIGGERS\` — Retries when AI stops after tool calls
- \`truncateRetryCount\` / \`MAX_TRUNCATE_RETRIES\` — Removes messages on persistent 400s
- Exponential backoff: \`Math.min(2 ** iterationCount * 1000, 30_000)\`

**Provider-Specific Fixes:**
- Preserves Gemini's \`extra_content\` field (thought_signature) to prevent 400 errors

**System Prompt Refresh:**
- Refreshes system prompt each iteration to pick up new skills

**Comprehensive Logging:**
- API request/response logging with token counts
- Tool call validation warnings
- Debug logging for message payloads

See \`src/agentic-loop.ts\` in the source tree for the complete 500+ line implementation.

## Step 9: Upgrade \`src/config.tsx\`

The final version adds the \`InitComponent\` for the interactive \`protoagent init\` wizard, plus helper functions for config path resolution:

- \`InitComponent\` — Interactive React component for creating runtime configs
- \`getInitConfigPath()\` — Returns path for project or user config
- \`writeInitConfig()\` — Creates initial protoagent.jsonc with empty providers/mcp structure
- Helper functions: \`getConfigDirectory()\`, \`getUserRuntimeConfigPath()\`, \`getProjectRuntimeConfigPath()\`
- Enhanced \`resolveApiKey()\` with better precedence chain and custom headers support

Key additions to the \`InitComponent\`:
- Two-step wizard: select target (project vs user) → confirm/create config
- Checks if config already exists and prompts for overwrite
- Shows colored success/exists messages after creation

See \`src/config.tsx\` in the source tree for the complete implementation.

## Step 10: Upgrade \`src/mcp.ts\`

The final version adds logging integration and stderr handling:

- **JSDoc header** — Comprehensive documentation of MCP configuration format
- **Logger integration** — Imports \`logger\` from utils
- **Stderr piping** — Stdio server stderr is captured and logged via \`logger.debug()\` instead of bleeding into the terminal UI
- **Structured sections** — Code organized with \`// ─── Section ───\` dividers
- **Better type organization** — Explicit \`StdioServerConfig\` and \`HttpServerConfig\` type extracts

The stderr handling is particularly important: MCP servers often log to stderr, which would corrupt the Ink UI. By piping it to the logger, the UI stays clean while debug logs capture server output.

See \`src/mcp.ts\` in the source tree for the complete implementation.

## Step 11: Final \`src/App.tsx\`

The final App brings together everything from Parts 1-12 plus:

- **Archived vs live message rendering** — archived messages use \`useMemo\` for performance, live messages re-render during streaming
- **Static items as React nodes** — \`StaticItem\` stores \`node: React.ReactNode\` instead of \`text: string\`; all \`addStatic()\` calls use \`<Text>\` components with Ink props (e.g., \`<Text color="green">\`, \`<Text bold>\`) instead of ANSI escape codes
- **Grouped tool rendering** — tool calls and results are consolidated using \`ConsolidatedToolMessage\`
- **Collapsible output** — system prompts and tool results use \`CollapsibleBox\`
- **Left-bar indicators** — \`LeftBar\` replaces Box borders for callout-style content; the bar stretches to match content height via \`measureElement\` with no extra line overhead
- **Formatted text** — assistant messages use \`FormattedMessage\` with markdown/table support
- **Slash commands** — \`/clear\`, \`/collapse\`, \`/expand\`, \`/help\`, \`/quit\`
- **Spinner with active tool** — shows which tool is currently executing
- **Debounced text rendering** — 50ms batching for streaming text deltas
- **Terminal resize handling** — re-renders input on window resize
- **Quitting with session save** — displays the resume command before exit

See \`src/App.tsx\` in the source tree for the complete 1061-line implementation.

## Step 12: Final \`src/cli.tsx\`

\`\`\`typescript
// src/cli.tsx

/**
 * CLI entry point for ProtoAgent.
 *
 * Parses command-line flags and launches either the main chat UI
 * or the configuration wizard.
 */

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, InitComponent, readConfig, writeConfig, writeInitConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: TRACE, DEBUG, INFO, WARN, ERROR', 'DEBUG')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    render(
      <App
        dangerouslySkipPermissions={options.dangerouslySkipPermissions || false}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });

program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(\`\${selected.provider} / \${selected.model}\`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program
  .command('init')
  .description('Create a project-local or shared ProtoAgent runtime config')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--force', 'Overwrite an existing target file')
  .action((options) => {
    if (options.project || options.user) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }

      const result = writeInitConfig(options.project ? 'project' : 'user', process.cwd(), {
        overwrite: Boolean(options.force),
      });
      const message = result.status === 'created'
        ? 'Created ProtoAgent config:'
        : result.status === 'overwritten'
          ? 'Overwrote ProtoAgent config:'
          : 'ProtoAgent config already exists:';
      console.log(message);
      console.log(result.path);
      return;
    }

    render(<InitComponent />);
  });

program.parse(process.argv);
\`\`\`

## Step 13: Logging Throughout the Codebase

With the logger utility in place, all core modules now include observability:

- **agentic-loop.ts** — Logs API requests/responses, tool calls, errors, and retry attempts
- **sessions.ts** — Logs session save operations
- **skills.ts** — Logs skill loading, collisions, and invalid skills
- **sub-agent.ts** — Logs sub-agent lifecycle and tool execution
- **mcp.ts** — Logs MCP server stderr output
- **bash.ts** — Logs command execution

Rather than showing every logging addition (they're repetitive \`logger.debug()\` and \`logger.info()\` calls), the key is that the logger provides a consistent way to trace execution across the entire application.

## Verification

\`\`\`bash
npm run dev -- --log-level debug
\`\`\`

You should see:
- Richer output rendering: code blocks and tables with a left-bar indicator, no box borders
- Grouped tool activity: tool calls and results shown together with a left-bar
- Collapsible long content: system prompt collapsed by default
- Slash commands: \`/help\`, \`/clear\`, \`/expand\`, \`/collapse\`, \`/quit\`
- Debug log file path displayed at startup
- Spinner showing which tool is currently executing
- Session save on quit with resume command

## Differences from Final Source

The part-13 checkpoint is functionally complete, but the live source at \`/src\` has evolved with additional polish. Here are the differences and why they're not in the tutorial:

### Comment Style Improvements
The live source uses comprehensive JSDoc headers on nearly every file:

\`\`\`typescript
/**
 * Tool registry — collects all tool definitions and provides a dispatcher.
 *
 * Each tool file exports:
 *  - A tool definition (OpenAI function-calling JSON schema)
 *  - A handler function (args) => Promise<string>
 *
 * This file wires them together into a single \`tools\` array and
 * a \`handleToolCall(name, args)\` dispatcher.
 */
\`\`\`

**Why not in tutorial:** These are repetitive and don't add functionality. The tutorial focuses on code that teaches concepts, not documentation boilerplate.

### Logger Integration
The live source adds \`logger\` imports and debug calls throughout:
- \`tools/bash.ts\` — logs command execution
- \`tools/index.ts\` — logs tool registration
- \`utils/approval.ts\` — logs approval decisions
- \`utils/compactor.ts\` — logs compaction events

**Why not in tutorial:** The tutorial covers the logger utility in Step 1 and mentions it in the "Logging Throughout" section. Adding every \`logger.debug()\` call would be repetitive and clutter the learning material.

### Model Catalog Updates
\`providers.ts\` in the live source has:
- Updated pricing and context windows (models change frequently)
- New models: gpt-5.4-pro, gpt-5.2, gpt-5-nano
- \`pricingPerMillionCached\` field for prompt caching
- Runtime config merging via \`getRuntimeConfig()\`

**Why not in tutorial:** Model specs change frequently. The tutorial provides a working baseline; the live source stays current with actual provider offerings.

### Minor Code Cleanups
- \`App.tsx\` — incremental line-flushing for streaming text: complete lines are flushed to \`<Static>\` immediately during streaming, leaving only the incomplete final line in the dynamic frame; prevents unbounded growth and enables real-time scrollback copying
- \`sub-agent.ts\` — interface ordering, JSDoc header
- \`system-prompt.ts\` — enhanced guidelines section (SUBAGENT STRATEGY), config path display; now encourages tasteful use of **bold** and *italic* instead of prohibiting it
- \`write-file.ts\` — records read after write to prevent staleness guard false positives
- \`compactor.ts\` — protected skill message handling
- \`cli.tsx\` — shebang, inline comments

**Why not in tutorial:** These are micro-optimizations and stylistic choices that don't change behavior significantly enough to warrant tutorial steps.

### Functional Equivalence
Despite these differences, the part-13 checkpoint is **fully functional**. The live source is essentially the same code with:
1. More documentation comments
2. Additional debug logging
3. Updated model pricing
4. Minor edge-case fixes

You can use the part-13 checkpoint as a working foundation and evolve it independently, or sync with the live source for the latest polish.

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-13\`.

This is the final checkpoint. At this point your staged rebuild matches the complete ProtoAgent application.

## Core takeaway

Polish is not just cosmetics. It is the layer that makes the tool loop readable, debuggable, and survivable over a long session. The separation of archived and live messages, the grouped tool rendering, the formatted output — these are what turn a working agent loop into a tool you actually want to use.
`,
  },
  {
    path: "docs/build-your-own/part-2.md",
    content: `# Part 2: AI Integration

This is the part where the CLI stops being a terminal shell and starts talking to a model. By the end, your app will stream responses from OpenAI in real time.

To keep things simple and remove abstractions, we're using the OpenAI SDK directly. We'll be supporting other providers such as [Google's Gemini](https://ai.google.dev/gemini-api/docs/openai) and [Anthropic's Claude](https://platform.claude.com/docs/en/api/openai-sdk) models using their OpenAI SDK compatibility capabilities. 

Your target snapshot is \`protoagent-build-your-own-checkpoints/part-2\`.

## What you are building

Starting from the Part 1 shell, you are adding:

- The OpenAI SDK for model calls
- Environment-based API key loading via \`.env\` file and \`dotenv\` (temporary; Part 3 replaces this with config persistence)
- A typed \`Message\` structure (\`role\` + \`content\`)
- Streaming assistant output in the terminal UI
- Basic error handling around model calls

This is still simple — no provider abstraction, no persisted config. That comes in Part 3.

## Files to change

| File | Change |
|------|--------|
| \`package.json\` | Add \`openai\` and \`dotenv\` dependencies |
| \`src/App.tsx\` | Replace string messages with typed messages, add OpenAI streaming |

\`src/cli.tsx\` and \`tsconfig.json\` stay the same as Part 1.

## Step 1: Update \`package.json\`

Add \`openai\` and \`dotenv\` to dependencies:

\`\`\`json
{
  "name": "protoagent",
  "version": "0.0.1",
  "description": "A simple coding agent CLI.",
  "bin": "dist/cli.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "build:watch": "tsc --watch"
  },
  "files": [
    "dist"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "commander": "^14.0.1",
    "dotenv": "^16.5.0",
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
    "openai": "^5.23.1",
    "react": "^19.1.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2"
  }
}
\`\`\`

## Step 2: Create a \`.env\` file

Create a \`.env\` file in the project root (and add it to \`.gitignore\`):

\`\`\`bash
OPENAI_API_KEY=your_key_here
\`\`\`

## Step 3: Rewrite \`src/App.tsx\`

Replace the Part 1 App with a version that talks to OpenAI. The key changes:

1. Import \`openai\` and \`dotenv/config\`
2. Replace \`string[]\` messages with typed \`Message[]\`
3. Initialize with a system message
4. Stream responses using \`openai.chat.completions.create({ stream: true })\`
5. Update the assistant message incrementally as chunks arrive

\`\`\`tsx
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import 'dotenv/config';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AppProps {
  options?: Record<string, any>;
}

export const App: React.FC<AppProps> = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
  ]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputText('');
    setInputKey((prev) => prev + 1);
    setLoading(true);

    try {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: updatedMessages,
        stream: true,
      });

      // Create an empty assistant message and stream into it
      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages((prev) => [...prev, assistantMessage]);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        assistantMessage.content += delta;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...assistantMessage };
          return updated;
        });
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: \`Error: \${err.message}\` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  // Filter out system messages for display
  const visibleMessages = messages.filter((msg) => msg.role !== 'system');

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      <Text dimColor italic>A simple, hackable coding agent CLI.</Text>
      <Text> </Text>

      {/* Message area */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} flexDirection="column">
            {msg.role === 'user' ? (
              <Text>
                <Text color="green" bold>{'> '}</Text>
                <Text>{msg.content}</Text>
              </Text>
            ) : (
              <Text>{msg.content}</Text>
            )}
          </Box>
        ))}
        {loading && visibleMessages[visibleMessages.length - 1]?.role === 'user' && (
          <Text dimColor>Agent is thinking...</Text>
        )}
      </Box>

      {/* Input */}
      <Box borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>{'> '}</Text>
        <TextInput
          key={inputKey}
          defaultValue={inputText}
          onChange={setInputText}
          placeholder="Type your message..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
\`\`\`

The streaming loop is the important part. Instead of waiting for the full response, we create an empty assistant message immediately and append each text chunk as it arrives. This makes the UI feel responsive even on long answers.

## Verification

Set your API key and launch:

\`\`\`bash
npm install
npm run dev
\`\`\`

Ask something simple. You should see:

- Your prompt appears in green
- "Agent is thinking..." shows briefly
- The assistant response streams in character by character
- Errors show inline if the API key is wrong or the call fails

\`\`\`
 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


A simple, hackable coding agent CLI.

> hi
Hello! How can I assist you today?
> how are you?
I’m just a program, so I don’t have feelings, but I’m here and ready to help you! What do you need assistance
with today?
╭─────────────────────────────────────────────────────────────╮
│ > Type your message...                                      │
╰─────────────────────────────────────────────────────────────╯
\`\`\`

## Snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-2\`.

## Pitfalls

- Forgetting \`import 'dotenv/config'\` and getting \`undefined\` API key errors
- Recreating the assistant message on every chunk instead of updating the last one
- Rendering the system message in the transcript (filter it out)
- Using a non-streaming request — you lose the real-time feel

## What comes next

Part 3 replaces the hardcoded OpenAI client with a multi-provider configuration system. You'll be able to switch between OpenAI, Anthropic Claude, Google Gemini, and more — all persisted to disk.
`,
  },
  {
    path: "docs/build-your-own/part-3.md",
    content: `# Part 3: Configuration Management

Part 2 hardcoded everything — OpenAI, one model, one env var. That works for a demo but not for a real tool. This part introduces persisted configuration: a provider/model catalog, a config wizard, and API key resolution that works across providers.

In this part, we're going to make it possible to configure \`protoagent\`, mainly with the introduction of \`protoagent.jsonc\` configuration file. It will allow you to specify LLM providers and other configurations in the future, which will be automatically used by \`protoagent\`. \`protoagent\` will look for this \`protoagent.jsonc\` file either within the directory/project it is being run, or at configurations in the user directory. The paths will be one of the following:  
1. \`<process.cwd()>/.protoagent/protoagent.jsonc\` (project config)
2. \`~/.config/protoagent/protoagent.jsonc\` (user config)

Project config takes precedence, allowing per-project overrides of user defaults.

Your target snapshot is \`protoagent-build-your-own-checkpoints/part-3\`.

## What you are building

- A provider/model catalog with pricing metadata (\`src/providers.ts\`)
- Persistent config storage in \`protoagent.jsonc\` (\`src/config.tsx\`)
- A \`protoagent configure\` subcommand for the setup wizard
- Inline first-time setup in the main app
- API key resolution: active \`protoagent.jsonc\` → environment variable → provider default

**Note on \`configure\` vs \`init\`:** Part 3 focuses on the \`configure\` command (interactive setup wizard that modifies the active config). Later parts introduce the \`init\` command, which creates an initial empty config template. You can use them together: \`init\` creates the file structure, then \`configure\` sets the active provider/model.

## Files to create or change

| File | Action |
|------|--------|
| \`src/providers.ts\` | **Create** — provider/model registry |
| \`src/config.tsx\` | **Create** — config persistence + setup wizard |
| \`src/cli.tsx\` | **Modify** — add \`configure\` subcommand |
| \`src/App.tsx\` | **Modify** — load config, build client, inline setup |
| \`package.json\` | **Modify** — add \`jsonc-parser\` dependency |

## Step 1: Update \`package.json\`

Add \`jsonc-parser\` (used later for runtime config, but good to include now):

\`\`\`json
{
  "name": "protoagent",
  "version": "0.0.1",
  "description": "A simple coding agent CLI.",
  "bin": "dist/cli.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "build:watch": "tsc --watch"
  },
  "files": [
    "dist"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "commander": "^14.0.1",
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
    "jsonc-parser": "^3.3.1",
    "openai": "^5.23.1",
    "react": "^19.1.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2"
  }
}
\`\`\`

Note: we dropped \`dotenv\` — API keys are now resolved through the config system or environment variables directly.

## Step 2: Create \`src/providers.ts\`

Create the file:

\`\`\`bash
touch src/providers.ts
\`\`\`

This file defines the built-in provider catalog. Every supported provider, model, pricing, and connection details live here.

\`\`\`typescript
export interface ModelDetails {
  id: string;
  name: string;
  contextWindow: number;
  pricingPerMillionInput: number;
  pricingPerMillionOutput: number;
  defaultParams?: Record<string, unknown>;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models: ModelDetails[];
}

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 1_048_576, pricingPerMillionInput: 2.50, pricingPerMillionOutput: 15.00 },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', contextWindow: 1_000_000, pricingPerMillionInput: 0.25, pricingPerMillionOutput: 2.00 },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1_048_576, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 8.00 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 1_000_000, pricingPerMillionInput: 5.0, pricingPerMillionOutput: 25.0 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 1_000_000, pricingPerMillionInput: 3.0, pricingPerMillionOutput: 15.0 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, pricingPerMillionInput: 1.0, pricingPerMillionOutput: 5.0 },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 0.50, pricingPerMillionOutput: 3.0 },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 12.0 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000, pricingPerMillionInput: 0.30, pricingPerMillionOutput: 2.5 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000, pricingPerMillionInput: 1.25, pricingPerMillionOutput: 10.0 },
    ],
  }
];

export function getAllProviders(): ModelProvider[] {
  return BUILTIN_PROVIDERS;
}

export function getProvider(providerId: string): ModelProvider | undefined {
  return getAllProviders().find((provider) => provider.id === providerId);
}

export function getModelDetails(providerId: string, modelId: string): ModelDetails | undefined {
  return getProvider(providerId)?.models.find((model) => model.id === modelId);
}

export function getModelPricing(providerId: string, modelId: string) {
  const details = getModelDetails(providerId, modelId);
  if (!details) return undefined;
  return {
    inputPerToken: details.pricingPerMillionInput / 1_000_000,
    outputPerToken: details.pricingPerMillionOutput / 1_000_000,
    contextWindow: details.contextWindow ?? 128_000,
  };
}

export function getRequestDefaultParams(providerId: string, modelId: string): Record<string, unknown> {
  const provider = getProvider(providerId);
  const model = getModelDetails(providerId, modelId);
  return {
    ...(provider?.defaultParams || {}),
    ...(model?.defaultParams || {}),
  };
}
\`\`\`

Note: \`getAllProviders()\` just returns the built-in list for now. In Part 11 (MCP/Runtime Config), we add runtime config loading from the active \`protoagent.jsonc\` so users can add custom providers via that file.

## Step 3: Create \`src/config.tsx\`

Create the file:

\`\`\`bash
touch src/config.tsx
\`\`\`

This file handles config persistence and the setup wizard. The active provider/model/API key selection is stored in \`protoagent.jsonc\`, using the project file if present and otherwise the shared user file. Configuration is read from and written to \`protoagent.jsonc\` using \`jsonc-parser\`.

\`\`\`tsx
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput, PasswordInput } from '@inkjs/ui';
import { parse } from 'jsonc-parser';
import { getAllProviders, getProvider } from './providers.js';

export interface Config {
  provider: string;
  model: string;
  apiKey?: string;
}

export type InitConfigTarget = 'project' | 'user';
export type InitConfigWriteStatus = 'created' | 'exists' | 'overwritten';

// These constants define Unix file permissions in octal notation.
// They ensure config directories and files are only accessible by the owner,
// protecting sensitive data like API keys from other users on the system.
const CONFIG_DIR_MODE = 0o700;  // Owner: rwx, Group: ---, Others: ---
const CONFIG_FILE_MODE = 0o600; // Owner: rw-, Group: ---, Others: ---

// Applies restrictive Unix permissions to a file or directory.
// Skips on Windows since Unix permission concepts don't apply there.
// Uses chmodSync to enforce the permission mode immediately.
function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

// Resolves the API key for a provider using a precedence chain:
// 1. Direct API key from config
// 2. Environment variable specific to the provider (e.g., OPENAI_API_KEY)
// 3. Generic PROTOAGENT_API_KEY environment variable
// 4. Default API key from provider definition
// 5. 'none' if provider uses header-based auth instead of API key
// Returns null if no API key could be resolved.
export function resolveApiKey(config: Pick<Config, 'provider' | 'apiKey'>): string | null {
  const directApiKey = config.apiKey?.trim();
  if (directApiKey) return directApiKey;

  const provider = getProvider(config.provider);

  if (provider?.apiKeyEnvVar) {
    const envValue = process.env[provider.apiKeyEnvVar]?.trim();
    if (envValue) return envValue;
  }

  const envOverride = process.env.PROTOAGENT_API_KEY?.trim();
  if (envOverride) return envOverride;

  const providerApiKey = provider?.apiKey?.trim();
  if (providerApiKey) return providerApiKey;

  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    return 'none';
  }

  return null;
}

export const getUserRuntimeConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.config', 'protoagent');
};

export const getUserRuntimeConfigPath = () => {
  return path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc');
};

export const getProjectRuntimeConfigDirectory = (cwd = process.cwd()) => {
  return path.join(cwd, '.protoagent');
};

export const getProjectRuntimeConfigPath = (cwd = process.cwd()) => {
  return path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc');
};

export const getInitConfigPath = (target: InitConfigTarget, cwd = process.cwd()) => {
  return target === 'project' ? getProjectRuntimeConfigPath(cwd) : getUserRuntimeConfigPath();
};

/** Returns the active config path: project if it exists, otherwise user. */
export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) return projectPath;
  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) return userPath;
  return null;
}

interface RuntimeProviderConfig {
  apiKey?: string;
  models?: Record<string, unknown>;
}

interface RuntimeConfigFile {
  providers?: Record<string, RuntimeProviderConfig>;
  mcp?: { servers?: Record<string, unknown> };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Reads and parses protoagent.jsonc (with comments support), returns null on error/missing file.
function readRuntimeConfigFileSync(configPath: string): RuntimeConfigFile | null {
  if (!existsSync(configPath)) return null;
  try {
    const content = readFileSync(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || !isPlainObject(parsed)) return null;
    return parsed as RuntimeConfigFile;
  } catch {
    return null;
  }
}

// Extracts the first configured provider/model from runtime config (returns null if none found).
function getConfiguredProviderAndModel(runtimeConfig: RuntimeConfigFile): Config | null {
  for (const [providerId, providerConfig] of Object.entries(runtimeConfig.providers || {})) {
    const modelId = Object.keys(providerConfig.models || {})[0];
    if (!modelId) continue;
    const apiKey = typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.trim().length > 0
      ? providerConfig.apiKey.trim()
      : undefined;
    return { provider: providerId, model: modelId, ...(apiKey ? { apiKey } : {}) };
  }
  return null;
}

// Creates config directory with secure permissions if it doesn't exist.
function ensureDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  hardenPermissions(targetDir, CONFIG_DIR_MODE);
}

function writeRuntimeConfigFile(configPath: string, runtimeConfig: RuntimeConfigFile): void {
  ensureDirectory(path.dirname(configPath));
  writeFileSync(configPath, \`\${JSON.stringify(runtimeConfig, null, 2)}\\n\`, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
}

// Updates or inserts a provider/model selection into runtime config, preserving existing settings.
function upsertSelectedConfig(runtimeConfig: RuntimeConfigFile, config: Config): RuntimeConfigFile {
  const existingProviders = runtimeConfig.providers || {};
  const currentProvider = existingProviders[config.provider] || {};
  const currentModels = currentProvider.models || {};
  const selectedModelConfig = currentModels[config.model] || {};

  const nextProvider: RuntimeProviderConfig = {
    ...currentProvider,
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}),
    models: Object.fromEntries([
      [config.model, selectedModelConfig],
      ...Object.entries(currentModels).filter(([modelId]) => modelId !== config.model),
    ]),
  };

  if (!config.apiKey?.trim()) {
    delete nextProvider.apiKey;
  }

  return {
    ...runtimeConfig,
    providers: Object.fromEntries([
      [config.provider, nextProvider],
      ...Object.entries(existingProviders).filter(([providerId]) => providerId !== config.provider),
    ]),
  };
}

export const readConfig = (target: InitConfigTarget | 'active' = 'active', cwd = process.cwd()): Config | null => {
  const configPath = target === 'active' ? getActiveRuntimeConfigPath() : getInitConfigPath(target, cwd);
  if (!configPath) return null;
  const runtimeConfig = readRuntimeConfigFileSync(configPath);
  if (!runtimeConfig) return null;
  return getConfiguredProviderAndModel(runtimeConfig);
};

export const writeConfig = (config: Config, target: InitConfigTarget = 'user', cwd = process.cwd()) => {
  const configPath = getInitConfigPath(target, cwd);
  const runtimeConfig = readRuntimeConfigFileSync(configPath) || { providers: {}, mcp: { servers: {} } };
  const nextRuntimeConfig = upsertSelectedConfig(runtimeConfig, config);
  writeRuntimeConfigFile(configPath, nextRuntimeConfig);
  return configPath;
};

// React component for Configure Wizard (standalone subcommand)
// Guides users through selecting a provider/model and saving it to config
// Steps:
// 1. Choose project vs user config
// 2. If existing config found, show it and ask to reset or keep
// 3. If resetting or no existing config, show provider/model selection
// 4. After selection, prompt for API key (if needed) and save config
export const ConfigureComponent = () => {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<InitConfigTarget>('user');
  const [existingConfig, setExistingConfig] = useState<Config | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [configWritten, setConfigWritten] = useState(false);

  // Step 0: Choose project vs user config
  if (step === 0) {
    return (
      <Box flexDirection="column">
        <Text>Choose where to configure ProtoAgent:</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: \`Project config — \${getProjectRuntimeConfigPath()}\`, value: 'project' },
              { label: \`Shared user config — \${getUserRuntimeConfigPath()}\`, value: 'user' },
            ]}
            onChange={(value) => {
              setTarget(value as InitConfigTarget);
              const existing = readConfig(value as InitConfigTarget);
              setExistingConfig(existing);
              setStep(existing ? 1 : 2);
            }}
          />
        </Box>
      </Box>
    );
  }

  // Step 1: Existing config found — ask to reset
  if (step === 1 && existingConfig) {
    const provider = getProvider(existingConfig.provider);
    return (
      <Box flexDirection="column">
        <Text>Existing configuration found:</Text>
        <Text>  Provider: {provider?.name || existingConfig.provider}</Text>
        <Text>  Model: {existingConfig.model}</Text>
        <Text> </Text>
        <Text>Do you want to reset and configure a new one? (y/n)</Text>
        <TextInput
          onSubmit={(answer: string) => {
            if (answer.toLowerCase() === 'y') {
              setStep(2);
            } else {
              setConfigWritten(false);
              setStep(4);
            }
          }}
        />
      </Box>
    );
  }

  // Step 2: Model selection
  if (step === 2) {
    const items = getAllProviders().flatMap((provider) =>
      provider.models.map((model) => ({
        label: \`\${provider.name} - \${model.name}\`,
        value: \`\${provider.id}:::\${model.id}\`,
      })),
    );

    return (
      <Box flexDirection="column">
        <Text>Select an AI Model:</Text>
        <Select
          options={items}
          onChange={(value: string) => {
            const [providerId, modelId] = value.split(':::');
            setSelectedProviderId(providerId);
            setSelectedModelId(modelId);
            setStep(3);
          }}
        />
      </Box>
    );
  }

  // Step 3: API key input
  if (step === 3) {
    const provider = getProvider(selectedProviderId);
    const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

    return (
      <Box flexDirection="column">
        <Text>{hasResolvedAuth ? 'Optional API Key' : 'Enter API Key'} for {provider?.name || selectedProviderId}:</Text>
        <PasswordInput
          placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : \`Enter your \${provider?.apiKeyEnvVar || 'API'} key\`}
          onSubmit={(value: string) => {
            if (value.trim().length === 0 && !hasResolvedAuth) return;
            const newConfig: Config = {
              provider: selectedProviderId,
              model: selectedModelId,
              ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
            };
            writeConfig(newConfig, target);
            setConfigWritten(true);
            setStep(4);
          }}
        />
      </Box>
    );
  }

  // Step 4: Done
  return (
    <Box flexDirection="column">
      {configWritten ? (
        <Text color="green">Configuration saved successfully!</Text>
      ) : (
        <Text color="yellow">Configuration not changed.</Text>
      )}
      <Text>You can now run ProtoAgent.</Text>
    </Box>
  );
};
\`\`\`

## Step 4: Update \`src/cli.tsx\`

Add the \`configure\` subcommand and pass options to App:

\`\`\`tsx
#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, readConfig, writeConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .action(() => {
    render(<App />);
  });

program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(\`\${selected.provider} / \${selected.model}\`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program.parse(process.argv);
\`\`\`

## Step 5: Rewrite \`src/App.tsx\`

Now the app loads config on startup, builds an OpenAI client from provider metadata, shows inline setup if no config exists, and streams responses using the configured model.

\`\`\`tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getProvider } from './providers.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? \`Missing API key for \${providerName}. Set it in config or export \${envVar}.\`
        : \`Missing API key for \${providerName}.\`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };

  const baseURL = provider?.baseURL;
  if (baseURL) clientOptions.baseURL = baseURL;

  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
  }

  return new OpenAI(clientOptions);
}

// If protoagent isn't already set up with LLM provider/model, guide the user through an interactive setup flow
const InlineSetup: React.FC<{ onComplete: (config: Config) => void }> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: \`\${provider.name} - \${model.name}\`,
      value: \`\${provider.id}:::\${model.id}\`,
    })),
  );

  if (setupStep === 'provider') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>First-time setup</Text>
        <Text dimColor>Select a provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setSetupStep('api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>Selected: {provider?.name} / {selectedModelId}</Text>
      <Text>{hasResolvedAuth ? 'Optional API key:' : 'Enter your API key:'}</Text>
      <PasswordInput
        placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : \`Paste your \${provider?.apiKeyEnvVar || 'API'} key\`}
        onSubmit={(value) => {
          if (value.trim().length === 0 && !hasResolvedAuth) return;
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
          };
          writeConfig(newConfig, 'user');
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

// Main Protoagent app
export const App: React.FC = () => {
  const { exit } = useApp();
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [client, setClient] = useState<OpenAI | null>(null);

  const initializeWithConfig = useCallback((loadedConfig: Config) => {
    setConfig(loadedConfig);
    try {
      const newClient = buildClient(loadedConfig);
      setClient(newClient);
      setMessages([
        { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
      ]);
      setNeedsSetup(false);
      setInitialized(true);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // When the app loads, read the configuration file
  useEffect(() => {
    const loadedConfig = readConfig();
    if (!loadedConfig) {
      setNeedsSetup(true);
      return;
    }
    initializeWithConfig(loadedConfig);
  }, [initializeWithConfig]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !client || !config) return;

    setInputText('');
    setInputKey((prev) => prev + 1);
    setLoading(true);
    setError(null);

    const userMessage: Message = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: updatedMessages,
        stream: true,
      });

      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages((prev) => [...prev, assistantMessage]);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        assistantMessage.content += delta;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...assistantMessage };
          return updated;
        });
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: \`Error: \${err.message}\` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, client, config, messages]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') exit();
  });

  const visibleMessages = messages.filter((msg) => msg.role !== 'system');
  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>Model: {providerInfo?.name || config.provider} / {config.model}</Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {needsSetup && (
        <InlineSetup onComplete={initializeWithConfig} />
      )}

      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} flexDirection="column">
            {msg.role === 'user' ? (
              <Text>
                <Text color="green" bold>{'> '}</Text>
                <Text>{msg.content}</Text>
              </Text>
            ) : (
              <Text>{msg.content}</Text>
            )}
          </Box>
        ))}
        {loading && visibleMessages[visibleMessages.length - 1]?.role === 'user' && (
          <Text dimColor>Agent is thinking...</Text>
        )}
      </Box>

      {initialized && (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green" bold>{'> '}</Text>
          <TextInput
            key={inputKey}
            defaultValue={inputText}
            onChange={setInputText}
            placeholder="Type your message..."
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  );
};
\`\`\`

## Verification

Build and run the configure wizard:

\`\`\`bash
npm install
npm run build
node dist/cli.js configure
\`\`\`

You should see a provider/model selector, then an API key prompt. After completing setup, run:

\`\`\`bash
npm run dev
\`\`\`

The app should show your configured model name and stream responses. Your credentials are now stored in your \`protoagent.jsonc\` file. In \`Part 11\`, we will make it possible for the \`protoagent.jsonc\` to load your API keys from environment variables instead of having it in the file for a more secure setup.

## Snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-3\`.

## What comes next

Part 4 introduces the agentic loop — the tool-use cycle where the model can call tools and the app executes them. This is where ProtoAgent stops being a chat wrapper and becomes an agent.
`,
  },
  {
    path: "docs/build-your-own/part-4.md",
    content: `# Part 4: The Agentic Loop

This is where ProtoAgent becomes an agent instead of a chatbot. Up to Part 3, the app could stream text from a model. Now you add the tool-use loop: the model can request tools, the runtime executes them, and the model continues reasoning with the results.

Your target snapshot is \`protoagent-build-your-own-checkpoints/part-4\`.

## What you are building

- A reusable \`runAgenticLoop()\` function that implements the standard tool-use cycle
- A tool registry with definitions and handlers
- Event-based communication from the loop to the UI
- One real built-in tool: \`read_file\`

## Files to create or change

| File | Action |
|------|--------|
| \`src/agentic-loop.ts\` | **Create** — the core agentic loop |
| \`src/tools/index.ts\` | **Create** — tool registry and dispatcher |
| \`src/tools/read-file.ts\` | **Create** — first tool: read files |
| \`src/App.tsx\` | **Modify** — switch from direct streaming to the agentic loop |

## Step 1: Create \`src/tools/read-file.ts\`

Create the file:

\`\`\`bash
mkdir -p src/tools && touch src/tools/read-file.ts
\`\`\`

The first tool. It reads files with line numbers, supports offset/limit for large files, and validates that paths stay within the working directory.

\`\`\`typescript
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

// Definitions of the read file tool as provided to the LLM
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
  // Resolve path relative to cwd and check it stays within the project
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, filePath);
  if (!resolved.startsWith(cwd)) {
    throw new Error(\`Path "\${filePath}" is outside the working directory.\`);
  }

  // Check file exists
  try {
    await fs.stat(resolved);
  } catch {
    return \`File not found: '\${filePath}'\`;
  }

  const start = Math.max(0, offset);
  const maxLines = Math.max(0, limit);
  const lines: string[] = [];
  let totalLines = 0;

  const stream = createReadStream(resolved, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lineReader) {
      if (totalLines >= start && lines.length < maxLines) {
        lines.push(line);
      }
      totalLines++;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  const end = Math.min(totalLines, start + lines.length);

  // Add line numbers (1-based) and truncate long lines
  const numbered = lines.map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, ' ');
    const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
    return \`\${lineNum} | \${truncated}\`;
  });

  const rangeLabel = lines.length === 0
    ? 'none'
    : \`\${Math.min(start + 1, totalLines)}-\${end}\`;
  const header = \`File: \${filePath} (\${totalLines} lines total, showing \${rangeLabel})\`;
  return \`\${header}\\n\${numbered.join('\\n')}\`;
}
\`\`\`

## Step 2: Create \`src/tools/index.ts\`

Create the file:

\`\`\`bash
touch src/tools/index.ts
\`\`\`

The tool registry collects all tool definitions and provides a dispatcher. At this stage there's only one tool, but the pattern scales to many.

\`\`\`typescript
import { readFileTool, readFile } from './read-file.js';

export interface ToolCallContext {
  sessionId?: string;
}

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
];

export function getAllTools() {
  return [...tools];
}

/**
 * Dispatch a tool call to the appropriate handler.
 */
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit);
      default:
        return \`Error: Unknown tool "\${toolName}"\`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return \`Error executing \${toolName}: \${msg}\`;
  }
}
\`\`\`

## Step 3: Create \`src/agentic-loop.ts\`

Create the file:

\`\`\`bash
touch src/agentic-loop.ts
\`\`\`

This is the heart of the agent runtime. The loop:

1. Sends the conversation to the LLM with tool definitions
2. If the response contains \`tool_calls\`: executes each tool, appends results, loops back to step 1
3. If the response is plain text: returns it to the caller

The loop communicates with the UI through events, never rendering directly.

\`\`\`typescript
import type OpenAI from 'openai';
import { getAllTools, handleToolCall } from './tools/index.js';

// ─── Types ───
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Type for tool calls included in the model's response, which the agentic loop will execute
// Exported for use in the UI layer to display ongoing tool calls and their results
export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

// Type for events emitted during the agentic loop, such as text deltas, tool calls, and errors
// Exported for use in the UI layer to update the interface in real-time as the agent processes
export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
  transient?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

export interface AgenticLoopOptions {
  maxIterations?: number;
  abortSignal?: AbortSignal;
  sessionId?: string;
}

// Run the agentic loop: send messages to the model, execute any tool calls,
// and continue until the model returns plain text.
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  // The onEvent callback allows the agentic loop to emit events that the UI can listen to for real-time updates (like streaming text or tool call status)
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;

  // The updatedMessages array will accumulate the conversation history, including tool call results, as we loop
  const updatedMessages: Message[] = [...messages];
  let iterationCount = 0;

  // The While loop is the core of the Agentic Loop.
  // We continue to request a new message from the LLM until it indicates it is 'done' with an empty message
  // Or, we continue until the user stops the agent
  // Or, we reach the max amount of iterations to avoid endless loops
  while (iterationCount < maxIterations) {
    // The abort signal allows the user to stop the agent from the UI
    if (abortSignal?.aborted) {
      onEvent({ type: 'done' });
      return updatedMessages;
    }

    iterationCount++;

    try {
      const allTools = getAllTools();

      // This is the API call to the LLM, passing the conversation history and available tools.
      // The model can respond with text, and/or indicate it wants to call a tool by including tool_calls in the response.
      const stream = await client.chat.completions.create({
        model,
        messages: updatedMessages,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
      }, {
        signal: abortSignal,
      });

      // Accumulate the streamed response
      const assistantMessage: any = {
        role: 'assistant',
        content: '',
        tool_calls: [],
      };
      let streamedContent = '';
      let hasToolCalls = false;

      // Iterate through all the chunks of the streamed LLM response
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Stream text content back to the UI
        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
        }

        // Accumulate tool calls by index
        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const idx = tc.index || 0;

            // Create a tool call entry at the correct index if it doesn't exist, then fill in details as they stream in
            if (!assistantMessage.tool_calls[idx]) {
              assistantMessage.tool_calls[idx] = {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) assistantMessage.tool_calls[idx].id = tc.id;
            if (tc.function?.name) {
              assistantMessage.tool_calls[idx].function.name += tc.function.name;
            }
            if (tc.function?.arguments) {
              assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Collapses "sparse" arrays by removing empty slots (undefined) or null values 
        // that can occur if streaming indexes arrive out of order or are skipped.
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        updatedMessages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          if (abortSignal?.aborted) {
            onEvent({ type: 'done' });
            return updatedMessages;
          }

          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' },
          });

          try {
            // This is where the tool is actually executed. 
            // The handleToolCall function looks up the tool by name and runs it with the provided arguments.
            const args = JSON.parse(argsStr);
            const result = await handleToolCall(name, args, { sessionId });

            // We add the tool result back into the conversation history as a
            // new message with role 'tool' so that the LLM can see the result of its 
            // tool call in the next iteration.
            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result },
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: \`Error: \${errMsg}\`,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg },
            });
          }
        }

        // Continue loop — let the model process tool results
        // This is the end of the if block for handling tool calls. 
        // After executing all tool calls and adding their results to the conversation history, 
        // we loop back and call the model again with the updated messages. 
        // The model can then respond with more text, more tool calls, or indicate it is done.
        continue;
      }

      // Plain text response — done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
      }

      onEvent({ type: 'done' });
      return updatedMessages;

    } catch (apiError: any) {
      if (abortSignal?.aborted) {
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      const errMsg = apiError?.message || 'Unknown API error';

      // Retry on rate limit
      if (apiError?.status === 429) {
        onEvent({ type: 'error', error: 'Rate limited. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      // Retry on server errors
      if (apiError?.status >= 500) {
        onEvent({ type: 'error', error: 'Server error. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Non-retryable error
      onEvent({ type: 'error', error: errMsg });
      onEvent({ type: 'done' });
      return updatedMessages;
    }
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}

/**
 * Initialize the conversation with a system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  return [{
    role: 'system',
    content: 'You are ProtoAgent, a helpful AI coding assistant. You have access to tools that let you read files in the current project. Use the read_file tool to examine code when the user asks about files.',
  } as Message];
}
\`\`\`

The key detail in the streaming loop: tool calls arrive as fragments indexed by \`tc.index\`. You have to accumulate the \`id\`, \`name\`, and \`arguments\` separately for each index position. Only after the stream ends do you have the complete tool call objects.

## Step 4: Rewrite \`src/App.tsx\`

Replace the direct OpenAI streaming with the agentic loop. The UI now reacts to events from the loop.

\`\`\`tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getProvider } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? \`Missing API key for \${providerName}. Set it in config or export \${envVar}.\`
        : \`Missing API key for \${providerName}.\`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  const baseURL = provider?.baseURL;
  if (baseURL) clientOptions.baseURL = baseURL;
  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
  }

  return new OpenAI(clientOptions);
}

/** Inline setup wizard */
const InlineSetup: React.FC<{ onComplete: (config: Config) => void }> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: \`\${provider.name} - \${model.name}\`,
      value: \`\${provider.id}:::\${model.id}\`,
    })),
  );

  if (setupStep === 'provider') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>First-time setup</Text>
        <Text dimColor>Select a provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setSetupStep('api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>Selected: {provider?.name} / {selectedModelId}</Text>
      <Text>{hasResolvedAuth ? 'Optional API key:' : 'Enter your API key:'}</Text>
      <PasswordInput
        placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : \`Paste your \${provider?.apiKeyEnvVar || 'API'} key\`}
        onSubmit={(value) => {
          if (value.trim().length === 0 && !hasResolvedAuth) return;
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
          };
          writeConfig(newConfig);
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

export const App: React.FC = () => {
  const { exit } = useApp();

  // Core state
  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Refs
  const clientRef = useRef<OpenAI | null>(null);
  const assistantMessageRef = useRef<{ message: any; index: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);
    clientRef.current = buildClient(loadedConfig);

    const initialMessages = await initializeMessages();
    setCompletionMessages(initialMessages);
    setNeedsSetup(false);
    setInitialized(true);
  }, []);

  useEffect(() => {
    const loadedConfig = readConfig();
    if (!loadedConfig) {
      setNeedsSetup(true);
      return;
    }
    initializeWithConfig(loadedConfig);
  }, [initializeWithConfig]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !clientRef.current || !config) return;

    setInputText('');
    setInputKey((prev) => prev + 1);
    setLoading(true);
    setError(null);

    // Add user message immediately for UI display
    const userMessage: Message = { role: 'user', content: trimmed };
    setCompletionMessages((prev) => [...prev, userMessage]);

    assistantMessageRef.current = null;
    abortControllerRef.current = new AbortController();

    try {
      // This is the main change in this file. When the user submits a message
      // We run the agentic loop. The switch allows us to handle the AgentEvents,
      // and update the UI as needed.
      const updatedMessages = await runAgenticLoop(
        clientRef.current,
        config.model,
        [...completionMessages, userMessage],
        trimmed,
        (event: AgentEvent) => {
          switch (event.type) {
            // Text deltas are streamed as the model generates text, so we append them to the current assistant message in real-time.
            case 'text_delta':
              if (!assistantMessageRef.current) {
                const msg = { role: 'assistant', content: event.content || '' } as Message;
                setCompletionMessages((prev) => {
                  assistantMessageRef.current = { message: msg, index: prev.length };
                  return [...prev, msg];
                });
              } else {
                assistantMessageRef.current.message.content += event.content || '';
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantMessageRef.current!.index] = { ...assistantMessageRef.current!.message };
                  return updated;
                });
              }
              break;
            // When the model indicates it wants to call a tool, we add the tool call info to the current assistant message.
            case 'tool_call':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                const existingRef = assistantMessageRef.current;
                const assistantMsg = existingRef?.message
                  ? { ...existingRef.message, tool_calls: [...(existingRef.message.tool_calls || [])] }
                  : { role: 'assistant', content: '', tool_calls: [] as any[] };

                const tc = {
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.name, arguments: toolCall.args },
                };

                const idx = assistantMsg.tool_calls.findIndex((t: any) => t.id === toolCall.id);
                if (idx === -1) assistantMsg.tool_calls.push(tc);
                else assistantMsg.tool_calls[idx] = tc;

                setCompletionMessages((prev) => {
                  const nextIndex = existingRef?.index ?? prev.length;
                  assistantMessageRef.current = { message: assistantMsg, index: nextIndex };
                  if (existingRef) {
                    const updated = [...prev];
                    updated[existingRef.index] = assistantMsg;
                    return updated;
                  }
                  return [...prev, assistantMsg as Message];
                });
              }
              break;
            // When a tool result is received, we add it as a new message with role 'tool' so it appears in the UI, and also so that the model can see the result in the conversation history for the next iteration of the loop.
            case 'tool_result':
              if (event.toolCall) {
                setCompletionMessages((prev) => [
                  ...prev,
                  {
                    role: 'tool',
                    tool_call_id: event.toolCall!.id,
                    content: event.toolCall!.result || '',
                  } as any,
                ]);
                // Reset for next assistant message
                assistantMessageRef.current = null;
              }
              break;
            case 'error':
              if (event.error) setError(event.error);
              break;
            case 'done':
              break;
          }
        },
        { abortSignal: abortControllerRef.current.signal }
      );

      setCompletionMessages(updatedMessages);
    } catch (err: any) {
      setError(\`Error: \${err.message}\`);
    } finally {
      setLoading(false);
    }
  }, [loading, config, completionMessages]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') exit();
    if (key.escape && loading && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  });

  // Render messages
  const visibleMessages = completionMessages.filter((msg) => msg.role !== 'system');
  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>Model: {providerInfo?.name || config.provider} / {config.model}</Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}
      {needsSetup && <InlineSetup onComplete={initializeWithConfig} />}

      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => {
          const msgAny = msg as any;
          const content = typeof msgAny.content === 'string' ? msgAny.content : '';
          const isToolCall = msg.role === 'assistant' && msgAny.tool_calls?.length > 0;

          if (msg.role === 'user') {
            return (
              <Text key={i}>
                <Text color="green" bold>{'> '}</Text>
                <Text>{content}</Text>
              </Text>
            );
          }

          if (isToolCall) {
            return (
              <Box key={i} flexDirection="column">
                {content && <Text>{content}</Text>}
                {msgAny.tool_calls.map((tc: any) => (
                  <Text key={tc.id} dimColor>
                    [tool: {tc.function?.name}]
                  </Text>
                ))}
              </Box>
            );
          }

          if (msg.role === 'tool') {
            const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
            return (
              <Text key={i} dimColor>
                → {preview}
              </Text>
            );
          }

          return <Text key={i}>{content}</Text>;
        })}
        {loading && completionMessages[completionMessages.length - 1]?.role === 'user' && (
          <Text dimColor>Thinking...</Text>
        )}
      </Box>

      {initialized && (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green" bold>{'> '}</Text>
          <TextInput
            key={inputKey}
            defaultValue={inputText}
            onChange={setInputText}
            placeholder="Type your message..."
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  );
};
\`\`\`

## Verification

Run the app and ask it to read a file:

\`\`\`bash
npm run dev
\`\`\`

Try:

\`\`\`
Read tsconfig.json and tell me what it does.
\`\`\`

You should see:
- A \`[tool: read_file]\` indicator
- A tool result preview
- The assistant's analysis of the file contents

\`\`\`

 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
> hi
Hi! How can I help you today? (I can answer questions, help with code, read project files, or anything else you need.)
> whats in tsconfig.json
[tool: read_file]
→ File: tsconfig.json (16 lines total, showing 1-16)
    1 | {
    2 |   "compilerOptions": {
    3 | ...
Here's the contents of tsconfig.json:

{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
╭─────────────────────────────────────────────────────────────╮
│ > Type your message...                                      │
╰─────────────────────────────────────────────────────────────╯
\`\`\`

## Snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-4\`.

## Pitfalls

- Appending the user message twice (once in the UI, once in the loop) — the loop receives the full history with the user message already included
- Forgetting to append tool results to the message history — the model needs to see them
- Not reassembling streamed tool call fragments by index — they arrive incrementally
- Trying to render from inside the loop — use events instead
- Aborting mid-execution and leaving orphaned \`tool_call_id\`s — if the user presses Escape after the assistant message with tool calls has been appended but before all tool results are appended, the history will contain unmatched IDs that cause a 400 on the next turn. In the production loop this is solved by injecting stub \`role: 'tool'\` messages for any unresolved IDs before returning on abort.

## What comes next

Part 5 adds the full file toolkit: write, edit, list, and search. These give the agent real power to inspect and modify code.
`,
  },
  {
    path: "docs/build-your-own/part-5.md",
    content: `# Part 5: Core Tools: Files, TODOs, and Web Fetching

This part expands your single \`read_file\` tool into a full toolkit: file writes, edits, directory listing, search, TODO tracking, and web fetching. It also introduces the path-validation and approval subsystems that every destructive tool uses.

## What you are building

Starting from Part 4, you add:

- \`src/utils/path-validation.ts\` — shared path security boundary
- \`src/utils/approval.ts\` — approval system for destructive operations
- \`src/tools/write-file.ts\` — create or overwrite files (with approval)
- \`src/tools/edit-file.ts\` — exact-string find-and-replace (with approval)
- \`src/tools/list-directory.ts\` — list directory contents
- \`src/tools/search-files.ts\` — recursive text search across files
- \`src/tools/todo.ts\` — in-memory task tracking for multi-step work
- \`src/tools/webfetch.ts\` — fetch and process web content
- Updated \`src/tools/read-file.ts\` — now uses the shared path-validation module
- Updated \`src/tools/index.ts\` — registers all 9 tools
- Updated \`src/App.tsx\` — adds approval UI and wires usage display

## Install new dependencies

\`\`\`bash
npm install html-to-text turndown he
npm install -D @types/turndown @types/he
\`\`\`

## Step 1: Path validation — \`src/utils/path-validation.ts\`

Create the file:

\`\`\`bash
mkdir -p src/utils && touch src/utils/path-validation.ts
\`\`\`

Every file tool resolves paths through this module. It ensures all operations stay inside the working directory and prevents symlink escape.

\`\`\`typescript
// src/utils/path-validation.ts

import fs from 'node:fs/promises';
import path from 'node:path';

const workingDirectory = process.cwd();

export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  // First check: is the normalised path within cwd?
  const relative = path.relative(workingDirectory, normalized);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(\`Path "\${requestedPath}" is outside the working directory.\`);
  }

  // Second check: resolve symlinks and re-check
  try {
    const realPath = await fs.realpath(normalized);
    const realRelative = path.relative(workingDirectory, realPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(\`Path "\${requestedPath}" resolves (via symlink) outside the working directory.\`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — validate the parent directory instead
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        const parentRelative = path.relative(workingDirectory, realParent);
        if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative)) {
          throw new Error(\`Parent directory of "\${requestedPath}" resolves outside the working directory.\`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(\`Parent directory of "\${requestedPath}" does not exist.\`);
      }
    }
    throw err;
  }
}

export function getWorkingDirectory(): string {
  return workingDirectory;
}
\`\`\`

## Step 2: Approval system — \`src/utils/approval.ts\`

Create the file:

\`\`\`bash
touch src/utils/approval.ts
\`\`\`

File writes, edits, and (later) shell commands all go through this system. Approval can be per-operation, per-session, or globally bypassed with \`--dangerously-skip-permissions\`.

\`\`\`typescript
// src/utils/approval.ts

export type ApprovalRequest = {
  id: string;
  type: 'file_write' | 'file_edit' | 'shell_command';
  description: string;
  detail?: string;
  sessionId?: string;
  sessionScopeKey?: string;
};

export type ApprovalResponse = 'approve_once' | 'approve_session' | 'reject';

// Global state
let dangerouslySkipPermissions = false;
// This Set stores which operations a user has allowed for the whole session.
// It is a combination of session ID and scope key (e.g. operation type) to allow for flexible approval scopes.
const sessionApprovals = new Set<string>();

// Callback that the Ink UI provides to handle interactive approval
let approvalHandler: ((req: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;

export function setDangerouslySkipPermissions(value: boolean): void {
  dangerouslySkipPermissions = value;
}

export function isDangerouslySkipPermissions(): boolean {
  return dangerouslySkipPermissions;
}

export function setApprovalHandler(handler: (req: ApprovalRequest) => Promise<ApprovalResponse>): void {
  approvalHandler = handler;
}

export function clearApprovalHandler(): void {
  approvalHandler = null;
}

export function clearSessionApprovals(): void {
  sessionApprovals.clear();
}

function getApprovalScopeKey(req: ApprovalRequest): string {
  const sessionId = req.sessionId ?? '__global__';
  const scope = req.sessionScopeKey ?? req.type;
  return \`\${sessionId}:\${scope}\`;
}

/**
 * Request approval for an operation. Returns true if approved.
 *
 * Check order:
 *  1. --dangerously-skip-permissions → auto-approve
 *  2. Session approval for this type → auto-approve
 *  3. Interactive prompt via the UI handler
 *  4. No handler registered → reject (fail closed)
 */
export async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (dangerouslySkipPermissions) return true;

  const sessionKey = getApprovalScopeKey(req);
  if (sessionApprovals.has(sessionKey)) return true;

  if (!approvalHandler) {
    return false;
  }

  const response = await approvalHandler(req);

  switch (response) {
    case 'approve_once':
      return true;
    case 'approve_session':
      sessionApprovals.add(sessionKey);
      return true;
    case 'reject':
      return false;
  }
}
\`\`\`

## Step 3: \`write_file\` — \`src/tools/write-file.ts\`

Create the file:

\`\`\`bash
touch src/tools/write-file.ts
\`\`\`

Creates or overwrites a file. Requires approval. Uses atomic write (temp file + rename).

\`\`\`typescript
// src/tools/write-file.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';

// Define the tool metadata for the LLM
export const writeFileTool = {
  type: 'function' as const,
  function: {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with the given content. Prefer edit_file for modifying existing files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to write (relative to working directory).' },
        content: { type: 'string', description: 'The full content to write to the file.' },
      },
      required: ['file_path', 'content'],
    },
  },
};

export async function writeFile(filePath: string, content: string, sessionId?: string): Promise<string> {
  const validated = await validatePath(filePath);

  // Request approval
  const preview = content.length > 500
    ? \`\${content.slice(0, 250)}\\n... (\${content.length} chars total) ...\\n\${content.slice(-250)}\`
    : content;

  const approved = await requestApproval({
    id: \`write-\${Date.now()}\`,
    type: 'file_write',
    description: \`Write file: \${filePath}\`,
    detail: preview,
    sessionId,
    sessionScopeKey: \`file_write:\${validated}\`,
  });

  if (!approved) {
    return \`Operation cancelled: write to \${filePath} was rejected by user.\`;
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(validated), { recursive: true });

  // Atomic write: write to temp file then rename
  const tmpPath = path.join(path.dirname(validated), \`.protoagent-write-\${process.pid}-\${Date.now()}-\${path.basename(validated)}\`);
  try {
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, validated);
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }

  const lines = content.split('\\n').length;
  return \`Successfully wrote \${lines} lines to \${filePath}\`;
}
\`\`\`

## Step 4: \`edit_file\` — \`src/tools/edit-file.ts\`

Create the file:

\`\`\`bash
touch src/tools/edit-file.ts
\`\`\`

Find-and-replace using exact string matching. This version uses straightforward exact match — a fuzzy match cascade is added in Part 13.

\`\`\`typescript
// src/tools/edit-file.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';

// Define the tool metadata for the LLM
export const editFileTool = {
  type: 'function' as const,
  function: {
    name: 'edit_file',
    description:
      'Edit an existing file by replacing an exact string match with new content. ' +
      'The old_string must match exactly (including whitespace and indentation). ' +
      'Always read the file first to get the exact content to replace.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit.' },
        old_string: { type: 'string', description: 'The exact text to find and replace.' },
        new_string: { type: 'string', description: 'The text to replace it with.' },
        expected_replacements: {
          type: 'number',
          description: 'Expected number of replacements (default 1). Fails if actual count differs.',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  expectedReplacements = 1,
  sessionId?: string,
): Promise<string> {
  if (oldString.length === 0) {
    return 'Error: old_string cannot be empty.';
  }

  const validated = await validatePath(filePath);
  const content = await fs.readFile(validated, 'utf8');

  // Check if old_string exists in the file
  const count = countOccurrences(content, oldString);

  if (count === 0) {
    return \`Error: old_string not found in \${filePath}. Re-read the file and try again.\`;
  }

  if (count !== expectedReplacements) {
    return \`Error: found \${count} occurrence(s) of old_string, but expected \${expectedReplacements}. Be more specific or set expected_replacements=\${count}.\`;
  }

  // Create a preview of the change for user approval. 
  // If the strings are long, we truncate them for better readability in the approval prompt.
  const oldPreview = oldString.length > 200 ? oldString.slice(0, 200) + '...' : oldString;
  const newPreview = newString.length > 200 ? newString.slice(0, 200) + '...' : newString;

  const approved = await requestApproval({
    id: \`edit-\${Date.now()}\`,
    type: 'file_edit',
    description: \`Edit file: \${filePath} (\${count} replacement\${count > 1 ? 's' : ''})\`,
    detail: \`Replace:\\n\${oldPreview}\\n\\nWith:\\n\${newPreview}\`,
    sessionId,
    sessionScopeKey: \`file_edit:\${validated}\`,
  });

  if (!approved) {
    return \`Operation cancelled: edit to \${filePath} was rejected by user.\`;
  }

  // Perform replacement
  const newContent = content.split(oldString).join(newString);
  const directory = path.dirname(validated);
  const tempPath = path.join(directory, \`.protoagent-edit-\${process.pid}-\${Date.now()}-\${path.basename(validated)}\`);
  try {
    await fs.writeFile(tempPath, newContent, 'utf8');
    await fs.rename(tempPath, validated);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }

  return \`Successfully edited \${filePath}: \${count} replacement(s) made.\`;
}
\`\`\`

## Step 5: \`list_directory\` — \`src/tools/list-directory.ts\`

Create the file:

\`\`\`bash
touch src/tools/list-directory.ts
\`\`\`

Simple directory listing with \`[DIR]\` and \`[FILE]\` markers.

\`\`\`typescript
// src/tools/list-directory.ts

import fs from 'node:fs/promises';
import { validatePath } from '../utils/path-validation.js';

export const listDirectoryTool = {
  type: 'function' as const,
  function: {
    name: 'list_directory',
    description: 'List the contents of a directory. Returns entries with [FILE] or [DIR] prefixes.',
    parameters: {
      type: 'object',
      properties: {
        directory_path: {
          type: 'string',
          description: 'Path to the directory to list (relative to working directory). Defaults to ".".',
        },
      },
      required: [],
    },
  },
};

export async function listDirectory(directoryPath = '.'): Promise<string> {
  const validated = await validatePath(directoryPath);
  const entries = await fs.readdir(validated, { withFileTypes: true });

  const lines = entries.map((entry) => {
    const prefix = entry.isDirectory() ? '[DIR] ' : '[FILE]';
    return \`\${prefix} \${entry.name}\`;
  });

  return \`Contents of \${directoryPath} (\${entries.length} entries):\\n\${lines.join('\\n')}\`;
}
\`\`\`

## Step 6: \`search_files\` — \`src/tools/search-files.ts\`

Create the file:

\`\`\`bash
touch src/tools/search-files.ts
\`\`\`

Recursive text search. This version uses a pure JS directory walk. Ripgrep support is added in Part 13.

\`\`\`typescript
// src/tools/search-files.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';

// Define the tool metadata for the LLM
export const searchFilesTool = {
  type: 'function' as const,
  function: {
    name: 'search_files',
    description: 'Search for a text pattern across files in a directory (recursive). Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'The text or regex pattern to search for.' },
        directory_path: { type: 'string', description: 'Directory to search in. Defaults to ".".' },
        file_extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by file extensions, e.g. [".ts", ".js"]. Searches all files if omitted.',
        },
        case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive. Defaults to true.' },
      },
      required: ['search_term'],
    },
  },
};

const MAX_RESULTS = 100;

export async function searchFiles(
  searchTerm: string,
  directoryPath = '.',
  caseSensitive = true,
  fileExtensions?: string[]
): Promise<string> {
  const validated = await validatePath(directoryPath);

  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(searchTerm, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return \`Error: invalid regex pattern "\${searchTerm}": \${message}\`;
  }

  const results: string[] = [];

  async function search(dir: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;

      const fullPath = path.join(dir, entry.name);

      // Skip common non-useful directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__'].includes(entry.name)) continue;
        // Recurse into subdirectory
        await search(fullPath);
        continue;
      }

      // Filter by extension
      if (fileExtensions && fileExtensions.length > 0) {
        const ext = path.extname(entry.name);
        if (!fileExtensions.includes(ext)) continue;
      }

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const lines = content.split('\\n');
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            const relativePath = path.relative(validated, fullPath);
            let lineContent = lines[i].trim();

            if (lineContent.length > 500) {
              lineContent = lineContent.slice(0, 500) + '... (truncated)';
            }

            results.push(\`\${relativePath}:\${i + 1}: \${lineContent}\`);
          }
          regex.lastIndex = 0;
        }
      } catch {
        // Skip files we can't read (binary, permission issues)
      }
    }
  }

  await search(validated);

  if (results.length === 0) {
    return \`No matches found for "\${searchTerm}" in \${directoryPath}\`;
  }

  const suffix = results.length >= MAX_RESULTS ? \`\\n(results truncated at \${MAX_RESULTS})\` : '';
  return \`Found \${results.length} match(es) for "\${searchTerm}":\\n\${results.join('\\n')}\${suffix}\`;
}
\`\`\`

## Step 7: TODO tools — \`src/tools/todo.ts\`

Create the file:

\`\`\`bash
touch src/tools/todo.ts
\`\`\`

In-memory task tracking for multi-step work. The agent uses these to plan work and track progress. TODOs are stored per session. This allows the agent to set tasks for itself and retrieve them at a later point, without having to rely on the conversation history to determine whether or not the complete task is complete and not forget any subtask.

\`\`\`typescript
// src/tools/todo.ts

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

const DEFAULT_SESSION_ID = '__default__';

// In-memory storage for TODO items, keyed by session ID
const todosBySession = new Map<string, TodoItem[]>();

function getSessionKey(sessionId?: string): string {
  return sessionId ?? DEFAULT_SESSION_ID;
}

function cloneTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map((todo) => ({ ...todo }));
}

function formatTodos(todos: TodoItem[], heading: string): string {
  if (todos.length === 0) {
    return \`\${heading}\\nNo TODOs.\`;
  }

  const statusIcons: Record<TodoItem['status'], string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  const lines = todos.map((t) => \`\${statusIcons[t.status]} [\${t.priority}] \${t.content} (\${t.id})\`);
  return \`\${heading}\\n\${lines.join('\\n')}\`;
}

export const todoReadTool = {
  type: 'function' as const,
  function: {
    name: 'todo_read',
    description: 'Read the current TODO list to check progress on tasks.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const todoWriteTool = {
  type: 'function' as const,
  function: {
    name: 'todo_write',
    description: 'Replace the TODO list with an updated version. Use this to plan tasks, update progress, and mark items complete.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete updated TODO list.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the item.' },
              content: { type: 'string', description: 'Description of the task.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Current status.',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level.',
              },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

export function readTodos(sessionId?: string): string {
  const todos = todosBySession.get(getSessionKey(sessionId)) ?? [];
  return formatTodos(todos, \`TODO List (\${todos.length} items):\`);
}

export function writeTodos(newTodos: TodoItem[], sessionId?: string): string {
  const todos = cloneTodos(newTodos);
  todosBySession.set(getSessionKey(sessionId), todos);
  return formatTodos(todos, \`TODO List Updated (\${todos.length} items):\`);
}

export function getTodosForSession(sessionId?: string): TodoItem[] {
  return cloneTodos(todosBySession.get(getSessionKey(sessionId)) ?? []);
}

export function setTodosForSession(sessionId: string, todos: TodoItem[]): void {
  todosBySession.set(getSessionKey(sessionId), cloneTodos(todos));
}

export function clearTodos(sessionId?: string): void {
  todosBySession.delete(getSessionKey(sessionId));
}
\`\`\`

## Step 8: Web fetch — \`src/tools/webfetch.ts\`

Create the file:

\`\`\`bash
touch src/tools/webfetch.ts
\`\`\`

Fetch and process web content with HTML-to-text/markdown conversion, size limits, and redirect handling.

\`\`\`typescript
// src/tools/webfetch.ts

// Webfetch tool: Fetches content from URLs and converts to different formats.
// - format='text': Uses html-to-text to strip all markup, returns plain readable text
// - format='markdown': Uses turndown to preserve structure as Markdown
// - format='html': Returns raw HTML as-is
// Features: Timeout control, redirect handling (max 10), size limits (5MB response, 2MB output),
// charset detection, and HTML entity decoding.

import { convert } from 'html-to-text';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 10;
const MAX_URL_LENGTH = 4096;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

const TEXT_MIME_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
];

// Lazy-loaded Turndown instance
// Turndown is an HTML-to-Markdown converter library
let _turndownService: any = null;
async function getTurndownService() {
  if (!_turndownService) {
    const { default: TurndownService } = await import('turndown');
    _turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    });
    _turndownService.remove(['script', 'style', 'meta', 'link']);
  }
  return _turndownService;
}

// Lazy-loaded he module
// he is an HTML entity decoder library (e.g., &lt; becomes <)
let _he: any = null;
async function getHe() {
  if (!_he) {
    const { default: he } = await import('he');
    _he = he;
  }
  return _he;
}

function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.some((type) => mimeType.includes(type));
}

function detectHTML(content: string, contentType: string): boolean {
  if (contentType.includes('text/html')) return true;
  const trimmed = content.slice(0, 1024).trim().toLowerCase();
  return /^<!doctype html|^<html|^<head|^<body|^<meta/.test(trimmed);
}

function parseCharset(contentType: string): string {
  const match = contentType.match(/charset=([^\\s;]+)/i);
  if (match) {
    const charset = match[1].replace(/['"]/g, '');
    try {
      new TextDecoder(charset);
      return charset;
    } catch {
      return 'utf-8';
    }
  }
  return 'utf-8';
}

function truncateOutput(output: string, maxSize: number): string {
  if (output.length > maxSize) {
    const truncatedSize = Math.max(100, maxSize - 100);
    return (
      output.slice(0, truncatedSize) +
      \`\\n\\n[Content truncated: \${output.length} characters exceeds \${maxSize} limit]\`
    );
  }
  return output;
}

export const webfetchTool = {
  type: 'function' as const,
  function: {
    name: 'webfetch',
    description: 'Fetch and process content from a web URL. Supports text (plain text extraction), markdown (HTML to markdown conversion), or html (raw HTML) output formats.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP(S) URL to fetch (must start with http:// or https://)',
        },
        format: {
          type: 'string',
          enum: ['text', 'markdown', 'html'],
          description: 'Output format: text (plain text), markdown (HTML to markdown), or html (raw HTML)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default 30, min 1, max 120)',
        },
      },
      required: ['url', 'format'],
    },
  },
};

function htmlToText(html: string): string {
  try {
    return convert(html, {
      wordwrap: 120,
      selectors: [
        { selector: 'img', options: { ignoreHref: true } },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    });
  } catch {
    return html
      .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, '')
      .replace(/<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .split('\\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\\n');
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  try {
    const turndown = await getTurndownService();
    return turndown.turndown(html);
  } catch {
    return \`\\\`\\\`\\\`html\\n\${html}\\n\\\`\\\`\\\`\`;
  }
}

async function fetchWithRedirectLimit(url: string, signal: AbortSignal): Promise<Response> {
  let redirectCount = 0;
  let currentUrl = url;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await fetch(currentUrl, {
      signal,
      headers: FETCH_HEADERS,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        redirectCount++;
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
    }

    return response;
  }

  throw new Error(\`Too many redirects (max \${MAX_REDIRECTS})\`);
}

export async function webfetch(
  url: string,
  format: 'text' | 'markdown' | 'html',
  timeout?: number,
): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Invalid URL format. Must start with http:// or https://');
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(\`URL too long (\${url.length} characters, max \${MAX_URL_LENGTH})\`);
  }

  const timeoutSeconds = Math.min(timeout ?? 30, 120);
  if (timeoutSeconds < 1) {
    throw new Error('Timeout must be between 1 and 120 seconds');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const startTime = Date.now();
    const response = await fetchWithRedirectLimit(url, controller.signal);

    if (!response.ok) {
      throw new Error(\`HTTP \${response.status} error: \${response.statusText}\`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(\`Response too large (exceeds 5MB limit).\`);
    }

    const contentType = response.headers.get('content-type') ?? 'text/plain';

    if (!isTextMimeType(contentType)) {
      throw new Error(\`Content type '\${contentType}' is not supported.\`);
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error(\`Response too large (exceeds 5MB limit).\`);
    }

    const charset = parseCharset(contentType);
    const decoder = new TextDecoder(charset, { fatal: false });
    const content = decoder.decode(arrayBuffer);
    const isHTML = detectHTML(content, contentType);

    let output: string;
    if (format === 'text') {
      output = isHTML ? htmlToText(content) : content;
    } else if (format === 'markdown') {
      output = isHTML ? await htmlToMarkdown(content) : \`\\\`\\\`\\\`\\n\${content}\\n\\\`\\\`\\\`\`;
    } else {
      output = content;
    }

    if (format !== 'html') {
      const he = await getHe();
      output = he.decode(output);
    }

    output = truncateOutput(output, MAX_OUTPUT_SIZE);

    const fetchTime = Date.now() - startTime;
    return {
      output,
      title: \`\${url} (\${contentType})\`,
      metadata: { url, format, contentType, charset, contentLength: arrayBuffer.byteLength, outputLength: output.length, fetchTime },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(\`Fetch timeout after \${timeoutSeconds} seconds\`);
    }
    if (error instanceof Error) throw error;
    throw new Error(\`Failed to fetch \${url}: \${String(error)}\`);
  } finally {
    clearTimeout(timeoutId);
  }
}
\`\`\`

## Step 9: Update \`read_file\` — \`src/tools/read-file.ts\`

Update to use the shared path-validation module instead of inline validation.

\`\`\`typescript
// src/tools/read-file.ts

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
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

export async function readFile(filePath: string, offset = 0, limit = 2000, sessionId?: string): Promise<string> {
  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      return \`File not found: '\${filePath}'\`;
    }
    throw err;
  }

  const start = Math.max(0, offset);
  const maxLines = Math.max(0, limit);
  const lines: string[] = [];
  let totalLines = 0;

  const stream = createReadStream(validated, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lineReader) {
      if (totalLines >= start && lines.length < maxLines) {
        lines.push(line);
      }
      totalLines++;
    }

    const stats = await fs.stat(validated);
    if (stats.size === 0) {
      totalLines = 0;
    } else if (lines.length === 0 && totalLines === 0) {
      totalLines = 1;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  const end = Math.min(totalLines, start + lines.length);

  const numbered = lines.map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, ' ');
    const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
    return \`\${lineNum} | \${truncated}\`;
  });

  const rangeLabel = lines.length === 0
    ? 'none'
    : \`\${Math.min(start + 1, totalLines)}-\${end}\`;
  const header = \`File: \${filePath} (\${totalLines} lines total, showing \${rangeLabel})\`;
  return \`\${header}\\n\${numbered.join('\\n')}\`;
}
\`\`\`

## Step 10: Update tool registry — \`src/tools/index.ts\`

Register all 9 tools and their handlers.

\`\`\`typescript
// src/tools/index.ts

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
}

// All tool definitions — passed to the LLM
export function getAllTools() {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirectoryTool,
    searchFilesTool,
    todoReadTool,
    todoWriteTool,
    webfetchTool,
  ];
}

// Dispatch a tool call to the appropriate handler.
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
      case 'write_file':
        return await writeFile(args.file_path, args.content, context.sessionId);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'todo_read':
        return readTodos(context.sessionId);
      case 'todo_write':
        return writeTodos(args.todos, context.sessionId);
      case 'webfetch': {
        const result = await webfetch(args.url, args.format, args.timeout);
        return JSON.stringify(result);
      }
      default:
        return \`Error: Unknown tool "\${toolName}"\`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return \`Error executing \${toolName}: \${msg}\`;
  }
}
\`\`\`

## Step 11: Update \`src/App.tsx\`

The main changes: wire up the approval handler so \`write_file\` and \`edit_file\` can request user approval, and add the \`ApprovalPrompt\` component.

Replace your \`App.tsx\` with this version. Key additions over Part 4:

- \`ApprovalPrompt\` component for interactive approval
- \`setApprovalHandler\` wired up in initialization
- \`pendingApproval\` state to manage approval flow
- Usage display stub for cost tracking (wired fully in Part 8)

\`\`\`typescript
// src/App.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getProvider } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';
import { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from './tools/index.js';
import type { ApprovalRequest, ApprovalResponse } from './utils/approval.js';

export interface AppProps {
  dangerouslySkipPermissions?: boolean;
}

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? \`Missing API key for \${providerName}. Set it in config or export \${envVar}.\`
        : \`Missing API key for \${providerName}.\`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };

  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim();
  const baseURL = baseURLOverride || provider?.baseURL;
  if (baseURL) {
    clientOptions.baseURL = baseURL;
  }

  return new OpenAI(clientOptions);
}

/** Interactive approval prompt rendered inline. */
const ApprovalPrompt: React.FC<{
  request: ApprovalRequest;
  onRespond: (response: ApprovalResponse) => void;
}> = ({ request, onRespond }) => {
  const sessionApprovalLabel = request.sessionScopeKey
    ? 'Approve this operation for session'
    : \`Approve all "\${request.type}" for session\`;

  const items = [
    { label: 'Approve once', value: 'approve_once' as const },
    { label: sessionApprovalLabel, value: 'approve_session' as const },
    { label: 'Reject', value: 'reject' as const },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginY={1}>
      <Text color="green" bold>Approval Required</Text>
      <Text>{request.description}</Text>
      {request.detail && (
        <Text dimColor>{request.detail.length > 200 ? request.detail.slice(0, 200) + '...' : request.detail}</Text>
      )}
      <Box marginTop={1}>
        <Select
          options={items.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onRespond(value as ApprovalResponse)}
        />
      </Box>
    </Box>
  );
};

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{
  onComplete: (config: Config) => void;
}> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: \`\${provider.name} - \${model.name}\`,
      value: \`\${provider.id}:::\${model.id}\`,
    })),
  );

  if (setupStep === 'provider') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>First-time setup</Text>
        <Text dimColor>Select a provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setSetupStep('api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>
        Selected: {provider?.name} / {selectedModelId}
      </Text>
      <Text>{hasResolvedAuth ? 'Optional API key:' : 'Enter your API key:'}</Text>
      {apiKeyError && <Text color="red">{apiKeyError}</Text>}
      <PasswordInput
        placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : \`Paste your \${provider?.apiKeyEnvVar || 'API'} key\`}
        onSubmit={(value) => {
          if (value.trim().length === 0 && !hasResolvedAuth) {
            setApiKeyError('API key cannot be empty.');
            return;
          }
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
          };
          writeConfig(newConfig);
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

export const App: React.FC<AppProps> = ({ dangerouslySkipPermissions = false }) => {
  const { exit } = useApp();

  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [inputResetKey, setInputResetKey] = useState(0);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  const clientRef = useRef<OpenAI | null>(null);

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);
    clientRef.current = buildClient(loadedConfig);

    const initialMessages = await initializeMessages();
    setCompletionMessages(initialMessages);
    setNeedsSetup(false);
    setInitialized(true);
  }, []);

  useEffect(() => {
    const init = async () => {
      if (dangerouslySkipPermissions) {
        setDangerouslySkipPermissions(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      const loadedConfig = readConfig();
      if (!loadedConfig) {
        setNeedsSetup(true);
        return;
      }

      await initializeWithConfig(loadedConfig);
    };

    init().catch((err) => {
      setError(\`Initialization failed: \${err.message}\`);
    });

    return () => {
      clearApprovalHandler();
    };
  }, []);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !clientRef.current || !config) return;

    setInputText('');
    setInputResetKey((prev) => prev + 1);
    setLoading(true);
    setError(null);

    const userMessage: Message = { role: 'user', content: trimmed };
    setCompletionMessages((prev) => [...prev, userMessage]);

    try {
      const updatedMessages = await runAgenticLoop(
        clientRef.current,
        config.model,
        [...completionMessages, userMessage],
        trimmed,
        (event: AgentEvent) => {
          switch (event.type) {
            case 'text_delta':
              setCompletionMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (event.content || '') }];
                }
                return [...prev, { role: 'assistant', content: event.content || '' }];
              });
              break;
            case 'tool_call':
              if (event.toolCall) {
                setCompletionMessages((prev) => {
                  const assistantMsg = {
                    role: 'assistant' as const,
                    content: '',
                    tool_calls: [{
                      id: event.toolCall!.id,
                      type: 'function' as const,
                      function: { name: event.toolCall!.name, arguments: event.toolCall!.args },
                    }],
                  };
                  return [...prev, assistantMsg as any];
                });
              }
              break;
            case 'tool_result':
              if (event.toolCall) {
                setCompletionMessages((prev) => [
                  ...prev,
                  {
                    role: 'tool',
                    tool_call_id: event.toolCall!.id,
                    content: event.toolCall!.result || '',
                  } as any,
                ]);
              }
              break;
            case 'error':
              setError(event.error || 'Unknown error');
              break;
            case 'done':
              break;
          }
        },
      );

      setCompletionMessages(updatedMessages);
    } catch (err: any) {
      setError(\`Error: \${err.message}\`);
    } finally {
      setLoading(false);
    }
  }, [loading, config, completionMessages]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>
          Model: {providerInfo?.name || config.provider} / {config.model}
          {dangerouslySkipPermissions && <Text color="red"> (auto-approve all)</Text>}
        </Text>
      )}

      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {needsSetup && (
        <InlineSetup
          onComplete={(newConfig) => {
            initializeWithConfig(newConfig).catch((err) => {
              setError(\`Initialization failed: \${err.message}\`);
            });
          }}
        />
      )}

      <Box flexDirection="column" flexGrow={1}>
        {completionMessages.map((msg, index) => {
          const displayContent = 'content' in msg && typeof msg.content === 'string' ? msg.content : null;
          const msgAny = msg as any;
          const isToolCall = msg.role === 'assistant' && msgAny.tool_calls?.length > 0;

          if (msg.role === 'system') {
            return (
              <Box key={index} marginBottom={1}>
                <Text dimColor>[System prompt loaded]</Text>
              </Box>
            );
          }

          if (msg.role === 'user') {
            return (
              <Box key={index} flexDirection="column">
                <Text>
                  <Text color="green" bold>{'> '}</Text>
                  <Text>{displayContent}</Text>
                </Text>
              </Box>
            );
          }

          if (isToolCall) {
            return (
              <Box key={index} flexDirection="column">
                {msgAny.tool_calls.map((tc: any) => (
                  <Text key={tc.id} dimColor>
                    Tool: {tc.function?.name}({tc.function?.arguments?.slice(0, 100)})
                  </Text>
                ))}
              </Box>
            );
          }

          if (msg.role === 'tool') {
            const content = displayContent || '';
            return (
              <Box key={index} flexDirection="column">
                <Text dimColor>
                  {content.length > 200 ? content.slice(0, 200) + '...' : content}
                </Text>
              </Box>
            );
          }

          return (
            <Box key={index} flexDirection="column">
              <Text>{displayContent}</Text>
            </Box>
          );
        })}

        {loading && <Text dimColor>Working...</Text>}

        {/* Approval prompt */}
        {pendingApproval && (
          <ApprovalPrompt
            request={pendingApproval.request}
            onRespond={(response) => {
              pendingApproval.resolve(response);
              setPendingApproval(null);
            }}
          />
        )}
      </Box>

      {/* Input */}
      {initialized && !pendingApproval && (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Box width={2} flexShrink={0}>
            <Text color="green" bold>{'>'}</Text>
          </Box>
          <Box flexGrow={1}>
            <TextInput
              key={inputResetKey}
              defaultValue={inputText}
              onChange={setInputText}
              placeholder="Type your message..."
              onSubmit={handleSubmit}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
\`\`\`

## Verification

\`\`\`bash
npm run dev
\`\`\`

Try prompts that exercise the new tools:

- \`List the files in src/tools\` — uses \`list_directory\`
- \`Search the project for the word "Config"\` — uses \`search_files\`
- \`Read src/config.tsx and explain what it does\` — uses \`read_file\`
- \`Create a file called test.txt with "hello world"\` — uses \`write_file\` (triggers approval)
- \`Read test.txt and change "hello" to "goodbye"\` — uses \`read_file\` then \`edit_file\` (triggers approval)

You should see approval prompts for write and edit operations (unless using \`--dangerously-skip-permissions\`).

\`\`\`
 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> hi
Hi — how can I help you today?
> create index.html with hello world
Tool: write_file({"file_path":"index.html","content":"<!doctype html>\\n<html lang=\\"en\\">\\n<head>\\n  <meta charset=\\")
Successfully wrote 12 lines to index.html
Done — I created index.html with "hello world". Would you like any styling or additional content?
╭─────────────────────────────────────────────────────────────╮
│ > Type your message...                                      │
╰─────────────────────────────────────────────────────────────╯
\`\`\`

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-5\`.

## Core takeaway

This is where ProtoAgent stops being a chat demo and becomes a real coding agent. The approval system ensures destructive operations are always gated, and path validation prevents the agent from escaping the project directory.
`,
  },
  {
    path: "docs/build-your-own/part-6.md",
    content: `# Part 6: Shell Commands & Approvals

A coding agent needs the shell — to run tests, inspect git state, build the project. But giving an agent shell access requires a safety model. This part adds the \`bash\` tool with a three-tier security system: hard-blocked dangerous commands, auto-approved safe commands, and everything else requiring user approval.

## What you are building

Starting from Part 5, you add:

- \`src/tools/bash.ts\` — shell execution with security controls
- Updated \`src/tools/index.ts\` — registers the bash tool
- Updated \`src/cli.tsx\` — adds \`--dangerously-skip-permissions\` flag

## Step 1: Create \`src/tools/bash.ts\`

Create the file:

\`\`\`bash
touch src/tools/bash.ts
\`\`\`

The three-tier security model:
1. **Hard-blocked** — dangerous commands that cannot run even with \`--dangerously-skip-permissions\`
2. **Auto-approved** — safe read-only commands (git status, pwd, etc.)
3. **Requires approval** — everything else goes through the approval handler

\`\`\`typescript
// src/tools/bash.ts

// SECURITY NOTICE: This tool executes shell commands with multiple safety layers:
// 1. Hard-blocks dangerous patterns (sudo, rm -rf /, etc.) - cannot be bypassed
// 2. Auto-approves a whitelist of safe read-only commands (git status, ls, etc.)
// 3. Requires user approval for all other commands
// 4. Blocks shell control operators (;, &&, ||, |, >, <, \`, \$(), *, ?)
// 5. Validates paths stay within the working directory
// 6. Enforces timeouts and output limits
//
// HOWEVER: Shell execution is inherently risky. Like other coding agents (Claude Code,
// Cursor Agent, etc.), running this tool within a sandboxed environment (Docker container,
// VM, or restricted user account) can provide higher degrees of security for untrusted code.
// The approval system is your last line of defense - review commands carefully.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { requestApproval } from '../utils/approval.js';
import { getWorkingDirectory, validatePath } from '../utils/path-validation.js';

// Define the tool schema for the bash tool
export const bashTool = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description:
      'Execute a shell command. Safe commands (ls, grep, git status, etc.) run automatically. ' +
      'Other commands require user approval. Some dangerous commands are blocked entirely.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 30000 (30s).' },
      },
      required: ['command'],
    },
  },
};

// Hard-blocked commands — these CANNOT be run, even with --dangerously-skip-permissions
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'sudo',
  'su ',
  'chmod 777',
  'dd if=',
  'mkfs',
  'fdisk',
  'format c:',
];

// Auto-approved safe commands — read-only / informational
const SAFE_COMMANDS = [
  'pwd', 'whoami', 'date',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'npm list', 'npm ls', 'yarn list',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
];

// What are shell control operators? 
// Shell control operators are characters or sequences that allow chaining or controlling the flow of commands in a shell. For example:
// - \`;\` allows you to run multiple commands sequentially, like \`ls; echo "done"\`
// - \`&&\` allows you to run the next command only if the previous one succeeded, like \`mkdir new_folder && cd new_folder\`
// - \`||\` allows you to run the next command only if the previous one failed, like \`cd non_existent_folder || echo "Failed to change directory"\`
// - \`|\` allows you to pipe the output of one command into another, like \`ls | grep "txt"\`
// - \`>\` and \`<\` allow you to redirect output and input, like \`echo "Hello" > file.txt\` or \`sort < unsorted.txt\`
// - \`\` \` \`\` and \`\$()\` allow you to execute a command and use its output in another command, like \`\`echo "Today is \`date\`"\`\` or \`echo "Today is \$(date)"\`
// - \`*\` and \`?\` are wildcard characters used for pattern matching in file names, like \`ls *.txt\` or \`ls file?.txt\`
// The presence of these operators can indicate that a command is trying to do more than just execute a single, simple instruction, which is why we check for them as a potential safety measure.
const SHELL_CONTROL_PATTERN = /(^|[^\\\\])(?:;|&&|\\|\\||\\||>|<|\`|\\\$\\(|\\*|\\?)/;

function isDangerous(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}

function hasShellControlOperators(command: string): boolean {
  return SHELL_CONTROL_PATTERN.test(command);
}

// Tokenize the command while respecting quoted substrings (e.g., "ls 'my folder'")
function tokenizeCommand(command: string): string[] | null {
  const tokens = command.match(/"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\S+/g);
  return tokens && tokens.length > 0 ? tokens : null;
}

function stripOuterQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function looksLikePath(token: string): boolean {
  if (!token) return false;
  if (token === '.' || token === '..') return true;
  if (token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.startsWith('~/')) {
    return true;
  }
  return token.includes(path.sep) || /\\.[A-Za-z0-9_-]+\$/.test(token);
}

async function validateCommandPaths(tokens: string[]): Promise<boolean> {
  for (let index = 1; index < tokens.length; index++) {
    const token = stripOuterQuotes(tokens[index]);
    if (!looksLikePath(token)) continue;
    if (token.startsWith('~')) return false;

    try {
      await validatePath(token);
    } catch {
      return false;
    }
  }

  return true;
}

async function isSafe(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed || hasShellControlOperators(trimmed)) {
    return false;
  }

  const tokens = tokenizeCommand(trimmed);
  if (!tokens) {
    return false;
  }

  const firstWord = trimmed.split(/\\s+/)[0];

  const matchedSafeCommand = SAFE_COMMANDS.some((safe) => {
    if (safe.includes(' ')) {
      return trimmed === safe || trimmed.startsWith(\`\${safe} \`);
    }
    return firstWord === safe;
  });

  if (!matchedSafeCommand) {
    return false;
  }

  return validateCommandPaths(tokens);
}

export async function runBash(command: string, timeoutMs = 30_000, sessionId?: string): Promise<string> {
  // Layer 1: hard block
  if (isDangerous(command)) {
    return \`Error: Command blocked for safety. "\${command}" contains a dangerous pattern that cannot be executed.\`;
  }

  // Layer 2: safe commands skip approval
  if (!(await isSafe(command))) {
    // Layer 3: interactive approval
    const approved = await requestApproval({
      id: \`bash-\${Date.now()}\`,
      type: 'shell_command',
      description: \`Run command: \${command}\`,
      detail: \`Working directory: \${getWorkingDirectory()}\\nCommand: \${command}\`,
      sessionId,
      sessionScopeKey: \`shell:\${command}\`,
    });

    if (!approved) {
      return \`Command cancelled by user: \${command}\`;
    }
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, [], {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve(\`Command timed out after \${timeoutMs / 1000}s.\\nPartial stdout:\\n\${stdout.slice(0, 5000)}\\nPartial stderr:\\n\${stderr.slice(0, 2000)}\`);
        return;
      }

      const maxLen = 50_000;
      const truncatedStdout = stdout.length > maxLen
        ? stdout.slice(0, maxLen) + \`\\n... (output truncated, \${stdout.length} chars total)\`
        : stdout;

      if (code === 0) {
        resolve(truncatedStdout || '(command completed successfully with no output)');
      } else {
        resolve(\`Command exited with code \${code}.\\nstdout:\\n\${truncatedStdout}\\nstderr:\\n\${stderr.slice(0, 5000)}\`);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(\`Error executing command: \${err.message}\`);
    });
  });
}
\`\`\`

## Step 2: Update \`src/tools/index.ts\`

Add the bash tool import and registration.

\`\`\`typescript
// src/tools/index.ts

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { bashTool, runBash } from './bash.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
}

// All tool definitions — passed to the LLM
export function getAllTools() {
  return [
    readFileTool,
    writeFileTool,
    editFileTool,
    listDirectoryTool,
    searchFilesTool,
    bashTool,
    todoReadTool,
    todoWriteTool,
    webfetchTool,
  ];
}

// Dispatch a tool call to the appropriate handler.
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
      case 'write_file':
        return await writeFile(args.file_path, args.content, context.sessionId);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'bash':
        return await runBash(args.command, args.timeout_ms, context.sessionId);
      case 'todo_read':
        return readTodos(context.sessionId);
      case 'todo_write':
        return writeTodos(args.todos, context.sessionId);
      case 'webfetch': {
        const result = await webfetch(args.url, args.format, args.timeout);
        return JSON.stringify(result);
      }
      default:
        return \`Error: Unknown tool "\${toolName}"\`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return \`Error executing \${toolName}: \${msg}\`;
  }
}
\`\`\`

## Step 3: Update \`src/cli.tsx\`

Add the \`--dangerously-skip-permissions\` flag that bypasses approval prompts.

\`\`\`typescript
// src/cli.tsx
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, readConfig, writeConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .action((options) => {
    render(<App dangerouslySkipPermissions={options.dangerouslySkipPermissions || false} />);
  });

program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(\`\${selected.provider} / \${selected.model}\`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program.parse(process.argv);
\`\`\`

## Verification

\`\`\`bash
npm run dev
\`\`\`

Try these prompts:

- \`Run git status and summarize it.\` — auto-approved (safe command)
- \`Run npm install\` — requires approval (not in safe list)
- \`List files using ls -la\` — requires approval (shell operators)

Then try with the bypass flag:

\`\`\`bash
npm run dev -- --dangerously-skip-permissions
\`\`\`

Now non-blocked commands run without prompts.

With the bypass flag, these also run without prompts:
- \`Write a file index.html with "hello world"\` — auto-approved file write
- \`Edit src/config.tsx to change the default model to gpt-4o\` — auto-approved file edit
- \`Create a new folder called tests\` — auto-approved via bash

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-6\`.

## Core takeaway

The shell layer is conservative on purpose. Hard-blocked commands cannot run regardless of flags. Auto-approved commands are narrowly scoped to read-only operations. Everything else requires explicit user consent. This layered approach gives the agent useful power without treating shell access as harmless.
`,
  },
  {
    path: "docs/build-your-own/part-7.md",
    content: `# Part 7: System Prompt & Runtime Policy

The system prompt is where ProtoAgent stops being "a model with tools" and becomes "this specific coding agent with this specific workflow." Instead of a static string, the prompt is generated at runtime — reflecting the actual working directory, project structure, and available tools.

## What you are building

Starting from Part 6, you add:

- \`src/system-prompt.ts\` — dynamic system prompt generator
- Updated \`src/agentic-loop.ts\` — uses \`generateSystemPrompt()\` for the \`initializeMessages\` function
- Updated \`src/App.tsx\` — calls \`initializeMessages()\` which now uses the generated prompt

## Step 1: Create \`src/system-prompt.ts\`

Create the file:

\`\`\`bash
touch src/system-prompt.ts
\`\`\`

This module builds the system prompt dynamically from the runtime environment:

- Discovers the working directory and project name
- Builds a filtered directory tree (depth 3, excludes noise)
- Auto-generates tool descriptions from the tool registry schemas
- Includes workflow guidelines for the model

\`\`\`typescript
// src/system-prompt.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllTools } from './tools/index.js';

/** Build a filtered directory tree (depth 3, excludes noise). */
async function buildDirectoryTree(dirPath = '.', depth = 0, maxDepth = 3): Promise<string> {
  if (depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  let tree = '';

  try {
    const fullPath = path.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const filtered = entries.filter((e) => {
      const n = e.name;
      return !n.startsWith('.') && !['node_modules', 'dist', 'build', 'coverage', '__pycache__', '.git'].includes(n) && !n.endsWith('.log');
    });

    for (const entry of filtered.slice(0, 20)) {
      if (entry.isDirectory()) {
        tree += \`\${indent}\${entry.name}/\\n\`;
        tree += await buildDirectoryTree(path.join(dirPath, entry.name), depth + 1, maxDepth);
      } else {
        tree += \`\${indent}\${entry.name}\\n\`;
      }
    }

    if (filtered.length > 20) {
      tree += \`\${indent}... (\${filtered.length - 20} more)\\n\`;
    }
  } catch {
    // Can't read directory — skip
  }

  return tree;
}

/** Auto-generate tool descriptions from their JSON schemas. */
function generateToolDescriptions(): string {
  return getAllTools()
    .map((tool, i) => {
      const fn = tool.function;
      const params = fn.parameters as { required?: string[]; properties?: Record<string, any> };
      const required = params.required || [];
      const props = Object.keys(params.properties || {});
      const paramList = props
        .map((p) => \`\${p}\${required.includes(p) ? ' (required)' : ' (optional)'}\`)
        .join(', ');
      return \`\${i + 1}. \${fn.name} — \${fn.description}\\n   Parameters: \${paramList || 'none'}\`;
    })
    .join('\\n\\n');
}

/** Generate the complete system prompt. */
export async function generateSystemPrompt(): Promise<string> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const tree = await buildDirectoryTree();
  const toolDescriptions = generateToolDescriptions();

  return \`You are ProtoAgent, a coding assistant with file system and shell command capabilities.
Your job is to help the user complete coding tasks in their project.

PROJECT CONTEXT

Working Directory: \${cwd}
Project Name: \${projectName}

PROJECT STRUCTURE:
\${tree}

AVAILABLE TOOLS

\${toolDescriptions}

GUIDELINES

OUTPUT FORMAT:
- You are running in a terminal. Be concise. Optimise for scannability.
- Use **bold** for important terms, *italic* for references.
- Use flat bullet lists with emojis to communicate information densely (e.g. ✅ done, ❌ failed, 📁 file, 🔍 searching).
- NEVER use nested indentation. Keep all lists flat — one level only.

WORKFLOW:
- Before making tool calls, briefly explain what you're about to do and why.
- Always read files before editing them.
- Prefer edit_file over write_file for existing files.
- Use TODO tracking (todo_write / todo_read) by default for almost all work.
- Start by creating or refreshing the TODO list before doing substantive work, then keep it current throughout the task.
- Search first when you need to find something — use search_files or bash with grep/find.
- Shell commands: safe commands (ls, grep, git status, etc.) run automatically. Other commands require user approval.

FILE OPERATIONS:
- ALWAYS use read_file before editing to get exact content.
- NEVER write over existing files unless explicitly asked — use edit_file instead.
- Create parent directories before creating files in them.
- Use bash for package management, git, building, testing, etc.

IMPLEMENTATION STANDARDS:
- Thorough investigation: Before implementing, understand the existing codebase, patterns, and related systems.
- Completeness: Ensure implementations are complete and tested, not partial or left in a broken state.
- Code quality: Follow existing code style and conventions.\`;
}
\`\`\`

## Step 2: Update \`src/agentic-loop.ts\`

The \`initializeMessages\` function now uses the generated system prompt instead of a hardcoded string.

\`\`\`typescript
// In src/agentic-loop.ts, update the initializeMessages function:

import { generateSystemPrompt } from './system-prompt.js';

export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt }];
}
\`\`\`

The rest of the agentic loop stays the same as Part 4. The only change is this one function.

## Verification

\`\`\`bash
npm run dev
\`\`\`

Ask the model to describe the project:

\`\`\`text
Explain the structure of this project.
\`\`\`

You should see:
- The model using file tools more deliberately
- Answers that reflect the actual project structure (because the system prompt now includes the directory tree)
- Tool descriptions that match the actual registered tools

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-7\`.

## Core takeaway

The system prompt is not static documentation. It is a runtime-generated contract between the app, the tool layer, and the model. When you add a tool, the prompt updates automatically. When you change the project structure, the tree updates. The model always sees an accurate picture of what it can do.
`,
  },
  {
    path: "docs/build-your-own/part-8.md",
    content: `# Part 8: Compaction & Cost Tracking

Once an agent runs longer sessions, context pressure becomes real. Every message, tool result, and file read adds tokens. This part adds token estimation, cost tracking, context-window utilization monitoring, and automatic compaction when the context gets too full.

## What you are building

Starting from Part 7, you add:

- \`src/utils/cost-tracker.ts\` — token estimation and cost calculation
- \`src/utils/compactor.ts\` — conversation compaction when context exceeds 90%
- Updated \`src/agentic-loop.ts\` — compaction check, usage emission, abort support
- Updated \`src/App.tsx\` — usage display, cost tracking, abort controller
- Updated \`src/cli.tsx\` — log level option

## Step 1: Create \`src/utils/cost-tracker.ts\`

Create the file:

\`\`\`bash
touch src/utils/cost-tracker.ts
\`\`\`

We're going to rely on simple token estimation (~4 characters per token) as a fallback for when we can't receive the usage from the API. The cost tracker also handles cached token pricing for providers that support prompt caching.

\`\`\`typescript
// src/utils/cost-tracker.ts

import type OpenAI from 'openai';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ContextInfo {
  currentTokens: number;
  maxTokens: number;
  utilizationPercentage: number;
  needsCompaction: boolean;
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cachedPerToken?: number;
  contextWindow: number;
}

// Rough token estimation: ~4 characters per token.
// Only used as a fallback when the model doesn't return actual token counts, so it's better to overestimate than underestimate to avoid surprises.
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens for a single message including overhead. */
export function estimateMessageTokens(msg: OpenAI.Chat.Completions.ChatCompletionMessageParam): number {
  let tokens = 4; // per-message overhead
  if ('content' in msg && typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content);
  }
  if ('tool_calls' in msg && Array.isArray((msg as any).tool_calls)) {
    for (const tc of (msg as any).tool_calls) {
      tokens += estimateTokens(tc.function?.name || '') + estimateTokens(tc.function?.arguments || '') + 10;
    }
  }
  return tokens;
}

/** Estimate total tokens for a conversation. */
export function estimateConversationTokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0) + 10;
}

/** Calculate dollar cost for a given number of tokens. */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): number {
  if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
    const uncachedTokens = inputTokens - cachedTokens;
    return (
      uncachedTokens * pricing.inputPerToken +
      cachedTokens * pricing.cachedPerToken +
      outputTokens * pricing.outputPerToken
    );
  }
  return inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken;
}

/** Get context window utilisation info. */
export function getContextInfo(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  pricing: ModelPricing
): ContextInfo {
  const currentTokens = estimateConversationTokens(messages);
  const maxTokens = pricing.contextWindow;
  const utilizationPercentage = (currentTokens / maxTokens) * 100;
  return {
    currentTokens,
    maxTokens,
    utilizationPercentage,
    needsCompaction: utilizationPercentage >= 90,
  };
}

/** Build a UsageInfo from actual or estimated token counts. */
export function createUsageInfo(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): UsageInfo {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: calculateCost(inputTokens, outputTokens, pricing, cachedTokens),
  };
}
\`\`\`

## Step 2: Create \`src/utils/compactor.ts\`

Create the file:

\`\`\`bash
touch src/utils/compactor.ts
\`\`\`

When the conversation exceeds 90% of the context window, the compactor summarizes older messages using the LLM. The most recent messages are kept verbatim so the agent doesn't lose immediate context.

Compacting the conversation is quite simple. We take the full conversation, ask the LLM to summarize it, then build a new conversation with the original system prompt, the summarized conversation, and the recent messages.

\`\`\`typescript
// src/utils/compactor.ts

import type OpenAI from 'openai';
import { estimateConversationTokens } from './cost-tracker.js';
import { getTodosForSession, type TodoItem } from '../tools/todo.js';

const RECENT_MESSAGES_TO_KEEP = 5;

const COMPRESSION_PROMPT = \`You are a conversation state manager. Your job is to compress a conversation history into a compact summary that preserves all important context.

Produce a structured summary in this format:

<state_snapshot>
<overall_goal>What the user is trying to accomplish</overall_goal>
<key_knowledge>Important facts, conventions, constraints discovered</key_knowledge>
<file_system_state>Files created, read, modified, or deleted (with paths)</file_system_state>
<recent_actions>Last significant actions and their outcomes</recent_actions>
<current_plan>Current step-by-step plan with status: [DONE], [IN PROGRESS], [TODO]</current_plan>
</state_snapshot>

Be thorough but concise. Do not lose any information that would be needed to continue the conversation.\`;

export async function compactIfNeeded(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  contextWindow: number,
  currentTokens: number,
  requestDefaults: Record<string, unknown> = {},
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const utilisation = (currentTokens / contextWindow) * 100;
  if (utilisation < 90) return messages;

  try {
    return await compactConversation(client, model, messages, requestDefaults, sessionId);
  } catch (err) {
    return messages;
  }
}

async function compactConversation(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  requestDefaults: Record<string, unknown>,
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const systemMessage = messages[0];
  const recentMessages = messages.slice(-RECENT_MESSAGES_TO_KEEP);
  const historyToCompress = messages.slice(1, messages.length - RECENT_MESSAGES_TO_KEEP);

  if (historyToCompress.length === 0) {
    return messages;
  }

  const activeTodos = getTodosForSession(sessionId);
  const todoReminder = activeTodos.length > 0
    ? \`\\n\\nActive TODOs:\\n\${activeTodos.map((todo: TodoItem) => \`- [\${todo.status}] \${todo.content}\`).join('\\n')}\\n\\nThe agent must not stop until the TODO list is fully complete.\`
    : '';

  const compressionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPRESSION_PROMPT },
    {
      role: 'user',
      content: \`Here is the conversation history to compress:\\n\\n\${historyToCompress
        .map((m) => \`[\${(m as any).role}]: \${(m as any).content || JSON.stringify((m as any).tool_calls || '')}\`)
        .join('\\n\\n')}\${todoReminder}\`,
    },
  ];

  const response = await client.chat.completions.create({
    ...requestDefaults,
    model,
    messages: compressionMessages,
    max_tokens: 2000,
    temperature: 0.1,
  });

  const summary = response.choices[0]?.message?.content;
  if (!summary) {
    throw new Error('Compression returned empty response');
  }

  const compacted: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    systemMessage,
    { role: 'system', content: \`Previous conversation summary:\\n\\n\${summary}\` },
    ...recentMessages,
  ];

  const oldTokens = estimateConversationTokens(messages);
  const newTokens = estimateConversationTokens(compacted);

  return compacted;
}
\`\`\`

## Step 3: Update \`src/agentic-loop.ts\`

The agentic loop now checks context utilization before each API call and compacts if needed. It also emits \`usage\` events after each iteration.

Key changes to your existing loop:

1. Accept \`pricing\` and \`requestDefaults\` options, plus \`abortSignal\`
2. Before each API call, check context and compact if needed
3. After each API response, emit a \`usage\` event with token counts and cost
4. Track actual usage from the API response when available

Update the imports and options interface:

\`\`\`typescript
// src/agentic-loop.ts
import type OpenAI from 'openai';
import { getAllTools, handleToolCall } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { compactIfNeeded } from './utils/compactor.js';
import { createUsageInfo, estimateConversationTokens, estimateTokens, getContextInfo, type ModelPricing } from './utils/cost-tracker.js';

// ─── Types ───
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
  transient?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

export interface AgenticLoopOptions {
  maxIterations?: number;
  abortSignal?: AbortSignal;
  sessionId?: string;
  pricing?: ModelPricing;
  requestDefaults?: Record<string, unknown>;
}
\`\`\`

Update the \`runAgenticLoop\` function signature and initialization:

\`\`\`typescript
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;
  const pricing = options.pricing;
  const requestDefaults = options.requestDefaults || {};

  const updatedMessages: Message[] = [...messages];
  let iterationCount = 0;

  while (iterationCount < maxIterations) {
    if (abortSignal?.aborted) {
      onEvent({ type: 'done' });
      return updatedMessages;
    }

    iterationCount++;

    // Check context utilization and compact if needed
    if (pricing) {
      const currentTokens = estimateConversationTokens(messages);
      messages = await compactIfNeeded(
        client, model, messages, pricing.contextWindow,
        currentTokens, requestDefaults, sessionId
      );
    }

    try {
      const allTools = getAllTools();

      const stream = await client.chat.completions.create({
        model,
        messages: updatedMessages,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
      }, {
        signal: abortSignal,
      });

      const assistantMessage: any = {
        role: 'assistant',
        content: '',
        tool_calls: [],
      };
      let streamedContent = '';
      let hasToolCalls = false;
      let actualUsage: OpenAI.CompletionUsage | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (chunk.usage) {
          actualUsage = chunk.usage;
        }

        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
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
            if (tc.function?.name) {
              assistantMessage.tool_calls[idx].function.name += tc.function.name;
            }
            if (tc.function?.arguments) {
              assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Emit usage event with token counts and cost
      {
        const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(updatedMessages);
        const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
        const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
        const cost = pricing
          ? createUsageInfo(inputTokens, outputTokens, pricing, cachedTokens).estimatedCost
          : 0;
        const contextPercent = pricing
          ? getContextInfo(updatedMessages, pricing).utilizationPercentage
          : 0;

        onEvent({
          type: 'usage',
          usage: { inputTokens, outputTokens, cost, contextPercent },
        });
      }

      // Handle tool calls (rest of your existing logic)...
      if (assistantMessage.tool_calls.length > 0) {
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        updatedMessages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          if (abortSignal?.aborted) {
            onEvent({ type: 'done' });
            return updatedMessages;
          }

          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' },
          });

          try {
            const args = JSON.parse(argsStr);
            const result = await handleToolCall(name, args, { sessionId });

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result },
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: \`Error: \${errMsg}\`,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg },
            });
          }
        }
        continue;
      }

      // Plain text response — done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
      }

      onEvent({ type: 'done' });
      return updatedMessages;

    } catch (apiError: any) {
      if (abortSignal?.aborted) {
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      const errMsg = apiError?.message || 'Unknown API error';

      if (apiError?.status === 429) {
        onEvent({ type: 'error', error: 'Rate limited. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (apiError?.status >= 500) {
        onEvent({ type: 'error', error: 'Server error. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      onEvent({ type: 'error', error: errMsg });
      onEvent({ type: 'done' });
      return updatedMessages;
    }
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}
\`\`\`

## Step 4: Update \`src/App.tsx\`

Add usage tracking state, the \`UsageDisplay\` component, and wire up the \`usage\` event from the agentic loop. Also add the abort controller and pass pricing/request defaults to the loop.

Update imports:

\`\`\`typescript
import { getAllProviders, getModelPricing, getProvider, getRequestDefaultParams } from './providers.js';
\`\`\`

Add to \`AppProps\`:

\`\`\`typescript
export interface AppProps {
  dangerouslySkipPermissions?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
}
\`\`\`

Add the \`UsageDisplay\` component:

\`\`\`typescript
const UsageDisplay: React.FC<{
  usage: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } | null;
  totalCost: number;
}> = ({ usage, totalCost }) => {
  if (!usage && totalCost === 0) return null;

  return (
    <Box marginTop={1}>
      {usage && (
        <Text dimColor>
          tokens: {usage.inputTokens}↓ {usage.outputTokens}↑ | ctx: {usage.contextPercent.toFixed(0)}%
        </Text>
      )}
      {totalCost > 0 && (
        <Text dimColor> | cost: \${totalCost.toFixed(4)}</Text>
      )}
    </Box>
  );
};
\`\`\`

Update the \`App\` component signature and add state:

\`\`\`typescript
export const App: React.FC<AppProps> = ({ dangerouslySkipPermissions = false, logLevel = 'info' }) => {
  // ... existing state ...

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);

  // Abort controller for cancelling the current completion
  const abortControllerRef = useRef<AbortController | null>(null);

  // ... rest of component
\`\`\`

Update \`handleSubmit\` to use pricing, request defaults, and abort controller:

\`\`\`typescript
const handleSubmit = useCallback(async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || loading || !clientRef.current || !config) return;

  setInputText('');
  setInputResetKey((prev) => prev + 1);
  setLoading(true);
  setError(null);

  const userMessage: Message = { role: 'user', content: trimmed };
  setCompletionMessages((prev) => [...prev, userMessage]);

  try {
    const pricing = getModelPricing(config.provider, config.model);
    const requestDefaults = getRequestDefaultParams(config.provider, config.model);

    // Create abort controller for this completion
    abortControllerRef.current = new AbortController();

    const updatedMessages = await runAgenticLoop(
      clientRef.current,
      config.model,
      [...completionMessages, userMessage],
      trimmed,
      (event: AgentEvent) => {
        switch (event.type) {
          case 'text_delta':
            setCompletionMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (event.content || '') }];
              }
              return [...prev, { role: 'assistant', content: event.content || '' }];
            });
            break;
          case 'tool_call':
            if (event.toolCall) {
              setCompletionMessages((prev) => {
                const assistantMsg = {
                  role: 'assistant' as const,
                  content: '',
                  tool_calls: [{
                    id: event.toolCall!.id,
                    type: 'function' as const,
                    function: { name: event.toolCall!.name, arguments: event.toolCall!.args },
                  }],
                };
                return [...prev, assistantMsg as any];
              });
            }
            break;
          case 'tool_result':
            if (event.toolCall) {
              setCompletionMessages((prev) => [
                ...prev,
                {
                  role: 'tool',
                  tool_call_id: event.toolCall!.id,
                  content: event.toolCall!.result || '',
                } as any,
              ]);
            }
            break;
          case 'usage':
            if (event.usage) {
              setLastUsage(event.usage);
              setTotalCost((prev) => prev + event.usage!.cost);
            }
            break;
          case 'iteration_done':
            // Reset assistant message tracker between iterations
            break;
          case 'error':
            setError(event.error || 'Unknown error');
            break;
          case 'done':
            break;
        }
      },
      {
        pricing: pricing || undefined,
        abortSignal: abortControllerRef.current.signal,
        requestDefaults,
      }
    );

    setCompletionMessages(updatedMessages);
  } catch (err: any) {
    setError(\`Error: \${err.message}\`);
  } finally {
    setLoading(false);
  }
}, [loading, config, completionMessages]);
\`\`\`

Add the usage display to the rendered output (before the input box):

\`\`\`tsx
      {initialized && !!lastUsage && (
        <UsageDisplay usage={lastUsage} totalCost={totalCost} />
      )}

      {/* Input */}
      {initialized && !pendingApproval && (
        // ... existing input box
      )}
\`\`\`

## Step 5: Update \`src/cli.tsx\`

Add the \`--log-level\` option:

\`\`\`typescript
program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: error, warn, info, debug, trace')
  .action((options) => {
    render(<App dangerouslySkipPermissions={options.dangerouslySkipPermissions || false} logLevel={options.logLevel || 'info'} />);
  });
\`\`\`

## Verification

\`\`\`bash
npm run dev
\`\`\`

After a few exchanges, you should see token and cost information displayed at the bottom of the UI. For long sessions that approach the context window limit, compaction will automatically kick in.

\`\`\`
 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> hi
✅ Hello — I'm **ProtoAgent**. How can I help today?

- 🔎 *Options I can do right away:* list project files, open or search files, run
tests/build, edit code, or update the TODO.
- ❓ *Tell me what you want:* a short task (e.g., "fix bug X"), or describe a
feature to implement.
- ⚙️ If you want me to start, say which action and I’ll refresh the TODO list and
inspect the code before making changes.

tokens: 1057↓ 100↑ | ctx: 0% | cost: \$0.0005
╭─────────────────────────────────────────────────────╮
│ > Type your message...                              │
╰─────────────────────────────────────────────────────╯
\`\`\`

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-8\`.

## Core takeaway

Compaction is what keeps a long coding session usable instead of quietly degrading once the context window fills up. The cost tracker makes context pressure visible so you (and the agent) can make informed decisions.
`,
  },
  {
    path: "docs/build-your-own/part-9.md",
    content: `# Part 9: Skills & AGENTS.md

Skills and AGENTS.md solve related problems: how do you give the agent project-specific context without restating it in every conversation?

- [**AGENTS.md**](https://agents.md/) provides static project-wide instructions that load automatically from your project root. It's like a system prompt that the user can define as a configuration for a project without changing the code of ProtoAgent, and that is compatible with any other coding agent.
- [**Skills**](https://agentskills.io/home) provide on-demand specialized instructions that the agent loads only when needed. These are more specific to tasks and can include specific workflows. But they can also be large, which is why they are not all added to the messages passed to the LLM at once. Instead, they are only loaded when they are needed.

Together they let ProtoAgent adapt to each project's workflow without manual prompting.

## What you are building

Starting from Part 8, you add:

- \`src/skills.ts\` — skill discovery, validation, activation, and catalog generation
- Updated \`src/system-prompt.ts\` — includes AGENTS.md content and the skills catalog in the prompt
- Updated \`src/utils/path-validation.ts\` — adds \`allowedRoots\` so skill directories are readable

## Install new dependency

\`\`\`bash
npm install yaml
\`\`\`

## Step 1: Update path validation — \`src/utils/path-validation.ts\`

Skills live outside the project directory (e.g., \`~/.config/protoagent/skills/\`), so path validation needs to support additional allowed roots.

\`\`\`typescript
// src/utils/path-validation.ts

import fs from 'node:fs/promises';
import path from 'node:path';

const workingDirectory = process.cwd();
let allowedRoots: string[] = [];

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedPath(targetPath: string): boolean {
  return isWithinRoot(targetPath, workingDirectory) || allowedRoots.some((root) => isWithinRoot(targetPath, root));
}

export async function setAllowedPathRoots(roots: string[]): Promise<void> {
  const normalizedRoots = await Promise.all(
    roots.map(async (root) => {
      const resolved = path.resolve(root);
      try {
        const realRoot = await fs.realpath(resolved);
        return [path.normalize(resolved), realRoot];
      } catch {
        return [path.normalize(resolved)];
      }
    })
  );

  allowedRoots = Array.from(new Set(normalizedRoots.flat()));
}

export function getAllowedPathRoots(): string[] {
  return [...allowedRoots];
}

export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  if (!isAllowedPath(normalized)) {
    throw new Error(\`Path "\${requestedPath}" is outside the working directory.\`);
  }

  try {
    const realPath = await fs.realpath(normalized);
    if (!isAllowedPath(realPath)) {
      throw new Error(\`Path "\${requestedPath}" resolves (via symlink) outside the working directory.\`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        if (!isAllowedPath(realParent)) {
          throw new Error(\`Parent directory of "\${requestedPath}" resolves outside the working directory.\`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(\`Parent directory of "\${requestedPath}" does not exist.\`);
      }
    }
    throw err;
  }
}

export function getWorkingDirectory(): string {
  return workingDirectory;
}
\`\`\`

## Step 2: Create \`src/skills.ts\`

Create the file:

\`\`\`bash
touch src/skills.ts
\`\`\`

Skills use \`SKILL.md\` files with YAML frontmatter as defined in the [specification for agent skills](https://agentskills.io/home). Each skill lives in its own directory. The system discovers skills from multiple locations (project-level and user-level), validates them, and can activate them on demand.

\`\`\`typescript
// src/skills.ts

import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  registerDynamicHandler,
  registerDynamicTool,
  unregisterDynamicHandler,
  unregisterDynamicTool,
} from './tools/index.js';
import { setAllowedPathRoots } from './utils/path-validation.js';
import { logger } from './utils/logger.js';

export interface Skill {
  name: string;
  description: string;
  source: 'project' | 'user';
  location: string;
  skillDir: string;
  body: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface SkillDiscoveryOptions {
  cwd?: string;
  homeDir?: string;
}

interface SkillRoot {
  dir: string;
  source: 'project' | 'user';
}

const ACTIVATE_SKILL_TOOL_NAME = 'activate_skill';
const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\$/;
const MAX_RESOURCE_FILES = 200;

/**
 * Returns the list of directories to search for skills, ordered by precedence.
 * Necessary for: Defining where skills can be installed (user-global vs project-local)
 * and establishing priority (project skills override user skills with same name).
 */
function getSkillRoots(options: SkillDiscoveryOptions = {}): SkillRoot[] {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  return [
    { dir: path.join(homeDir, '.agents', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.protoagent', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.config', 'protoagent', 'skills'), source: 'user' },
    { dir: path.join(cwd, '.agents', 'skills'), source: 'project' },
    { dir: path.join(cwd, '.protoagent', 'skills'), source: 'project' },
  ];
}

// Parses SKILL.md content to extract YAML frontmatter and markdown body.
function parseFrontmatter(rawContent: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = rawContent.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)\$/);
  if (!match) {
    throw new Error('SKILL.md must begin with YAML frontmatter delimited by --- lines.');
  }

  const document = YAML.parse(match[1]);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Frontmatter must parse to an object.');
  }

  return { frontmatter: document as Record<string, unknown>, body: match[2].trim() };
}

// Validates that a skill name follows the kebab-case naming convention.
function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && VALID_SKILL_NAME.test(name);
}

// Normalizes the metadata field from frontmatter into a clean string record.
function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, v]) => typeof v === 'string');
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

// Validates parsed frontmatter and constructs a complete Skill object.
function validateSkill(parsed: { frontmatter: Record<string, unknown>; body: string }, skillDir: string, source: 'project' | 'user', location: string): Skill {
  const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
  const description = typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description.trim() : '';
  const compatibility = typeof parsed.frontmatter.compatibility === 'string' ? parsed.frontmatter.compatibility.trim() : undefined;
  const license = typeof parsed.frontmatter.license === 'string' ? parsed.frontmatter.license.trim() : undefined;
  const allowedToolsValue = typeof parsed.frontmatter['allowed-tools'] === 'string' ? parsed.frontmatter['allowed-tools'].trim() : undefined;

  if (!isValidSkillName(name)) throw new Error(\`Skill name "\${name}" is invalid.\`);
  if (path.basename(skillDir) !== name) throw new Error(\`Skill name "\${name}" must match directory name "\${path.basename(skillDir)}".\`);
  if (!description || description.length > 1024) throw new Error('Skill description is required and must be 1-1024 characters.');

  return {
    name, description, source, location, skillDir, body: parsed.body,
    compatibility, license, metadata: normalizeMetadata(parsed.frontmatter.metadata),
    allowedTools: allowedToolsValue ? allowedToolsValue.split(/\\s+/).filter(Boolean) : undefined,
  };
}

// Loads a single skill from a directory by reading and parsing its SKILL.md file.
async function loadSkillFromDirectory(skillDir: string, source: 'project' | 'user'): Promise<Skill | null> {
  const location = path.join(skillDir, 'SKILL.md');
  try {
    const rawContent = await fs.readFile(location, 'utf8');
    const parsed = parseFrontmatter(rawContent);
    const skill = validateSkill(parsed, skillDir, source, location);
    logger.debug(\`Loaded skill: \${skill.name} (\${source})\`, { location });
    return skill;
  } catch (error) {
    logger.warn(\`Skipping invalid skill at \${location}\`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

// Discovers all valid skills within a single skill root directory.
async function discoverSkillsInRoot(root: SkillRoot): Promise<Skill[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(root.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const loaded = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => loadSkillFromDirectory(path.join(root.dir, entry.name), root.source))
  );

  return loaded.filter((skill): skill is Skill => skill !== null);
}

//Loads all skills from all skill roots, merging duplicates with project taking precedence.
export async function loadSkills(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const roots = getSkillRoots(options);
  const merged = new Map<string, Skill>();

  for (const root of roots) {
    const skills = await discoverSkillsInRoot(root);
    for (const skill of skills) {
      merged.set(skill.name, skill);
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// Escapes special XML characters in a string to prevent injection attacks.
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Builds the XML skills catalog section that appears in the system prompt.
export function buildSkillsCatalogSection(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const catalog = skills
    .map((skill) => [
      '  <skill>',
      \`    <name>\${escapeXml(skill.name)}</name>\`,
      \`    <description>\${escapeXml(skill.description)}</description>\`,
      \`    <location>\${escapeXml(skill.location)}</location>\`,
      '  </skill>',
    ].join('\\n'))
    .join('\\n');

  return \`AVAILABLE SKILLS

The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the \${ACTIVATE_SKILL_TOOL_NAME} tool with the skill's name before proceeding.

<available_skills>
\${catalog}
</available_skills>\`;
}

// Lists all resource files (scripts, references, assets) within a skill directory.
async function listSkillResources(skillDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    if (files.length >= MAX_RESOURCE_FILES) return;
    const absoluteDir = path.join(skillDir, relativeDir);
    let entries: Dirent[] = [];
    try { entries = await fs.readdir(absoluteDir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (files.length >= MAX_RESOURCE_FILES) return;
      const nextRelative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) { await walk(nextRelative); }
      else { files.push(nextRelative.split(path.sep).join('/')); }
    }
  }

  await Promise.all(['scripts', 'references', 'assets'].map((dir) => walk(dir)));
  return files.sort();
}

// Activates a skill by name, returning its content wrapped in XML for the agent.
export async function activateSkill(skillName: string, options: SkillDiscoveryOptions = {}): Promise<string> {
  const skills = await loadSkills(options);
  const skill = skills.find((entry) => entry.name === skillName);
  if (!skill) return \`Error: Unknown skill "\${skillName}".\`;

  const resources = await listSkillResources(skill.skillDir);
  const resourcesBlock = resources.length > 0
    ? \`<skill_resources>\\n\${resources.map((r) => \`  <file>\${escapeXml(r)}</file>\`).join('\\n')}\\n</skill_resources>\`
    : '<skill_resources />';

  return \`<skill_content name="\${escapeXml(skill.name)}">\\n\${skill.body}\\n\\nSkill directory: \${escapeXml(skill.skillDir)}\\nRelative paths in this skill are relative to the skill directory.\\n\\n\${resourcesBlock}\\n</skill_content>\`;
}

// Initializes the skill system at startup - loads skills, sets up security, registers the tool.
export async function initializeSkillsSupport(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const skills = await loadSkills(options);
  await setAllowedPathRoots(skills.map((skill) => skill.skillDir));

  if (skills.length === 0) {
    unregisterDynamicTool(ACTIVATE_SKILL_TOOL_NAME);
    unregisterDynamicHandler(ACTIVATE_SKILL_TOOL_NAME);
    return [];
  }

  registerDynamicTool({
    type: 'function',
    function: {
      name: ACTIVATE_SKILL_TOOL_NAME,
      description: 'Load the full instructions for a discovered skill so you can follow it for the current task.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: skills.map((skill) => skill.name),
            description: 'The exact skill name to activate.',
          },
        },
        required: ['name'],
      },
    },
  });

  registerDynamicHandler(ACTIVATE_SKILL_TOOL_NAME, async (args) => activateSkill(args.name, options));

  return skills;
}
\`\`\`

## Step 3: Update \`src/tools/index.ts\`

Skills are different from AGENTS.md because they are loaded dynamically to avoid taking up space in the LLM's context window. Instead of loading all skill content at startup, we only load a lightweight catalog (name and description). When the agent encounters a task that matches a skill's description, it calls \`activate_skill\` to load the full skill content on-demand.

This requires a dynamic tool system - the \`activate_skill\` tool isn't hardcoded in our tools array. Instead, skills.ts registers it at runtime after discovering which skills are available. This way the tool's \`enum\` parameter always lists the currently installed skills.

Add dynamic tool support to \`src/tools/index.ts\`:

\`\`\`typescript
// Add to src/tools/index.ts:
// src/tools/index.ts

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { bashTool, runBash } from './bash.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
}

export type DynamicTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  bashTool,
  todoReadTool,
  todoWriteTool,
  webfetchTool,
];

let dynamicTools: DynamicTool[] = [];

export function registerDynamicTool(tool: DynamicTool): void {
  const toolName = tool.function.name;
  dynamicTools = dynamicTools.filter((existing) => existing.function.name !== toolName);
  dynamicTools.push(tool);
}

export function unregisterDynamicTool(toolName: string): void {
  dynamicTools = dynamicTools.filter((tool) => tool.function.name !== toolName);
}

export function clearDynamicTools(): void {
  dynamicTools = [];
}

export function getAllTools() {
  return [...tools, ...dynamicTools];
}

// Dynamic tool handlers
const dynamicHandlers = new Map<string, (args: any) => Promise<string>>();

export function registerDynamicHandler(name: string, handler: (args: any) => Promise<string>): void {
  dynamicHandlers.set(name, handler);
}

export function unregisterDynamicHandler(name: string): void {
  dynamicHandlers.delete(name);
}

// Dispatch a tool call to the appropriate handler.
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
      case 'write_file':
        return await writeFile(args.file_path, args.content, context.sessionId);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'bash':
        return await runBash(args.command, args.timeout_ms, context.sessionId);
      case 'todo_read':
        return readTodos(context.sessionId);
      case 'todo_write':
        return writeTodos(args.todos, context.sessionId);
      case 'webfetch': {
        const result = await webfetch(args.url, args.format, args.timeout);
        return JSON.stringify(result);
      }
      default: {
        const handler = dynamicHandlers.get(toolName);
        if (handler) return await handler(args);
        return \`Error: Unknown tool "\${toolName}"\`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return \`Error executing \${toolName}: \${msg}\`;
  }
}
\`\`\`

## Step 4: Update \`src/system-prompt.ts\`

Add both AGENTS.md loading and the skills catalog to the generated prompt.

Replace your \`src/system-prompt.ts\` with this updated version:

\`\`\`typescript
// src/system-prompt.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllTools } from './tools/index.js';
import { buildSkillsCatalogSection, initializeSkillsSupport } from './skills.js';

/**
 * Load AGENTS.md content from cwd and parent directories.
 *
 * AGENTS.md (https://agents.md/) is a simple, open format for guiding coding agents.
 * It's like a README for agents — a dedicated place to give AI coding tools the
 * context they need to work on a project.
 */
async function loadAgentsMd(): Promise<{ content: string; path: string } | null> {
  let currentDir = path.resolve('.');

  while (true) {
    const agentsPath = path.join(currentDir, 'AGENTS.md');
    try {
      await fs.access(agentsPath);
      const content = await fs.readFile(agentsPath, 'utf-8');
      return { content, path: agentsPath };
    } catch {
      // File doesn't exist here — check parent
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
  }

  return null;
}

/** Build a filtered directory tree (depth 3, excludes noise). */
async function buildDirectoryTree(dirPath = '.', depth = 0, maxDepth = 3): Promise<string> {
  if (depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  let tree = '';

  try {
    const fullPath = path.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const filtered = entries.filter((e) => {
      const n = e.name;
      return !n.startsWith('.') && !['node_modules', 'dist', 'build', 'coverage', '__pycache__', '.git'].includes(n) && !n.endsWith('.log');
    });

    for (const entry of filtered.slice(0, 20)) {
      if (entry.isDirectory()) {
        tree += \`\${indent}\${entry.name}/\\n\`;
        tree += await buildDirectoryTree(path.join(dirPath, entry.name), depth + 1, maxDepth);
      } else {
        tree += \`\${indent}\${entry.name}\\n\`;
      }
    }

    if (filtered.length > 20) {
      tree += \`\${indent}... (\${filtered.length - 20} more)\\n\`;
    }
  } catch {
    // Can't read directory — skip
  }

  return tree;
}

/** Auto-generate tool descriptions from their JSON schemas. */
function generateToolDescriptions(): string {
  return getAllTools()
    .map((tool, i) => {
      const fn = tool.function;
      const params = fn.parameters as { required?: string[]; properties?: Record<string, any> };
      const required = params.required || [];
      const props = Object.keys(params.properties || {});
      const paramList = props
        .map((p) => \`\${p}\${required.includes(p) ? ' (required)' : ' (optional)'}\`)
        .join(', ');
      return \`\${i + 1}. \${fn.name} — \${fn.description}\\n   Parameters: \${paramList || 'none'}\`;
    })
    .join('\\n\\n');
}

/** Generate the complete system prompt. */
export async function generateSystemPrompt(): Promise<string> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const tree = await buildDirectoryTree();
  const skills = await initializeSkillsSupport();
  const toolDescriptions = generateToolDescriptions();
  const skillsSection = buildSkillsCatalogSection(skills);
  const agentsMd = await loadAgentsMd();

  const agentsMdSection = agentsMd
    ? \`\\nAGENTS.md INSTRUCTIONS\\n\\nThe following instructions are from the AGENTS.md file at: \${agentsMd.path}\\n\\n\${agentsMd.content}\\n\`
    : '';

  return \`You are ProtoAgent, a coding assistant with file system and shell command capabilities.
Your job is to help the user complete coding tasks in their project.

PROJECT CONTEXT

Working Directory: \${cwd}
Project Name: \${projectName}

PROJECT STRUCTURE:
\${tree}
\${agentsMdSection}
AVAILABLE TOOLS

\${toolDescriptions}
\${skillsSection ? \`\\n\${skillsSection}\\n\` : ''}
GUIDELINES

OUTPUT FORMAT:
- You are running in a terminal. Be concise. Optimise for scannability.
- Use **bold** for important terms, *italic* for references.
- Use flat bullet lists with emojis to communicate information densely (e.g. ✅ done, ❌ failed, 📁 file, 🔍 searching).
- NEVER use nested indentation. Keep all lists flat — one level only.

WORKFLOW:
- Before making tool calls, briefly explain what you're about to do and why.
- Always read files before editing them.
- Prefer edit_file over write_file for existing files.
- Use TODO tracking (todo_write / todo_read) by default for almost all work.
- Start by creating or refreshing the TODO list before doing substantive work, then keep it current throughout the task.
- Search first when you need to find something — use search_files or bash with grep/find.
- Shell commands: safe commands (ls, grep, git status, etc.) run automatically. Other commands require user approval.

FILE OPERATIONS:
- ALWAYS use read_file before editing to get exact content.
- NEVER write over existing files unless explicitly asked — use edit_file instead.
- Create parent directories before creating files in them.
- Use bash for package management, git, building, testing, etc.

IMPLEMENTATION STANDARDS:
- Thorough investigation: Before implementing, understand the existing codebase, patterns, and related systems.
- Completeness: Ensure implementations are complete and tested, not partial or left in a broken state.
- Code quality: Follow existing code style and conventions.\`;
}
\`\`\`

## About AGENTS.md

[AGENTS.md](https://agents.md/) is a simple, open format for guiding coding agents. Think of it as a README for agents — a dedicated place to give AI coding tools the context they need to work on your project.

ProtoAgent automatically loads \`AGENTS.md\` from your working directory and walks up parent directories until it finds one. If found, its contents are injected into the system prompt.

### Example AGENTS.md

\`\`\`markdown
# Project Instructions

- Say 'BEEP BEEP' before every message

## Build
- Use \`npm run build\` to compile TypeScript
- Use \`npm run dev\` for development mode with hot reload

## Testing
- Run \`npm test\` for unit tests

## Code Style
- Use TypeScript strict mode
- Prefer named exports over default exports
\`\`\`

### AGENTS.md vs Skills

| AGENTS.md | Skills (SKILL.md) |
|-----------|-------------------|
| Automatically loaded on startup | Loaded on-demand via \`activate_skill\` |
| Static project context | Specialized, task-specific instructions |
| Lives at project root | Lives in \`.agents/skills/\` directories |
| Always included in prompt | Only included when explicitly requested |

Use **AGENTS.md** for project-wide conventions that should always be available. Use **Skills** for specialized, reusable instructions that should only be loaded when needed.

## Verification

### Testing AGENTS.md

Create an \`AGENTS.md\` file in your project root:

\`\`\`markdown
# Project Instructions

- Say 'BEEP BEEP' before every message

## Build
- Use \`npm run build\` to compile TypeScript
- Use \`npm run dev\` for development mode with hot reload

## Testing
- Run \`npm test\` for unit tests

## Code Style
- Use TypeScript strict mode
- Prefer named exports over default exports
\`\`\`

Run the app and check that the AGENTS.md content appears in the system prompt. Ask the agent "how do I build this project?" — it should reference the build commands from AGENTS.md.

### Testing Skills

Create a test skill:

\`\`\`bash
mkdir -p .protoagent/skills/test-conventions
\`\`\`

Create \`.protoagent/skills/test-conventions/SKILL.md\`:

\`\`\`markdown
---
name: test-conventions
description: Project testing conventions and standards
---

When writing tests for this project:
- Use vitest as the test runner
- Place test files next to source files with .test.ts extension
- Use describe/it blocks
\`\`\`

Run the app and ask about testing conventions. The agent should discover the skill, show it in the available skills catalog, and activate it when relevant to the task.

\`\`\`

 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> what are you skills?
BEEP BEEP

Here are the skills and capabilities I can use for this project environment:

- 🔍 **Available agent skills**
- ✅ **find-skills** — Helps discover/install agent skills when you ask things like
*“find a skill for X”* or *“is there a skill that can…”* (location:
.agents/skills/find-skills/SKILL.md)
- ✅ **test-conventions** — Provides project testing conventions and standards
(location: .protoagent/skills/test-conventions/SKILL.md)

tokens: 1057↓ 100↑ | ctx: 0% | cost: \$0.0005
╭─────────────────────────────────────────────────────╮
│ > Type your message...                              │
╰─────────────────────────────────────────────────────╯
\`\`\`

## Resulting snapshot

Your project should match \`protoagent-build-your-own-checkpoints/part-9\`.

## Core takeaway

AGENTS.md and Skills are complementary ways to give the agent project context. AGENTS.md provides static, always-available instructions for the current project. Skills provide dynamic, on-demand instructions that can be shared across projects. Together they let ProtoAgent adapt to each project's workflow without manual prompting.
`,
  },
  {
    path: "docs/index.md",
    content: `---
layout: home

hero:
  eyebrow: PROTOAGENT
  title: A coding agent you can build yourself
  text: Coding agents can feel like magic. ProtoAgent is a lean, readable implementation that pulls back the curtain, giving you the blueprint to understand and build your own.
  subtext: Small enough to understand in a 20 minutes, simple enough to build yourself in an afternoon, usable enough to try out on an actual project.
  actions:
    - theme: brand
      text: Build Your Own
      link: /build-your-own/
    - theme: alt
      text: Try it out
      link: /try-it-out/getting-started

features:
  - title: CORE AGENTIC LOOP
    tag: the core of the coding agent
    details: ProtoAgent streams model output, executes tools, appends results, retries transient failures, and keeps going until the model can answer directly.
  - title: FILES, SHELL, AND WEB
    tag: taking action
    details: It can read, write, and edit files, search a repo, run shell commands with approvals, fetch docs from the web, and keep a TODO list while it works.
  - title: APPROVE TOOL USES
    tag: local safety rails
    details: Writes, edits, and non-safe shell commands go through inline approvals, while a small set of dangerous shell patterns stays blocked outright.
  - title: SESSIONS
    tag: persistent context
    details: Sessions are saved to disk with message history and TODOs, so you can quit, come back later, and keep working without starting from scratch.
  - title: SKILLS AND MCP
    tag: easy extension points
    details: Skills let you package project-specific instructions, and MCP lets you connect external tools without hardcoding them into the app.
  - title: SUB-AGENTS
    tag: keep context clean
    details: Focused research can be pushed into child runs so the parent conversation stays lighter and easier to follow.
---
`,
  },
  {
    path: "docs/public/favicon.svg",
    content: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>
  <rect width="100" height="100" fill="#0a180e" rx="20"/>
  <text x="50" y="42" font-family="monospace" font-size="32" fill="#72ff8c" text-anchor="middle" filter="url(#glow)" font-weight="bold">█▀█</text>
  <text x="50" y="74" font-family="monospace" font-size="32" fill="#72ff8c" text-anchor="middle" filter="url(#glow)" font-weight="bold">█▀▀</text>
</svg>`,
  },
  {
    path: "docs/reference/acknowledgements.md",
    content: `# Acknowledgements

ProtoAgent was inspired by and built upon ideas from these excellent open-source
coding agents:

- [Codex](https://github.com/openai/codex) - OpenAI's official CLI coding agent
- [Gemini CLI](https://github.com/google-gemini/gemini-cli) - Google's terminal-based
coding assistant
- [OpenCode](https://github.com/anomalyco/opencode) - An open, hackable coding agent
- [Pi Mono](https://github.com/badlogic/pi-mono) - A minimal, extensible agent
implementation

These projects demonstrated different approaches to the agentic loop, tool calling,
and terminal UX that informed ProtoAgent's design.
`,
  },
  {
    path: "docs/reference/architecture.md",
    content: `# Architecture

This page is the docs-site companion to the root \`ARCHITECTURE.md\`.

If you are reading the repo directly, \`ARCHITECTURE.md\` is the fuller source of truth. This page is the shorter walkthrough for when you mostly want to understand how the pieces fit together.

For the companion behavior reference, see \`/reference/spec\` or the root \`SPEC.md\`.

## 1. High-level Structure

\`\`\`text
protoagent CLI
  -> App (Ink)
     -> Agentic Loop
        -> OpenAI SDK client
        -> 9 built-in tools
        -> Dynamic tools from MCP and skills
        -> Special sub-agent execution path
\`\`\`

At runtime, the user interacts with the Ink app, while the agent loop handles model/tool orchestration and emits events back to the UI.

## 2. Module Map

Main implementation areas:

- \`src/cli.tsx\` — CLI entry point, Commander-based argument parsing
- \`src/App.tsx\` — Ink TUI, session lifecycle, approvals, slash commands, config flows, MCP lifecycle
- \`src/agentic-loop.ts\` — Tool-use loop with streaming, error recovery, sub-agent routing, compaction
- \`src/system-prompt.ts\` — Dynamic prompt with directory tree, tool descriptions, skills catalog
- \`src/sub-agent.ts\` — Isolated child agent runs
- \`src/config.tsx\` — Config persistence, legacy format support, API key resolution, ConfigureComponent wizard
- \`src/providers.ts\` — Provider catalog with OpenAI, Anthropic, Google Gemini, Cerebras
- \`src/sessions.ts\` — Session persistence with UUID IDs and hardened permissions
- \`src/skills.ts\` — SKILL.md discovery from 5 roots, YAML frontmatter parsing, validation, activation
- \`src/mcp.ts\` — MCP client for stdio and HTTP servers using \`@modelcontextprotocol/sdk\`
- \`src/runtime-config.ts\` — Merged \`protoagent.jsonc\` from 3 locations with env var interpolation
- \`src/tools/index.ts\` — 9 static tools + dynamic tool registry
- \`src/tools/*\` — Individual tool implementations
- \`src/components/*\` — Ink UI components: CollapsibleBox, ConsolidatedToolMessage, FormattedMessage, Table, LeftBar, ConfigDialog
- \`src/utils/logger.ts\` — File-based logger with levels (ERROR/WARN/INFO/DEBUG/TRACE) and in-memory buffer (last 100 entries)
- \`src/utils/cost-tracker.ts\` — Token estimation (~4 chars/token), cost calculation
- \`src/utils/compactor.ts\` — Conversation compaction at 90% context utilization
- \`src/utils/approval.ts\` — Approval system: per-operation, per-session, or --dangerously-skip-permissions
- \`src/utils/path-validation.ts\` — Path security with allowedRoots for skills
- \`src/utils/file-time.ts\` — Read-before-edit staleness guard (per-session file modification tracking)

## 3. Startup Flow

Current startup path:

1. \`src/cli.tsx\` parses arguments with Commander.
2. \`App\` initializes logging and sets up approval handling.
3. Runtime config is loaded from the active \`protoagent.jsonc\` file (project if present, otherwise user).
4. Config is loaded or inline setup is shown.
5. The OpenAI client is created from provider metadata.
6. MCP is initialized, which connects servers and registers dynamic tools.
7. A saved session is resumed or a new session is created.
8. The initial system prompt is generated (which also initializes skills).

## 4. Turn Execution Flow

For a normal user message:

1. \`App\` appends the user message immediately.
2. \`runAgenticLoop()\` refreshes the system prompt and compacts history if needed.
3. The model streams assistant text and/or tool calls.
4. Tool calls are executed through the tool system, except \`sub_agent\`, which is handled specially in the loop.
5. Tool results are appended to history.
6. The loop repeats until plain assistant text is returned.
7. \`App\` saves the session and TODO state.

The loop communicates back to the UI via these event types: \`text_delta\`, \`tool_call\`, \`tool_result\`, \`sub_agent_iteration\`, \`usage\`, \`error\`, \`done\`, \`iteration_done\`.

\`sub_agent_iteration\` carries sub-agent progress (tool name + status) separately from \`tool_call\` so the UI can show it in the spinner without adding entries to the parent's tool-call message history.

## 5. Message and Session Model

The core app state centers on:

- \`completionMessages\` — the full message history
- the current session object (UUID, title, timestamps, provider, model, TODOs)
- per-session TODO state (in memory, persisted with session)
- a live \`assistantMessageRef\` used during streaming updates

Sessions are stored at \`~/.local/share/protoagent/sessions/\` with \`0o600\` file permissions.

## 6. Tool Architecture

Static built-ins come from \`src/tools/index.ts\` and \`src/tools/*\`:

- \`read_file\`, \`write_file\`, \`edit_file\`, \`list_directory\`, \`search_files\`
- \`bash\`
- \`todo_read\`, \`todo_write\`
- \`webfetch\`

Dynamic tools can be registered by:

- \`src/mcp.ts\` — registers \`mcp_<server>_<tool>\` tools
- \`src/skills.ts\` — registers \`activate_skill\` tool

\`sub_agent\` is a special-case tool exposed by the agentic loop rather than the normal registry.

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

1. discovers validated \`SKILL.md\` directories from 5 roots
2. may register \`activate_skill\` as a dynamic tool
3. extends allowed file roots to skill directories (via \`setAllowedPathRoots\`)
4. builds a catalog section for the system prompt

Because skill initialization happens during system-prompt generation, it has runtime side effects on both tool registration and path-access roots.

## 9. MCP Architecture

\`src/mcp.ts\` reads the active \`protoagent.jsonc\` runtime config, connects stdio (\`StdioClientTransport\`) or HTTP (\`StreamableHTTPClientTransport\`) MCP servers, discovers their tools via \`listTools()\`, and registers them dynamically with \`registerDynamicTool\` and \`registerDynamicHandler\`.

Tool names are prefixed: \`mcp_<server>_<tool>\`. Tool results are flattened from content blocks to strings.

## 10. Sub-Agent Architecture

\`src/sub-agent.ts\` runs isolated child loops with a fresh prompt and message history. Children use the normal built-in and dynamic tools via \`getAllTools()\`, but do not recursively expose \`sub_agent\`. Default iteration limit is 100. Child TODOs are ephemeral (keyed by \`sub-agent-<uuid>\`) and cleared on completion.

**Abort propagation:** the parent's \`AbortSignal\` is passed through to \`runSubAgent()\`, to the child's \`client.chat.completions.create()\` call, and to each \`handleToolCall()\` invocation. Pressing Escape stops the child as soon as the in-flight request or tool call acknowledges the signal.

**AbortSignal listener limit:** the same \`AbortSignal\` is shared across every API call in the loop. The OpenAI SDK attaches one \`abort\` listener per call, so on a long run the default Node.js limit of 10 listeners per \`EventTarget\` is exceeded, producing a \`MaxListenersExceededWarning\`. \`AbortSignal\` is a Web API \`EventTarget\` with no \`.setMaxListeners()\` instance method, so the fix uses the standalone \`setMaxListeners(0, abortSignal)\` from \`node:events\`, which supports both \`EventEmitter\` and \`EventTarget\`. This is called once at the start of \`runAgenticLoop\`, scoped to that signal only.

**UI progress isolation:** sub-agent tool steps are reported via \`onProgress\` callbacks that the agentic loop converts to \`sub_agent_iteration\` events. The UI handles these by updating the spinner label only — never touching \`completionMessages\` or \`assistantMessageRef\` — keeping the parent conversation history clean.

## 11. Conversation Compaction and Cost Tracking

ProtoAgent estimates token usage (~4 chars/token), tracks context-window usage, and compacts old conversation history at 90% utilization. Compaction preserves protected skill payloads (messages containing \`<skill_content\`) and the 5 most recent messages. The compaction prompt produces a structured \`<state_snapshot>\` summary.

If the API returns a 400 error indicating the prompt is too long (e.g. \`prompt too long\`, \`context length exceeded\`), the loop attempts forced compaction by treating current usage as 100% of the context window, then falls back to truncating oversized \`role: 'tool'\` messages exceeding 20,000 characters. This handles large MCP tool results such as base64 screenshot blobs.

## 12. Terminal UI

\`src/App.tsx\` is both the visible UI layer and the runtime coordinator for:

- slash commands (\`/collapse\`, \`/expand\`, \`/help\`, \`/quit\`, \`/exit\`)
- session lifecycle (create, save, resume, clear)
- approvals (interactive prompt with approve-once, approve-session, reject)
- config flows (inline first-run setup)
- MCP lifecycle (initialize, close)
- event-driven rendering of the agentic loop

The UI also includes collapsible message boxes, grouped tool rendering, formatted assistant output, usage display, debounced text input, spinner, and terminal resize handling.

### LeftBar

Tool calls, approvals, errors, and code blocks are visually offset with a bold \`│\` bar on the left (\`src/components/LeftBar.tsx\`), similar to a GitHub callout block.

This is deliberately not a \`<Box borderStyle>\`. Box borders add lines on all four sides, which increases Ink's managed line count and makes resize ghosting worse — Ink erases by line count, so any extra rows it doesn't expect to own can leave stale lines on screen. \`LeftBar\` instead renders a plain \`<Text>\` column containing \`│\` repeated once per content row. The row count comes from \`measureElement\` called after each render, so the bar always matches the content height exactly. Total line count equals the children's line count with no overhead.

### Static scrollback

Completed conversation turns are flushed to Ink's \`<Static>\` component, which writes them once above the managed region and removes them from the re-render cycle. Full history is available via session resume (\`--session\`).

## 13. Important Implementation Nuances

These are the details that are easy to miss if you only skim the file tree:

- \`App.tsx\` is not just presentation — it coordinates session, MCP, config, and approval lifecycles
- the system prompt is regenerated repeatedly (on each loop iteration)
- skills initialization mutates runtime state (tool registration and path roots)
- \`sub_agent\` is not part of \`getAllTools()\` — it is injected by the agentic loop
- some tool failures flow back as tool-result strings rather than thrown errors
- the agentic loop sanitizes malformed tool calls (normalizes/repairs malformed JSON, detects repeated string patterns)
- error recovery includes retry logic for 400 (context-too-long), 429, and 5xx responses
- \`sub_agent_iteration\` events are handled by \`App\` in a separate case that only updates the spinner; they never touch \`completionMessages\` or \`assistantMessageRef\`
- the loop includes retrigger logic: after tool calls complete, if the model returns an empty response, the loop auto-retries rather than returning to the user
- a sub-agent that calls tools but produces no final text returns the sentinel string \`'(sub-agent completed with no response)'\`; this is logged at debug level and is not an error

## 14. Shutdown and Lifecycle Boundaries

Graceful quit (\`/quit\` or \`/exit\`) saves the session and shows a resume command. Immediate \`Ctrl-C\` exits without that quit flow. App cleanup clears approval handlers and closes MCP connections.

## 15. Extension Points

The main extension surfaces are:

- \`src/providers.ts\` — add built-in providers
- \`src/tools/*\` — add built-in tools
- \`src/skills.ts\` — skill discovery and activation
- \`src/mcp.ts\` — MCP server integration
- \`src/sub-agent.ts\` — child agent execution
- \`src/components/*\` — UI components
- \`protoagent.jsonc\` — runtime provider, model, and MCP configuration
`,
  },
  {
    path: "docs/reference/cli.md",
    content: `# CLI Reference

## Basic usage

\`\`\`bash
protoagent [options] [command]
\`\`\`

Running with no command starts the interactive TUI.

## Commands

### \`protoagent\`

Starts the main interactive app. If no config exists, ProtoAgent shows the first-run setup flow inside the TUI.

### \`protoagent configure\`

Launches the configuration wizard for provider, model, and API key selection.

Interactive mode (default):
\`\`\`bash
protoagent configure
\`\`\`

Non-interactive mode with flags:
\`\`\`bash
protoagent configure --provider <id> --model <id> --api-key <key>
protoagent configure --provider <id> --model <id> --api-key <key> --project
protoagent configure --provider <id> --model <id> --api-key <key> --user
\`\`\`

Flags:
- \`--provider <id>\` — select provider by ID (e.g., \`openai\`, \`anthropic\`)
- \`--model <id>\` — select model by ID (e.g., \`gpt-5.2\`, \`claude-sonnet-4-6\`)
- \`--api-key <key>\` — set the API key
- \`--project\` — save to project config (\`<cwd>/.protoagent/protoagent.jsonc\`)
- \`--user\` — save to user config (\`~/.config/protoagent/protoagent.jsonc\`)

When both \`--project\` and \`--user\` are omitted, ProtoAgent defaults to project config.

### \`protoagent init\`

Creates a starter \`protoagent.jsonc\` and lets you choose between:

- project-local config in \`<cwd>/.protoagent/protoagent.jsonc\`
- shared user config in \`~/.config/protoagent/protoagent.jsonc\` on macOS/Linux or \`%USERPROFILE%/AppData/Local/protoagent/protoagent.jsonc\` on Windows

After the file is created, ProtoAgent prints the full path. If the target file already exists, it is not overwritten.

For non-interactive usage:

\`\`\`bash
protoagent init --project
protoagent init --user
protoagent init --project --force
\`\`\`

- \`--project\` writes \`<cwd>/.protoagent/protoagent.jsonc\`
- \`--user\` writes the shared user config path
- \`--force\` overwrites an existing target file

## Flags

### \`--dangerously-skip-permissions\`

Skips normal approval prompts for file writes, file edits, and non-safe shell commands.

Hard-blocked shell patterns are still denied.

\`\`\`bash
protoagent --dangerously-skip-permissions
\`\`\`

### \`--log-level <level>\`

Controls log verbosity. Default is \`INFO\`.

| Level | Meaning |
|---|---|
| \`ERROR\` | only errors |
| \`WARN\` | errors and warnings |
| \`INFO\` | normal operational info |
| \`DEBUG\` | detailed debugging output |
| \`TRACE\` | very verbose tracing |

ProtoAgent initializes a log file and shows its path in the UI.

### \`--session <id>\`

Resumes a previously saved session by ID.

\`\`\`bash
protoagent --session abc123de
\`\`\`

Session IDs are 8-character alphanumeric strings (a-z, 0-9). Legacy UUID format is also accepted.

### \`--version\`

Prints the current version.

## Slash commands

| Command | What it does |
|---|---|
| \`/quit\` | save the session and exit |
| \`/exit\` | alias for \`/quit\` |
| \`/collapse\` | collapse all long messages |
| \`/expand\` | expand all collapsed messages |
| \`/help\` | show available slash commands |

When quitting through \`/quit\` or \`/exit\`, ProtoAgent prints the exact \`protoagent --session <id>\` resume command.

## Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| \`Esc\` | abort the current in-flight completion |
| \`Ctrl-C\` | exit immediately |
`,
  },
  {
    path: "docs/reference/spec.md",
    content: `# Specification

This page is the docs-site companion to the root \`SPEC.md\`.

If you are reading the repo directly, \`SPEC.md\` is the fuller source of truth. This page keeps the same shape, but trims it down to the parts you usually want when you are trying to understand how ProtoAgent works right now.

For the companion runtime/module walkthrough, see \`/reference/architecture\` or the root \`ARCHITECTURE.md\`.

## 1. Goals

ProtoAgent is designed to stay:

- readable
- useful for real coding work
- extensible through tools, skills, MCP, and delegated runs

## 2. Architecture Overview

\`\`\`text
CLI (Commander)
  -> Ink TUI
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools (9 static)
        -> Dynamic tools from skills and MCP
        -> Special sub-agent tool
\`\`\`

Main implementation areas live in:

- \`src/cli.tsx\`
- \`src/App.tsx\`
- \`src/agentic-loop.ts\`
- \`src/tools/*\`
- \`src/sessions.ts\`
- \`src/skills.ts\`
- \`src/mcp.ts\`
- \`src/sub-agent.ts\`
- \`src/runtime-config.ts\`

## 3. CLI and Interaction Model

Current entry points and flags:

- \`protoagent\`
- \`protoagent configure\`
- \`--dangerously-skip-permissions\`
- \`--log-level <level>\` (default: \`INFO\`)
- \`--session <id>\`
- \`--version\`

Current slash commands:

- \`/collapse\`
- \`/expand\`
- \`/help\`
- \`/quit\`
- \`/exit\` (alias for \`/quit\`)

Keyboard shortcuts:

- \`Esc\` aborts the current completion
- \`Ctrl-C\` exits immediately

## 4. Configuration System

ProtoAgent uses a single configuration file: \`protoagent.jsonc\`.

Active config lookup is:

1. \`<cwd>/.protoagent/protoagent.jsonc\` if it exists
2. otherwise the shared user config at \`~/.config/protoagent/protoagent.jsonc\` on macOS/Linux or \`%USERPROFILE%/AppData/Local/protoagent/protoagent.jsonc\` on Windows

The first provider entry in the file is treated as the active provider, and the first model entry inside that provider is treated as the active model.

\`protoagent.jsonc\` may define:

- provider additions or overrides
- model metadata overrides
- request default parameters
- MCP server configuration

Environment variables remain higher priority than file-based transport and auth config.

The current implementation supports:

- inline first-run setup
- \`protoagent configure\`
- provider environment-variable fallback
- JSONC-based runtime provider and MCP extension
- environment variable interpolation with \`\${VAR}\` syntax

## 5. Provider and Model Support

Built-in providers ship in \`src/providers.ts\`:

| Provider | Models |
|---|---|
| **OpenAI** | GPT-5.4, GPT-5.4 Pro, GPT-5.2, GPT-5 Mini, GPT-5 Nano, GPT-4.1 |
| **Anthropic Claude** | Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5 |
| **Google Gemini** | Gemini 3 Flash (Preview), Gemini 3 Pro (Preview), Gemini 2.5 Flash, Gemini 2.5 Pro |

The active runtime registry is the result of built-in providers plus the active \`protoagent.jsonc\` file.

Providers may be added or overridden by ID. Each model entry includes context-window and pricing metadata and may also define per-model request defaults. Reserved request fields are stripped from config defaults.

## 6. Agentic Loop

The loop in \`src/agentic-loop.ts\`:

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

- \`read_file\`
- \`write_file\`
- \`edit_file\`
- \`list_directory\`
- \`search_files\`
- \`bash\`
- \`todo_read\`
- \`todo_write\`
- \`webfetch\`

Dynamic tools:

- \`activate_skill\` — registered when skills are discovered
- \`sub_agent\` — exposed specially by the loop
- \`mcp_<server>_<tool>\` — registered from MCP servers

## 8. File and Path Safety

Current rules include:

- file access limited to the working directory plus allowed skill roots
- symlink-aware validation
- parent-directory checks for non-existent files
- staleness guard requiring read-before-edit (tracked per session via file-time)

## 9. Approval Model

ProtoAgent uses three approval categories:

- \`file_write\`
- \`file_edit\`
- \`shell_command\`

Approval can be granted:

- per-operation (one-time)
- per-type for the session
- globally via \`--dangerously-skip-permissions\`

Hard-blocked shell patterns are always denied, even with \`--dangerously-skip-permissions\`. If no approval handler is registered, operations fail closed (rejected).

## 10. Session Persistence

Sessions are stored at \`~/.local/share/protoagent/sessions/\` as JSON files named by UUID.

Sessions persist:

- completion messages
- provider/model metadata
- timestamps and title
- TODO state

They are resumed with \`--session <id>\`.

## 11. Cost Tracking and Compaction

ProtoAgent estimates token usage (~4 chars/token heuristic), calculates cost from provider pricing metadata, tracks context utilization percentage, and compacts old conversation state at 90% context usage. Compaction preserves protected skill payloads and recent messages (last 5 kept verbatim).

## 12. Skills

Skills are validated local directories containing \`SKILL.md\` with YAML frontmatter. They are discovered from 5 roots (3 user, 2 project) and activated on demand via \`activate_skill\`. Skill directories are added as allowed path roots for file access.

## 13. MCP Support

ProtoAgent supports:

- stdio MCP servers (spawned as child processes via \`StdioClientTransport\`)
- HTTP / Streamable HTTP MCP servers (via \`StreamableHTTPClientTransport\`)

MCP server config is sourced from the active \`protoagent.jsonc\` runtime config. Remote tools are discovered via \`listTools()\` and registered dynamically at startup with names like \`mcp_<server>_<tool>\`.

## 14. Web Fetching

\`webfetch\` supports output formats:

- \`text\`
- \`markdown\`
- \`html\`

with URL, timeout, redirect, MIME, and size limits enforced in \`src/tools/webfetch.ts\`.

## 15. Sub-agents

\`sub_agent\` creates isolated child runs with their own message history and system prompt. Children use the normal tool stack but do not recursively expose \`sub_agent\`. Default iteration limit is 100. Child TODOs are ephemeral and cleared on completion.

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

- \`ERROR\`
- \`WARN\`
- \`INFO\`
- \`DEBUG\`
- \`TRACE\`

## 18. Known Omissions and Intentional Limits

Intentional omissions include:

- sandboxing
- skill permission enforcement
- MCP OAuth
- session branching
- non-interactive RPC/server modes
`,
  },
  {
    path: "docs/try-it-out/agents.md",
    content: `# AGENTS.md

AGENTS.md is a simple, open format for guiding coding agents. Think of it as a README for agents — a dedicated, predictable place to give AI coding tools the context they need to work on your project.

The format is documented at [https://agents.md](https://agents.md) and supported by many AI coding tools including OpenAI Codex, GitHub Copilot, Cursor, and Aider.

## How ProtoAgent uses AGENTS.md

When ProtoAgent starts, it looks for an \`AGENTS.md\` file in your working directory and walks up parent directories until it finds one. If found, its contents are injected into the system prompt before the first user message.

The hierarchy works as follows:
- ProtoAgent checks the current working directory first
- Then walks up parent directories (useful for monorepos with nested projects)
- The first \`AGENTS.md\` found wins
- If no \`AGENTS.md\` exists, ProtoAgent runs without custom instructions

## What to put in AGENTS.md

AGENTS.md is ideal for project-wide conventions that should always be in the agent's context:

- Build commands (\`npm run build\`, \`make\`, etc.)
- Test commands (\`npm test\`, \`pytest\`, etc.)
- Code style preferences
- Architecture guidelines
- File organization patterns
- Dependencies and frameworks used

## Example AGENTS.md

\`\`\`markdown
# Project Instructions

## Build
- Use \`npm run build\` to compile TypeScript
- Use \`npm run dev\` for development mode with hot reload

## Testing
- Run \`npm test\` for unit tests
- Run \`npm run test:integration\` for integration tests

## Code Style
- Use TypeScript strict mode
- Prefer named exports over default exports
- Use camelCase for variables and functions
- Use PascalCase for types and interfaces

## Architecture
- This is a Node.js CLI tool built with Ink for terminal UI
- Source code lives in \`src/\` directory
- Tools are organized by domain in \`src/tools/\`
\`\`\`

## Relationship to Skills

AGENTS.md and Skills serve different purposes:

| AGENTS.md | Skills (SKILL.md) |
|-----------|-------------------|
| Automatically loaded on startup | Loaded on-demand via \`activate_skill\` |
| Static project context | Specialized, task-specific instructions |
| Lives at project root | Lives in \`.agents/skills/\` directories |
| Always included in prompt | Only included when explicitly requested |

Use AGENTS.md for project-wide conventions that should always be available. Use Skills for specialized, reusable instructions that should only be loaded when needed.

See the tutorial for implementing both: [Part 9 - Skills & AGENTS.md](/build-your-own/part-9)

## File location

ProtoAgent only looks for \`AGENTS.md\` (case-sensitive) in the filesystem hierarchy. It does not support the global \`~/.agents/\` location that some tools use.

## Specification

The AGENTS.md format is stewarded by the [Agentic AI Foundation](https://agentic.ai/) under the Linux Foundation. See [https://agents.md](https://agents.md) for the full specification.
`,
  },
  {
    path: "docs/try-it-out/configuration.md",
    content: `# Configuration

ProtoAgent uses a runtime config file: \`protoagent.jsonc\`.

It stores:

- provider definitions and overrides
- MCP servers
- request defaults

## Config locations

ProtoAgent checks for config in two locations. The first one found wins:

1. \`<process.cwd()>/.protoagent/protoagent.jsonc\` (project config)
2. \`~/.config/protoagent/protoagent.jsonc\` (user config)

Project config takes precedence, allowing per-project overrides of user defaults.

## \`protoagent init\`

Use \`protoagent init\` when you want ProtoAgent to create a starter \`protoagent.jsonc\` for you.

It offers two targets:

- project-local: \`<process.cwd()>/.protoagent/protoagent.jsonc\`
- shared user config: \`~/.config/protoagent/protoagent.jsonc\` on macOS/Linux, \`%USERPROFILE%/AppData/Local/protoagent/protoagent.jsonc\` on Windows

After creating the file, ProtoAgent prints the exact path so you can open and edit it immediately. If the file already exists, it leaves it untouched and prints that existing path instead.

For non-interactive usage, you can target the destination directly:

\`\`\`bash
protoagent init --project
protoagent init --user
protoagent init --project --force
\`\`\`

\`--force\` overwrites an existing target file with the starter template.

See the tutorial for implementing config management: [Part 3 - Configuration Management](/build-your-own/part-3)

## \`protoagent.jsonc\`

This file may define:

- custom providers
- overrides to built-in providers
- custom model metadata
- request default parameters
- MCP servers

Example:

\`\`\`jsonc
{
  "providers": {
    "gemini": {
      "name": "Google Gemini",
      "baseURL": "https://generativelanguage.googleapis.com/v1beta/openai/",
      "apiKey": "\${GEMINI_API_KEY}",
      "models": {
        "gemini-3-flash": {
          "name": "Gemini 3 Flash",
          "contextWindow": 1000000
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
\`\`\`

See the tutorial for implementing runtime configuration: [Part 11 - Runtime Config](/build-your-own/part-11)

## Precedence rules

At runtime, ProtoAgent resolves the API key in this order:

1. Provider-specific environment variable (\`apiKeyEnvVar\`, e.g. \`OPENAI_API_KEY\`)
2. Generic environment variable (\`PROTOAGENT_API_KEY\`)
3. \`apiKey\` in \`protoagent.jsonc\`

If no API key is found but custom headers are configured, ProtoAgent returns \`'none'\` for header-based authentication (e.g., Cloudflare Gateway setups).

Base URL precedence:

1. \`PROTOAGENT_BASE_URL\`
2. \`provider.baseURL\`
3. built-in default

Header precedence:

1. \`PROTOAGENT_CUSTOM_HEADERS\`
2. \`provider.headers\`
3. built-in default headers

## Built-in providers and models

Built-in providers have default environment variables. Set the corresponding env var to use a provider without any config file:

| Provider | Env Var | Models |
|---|---|---|
| **openai** | \`OPENAI_API_KEY\` | GPT-5.4 (200k), GPT-5.4-pro (200k), GPT-5.2 (200k), GPT-5 Mini (200k), GPT-5 Nano (200k), GPT-4.1 (128k) |
| **anthropic** | \`ANTHROPIC_API_KEY\` | Claude Opus 4.6 (200k), Claude Sonnet 4.6 (200k), Claude Haiku 4.5 (200k) |
| **google** | \`GEMINI_API_KEY\` | Gemini 3 Flash Preview (1M), Gemini 3 Pro Preview (1M), Gemini 2.5 Flash (1M), Gemini 2.5 Pro (1M) |

Example:

\`\`\`bash
export OPENAI_API_KEY=sk-...
protoagent --provider openai --model gpt-5.2
\`\`\`

You can override these in \`protoagent.jsonc\` by defining \`apiKey\` or \`apiKeyEnvVar\`.

See the tutorial for how built-in providers are set up: [Part 3 - Provider Catalog](/build-your-own/part-3)

### Extending built-in providers

\`protoagent.jsonc\` can:

- add a new provider
- override a built-in provider by ID
- override a model entry by model ID under a provider

Each model may include:

- display name
- context window
- input pricing (\`inputPricePerMillion\`)
- output pricing (\`outputPricePerMillion\`)
- cached token pricing (\`cachedPricePerMillion\`) - for providers that support prompt caching
- model-level \`defaultParams\`

Providers may include provider-level \`defaultParams\` that apply to all models unless a model overrides them.

Reserved request fields are stripped from config-defined defaults and logged as warnings. These reserved keys include: \`model\`, \`messages\`, \`tools\`, \`tool_choice\`, \`stream\`, \`stream_options\`.

## MCP configuration

MCP server configuration lives inside \`protoagent.jsonc\` under \`mcp.servers\`.

ProtoAgent supports:

- stdio MCP servers
- HTTP / Streamable HTTP MCP servers

Example:

\`\`\`jsonc
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
        "url": "http://localhost:3000/mcp",
        "headers": {
          "Authorization": "Bearer \${API_TOKEN}"
        }
      }
    }
  }
}
\`\`\`

## Custom gateway setup

Route requests through a custom gateway or proxy by setting \`baseURL\` and custom headers:

\`\`\`jsonc
{
  "providers": {
    "cf-openai": {
      "name": "OpenAI via CF Gateway",
      "baseURL": "https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai",
      "apiKey": "\${OPENAI_API_KEY}",
      "headers": {
        "cf-aig-authorization": "Bearer \${CF_AIG_TOKEN}"
      },
      "models": {
        "gpt-5-mini": {
          "name": "GPT-5 Mini",
          "contextWindow": 400000
        }
      }
    }
  }
}
\`\`\`

This example uses [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/). For gateways that store provider keys server-side, set \`"apiKey": "none"\`.
`,
  },
  {
    path: "docs/try-it-out/getting-started.md",
    content: `# Getting Started

You've probably used coding agents that read files, run commands, and make edits without you really seeing what is going on under the hood. ProtoAgent is the same kind of tool, but with a simple codebase that is easy to understand. So easy to understand that you could build it yourself.

It's a TypeScript CLI with an Ink terminal UI, a streaming tool loop, inline approvals, and persisted sessions and the other features you would expect from coding agents like MCP and Skills.

## Install it

Install globally via npm:

\`\`\`bash
npm install -g protoagent
\`\`\`

Or run it from a local checkout:

\`\`\`bash
npm install
npm run dev
\`\`\`

## First run

Start ProtoAgent:

\`\`\`bash
protoagent
\`\`\`

If no config exists yet, ProtoAgent opens an inline setup flow right inside the TUI. You pick a provider, pick a model, and enter an API key.

You can reopen configuration later with:

\`\`\`bash
protoagent configure
\`\`\`

See the [Configuration guide](/try-it-out/configuration) for more details.

## Use it like you would any coding agent

Once it is configured, type a task and press Enter. ProtoAgent reads the project, decides which tools to call, asks for approval when it needs to, and keeps iterating until it has a final answer.

Some good first prompts:

- \`Read the README and tell me what this project does\`
- \`Find every TODO in src/\`
- \`Add error handling to the fetchData function\`
- \`Run the tests and fix any failures\`

## Interactive commands

Inside the app, you can use:

- \`/help\` — show available slash commands
- \`/collapse\` — collapse all long messages
- \`/expand\` — expand all collapsed messages
- \`/quit\` — save the session and exit (also accepts \`/exit\`)

Useful shortcuts:

- \`Esc\` aborts the current in-flight completion
- \`Ctrl-C\` exits immediately

## CLI flags

| Flag | What it does |
|---|---|
| \`--dangerously-skip-permissions\` | Skip normal approval prompts for writes, edits, and non-safe shell commands |
| \`--log-level <level>\` | Set log verbosity: \`TRACE\`, \`DEBUG\`, \`INFO\`, \`WARN\`, or \`ERROR\` |
| \`--session <id>\` | Resume a previously saved session |

## What you see while working

As ProtoAgent runs, you see the loop rather than just the final answer:

- streamed assistant output
- grouped tool calls and tool results
- inline approval prompts
- token, context, and cost info
- auto-saved session state and TODOs
- the active log file path

## Where to go next

- [Configuration](/try-it-out/configuration)
- [Tools](/try-it-out/tools)
- [Sessions](/try-it-out/sessions)
- [Skills](/try-it-out/skills)
- [Build your own](/build-your-own/)
`,
  },
  {
    path: "docs/try-it-out/mcp.md",
    content: `# MCP Servers

MCP is how ProtoAgent grows beyond its built-in tools.

Instead of baking every possible tool into the app, you point ProtoAgent at one or more MCP servers and it discovers their tools at startup.

Configuration lives in the active \`protoagent.jsonc\` file under \`mcp.servers\`.

See the tutorial for implementing MCP support: [Part 11 - MCP](/build-your-own/part-11)

## Supported server types

ProtoAgent currently supports:

- \`stdio\` servers started as child processes
- \`http\` servers reached through Streamable HTTP transport

The implementation uses the official \`@modelcontextprotocol/sdk\`, specifically the \`Client\`, \`StdioClientTransport\`, and \`StreamableHTTPClientTransport\` classes.

## Stdio servers

\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "my-server": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@example/mcp-server"],
        "env": {
          "API_KEY": "your-key-here"
        }
      }
    }
  }
}
\`\`\`

Stdio server stderr output is piped to ProtoAgent's debug logs for troubleshooting.

Fields:

- \`type\`: must be \`"stdio\`"
- \`command\`: executable to run
- \`args\`: optional command-line arguments
- \`env\`: optional environment variables (merged with \`process.env\`)
- \`cwd\`: optional working directory
- \`enabled\`: optional toggle (set to \`false\` to skip this server)
- \`timeoutMs\`: optional connection timeout

\`type\` is expected explicitly in the current implementation.

## HTTP servers

\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "remote-server": {
        "type": "http",
        "url": "http://localhost:3000/mcp",
        "headers": {
          "Authorization": "Bearer \${MY_MCP_TOKEN}"
        }
      }
    }
  }
}
\`\`\`

Fields:

- \`type\`: must be \`"http"\`
- \`url\`: full MCP endpoint URL
- \`headers\`: optional request headers (supports \`\${VAR}\` interpolation)
- \`enabled\`: optional toggle
- \`timeoutMs\`: optional connection timeout

## What happens at startup

When ProtoAgent launches, it loads the active \`protoagent.jsonc\` config and:

1. skips any server with \`enabled: false\`
2. connects to each configured server (stdio or HTTP)
3. calls \`listTools()\` through the MCP client
4. registers each remote tool dynamically
5. exposes them to the model with names like \`mcp_<server>_<tool>\`

So if a server named \`github\` exposes a tool named \`search_docs\`, the model sees \`mcp_github_search_docs\`.

Tool descriptions are prefixed with \`[MCP: <server>]\` so the model knows which server a tool came from.

## Current limits

- OAuth support is not implemented
- tool results are flattened into strings rather than preserved as rich structured blocks
`,
  },
  {
    path: "docs/try-it-out/sessions.md",
    content: `# Sessions

ProtoAgent saves session state so you can stop in the middle of a task, come back later, and keep going.

## Where sessions live

- **macOS/Linux**: \`~/.local/share/protoagent/sessions/\`
- **Windows**: \`%USERPROFILE%/AppData/Local/protoagent/sessions/\`

Each session is stored as a JSON file named by an 8-character alphanumeric ID (a-z, 0-9).

On non-Windows platforms, ProtoAgent hardens session directory permissions to \`0o700\` and file permissions to \`0o600\`.

## What gets saved

Each session stores:

- a session ID (8-character alphanumeric)
- a generated title (first 60 characters of the first user message)
- creation and update timestamps
- provider and model metadata
- \`completionMessages\` (the full message history)
- the session TODO list

## What does not get saved

- approval decisions
- live MCP connections
- in-flight request state

## Resuming a session

Use:

\`\`\`bash
protoagent --session <id>
\`\`\`

When a session loads, ProtoAgent refreshes the top system prompt before continuing.

When you quit from the UI with \`/quit\` or \`/exit\`, ProtoAgent saves the session and prints the exact resume command.

## Session IDs

Session IDs are 8-character alphanumeric strings (a-z, 0-9).

See the tutorial for implementing sessions: [Part 10 - Sessions](/build-your-own/part-10)
`,
  },
  {
    path: "docs/try-it-out/skills.md",
    content: `# Skills

Skills are how you give ProtoAgent project-specific instructions without hardcoding those instructions into the app itself.

Skills follow the [Agent Skills Specification](https://agentskills.io/specification).

If you want the agent to follow your code style, your release process, your package-manager preference, or some internal project conventions, this is the mechanism.

## Skill format

A skill lives in its own directory and must contain \`SKILL.md\`.

Example layout:

\`\`\`text
.agents/skills/code-style/
└── SKILL.md
\`\`\`

Example \`SKILL.md\`:

\`\`\`markdown
---
name: code-style
description: Follow the project's TypeScript and export conventions.
---

- Use TypeScript strict mode
- Prefer named exports over default exports
- Use camelCase for variables and functions
- Use PascalCase for types and interfaces
\`\`\`

This is an extremely simple example. Skills can contain detailed instructions, code examples, step-by-step workflows, or any other guidance the agent should follow.

Current validation rules:

- the file must start with YAML frontmatter
- \`name\` is required
- \`description\` is required (1-1024 characters)
- the skill name must be lowercase kebab-case (\`/^[a-z0-9]+(?:-[a-z0-9]+)*\$/\`)
- the skill name must be 1-64 characters
- the skill directory name must match the skill name exactly
- \`compatibility\`, when provided, must be 1-500 characters

## Discovery locations

ProtoAgent scans five roots for skills: three user-level and two project-level.

User roots:

- \`~/.agents/skills/\`
- \`~/.protoagent/skills/\`
- \`~/.config/protoagent/skills/\`

Project roots:

- \`<cwd>/.agents/skills/\`
- \`<cwd>/.protoagent/skills/\`

Roots are scanned in the order listed above. If a project skill and a user skill share the same name, the last one discovered wins (project roots are scanned after user roots, so project-level skills take precedence).

## How activation works

ProtoAgent does not inject every skill body into the prompt up front.

Instead it:

1. discovers and validates skills from all 5 roots
2. adds a catalog of available skills to the system prompt (name, description, location)
3. registers the \`activate_skill\` tool if at least one skill exists
4. lets the model load the full skill body only when it actually needs it

That is the whole design in one sentence: keep the base prompt smaller, but still let the model load the detailed instructions on demand.

See the tutorial for implementing skills: [Part 9 - Skills](/build-your-own/part-9)

## Skill resources

The [Agent Skills Specification](https://agentskills.io/specification) defines three optional directories that skills can bundle:

- \`scripts/\` — executable code
- \`references/\` — documentation and reference materials
- \`assets/\` — templates, images, data files

ProtoAgent walks these directories (up to 200 files maximum) and lists them in the activation output. It also adds discovered skill directories to the allowed path roots, so those bundled files can be accessed through the normal file tools.

## Supported frontmatter fields

The current loader understands:

- \`name\`
- \`description\`
- \`compatibility\`
- \`license\`
- \`metadata\`
- \`allowed-tools\`

\`allowed-tools\` is parsed into the dedicated \`allowedTools\` field (split on whitespace), but it is not currently enforced as a permission boundary.

## What activation returns

\`activate_skill\` returns a \`<skill_content ...>\` block that includes:

- the skill body (the markdown content after the frontmatter)
- the skill directory path
- guidance about resolving relative paths against the skill directory
- a \`<skill_resources>\` listing of bundled files (or an empty \`<skill_resources />\` tag)

The compaction system also preserves activated skill payloads when summarizing long conversations.
`,
  },
  {
    path: "docs/try-it-out/sub-agents.md",
    content: `# Sub-agents

Sub-agents exist for a pretty simple reason: long-running agent sessions get noisy.

If the model has to explore a bunch of files just to answer one focused question, the main conversation fills up with tool chatter that is useful in the moment and then mostly noise afterward.

Sub-agents move that work into an isolated child run.

## How it works

1. the main agent calls \`sub_agent\` with a \`task\` description
2. ProtoAgent creates a fresh child conversation with a new system prompt (the normal system prompt plus a sub-agent mode suffix)
3. the child uses the normal tool stack in that isolated context
4. only the child's final text answer comes back to the parent

This is useful for repo exploration, focused research, and independent subtasks.

## Implementation details

- \`max_iterations\` defaults to \`100\`
- child runs use the normal tool registry from \`getAllTools()\`
- \`sub_agent\` is not re-exposed recursively inside the child (the child cannot spawn its own sub-agents)
- child TODOs use an ephemeral session ID (\`sub-agent-<uuid>\`) and are **automatically cleared on completion**
- child history is not persisted as a normal user-facing session
- the parent receives a progress callback for each tool call in the child (\`running\`, \`done\`, \`error\` status per iteration)

See the tutorial for implementing sub-agents: [Part 12 - Sub-agents](/build-your-own/part-12)
`,
  },
  {
    path: "docs/try-it-out/tools.md",
    content: `# Tools

Tools are how ProtoAgent actually gets work done.

When you ask it to fix a bug or understand a repo, it is not just generating text. It is reading files, searching code, editing content, running commands, fetching docs, and feeding those results back into the loop.

## How tools work

Each tool has two parts:

- **JSON schema** — shown to the model in the system prompt. It describes the tool's name, a description of what it does, and a parameters object with types, required fields, and field descriptions.
- **Handler function** — the implementation that executes when the model calls the tool.

The model responds with tool calls containing the tool name and parameter values. ProtoAgent routes each call to its handler, captures the result, and appends a tool response message to the conversation. The model then uses that result to continue its work.

See the tutorial for implementing the tool system: [Part 4 - The Agentic Loop](/build-your-own/part-4), [Part 5 - Core Tools](/build-your-own/part-5)

## Built-in tools

ProtoAgent ships with 9 static tools:

- \`read_file\`
- \`write_file\`
- \`edit_file\`
- \`list_directory\`
- \`search_files\`
- \`bash\`
- \`todo_read\`
- \`todo_write\`
- \`webfetch\`

Dynamic tools are registered at runtime:

- \`activate_skill\` — registered when at least one valid skill is discovered
- \`sub_agent\` — spawns isolated sub-agents for parallel work
- \`mcp_<server>_<tool>\` — registered for each tool discovered from MCP servers

## File tools

### \`read_file\`

This is the basic "show me what is in the file" tool. It returns raw file content and supports \`offset\` and \`limit\` so the model can inspect big files in chunks.

### \`write_file\`

This creates or overwrites a file. In normal interactive use it requires approval, and it writes atomically through a temporary file plus rename.

### \`edit_file\`

This performs string find-and-replace. The edit fails if the old string is not found, or if the actual occurrence count does not match \`expected_replacements\` (defaults to 1).

### \`list_directory\`

Lists directory contents with \`[DIR]\` and \`[FILE]\` prefixes.

### \`search_files\`

Recursively searches files using regular-expression semantics, not literal-text matching. It tries to use \`ripgrep\` if available and falls back to a built-in JavaScript implementation.

## Shell tool

### \`bash\`

The \`bash\` tool uses a three-tier safety model:

1. hard-blocked dangerous patterns are always denied
2. a narrow set of safe commands runs without approval
3. everything else asks for approval

The safe list is intentionally narrow. Current auto-approved commands include:

- \`pwd\`, \`whoami\`, \`date\`
- \`git status\`, \`git log\`, \`git diff\`, \`git branch\`, \`git show\`, \`git remote\`
- \`npm list\`, \`npm ls\`, \`yarn list\`
- version commands like \`node --version\`, \`npm --version\`, \`python --version\`, \`python3 --version\`

Important detail: many common read-style commands such as \`ls\`, \`cat\`, \`grep\`, \`rg\`, \`find\`, \`awk\`, \`sed\`, \`sort\`, \`uniq\`, \`cut\`, \`wc\`, \`tree\`, \`file\`, \`dir\`, \`echo\`, and \`which\` are *not* auto-approved. They always require approval.

Commands with shell control operators (\`;\`, \`&&\`, \`||\`, \`|\`, \`>\`, \`<\`, \`\` \` \`\`, \`\$()\`, \`*\`, \`?\`) also always require approval, even if the base command would normally be safe.

Hard-blocked patterns include commands such as \`rm -rf /\`, \`sudo\`, \`su \`, \`chmod 777\`, \`dd if=\`, \`mkfs\`, \`fdisk\`, and \`format c:\`.

The default timeout is 30 seconds. Long-running output is truncated at 50,000 characters.

## TODO tools

### \`todo_read\` and \`todo_write\`

These tools give the agent a structured scratchpad for multi-step work.

TODOs are stored per session in memory, and the main app also persists them with session state so they survive resume.

\`todo_write\` replaces the full list each time.

## Web fetching

### \`webfetch\`

This lets ProtoAgent fetch a single HTTP or HTTPS URL and return processed content as JSON.

Supported formats are:

- \`text\` — converts HTML to plain text using html-to-text
- \`markdown\` — converts HTML to Markdown using Turndown
- \`html\` — returns raw HTML

For text and markdown formats, HTML entities are decoded. Output is truncated to 2MB if necessary.

Limits:

- **Timeout:** 30 seconds default, maximum 120 seconds
- **Response size:** 5 MB maximum
- **Output size:** 2 MB maximum (after processing)
- **Redirects:** Maximum 5 redirects followed
- **URL scheme:** Only http:// and https:// allowed

## Path security

File tools validate paths against the working directory and resolve symlinks before allowing access. File operations are restricted to the working directory (where ProtoAgent was launched) plus any allowed skill roots.

The skills system can add discovered skill directories as extra allowed roots so bundled \`scripts/\`, \`references/\`, and \`assets/\` files can be accessed through the normal file tools.

## Approvals

Writes, edits, and non-safe shell commands all flow through the approval system. The three approval categories are:

- \`file_write\`
- \`file_edit\`
- \`shell_command\`

Approval can be granted per-operation (one-time), per-type for the session, or globally via \`--dangerously-skip-permissions\`. Hard-blocked shell patterns are still denied even with \`--dangerously-skip-permissions\`.
`,
  },
  {
    path: "package.json",
    content: `{
  "name": "protoagent",
  "version": "0.1.14",
  "type": "module",
  "files": [
    "dist",
    "README.md"
  ],
  "bin": {
    "protoagent": "./dist/cli.js"
  },
  "scripts": {
    "clean": "node -e \\"require('node:fs').rmSync('dist', { recursive: true, force: true })\\"",
    "dev": "tsx src/cli.tsx",
    "test": "node --test --import tsx tests/**/*.test.{ts,tsx}",
    "build": "npm run clean && tsc && node -e \\"const fs=require('node:fs'); if (fs.existsSync('dist/cli.js')) fs.chmodSync('dist/cli.js', 0o755)\\"",
    "build:watch": "tsc --watch",
    "prepack": "npm run build",
    "docs:dev": "vitepress dev docs",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs",
    "docs:worker:dev": "cd docs-with-worker && npm run docs:dev",
    "docs:worker:build": "cd docs-with-worker && npm run docs:build",
    "docs:worker:preview": "cd docs-with-worker && npm run docs:preview"
  },
  "author": "Thomas Gauvin",
  "license": "MIT",
  "homepage": "https://protoagent.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/thomasgauvin/protoagent.git"
  },
  "keywords": [
    "ai",
    "agent",
    "cli",
    "coding-agent",
    "llm",
    "openai",
    "anthropic",
    "gemini",
    "terminal",
    "typescript"
  ],
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "commander": "^14.0.1",
    "he": "^1.2.0",
    "html-to-text": "^9.0.5",
    "ink": "^6.8.0",
    "ink-big-text": "^2.0.0",
    "jsonc-parser": "^3.3.1",
    "openai": "^5.23.1",
    "react": "^19.1.1",
    "turndown": "^7.2.2",
    "yaml": "^2.8.2",
    "yoga-layout": "^3.2.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.36.0",
    "@tailwindcss/postcss": "^4.1.18",
    "@types/he": "^1.2.3",
    "@types/html-to-text": "^9.0.4",
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "@types/turndown": "^5.0.6",
    "eslint": "^9.36.0",
    "ink-testing-library": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2",
    "typescript-eslint": "^8.44.1",
    "vitepress": "^1.6.4"
  }
}
`,
  },
  {
    path: "postcss.config.js",
    content: `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
`,
  },
  {
    path: "src/App.tsx",
    content: `/**
Main UI component — the heart of ProtoAgent's terminal interface.

Renders the chat loop, tool call feedback, approval prompts,
and cost/usage info. All heavy logic lives in \`agentic-loop.ts\`;
this file is purely presentation + state wiring.

Here's how the terminal UI is laid out (showcasing all options at once for demonstration, but in practice many elements are conditional on state):
┌─────────────────────────────────────────┐
│  ProtoAgent  (BigText logo)             │  static, rendered once (printBanner)
│  Model: Anthropic / claude-3-5 | Sess.. │  static header (printRuntimeHeader)
│  Debug logs: /path/to/log               │  static, if --log-level set
├─────────────────────────────────────────┤
│                                         │
│  [System Prompt ▸ collapsed]            │  archived (memoized)
│                                         │
│  > user message                         │  archived (memoized)
│                                         │
│  assistant reply text                   │  archived (memoized)
│                                         │
│  [tool_name ▸ collapsed]                │  archived (memoized)
│                                         │
│  > user message                         │  archived (memoized)
│                                         │
├ ─ ─ ─ ─ ─ ─ ─ live boundary ─ ─ ─ ─ ─ ─ ┤
│                                         │
│  assistant streaming text...            │  live (re-renders, ~50ms debounce)
│                                         │
│  [tool_name ▸ collapsed]                │  live (re-renders on tool_result)
│                                         │
│  Thinking...                            │  live, only if last msg is user
│                                         │
│ ╭─ Approval Required ─────────────────╮ │  live, only when pending approval
│ │  description / detail               │ │
│ │  ○ Approve once                     │ │
│ │  ○ Approve for session              │ │
│ │  ○ Reject                           │ │
│ ╰─────────────────────────────────────╯ │
│                                         │
│  [Error: message]                       │  live, inline thread errors
│                                         │
├─────────────────────────────────────────┤
│  tokens: 1234↓ 56↑ | ctx: 12% | \$0.02   │  static-ish, updates after each turn
├─────────────────────────────────────────┤
│  /quit  — Exit ProtoAgent               │  dynamic, shown when typing /
├─────────────────────────────────────────┤
│  ⠹ Running read_file...                 │  dynamic, shown while loading
├─────────────────────────────────────────┤
│ ╭─────────────────────────────────────╮ │
│ │ > [text input cursor              ] │ │  always visible when initialized
│ ╰─────────────────────────────────────╯ │
├─────────────────────────────────────────┤
│  Session saved. Resume with:            │  one-shot, shown on /quit
│  protoagent --session abc12345          │
└─────────────────────────────────────────┘
*/

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import { LeftBar } from './components/LeftBar.js';
import { TextInput, Select } from '@inkjs/ui';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, writeInitConfig, resolveApiKey, type Config, type InitConfigTarget, TargetSelection, ModelSelection, ApiKeyInput } from './config.js';
import { loadRuntimeConfig, getActiveRuntimeConfigPath } from './runtime-config.js';
import { getProvider, getModelPricing, getRequestDefaultParams } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';
import { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from './tools/index.js';
import type { ApprovalRequest, ApprovalResponse } from './utils/approval.js';
import { setLogLevel, LogLevel, initLogFile, logger } from './utils/logger.js';
import {
  createSession,
  ensureSystemPromptAtTop,
  saveSession,
  loadSession,
  generateTitle,
  type Session,
} from './sessions.js';
import { clearTodos, getTodosForSession, setTodosForSession } from './tools/todo.js';
import { initializeMcp, closeMcp, getConnectedMcpServers } from './mcp.js';
import { generateSystemPrompt } from './system-prompt.js';
import { renderFormattedText } from './utils/format-message.js';

interface InlineThreadError {
  id: string;
  message: string;
  transient?: boolean;
}

// A single item rendered by <Static>. Each item is appended once and
// permanently flushed to the terminal scrollback by Ink's Static component.
interface StaticItem {
  id: string;
  node: React.ReactNode;
}

type AddStaticFn = (node: React.ReactNode) => void;

// ─── Scrollback helpers ───
// These functions append text to the permanent scrollback buffer via the
// <Static> component. Ink flushes new Static items within its own render
// cycle, so there are no timing issues with write()/log-update.



function printBanner(addStatic: AddStaticFn): void {
  addStatic(
    <Text>
      <Text color="#09A469">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀</Text>
      {'\\n'}
      <Text color="#09A469">█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</Text>
      {'\\n'}
    </Text>
  );
}

function printRuntimeHeader(addStatic: AddStaticFn, config: Config, session: Session | null, dangerouslySkipPermissions: boolean): void {
  const provider = getProvider(config.provider);
  let line = \`Model: \${provider?.name || config.provider} / \${config.model}\`;
  if (dangerouslySkipPermissions) line += ' (auto-approve all)';
  if (session) line += \` | Session: \${session.id}\`;
  
  const lines: React.ReactNode[] = [<Text key="model" dimColor>{line}</Text>];
  
  const logFilePath = logger.getLogFilePath();
  if (logFilePath) {
    lines.push(<Text key="log" dimColor>Debug logs: {logFilePath}</Text>);
  }
  const configPath = getActiveRuntimeConfigPath();
  if (configPath) {
    lines.push(<Text key="config" dimColor>Config file: {configPath}</Text>);
  }
  const mcpServers = getConnectedMcpServers();
  if (mcpServers.length > 0) {
    lines.push(<Text key="mcp" dimColor>MCPs: {mcpServers.join(', ')}</Text>);
  }
  
  addStatic(
    <Text>
      {lines.map((l, i) => <React.Fragment key={i}>{l}{'\\n'}</React.Fragment>)}
      {'\\n'}
    </Text>
  );
}

function normalizeTranscriptText(text: string): string {
  const normalized = text.replace(/\\r\\n/g, '\\n');
  const lines = normalized.split('\\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\\n');
}

function printMessageToScrollback(addStatic: AddStaticFn, role: 'user' | 'assistant', text: string): void {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) {
    addStatic(<Text>{'\\n'}</Text>);
    return;
  }
  if (role === 'user') {
    addStatic(
      <Text>
        <Text color="green">{'>'}</Text> {normalized}{'\\n'}
      </Text>
    );
    return;
  }
  // Apply Markdown formatting (bold, italic) to assistant messages
  addStatic(<Text>{renderFormattedText(normalized)}{'\\n'}</Text>);
}

/**
 * Format a sub-agent tool call into a human-readable activity string.
 * Shows what the sub-agent is actually doing, e.g. "Sub-agent reading file package.json"
 */
function formatSubAgentActivity(tool: string, args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') {
    return \`Sub-agent running \${tool}...\`;
  }

  const argEntries = Object.entries(args);
  if (argEntries.length === 0) {
    return \`Sub-agent running \${tool}...\`;
  }

  // Extract the most meaningful argument based on the tool
  let detail = '';
  const firstValue = argEntries[0]?.[1];

  switch (tool) {
    case 'read_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'write_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'edit_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'list_directory':
      detail = typeof args.directory_path === 'string' ? args.directory_path : '(current)';
      break;
    case 'search_files':
      detail = typeof args.search_term === 'string' ? \`"\${args.search_term}"\` : '';
      break;
    case 'bash':
      detail = typeof args.command === 'string'
        ? args.command.split(/\\s+/).slice(0, 3).join(' ') + (args.command.split(/\\s+/).length > 3 ? '...' : '')
        : '';
      break;
    case 'todo_write':
      detail = Array.isArray(args.todos) ? \`\${args.todos.length} task(s)\` : '';
      break;
    case 'webfetch':
      detail = typeof args.url === 'string' ? new URL(args.url).hostname : '';
      break;
    case 'sub_agent':
      // Nested sub-agent
      detail = 'nested task...';
      break;
    default:
      // Use the first argument value as fallback
      detail = typeof firstValue === 'string'
        ? firstValue.length > 30 ? firstValue.slice(0, 30) + '...' : firstValue
        : '';
  }

  if (detail) {
    return \`Sub-agent \${tool.replace(/_/g, ' ')}: \${detail}\`;
  }

  return \`Sub-agent running \${tool}...\`;
}

function replayMessagesToScrollback(addStatic: AddStaticFn, messages: Message[]): void {  for (const message of messages) {
    const msgAny = message as any;
    if (message.role === 'system') continue;
    if (message.role === 'user' && typeof message.content === 'string') {
      printMessageToScrollback(addStatic, 'user', message.content);
      continue;
    }
    if (message.role === 'assistant' && typeof message.content === 'string' && message.content.trim().length > 0) {
      printMessageToScrollback(addStatic, 'assistant', message.content);
      continue;
    }
    if (message.role === 'tool') {
      const toolName = msgAny.name || 'tool';
      const compact = String(msgAny.content || '').replace(/\\s+/g, ' ').trim().slice(0, 180);
      addStatic(<Text dimColor>{'▶ '}{toolName}{': '}{compact}{'\\n'}</Text>);
    }
  }
  if (messages.length > 0) {
    addStatic(<Text>{'\\n'}</Text>);
  }
}

// Returns only the last N displayable lines of text so the live streaming box
// never grows taller than the terminal, preventing Ink's clearTerminal wipe.
const STREAMING_RESERVED_ROWS = 3; // usage bar + spinner + input line
function clipToRows(text: string, terminalRows: number): string {
  const maxLines = Math.max(1, terminalRows - STREAMING_RESERVED_ROWS);
  const lines = text.split('\\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(lines.length - maxLines).join('\\n');
}

// ─── Props ───
export interface AppProps {
  dangerouslySkipPermissions?: boolean;
  logLevel?: string;
  sessionId?: string;
}

// ─── Available slash commands ───
const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all available commands' },
  { name: '/quit', description: 'Exit ProtoAgent' },
  { name: '/exit', description: 'Alias for /quit' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HELP_TEXT = [
  'Commands:',
  '  /help   - Show this help',
  '  /quit   - Exit ProtoAgent',
  '  /exit   - Alias for /quit',
].join('\\n');

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? \`Missing API key for \${providerName}. Set it in config or export \${envVar}.\`
        : \`Missing API key for \${providerName}.\`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
  };

  // baseURL: env var override takes precedence over provider default
  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim();
  const baseURL = baseURLOverride || provider?.baseURL;
  if (baseURL) {
    clientOptions.baseURL = baseURL;
  }

  // Custom headers: env override takes precedence over provider defaults
  const rawHeaders = process.env.PROTOAGENT_CUSTOM_HEADERS?.trim();
  if (rawHeaders) {
    const defaultHeaders: Record<string, string> = {};
    for (const line of rawHeaders.split('\\n')) {
      const sep = line.indexOf(': ');
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 2).trim();
      if (key && value) defaultHeaders[key] = value;
    }
    if (Object.keys(defaultHeaders).length > 0) {
      clientOptions.defaultHeaders = defaultHeaders;
    }
  } else if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
  }

  return new OpenAI(clientOptions);
}

// ─── Sub-components ───

/** Shows filtered slash commands when user types /. */
const CommandFilter: React.FC<{ inputText: string }> = ({ inputText }) => {
  if (!inputText.startsWith('/')) return null;

  const filtered = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(inputText.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {filtered.map((cmd) => (
        <Text key={cmd.name} dimColor>
          <Text color="green">{cmd.name}</Text> — {cmd.description}
        </Text>
      ))}
    </Box>
  );
};

/** Interactive approval prompt rendered inline. */
const ApprovalPrompt: React.FC<{
  request: ApprovalRequest;
  onRespond: (response: ApprovalResponse) => void;
}> = ({ request, onRespond }) => {
  const sessionApprovalLabel = request.sessionScopeKey
    ? 'Approve this operation for session'
    : \`Approve all "\${request.type}" for session\`;

  const items = [
    { label: 'Approve once', value: 'approve_once' as const },
    { label: sessionApprovalLabel, value: 'approve_session' as const },
    { label: 'Reject', value: 'reject' as const },
  ];

  return (
    <LeftBar color="green" marginTop={1} marginBottom={1}>
      <Text color="green" bold>Approval Required</Text>
      <Text>{request.description}</Text>
      {request.detail && (
        <Text dimColor>{request.detail.length > 200 ? request.detail.slice(0, 200) + '...' : request.detail}</Text>
      )}
      <Box marginTop={1}>
        <Select
          options={items.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onRespond(value as ApprovalResponse)}
        />
      </Box>
    </LeftBar>
  );
};

/** Cost/usage display in the status bar. */
const UsageDisplay: React.FC<{
  usage: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } | null;
  totalCost: number;
}> = ({ usage, totalCost }) => {
  if (!usage && totalCost === 0) return null;

  return (
    <Box marginTop={1}>
      {usage && (
        <Box>
          <Box backgroundColor="#064e3b" paddingX={1}>
            <Text color="white">tokens: </Text>
            <Text color="white" bold>{usage.inputTokens}↓ {usage.outputTokens}↑</Text>
          </Box>
          <Box backgroundColor="#065f46" paddingX={1}>
            <Text color="white">ctx: </Text>
            <Text color="white" bold>{usage.contextPercent.toFixed(0)}%</Text>
          </Box>
        </Box>
      )}
      {totalCost > 0 && (
        <Box backgroundColor="#064e3b" paddingX={1}>
          <Text color="black">cost: </Text>
          <Text color="black" bold>\${totalCost.toFixed(4)}</Text>
        </Box>
      )}
    </Box>
  );
};

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{
  onComplete: (config: Config) => void;
}> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'target' | 'provider' | 'api_key'>('target');
  const [target, setTarget] = useState<InitConfigTarget>('project');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const handleModelSelect = (providerId: string, modelId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setSetupStep('api_key');
  };

  const handleConfigComplete = (config: Config) => {
    writeInitConfig(target);
    writeConfig(config, target);
    onComplete(config);
  };

  if (setupStep === 'target') {
    return (
      <Box marginTop={1}>
        <TargetSelection
          title="First-time setup"
          subtitle="Create a ProtoAgent runtime config:"
          onSelect={(value) => {
            setTarget(value);
            setSetupStep('provider');
          }}
        />
      </Box>
    );
  }

  if (setupStep === 'provider') {
    return (
      <Box marginTop={1}>
        <ModelSelection
          setSelectedProviderId={setSelectedProviderId}
          setSelectedModelId={setSelectedModelId}
          onSelect={handleModelSelect}
          title="First-time setup"
        />
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <ApiKeyInput
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        target={target}
        title="First-time setup"
        showProviderHeaders={false}
        onComplete={handleConfigComplete}
      />
    </Box>
  );
};

// ─── Main App ───
export const App: React.FC<AppProps> = ({
  dangerouslySkipPermissions = false,
  logLevel,
  sessionId,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;

  // ─── Static scrollback state ───
  // Each item appended here is rendered once by <Static> and permanently
  // flushed to the terminal scrollback by Ink, within its own render cycle.
  // Using <Static> items is important to avoid re-rendering issues, which hijack
  // scrollback and copying when new AI message streams are coming in.
  //
  // staticCounterRef keeps ID generation local to this component instance,
  // making it immune to Strict Mode double-invoke, HMR counter drift, and
  // collisions if multiple App instances ever coexist.
  const staticCounterRef = useRef(0);
  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);
  const addStatic = useCallback((node: React.ReactNode) => {
    staticCounterRef.current += 1;
    const id = \`s\${staticCounterRef.current}\`;
    setStaticItems((prev) => [...prev, { id, node }]);
  }, []);

  // Core state
  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  // isStreaming: true while the assistant is producing tokens.
  // streamingText: the live in-progress token buffer shown in the dynamic Ink
  // frame while the response streams. Cleared to '' at done and flushed to
  // <Static> as a permanent scrollback item. Keeping it in React state (not a
  // ref) is safe because the Ink frame height does NOT change as tokens arrive —
  // the streaming box is always 1+ lines tall while loading=true.
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpMessage, setHelpMessage] = useState<string | null>(null);
  const [threadErrors, setThreadErrors] = useState<InlineThreadError[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Input reset key — incremented on submit to force TextInput remount and clear
  const [inputResetKey, setInputResetKey] = useState(0);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Active tool tracking — shows which tool is currently executing
  const [activeTool, setActiveTool] = useState<string | null>(null);

  // Session state
  const [session, setSession] = useState<Session | null>(null);

  // Quitting state — shows the resume command before exiting
  const [quittingSession, setQuittingSession] = useState<Session | null>(null);

  // OpenAI client ref (stable across renders)
  const clientRef = useRef<OpenAI | null>(null);
  const assistantMessageRef = useRef<{
    message: any;
    index: number;
    kind: 'streaming_text' | 'tool_call_assistant';
  } | null>(null);

  // Abort controller for cancelling the current completion
  const abortControllerRef = useRef<AbortController | null>(null);

  // Buffer for streaming text that accumulates content and flushes complete lines to static
  // This prevents the live streaming area from growing unbounded - complete lines are
  // immediately flushed to <Static>, only the incomplete final line stays in the dynamic frame
  const streamingBufferRef = useRef<{ unflushedContent: string; hasFlushedAnyLine: boolean }>({
    unflushedContent: '',
    hasFlushedAnyLine: false,
  });

  const didPrintIntroRef = useRef(false);
  const printedThreadErrorIdsRef = useRef<Set<string>>(new Set());

  // ─── Post-config initialization (reused after inline setup) ───

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);

    clientRef.current = buildClient(loadedConfig);

    // Initialize MCP servers
    await initializeMcp();

    // Load or create session
    let loadedSession: Session | null = null;
    if (sessionId) {
      loadedSession = await loadSession(sessionId);
      if (loadedSession) {
        const systemPrompt = await generateSystemPrompt();
        loadedSession.completionMessages = ensureSystemPromptAtTop(
          loadedSession.completionMessages,
          systemPrompt
        );
        setTodosForSession(loadedSession.id, loadedSession.todos);
        setSession(loadedSession);
        setCompletionMessages(loadedSession.completionMessages);
        if (!didPrintIntroRef.current) {
          printBanner(addStatic);
          printRuntimeHeader(addStatic, loadedConfig, loadedSession, dangerouslySkipPermissions);
          replayMessagesToScrollback(addStatic, loadedSession.completionMessages);
          didPrintIntroRef.current = true;
        }
      } else {
        setError(\`Session "\${sessionId}" not found. Starting a new session.\`);
      }
    }

    if (!loadedSession) {
      // Initialize fresh conversation
      const initialCompletionMessages = await initializeMessages();
      setCompletionMessages(initialCompletionMessages);

      const newSession = createSession(loadedConfig.model, loadedConfig.provider);
      clearTodos(newSession.id);
      newSession.completionMessages = initialCompletionMessages;
      setSession(newSession);
      if (!didPrintIntroRef.current) {
        printBanner(addStatic);
        printRuntimeHeader(addStatic, loadedConfig, newSession, dangerouslySkipPermissions);
        didPrintIntroRef.current = true;
      }
    }

    setNeedsSetup(false);
    setInitialized(true);
  }, [dangerouslySkipPermissions, sessionId, addStatic]);

  // ─── Initialization ───

  useEffect(() => {
    if (!loading) {
      setSpinnerFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);

    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (error) {
      addStatic(<Text color="red">Error: {error}</Text>);
    }
  }, [error, addStatic]);



  useEffect(() => {
    for (const threadError of threadErrors) {
      if (threadError.transient || printedThreadErrorIdsRef.current.has(threadError.id)) {
        continue;
      }
      printedThreadErrorIdsRef.current.add(threadError.id);
      addStatic(<Text color="red">Error: {threadError.message}</Text>);
    }
  }, [threadErrors, addStatic]);

  useEffect(() => {
    const init = async () => {
      // Set log level and initialize log file
      if (logLevel) {
        const level = LogLevel[logLevel.toUpperCase() as keyof typeof LogLevel];
        if (level !== undefined) {
          setLogLevel(level);
          initLogFile();

          logger.info(\`ProtoAgent started with log level: \${logLevel}\`);
          logger.info(\`Log file: \${logger.getLogFilePath()}\`);
        }
      }

      // Set global approval mode
      if (dangerouslySkipPermissions) {
        setDangerouslySkipPermissions(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      await loadRuntimeConfig();

      const loadedConfig = readConfig('active');
      if (!loadedConfig) {
        setNeedsSetup(true);
        return;
      }

      await initializeWithConfig(loadedConfig);
    };

    init().catch((err) => {
      setError(\`Initialization failed: \${err.message}\`);
    });

    // Cleanup on unmount
    return () => {
      clearApprovalHandler();
      closeMcp();
    };
  }, []);

  // ─── Slash commands ───

  const handleSlashCommand = useCallback(async (cmd: string): Promise<boolean> => {
    const parts = cmd.trim().split(/\\s+/);
    const command = parts[0]?.toLowerCase();

    switch (command) {
        case '/quit':
        case '/exit':
        if (!session) {
          exit();
          return true;
        }

        try {
          const nextSession: Session = {
            ...session,
            completionMessages,
            todos: getTodosForSession(session.id),
            title: generateTitle(completionMessages),
          };

          await saveSession(nextSession);
          setSession(nextSession);
          setQuittingSession(nextSession);
          setError(null);

          // Exit after a short delay to allow render
          setTimeout(() => exit(), 100);
        } catch (err: any) {
          setError(\`Failed to save session before exit: \${err.message}\`);
        }
        return true;
      case '/expand':
      case '/collapse':
        // expand/collapse removed — transcript lives in scrollback
        return true;
       case '/help':
        setHelpMessage(HELP_TEXT);
        return true;
      default:
        return false;
    }
  }, [config, exit, session, completionMessages]);

  // ─── Submit handler ───

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !clientRef.current || !config) return;

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed);
      if (handled) {
        setInputText('');
        setInputResetKey((prev) => prev + 1);
        return;
      }
    }

    setInputText('');
    setInputResetKey((prev) => prev + 1); // Force TextInput to remount and clear
    setLoading(true);
    setIsStreaming(false);
    setStreamingText('');
    setError(null);
    setHelpMessage(null);
    setThreadErrors([]);

    // Reset turn tracking and streaming buffer
    assistantMessageRef.current = null;
    streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };

    // Print the user message directly to scrollback so it is selectable/copyable.
    // We still push it into completionMessages for session saving.
    const userMessage: Message = { role: 'user', content: trimmed };
    printMessageToScrollback(addStatic, 'user', trimmed);
    setCompletionMessages((prev) => [...prev, userMessage]);

    // Reset assistant message tracker (streamed indices were reset above)
    assistantMessageRef.current = null;

    try {
      const pricing = getModelPricing(config.provider, config.model);
      const requestDefaults = getRequestDefaultParams(config.provider, config.model);

      // Create abort controller for this completion
      abortControllerRef.current = new AbortController();

      const updatedMessages = await runAgenticLoop(
        clientRef.current,
        config.model,
        [...completionMessages, userMessage],
        trimmed,
        (event: AgentEvent) => {
          switch (event.type) {
            case 'text_delta': {
              const deltaText = event.content || '';

              // First text delta of this turn: initialize ref, show streaming indicator.
              if (!assistantMessageRef.current || assistantMessageRef.current.kind !== 'streaming_text') {
                // Trim leading whitespace from first delta - LLMs often output leading \\n or spaces
                const trimmedDelta = deltaText.replace(/^\\s+/, '');
                const assistantMsg = { role: 'assistant', content: trimmedDelta, tool_calls: [] } as Message;
                const idx = completionMessages.length + 1;
                assistantMessageRef.current = { message: assistantMsg, index: idx, kind: 'streaming_text' };
                setIsStreaming(true);
                setCompletionMessages((prev) => [...prev, assistantMsg]);

                // Initialize the streaming buffer and process the first chunk
                // through the same split logic as subsequent deltas for consistency
                const buffer = { unflushedContent: trimmedDelta, hasFlushedAnyLine: false };
                streamingBufferRef.current = buffer;

                // Process the first chunk: split on newlines and flush complete lines
                const lines = buffer.unflushedContent.split('\\n');
                if (lines.length > 1) {
                  const completeLines = lines.slice(0, -1);
                  const textToFlush = completeLines.join('\\n');
                  if (textToFlush) {
                    addStatic(renderFormattedText(textToFlush));
                    buffer.hasFlushedAnyLine = true;
                  }
                  buffer.unflushedContent = lines[lines.length - 1];
                }

                setStreamingText(buffer.unflushedContent);
              } else {
                // Subsequent deltas — append to ref and buffer, then flush complete lines
                assistantMessageRef.current.message.content += deltaText;

                // Accumulate in buffer and flush complete lines to static
                const buffer = streamingBufferRef.current;
                buffer.unflushedContent += deltaText;

                // Split on newlines to find complete lines
                const lines = buffer.unflushedContent.split('\\n');

                // If we have more than 1 element, there were newlines
                if (lines.length > 1) {
                  // All lines except the last one are complete (ended with \\n)
                  const completeLines = lines.slice(0, -1);

                  // Build the text to flush - each complete line gets a newline added back
                  const textToFlush = completeLines.join('\\n');

                  if (textToFlush) {
                    addStatic(renderFormattedText(textToFlush));
                    buffer.hasFlushedAnyLine = true;
                  }

                  // Keep only the last (incomplete) line in the buffer
                  buffer.unflushedContent = lines[lines.length - 1];
                }

                // Show the incomplete line (if any) in the dynamic frame
                setStreamingText(buffer.unflushedContent);
              }
              break;
            }
            case 'sub_agent_iteration':
              if (event.subAgentTool) {
                const { tool, status, args } = event.subAgentTool;
                if (status === 'running') {
                  setActiveTool(formatSubAgentActivity(tool, args));
                } else {
                  setActiveTool(null);
                }
              }
              // Handle sub-agent usage update
              if (event.subAgentUsage) {
                setTotalCost((prev) => prev + event.subAgentUsage!.cost);
              }
              break;
            case 'tool_call':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setActiveTool(toolCall.name);

                // If the model streamed some text before invoking this tool,
                // flush any remaining unflushed content to <Static> now.
                // The streaming buffer contains text that hasn't been flushed yet
                // (the incomplete final line). We need to flush it before the tool call.
                if (assistantMessageRef.current?.kind === 'streaming_text') {
                  const buffer = streamingBufferRef.current;

                  // Flush any remaining unflushed content
                  if (buffer.unflushedContent) {
                    addStatic(renderFormattedText(buffer.unflushedContent));
                  }

                  // Add spacing after the streamed text and before the tool call
                  addStatic(renderFormattedText('\\n'));

                  // Reset streaming state and buffer
                  streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
                  setIsStreaming(false);
                  setStreamingText('');
                  assistantMessageRef.current = null;
                }

                // Track the tool call in the ref WITHOUT triggering a render.
                // The render will happen when tool_result arrives.
                const existingRef = assistantMessageRef.current;
                const assistantMsg = existingRef?.message
                  ? {
                      ...existingRef.message,
                      tool_calls: [...(existingRef.message.tool_calls || [])],
                    }
                  : { role: 'assistant', content: '', tool_calls: [] as any[] };

                const nextToolCall = {
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.name, arguments: toolCall.args },
                };

                const idx = assistantMsg.tool_calls.findIndex(
                  (tc: any) => tc.id === toolCall.id
                );
                if (idx === -1) {
                  assistantMsg.tool_calls.push(nextToolCall);
                } else {
                  assistantMsg.tool_calls[idx] = nextToolCall;
                }

                if (!existingRef) {
                  // First tool call — we need to add the assistant message to state
                  setCompletionMessages((prev) => {
                    assistantMessageRef.current = {
                      message: assistantMsg,
                      index: prev.length,
                      kind: 'tool_call_assistant',
                    };
                    return [...prev, assistantMsg as Message];
                  });
                } else {
                  // Subsequent tool calls — just update the ref, no render
                  assistantMessageRef.current = {
                    ...existingRef,
                    message: assistantMsg,
                    kind: 'tool_call_assistant',
                  };
                }
              }
              break;
            case 'tool_result':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setActiveTool(null);

                // Write the tool summary immediately — at this point loading is
                // still true but the frame height is stable (spinner + input box).
                // The next state change (setActiveTool(null)) doesn't affect
                // frame height so write() restores the correct frame.
                const compactResult = (toolCall.result || '')
                  .replace(/\\s+/g, ' ')
                  .trim()
                  .slice(0, 180);
                addStatic(<Text dimColor>{'▶ '}{toolCall.name}{': '}{compactResult}{'\\n'}</Text>);

                // Flush the assistant message + tool result into completionMessages
                // for session saving.
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  // Sync assistant message
                  if (assistantMessageRef.current) {
                    updated[assistantMessageRef.current.index] = {
                      ...assistantMessageRef.current.message,
                    };
                  }
                  // Append tool result
                  updated.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolCall.result || '',
                    name: toolCall.name,
                  } as any);
                  return updated;
                });
              }
              break;
            case 'usage':
              if (event.usage) {
                setLastUsage(event.usage);
                setTotalCost((prev) => prev + event.usage!.cost);
              }
              break;
            case 'error':
              if (event.error) {
                const errorMessage = event.error;
                setThreadErrors((prev) => {
                  if (event.transient) {
                    return [
                      ...prev.filter((threadError) => !threadError.transient),
                      {
                        id: \`\${Date.now()}-\${prev.length}\`,
                        message: errorMessage,
                        transient: true,
                      },
                    ];
                  }

                  if (prev[prev.length - 1]?.message === errorMessage) {
                    return prev;
                  }

                  return [
                    ...prev,
                    {
                      id: \`\${Date.now()}-\${prev.length}\`,
                      message: errorMessage,
                      transient: false,
                    },
                  ];
                });
              } else {
                setError('Unknown error');
              }
              break;
            case 'iteration_done':
              if (assistantMessageRef.current?.kind === 'tool_call_assistant') {
                assistantMessageRef.current = null;
              }
              break;
            case 'done':
              if (assistantMessageRef.current?.kind === 'streaming_text') {
                const finalRef = assistantMessageRef.current;
                const buffer = streamingBufferRef.current;

                // Flush any remaining unflushed content from the buffer
                // This is the final incomplete line that was being displayed live
                if (buffer.unflushedContent) {
                  // If we've already flushed some lines, just append the remainder
                  // Otherwise, normalize and flush the full content
                  if (buffer.hasFlushedAnyLine) {
                    addStatic(renderFormattedText(buffer.unflushedContent));
                  } else {
                    // Nothing was flushed yet, normalize the full content
                    const normalized = normalizeTranscriptText(finalRef.message.content || '');
                    if (normalized) {
                      addStatic(renderFormattedText(normalized));
                    }
                  }
                }

                // Add final spacing after the streamed text
                // Always add one newline - the user message adds another for blank line separation
                if (buffer.unflushedContent) {
                  addStatic(renderFormattedText('\\n'));
                }

                // Clear streaming state and buffer
                setIsStreaming(false);
                setStreamingText('');
                streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  updated[finalRef.index] = { ...finalRef.message };
                  return updated;
                });
                assistantMessageRef.current = null;
              }
              setActiveTool(null);
              setThreadErrors((prev) => prev.filter((threadError) => !threadError.transient));
              break;
          }
        },
        {
          pricing: pricing || undefined,
          abortSignal: abortControllerRef.current.signal,
          sessionId: session?.id,
          requestDefaults,
        }
      );

      // Final update to ensure we have the complete message history
      setCompletionMessages(updatedMessages);

      // Update session
      if (session) {
        session.completionMessages = updatedMessages;
        session.todos = getTodosForSession(session.id);
        session.title = generateTitle(updatedMessages);
        await saveSession(session);
      }
    } catch (err: any) {
      setError(\`Error: \${err.message}\`);
    } finally {
      setLoading(false);
    }
  }, [loading, config, completionMessages, session, handleSlashCommand, addStatic]);

  // ─── Keyboard shortcuts ───

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
    if (key.escape && loading && abortControllerRef.current) {
      // Abort the current completion
      abortControllerRef.current.abort();
    }
  });

  // ─── Render ───

  return (
    <Box flexDirection="column">
      {/* Permanent scrollback — Ink flushes new items once within its render cycle */}
      <Static items={staticItems}>
        {(item) => (
          <Text key={item.id}>{item.node}</Text>
        )}
      </Static>

      {helpMessage && (
        <LeftBar color="green" marginTop={1} marginBottom={1}>
          <Text>{helpMessage}</Text>
        </LeftBar>
      )}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {/* Inline setup wizard */}
      {needsSetup && (
        <InlineSetup
          onComplete={(newConfig) => {
            initializeWithConfig(newConfig).catch((err) => {
              setError(\`Initialization failed: \${err.message}\`);
            });
          }}
        />
      )}

      {isStreaming && (
        <Text wrap="wrap">{renderFormattedText(clipToRows(streamingText, terminalRows))}<Text dimColor>▍</Text></Text>
      )}

      {threadErrors.filter((threadError) => threadError.transient).map((threadError) => (
        <LeftBar key={\`thread-error-\${threadError.id}\`} color="gray" marginBottom={1}>
          <Text color="gray">{threadError.message}</Text>
        </LeftBar>
      ))}

      {/* Approval prompt */}
      {pendingApproval && (
        <ApprovalPrompt
          request={pendingApproval.request}
          onRespond={(response) => {
            pendingApproval.resolve(response);
            setPendingApproval(null);
          }}
        />
      )}

      {/* Working indicator */}
      {initialized && !pendingApproval && loading && !isStreaming && (
        <Box>
          <Text color="green" bold>
            {SPINNER_FRAMES[spinnerFrame]}{' '}
            {activeTool ? \`Running \${activeTool}...\` : 'Working...'}
          </Text>
        </Box>
      )}

      {/* Command filter */}
      {initialized && !pendingApproval && inputText.startsWith('/') && (
        <CommandFilter inputText={inputText} />
      )}

      {/* Usage bar */}
      <UsageDisplay usage={lastUsage ?? null} totalCost={totalCost} />

      {/* Input */}
      {initialized && !pendingApproval && (
        <Box>
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color="green" bold>{'>'}</Text>
            </Box>
            <Box flexGrow={1} minWidth={10}>
              <TextInput
                key={inputResetKey}
                defaultValue={inputText}
                onChange={setInputText}
                placeholder="Type your message... (/help for commands)"
                onSubmit={handleSubmit}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Resume session command */}
      {quittingSession && (
        <Box flexDirection="column" marginTop={1} paddingX={1} marginBottom={1}>
          <Text dimColor>Session saved. Resume with:</Text>
          <Text color="green">protoagent --session {quittingSession.id}</Text>
        </Box>
      )}
    </Box>
  );
};
`,
  },
  {
    path: "src/agentic-loop.ts",
    content: `/**
 * The agentic loop — the core of ProtoAgent.
 *
 * This module implements the standard tool-use loop:
 *
 *  1. Send the conversation to the LLM with tool definitions
 *  2. If the response contains tool_calls:
 *     a. Execute each tool
 *     b. Append the results to the conversation
 *     c. Go to step 1
 *  3. If the response is plain text:
 *     a. Return it to the caller (the UI renders it)
 *
 * The loop is a plain TypeScript module — not an Ink component.
 * The UI subscribes to events emitted by the loop and updates
 * React state accordingly. This keeps the core logic testable
 * and UI-independent.
 */

import type OpenAI from 'openai';
import { setMaxListeners } from 'node:events';
import { getAllTools, handleToolCall } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { subAgentTool, runSubAgent, type SubAgentProgressHandler } from './sub-agent.js';
import {
  estimateTokens,
  estimateConversationTokens,
  createUsageInfo,
  getContextInfo,
  type ModelPricing,
} from './utils/cost-tracker.js';
import { compactIfNeeded } from './utils/compactor.js';
import { logger } from './utils/logger.js';

// ─── Types ───

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done' | 'sub_agent_iteration';
  content?: string;
  toolCall?: ToolCallEvent;
  /** Emitted while a sub-agent is executing — carries the child tool name and iteration status.
   *  Distinct from \`tool_call\` so the UI can show it as a nested progress indicator
   *  without adding it to the parent's tool-call message history. */
  subAgentTool?: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> };
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  /** Emitted when a sub-agent completes, carrying its accumulated usage. */
  subAgentUsage?: { inputTokens: number; outputTokens: number; cost: number };
  error?: string;
  transient?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

// ─── Agentic Loop ───

export interface AgenticLoopOptions {
  maxIterations?: number;
  pricing?: ModelPricing;
  abortSignal?: AbortSignal;
  sessionId?: string;
  requestDefaults?: Record<string, unknown>;
}

function emitAbortAndFinish(onEvent: AgentEventHandler): void {
  onEvent({ type: 'done' });
}

async function sleepWithAbort(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  if (abortSignal.aborted) {
    throw new Error('Operation aborted');
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', onAbort);
      reject(new Error('Operation aborted'));
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

/** @internal exported for unit testing only */
export function appendStreamingFragment(current: string, fragment: string): string {
  if (!fragment) return current;
  if (!current) return fragment;
  // Some providers resend the full accumulated value instead of a delta.
  // These two guards handle that case without corrupting normal incremental deltas.
  if (current === fragment) return current;
  if (fragment.startsWith(current)) return fragment;

  // Normal case: incremental delta, just append.
  // The previous partial-overlap loop was removed because it caused false-positive
  // deduplication: short JSON tokens (e.g. \`", "\`) would coincidentally match the
  // tail of \`current\`, silently stripping characters from valid argument payloads.
  return current + fragment;
}

function collapseRepeatedString(value: string): string {
  if (!value) return value;

  for (let size = 1; size <= Math.floor(value.length / 2); size++) {
    if (value.length % size !== 0) continue;
    const candidate = value.slice(0, size);
    if (candidate.repeat(value.length / size) === value) {
      return candidate;
    }
  }

  return value;
}

function normalizeToolName(name: string, validToolNames: Set<string>): string {
  if (!name) return name;
  if (validToolNames.has(name)) return name;

  const collapsed = collapseRepeatedString(name);
  if (validToolNames.has(collapsed)) {
    return collapsed;
  }

  return name;
}

function extractFirstCompleteJsonValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const opening = trimmed[0];
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : null;
  if (!closing) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) depth++;
    if (char === closing) depth--;

    if (depth === 0) {
      return trimmed.slice(0, i + 1);
    }
  }

  return null;
}

/**
 * Repair invalid JSON escape sequences in a string value.
 *
 * JSON only allows: \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX
 * Models sometimes emit \\| \\! \\- etc. (e.g. grep regex args) which make
 * JSON.parse throw, and Anthropic strict-validates tool_call arguments on
 * every subsequent request, bricking the session permanently.
 *
 * We double the backslash for any \\X where X is not a valid JSON escape char.
 */
function repairInvalidEscapes(value: string): string {
  // Match a backslash followed by any character that is NOT a valid JSON escape
  // Valid escapes: " \\ / b f n r t u
  return value.replace(/\\\\([^"\\\\\\/bfnrtu])/g, '\\\\\\\\\$1');
}

function normalizeJsonArguments(argumentsText: string): string {
  const trimmed = argumentsText.trim();
  if (!trimmed) return argumentsText;

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Fall through to repair heuristics.
  }

  const collapsed = collapseRepeatedString(trimmed);
  if (collapsed !== trimmed) {
    try {
      JSON.parse(collapsed);
      return collapsed;
    } catch {
      // Fall through to next heuristic.
    }
  }

  const firstJsonValue = extractFirstCompleteJsonValue(trimmed);
  if (firstJsonValue) {
    try {
      JSON.parse(firstJsonValue);
      return firstJsonValue;
    } catch {
      // Give up and return the original text below.
    }
  }

  // Heuristic: repair invalid escape sequences (e.g. \\| from grep regex args)
  const repaired = repairInvalidEscapes(trimmed);
  if (repaired !== trimmed) {
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // Try repair + first-value extraction together
      const repairedFirst = extractFirstCompleteJsonValue(repaired);
      if (repairedFirst) {
        try {
          JSON.parse(repairedFirst);
          return repairedFirst;
        } catch { /* give up */ }
      }
    }
  }

  return argumentsText;
}

function sanitizeToolCall(
  toolCall: any,
  validToolNames: Set<string>
): { toolCall: any; changed: boolean } {
  const originalName = toolCall.function?.name || '';
  const originalArgs = toolCall.function?.arguments || '';
  const normalizedName = normalizeToolName(originalName, validToolNames);
  const normalizedArgs = normalizeJsonArguments(originalArgs);
  const changed = normalizedName !== originalName || normalizedArgs !== originalArgs;

  if (!changed) {
    return { toolCall, changed: false };
  }

  return {
    changed: true,
    toolCall: {
      ...toolCall,
      function: {
        ...toolCall.function,
        name: normalizedName,
        arguments: normalizedArgs,
      },
    },
  };
}

function sanitizeMessagesForRetry(
  messages: Message[],
  validToolNames: Set<string>
): { messages: Message[]; changed: boolean } {
  let changed = false;

  const sanitizedMessages = messages.map((message) => {
    const msgAny = message as any;
    if (message.role !== 'assistant' || !Array.isArray(msgAny.tool_calls) || msgAny.tool_calls.length === 0) {
      return message;
    }

    const nextToolCalls = msgAny.tool_calls.map((toolCall: any) => {
      const sanitized = sanitizeToolCall(toolCall, validToolNames);
      changed = changed || sanitized.changed;
      return sanitized.toolCall;
    });

    return {
      ...msgAny,
      tool_calls: nextToolCalls,
    } as Message;
  });

  return { messages: sanitizedMessages, changed };
}

/**
 * Remove orphaned tool result messages that don't have a matching tool_call_id
 * in any assistant message. This happens when messages are truncated and the
 * assistant's tool_calls are removed but the tool results remain.
 */
function removeOrphanedToolResults(messages: Message[]): { messages: Message[]; changed: boolean } {
  // Collect all valid tool_call_ids from assistant messages
  const validToolCallIds = new Set<string>();
  for (const message of messages) {
    const msgAny = message as any;
    if (message.role === 'assistant' && Array.isArray(msgAny.tool_calls)) {
      for (const tc of msgAny.tool_calls) {
        if (tc.id) {
          validToolCallIds.add(tc.id);
        }
      }
    }
  }

  // Filter out tool messages with orphaned tool_call_ids
  const filteredMessages = messages.filter((message) => {
    const msgAny = message as any;
    if (message.role === 'tool' && msgAny.tool_call_id) {
      const isOrphaned = !validToolCallIds.has(msgAny.tool_call_id);
      if (isOrphaned) {
        logger.warn('Removing orphaned tool result', {
          tool_call_id: msgAny.tool_call_id,
          contentPreview: msgAny.content?.slice(0, 100),
        });
      }
      return !isOrphaned;
    }
    return true;
  });

  return { messages: filteredMessages, changed: filteredMessages.length !== messages.length };
}

function getValidToolNames(): Set<string> {
  return new Set(
    [...getAllTools(), subAgentTool]
      .map((tool: any) => tool.function?.name)
      .filter((name: string | undefined): name is string => Boolean(name))
  );
}

/**
 * Process a single user input through the agentic loop.
 *
 * Takes the full conversation history (including system message),
 * appends the user message, runs the loop, and returns the updated
 * message history.
 *
 * The \`onEvent\` callback is called for each event (text deltas,
 * tool calls, usage info, etc.) so the UI can render progress.
 */
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const pricing = options.pricing;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;
  const requestDefaults = options.requestDefaults || {};

  // The same AbortSignal is passed into every OpenAI SDK call and every
  // sleepWithAbort() across all loop iterations and sub-agent calls.
  // The SDK attaches an 'abort' listener per request, so on a long run
  // the default limit of 10 listeners is quickly exceeded, producing the
  // MaxListenersExceededWarning.  AbortSignal is a Web API EventTarget,
  // not a Node EventEmitter, so the instance method .setMaxListeners()
  // doesn't exist on it — use the standalone setMaxListeners() from
  // node:events instead, which handles both EventEmitter and EventTarget.
  if (abortSignal) {
    setMaxListeners(0, abortSignal); // 0 = unlimited, scoped to this signal only
  }

  // Note: userInput is passed for context/logging but user message should already be in messages array
  // (added by the caller in handleSubmit for immediate UI display)
  const updatedMessages: Message[] = [...messages];

  // Refresh system prompt to pick up any new skills or project changes
  const newSystemPrompt = await generateSystemPrompt();
  const systemMsgIndex = updatedMessages.findIndex((m) => m.role === 'system');
  if (systemMsgIndex !== -1) {
    updatedMessages[systemMsgIndex] = { role: 'system', content: newSystemPrompt } as Message;
  }

  let iterationCount = 0;
  let repairRetryCount = 0;
  let contextRetryCount = 0;
  let retriggerCount = 0;
  let truncateRetryCount = 0;
  let continueRetryCount = 0;
  const MAX_RETRIGGERS = 3;
  const MAX_TRUNCATE_RETRIES = 5;
  const MAX_CONTINUE_RETRIES = 1;
  const validToolNames = getValidToolNames();

  while (iterationCount < maxIterations) {
    // Check if abort was requested
    if (abortSignal?.aborted) {
      logger.debug('Agentic loop aborted by user');
      emitAbortAndFinish(onEvent);
      return updatedMessages;
    }

    iterationCount++;

    // Check for compaction
    if (pricing) {
      const contextInfo = getContextInfo(updatedMessages, pricing);
      if (contextInfo.needsCompaction) {
        const compacted = await compactIfNeeded(
          client,
          model,
          updatedMessages,
          pricing.contextWindow,
          contextInfo.currentTokens,
          requestDefaults,
          sessionId
        );
        // Replace messages in-place
        updatedMessages.length = 0;
        updatedMessages.push(...compacted);
      }
    }

    // Declare assistantMessage outside try block so it's accessible in catch
    let assistantMessage: any;

    try {
      // Build tools list: core tools + sub-agent tool + dynamic (MCP) tools
      const allTools = [...getAllTools(), subAgentTool];

      logger.info('Making API request', {
        model,
        toolsCount: allTools.length,
        messagesCount: updatedMessages.length,
      });

      // Log message structure for debugging provider compatibility
      for (const msg of updatedMessages) {
        const m = msg as any;
        if (m.role === 'tool') {
          logger.trace('Message payload', {
            role: m.role,
            tool_call_id: m.tool_call_id,
            contentLength: m.content?.length,
            contentPreview: m.content?.slice(0, 100),
          });
        } else if (m.role === 'assistant' && m.tool_calls?.length) {
          logger.trace('Message payload', {
            role: m.role,
            toolCalls: m.tool_calls.map((tc: any) => ({
              id: tc.id,
              name: tc.function?.name,
              argsLength: tc.function?.arguments?.length,
            })),
          });
        } else {
          logger.trace('Message payload', {
            role: m.role,
            contentLength: m.content?.length,
          });
        }
      }

        const stream = await client.chat.completions.create({
         ...requestDefaults,
         model,
         messages: updatedMessages,
         tools: allTools,
         tool_choice: 'auto',
         stream: true,
         stream_options: { include_usage: true },
       }, {
        signal: abortSignal,
      });

      // Accumulate the streamed response
      assistantMessage = {
        role: 'assistant',
        content: '',
        tool_calls: [],
      };
      let streamedContent = '';
      let hasToolCalls = false;
      let actualUsage: OpenAI.CompletionUsage | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (chunk.usage) {
          actualUsage = chunk.usage;
        }

        // Stream text content (and return to UI for immediate display via onEvent)
        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
        }

        // Accumulate tool calls across stream chunks
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
            if (tc.function?.name) {
              assistantMessage.tool_calls[idx].function.name = appendStreamingFragment(
                assistantMessage.tool_calls[idx].function.name,
                tc.function.name
              );
            }
            if (tc.function?.arguments) {
              assistantMessage.tool_calls[idx].function.arguments = appendStreamingFragment(
                assistantMessage.tool_calls[idx].function.arguments,
                tc.function.arguments
              );
            }
            // Gemini 3+ models include an \`extra_content\` field on tool calls
            // containing a \`thought_signature\`. This MUST be preserved and sent
            // back in subsequent requests, otherwise Gemini returns a 400.
            // See: https://ai.google.dev/gemini-api/docs/openai
            // See also: https://gist.github.com/thomasgauvin/3cfe8e907c957fba4e132e6cf0f06292
            if ((tc as any).extra_content) {
              assistantMessage.tool_calls[idx].extra_content = (tc as any).extra_content;
            }
          }
        }
      }

      // Log API response with usage info at INFO level
      {
        const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(updatedMessages);
        const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
        const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
        const cost = pricing
          ? createUsageInfo(inputTokens, outputTokens, pricing, cachedTokens).estimatedCost
          : 0;
        const contextPercent = pricing
          ? getContextInfo(updatedMessages, pricing).utilizationPercentage
          : 0;

        logger.info('Received API response', {
          model,
          inputTokens,
          outputTokens,
          cachedTokens,
          cost: cost > 0 ? \`\$\${cost.toFixed(4)}\` : 'N/A',
          contextPercent: contextPercent > 0 ? \`\${contextPercent.toFixed(1)}%\` : 'N/A',
          hasToolCalls: assistantMessage.tool_calls.length > 0,
          contentLength: assistantMessage.content?.length || 0,
        });

        onEvent({
          type: 'usage',
          usage: { inputTokens, outputTokens, cost, contextPercent },
        });
      }

      // Log the full assistant message for debugging
      logger.debug('Assistant response details', {
        contentLength: assistantMessage.content?.length || 0,
        contentPreview: assistantMessage.content?.slice(0, 200) || '(empty)',
        toolCallsCount: assistantMessage.tool_calls?.length || 0,
        toolCalls: assistantMessage.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name,
          argsPreview: tc.function?.arguments?.slice(0, 100),
        })),
      });

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Reset retrigger count on valid tool call response
        retriggerCount = 0;
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        assistantMessage.tool_calls = assistantMessage.tool_calls.map((toolCall: any) => {
          const sanitized = sanitizeToolCall(toolCall, validToolNames);
          if (sanitized.changed) {
            logger.warn('Sanitized streamed tool call', {
              originalName: toolCall.function?.name,
              sanitizedName: sanitized.toolCall.function?.name,
            });
          }
          return sanitized.toolCall;
        });

        // Validate that all tool calls have valid JSON arguments
        const invalidToolCalls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return false; // Empty args is valid
          try {
            JSON.parse(args);
            return false; // Valid JSON
          } catch {
            return true; // Invalid JSON
          }
        });

        if (invalidToolCalls.length > 0) {
          logger.warn('Assistant produced tool calls with invalid JSON, skipping this turn', {
            invalidToolCalls: invalidToolCalls.map((tc: any) => ({
              name: tc.function?.name,
              argsPreview: tc.function?.arguments?.slice(0, 100),
            })),
          });
          // Don't add the malformed assistant message to conversation
          // The loop will continue and retry
          continue;
        }

        logger.info('Model returned tool calls', {
          count: assistantMessage.tool_calls.length,
          tools: assistantMessage.tool_calls.map((tc: any) => tc.function?.name).join(', '),
        });

        updatedMessages.push(assistantMessage);

        // Track which tool_call_ids still need a tool result message.
        // This set is used to inject stub responses on abort, preventing
        // orphaned tool_call_ids from permanently bricking the session.
        const pendingToolCallIds = new Set<string>(
          assistantMessage.tool_calls.map((tc: any) => tc.id as string)
        );

        const injectStubsForPendingToolCalls = () => {
          for (const id of pendingToolCallIds) {
            updatedMessages.push({
              role: 'tool',
              tool_call_id: id,
              content: 'Aborted by user.',
            } as any);
          }
        };

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            logger.debug('Agentic loop aborted between tool calls');
            injectStubsForPendingToolCalls();
            emitAbortAndFinish(onEvent);
            return updatedMessages;
          }

          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' },
          });

          try {
            const args = JSON.parse(argsStr);
            let result: string;

            // Handle sub-agent tool specially
            if (name === 'sub_agent') {
              const subProgress: SubAgentProgressHandler = (evt) => {
                onEvent({
                  type: 'sub_agent_iteration',
                  subAgentTool: { tool: evt.tool, status: evt.status, iteration: evt.iteration, args: evt.args },
                });
              };
              const subResult = await runSubAgent(
                client,
                model,
                args.task,
                args.max_iterations,
                requestDefaults,
                subProgress,
                abortSignal,
                pricing,
              );
              result = subResult.response;
              // Emit sub-agent usage for the UI to add to total cost
              if (subResult.usage.inputTokens > 0 || subResult.usage.outputTokens > 0) {
                onEvent({
                  type: 'sub_agent_iteration',
                  subAgentUsage: subResult.usage,
                });
              }
            } else {
              result = await handleToolCall(name, args, { sessionId, abortSignal });
            }

            logger.info('Tool completed', {
              tool: name,
              resultLength: result.length,
            });

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
            pendingToolCallIds.delete(toolCall.id);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result },
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: \`Error: \${errMsg}\`,
            } as any);
            pendingToolCallIds.delete(toolCall.id);

            // If the tool was aborted, inject stubs for remaining pending calls and stop
            if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
              logger.debug('Agentic loop aborted during tool execution');
              injectStubsForPendingToolCalls();
              emitAbortAndFinish(onEvent);
              return updatedMessages;
            }

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg },
            });
          }
        }

        // Signal UI that this iteration's tool calls are all done,
        // so it can flush completed messages to static output.
        onEvent({ type: 'iteration_done' });

        // Continue loop — let the LLM process tool results
        continue;
      }

      // Plain text response — we're done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
        // Reset retrigger count on valid content response
        retriggerCount = 0;
      }

      // Check if we need to retrigger: if the last message is a tool result
      // but we got no assistant response (empty content, no tool_calls), the AI
      // may have stopped prematurely. Inject a 'continue' prompt and retry.
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      if (lastMessage?.role === 'tool' && retriggerCount < MAX_RETRIGGERS) {
        retriggerCount++;
        logger.warn('AI stopped after tool call without responding; retriggering', {
          retriggerCount,
          maxRetriggers: MAX_RETRIGGERS,
          lastMessageRole: lastMessage.role,
          assistantContent: assistantMessage.content || '(empty)',
          hasToolCalls: assistantMessage.tool_calls.length > 0,
        });
        // Inject a 'continue' prompt to help the AI continue
        updatedMessages.push({
          role: 'user',
          content: 'Please continue.',
        } as Message);
        continue;
      }

      repairRetryCount = 0;
      retriggerCount = 0;
      onEvent({ type: 'done' });
      return updatedMessages;

      } catch (apiError: any) {
      if (abortSignal?.aborted || apiError?.name === 'AbortError' || apiError?.message === 'Operation aborted') {
        logger.debug('Agentic loop request aborted');
        // If we have a partial assistant message with tool_calls, we need to
        // add it to the conversation history before returning, otherwise the
        // message sequence will be invalid (tool results without assistant tool_calls).
        if (assistantMessage && (assistantMessage.content || assistantMessage.tool_calls?.length > 0)) {
          // Clean up empty tool_calls entries
          if (assistantMessage.tool_calls?.length > 0) {
            assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
            // Filter out tool calls with malformed/incomplete JSON arguments
            assistantMessage.tool_calls = assistantMessage.tool_calls.filter((tc: any) => {
              const args = tc.function?.arguments;
              if (!args) return true; // No args is valid
              try {
                JSON.parse(args);
                return true; // Valid JSON
              } catch {
                logger.warn('Filtering out tool call with malformed JSON arguments due to abort', {
                  tool: tc.function?.name,
                  argsPreview: args.slice(0, 100),
                });
                return false; // Invalid JSON, filter out
              }
            });
          }
          // Only add the assistant message if we have content or valid tool calls
          if (assistantMessage.content || assistantMessage.tool_calls?.length > 0) {
            updatedMessages.push(assistantMessage);
          }
        }
        emitAbortAndFinish(onEvent);
        return updatedMessages;
      }

      const errMsg = apiError?.message || 'Unknown API error';

      // Try to extract response body for more details
      let responseBody: string | undefined;
      try {
        if (apiError?.response) {
          responseBody = JSON.stringify(apiError.response);
        } else if (apiError?.error) {
          responseBody = JSON.stringify(apiError.error);
        }
      } catch { /* ignore */ }

      logger.error(\`API error: \${errMsg}\`, {
        status: apiError?.status,
        code: apiError?.code,
        responseBody,
        headers: apiError?.headers ? Object.fromEntries(
          Object.entries(apiError.headers).filter(([k]) =>
            ['content-type', 'x-error', 'retry-after'].includes(k.toLowerCase())
          )
        ) : undefined,
      });

      // Log the last few messages to help debug format issues
      logger.debug('Messages at time of error', {
        lastMessages: updatedMessages.slice(-3).map((m: any) => ({
          role: m.role,
          hasToolCalls: !!(m.tool_calls?.length),
          tool_call_id: m.tool_call_id,
          contentPreview: m.content?.slice(0, 150),
        })),
      });

      const retryableStatus = apiError?.status === 408 || apiError?.status === 409 || apiError?.status === 425;
      const retryableCode = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(apiError?.code);

      // Handle 400 errors: try sanitization first, then truncate messages
      if (apiError?.status === 400) {
        // Try sanitization first
        if (repairRetryCount < 2) {
          const sanitized = sanitizeMessagesForRetry(updatedMessages, getValidToolNames());
          if (sanitized.changed) {
            repairRetryCount++;
            updatedMessages.length = 0;
            updatedMessages.push(...sanitized.messages);
            logger.warn('400 response after malformed tool payload; retrying with sanitized messages', {
              repairRetryCount,
            });
            // Silently retry without showing error to user
            continue;
          }
        }

        // Try removing orphaned tool results
        const orphanedRemoved = removeOrphanedToolResults(updatedMessages);
        if (orphanedRemoved.changed) {
          updatedMessages.length = 0;
          updatedMessages.push(...orphanedRemoved.messages);
          logger.warn('400 response after orphaned tool results; retrying with cleaned messages');
          // Silently retry without showing error to user
          continue;
        }

        // If sanitization didn't help, try removing messages one at a time (up to 5)
        if (truncateRetryCount < MAX_TRUNCATE_RETRIES) {
          truncateRetryCount++;
          const removedCount = Math.min(1, Math.max(0, updatedMessages.length - 2)); // Remove 1 at a time, keep system + at least 1 user
          if (removedCount > 0) {
            const removed = updatedMessages.splice(-removedCount);
            logger.debug('400 error: removing message from history to attempt fix', {
              truncateRetryCount,
              maxRetries: MAX_TRUNCATE_RETRIES,
              removedCount,
              removedRoles: removed.map((m: any) => m.role),
              removedPreviews: removed.map((m: any) => ({
                role: m.role,
                content: m.content?.slice(0, 100),
                tool_calls: m.tool_calls?.map((tc: any) => tc.function?.name),
              })),
            });
            // Silently retry without showing error to user
            continue;
          }
        }

        // After truncation retries exhausted, try adding a "continue" message
        if (continueRetryCount < MAX_CONTINUE_RETRIES) {
          continueRetryCount++;
          updatedMessages.push({ role: 'user', content: 'continue' } as Message);
          logger.warn('400 error: adding "continue" message to retry', {
            continueRetryCount,
            messageCount: updatedMessages.length,
          });
          onEvent({
            type: 'error',
            error: 'Request failed. Retrying with "continue"...',
            transient: true,
          });
          continue;
        }
      }

      // Handle context-window-exceeded (prompt too long) — attempt forced compaction
      // This fires when our token estimate was too low (e.g. base64 images from MCP tools)
      // and the request actually hit the hard provider limit.
      const isContextTooLong =
        apiError?.status === 400 &&
        typeof errMsg === 'string' &&
        /prompt.{0,30}too long|context.{0,30}length|maximum.{0,30}token|tokens?.{0,10}exceed/i.test(errMsg);

      if (isContextTooLong && contextRetryCount < 2) {
        contextRetryCount++;
        logger.warn(\`Prompt too long (attempt \${contextRetryCount}); forcing compaction\`, { errMsg });
        onEvent({
          type: 'error',
          error: 'Prompt too long. Compacting conversation and retrying...',
          transient: true,
        });

        if (pricing) {
          // Use the normal LLM-based compaction path
          try {
            const compacted = await compactIfNeeded(
              client, model, updatedMessages, pricing.contextWindow,
              // Pass the context window itself as currentTokens to force compaction
              pricing.contextWindow,
              requestDefaults, sessionId
            );
            updatedMessages.length = 0;
            updatedMessages.push(...compacted);
          } catch (compactErr) {
            logger.error(\`Forced compaction failed: \${compactErr}\`);
            // Fall through to truncation fallback below
          }
        }

        // Fallback: truncate any tool result messages whose content looks like
        // base64 or is extremely large (e.g. MCP screenshot data)
        const MAX_TOOL_RESULT_CHARS = 20_000;
        for (let i = 0; i < updatedMessages.length; i++) {
          const m = updatedMessages[i] as any;
          if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_RESULT_CHARS) {
            updatedMessages[i] = {
              ...m,
              content: m.content.slice(0, MAX_TOOL_RESULT_CHARS) + '\\n... (truncated — content was too large)',
            };
          }
        }

        continue;
      }

      // Retry on 429 (rate limit) with backoff
      if (apiError?.status === 429) {
        const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
        const backoff = Math.min(retryAfter * 1000, 60_000);
        logger.info(\`Rate limited, retrying in \${backoff / 1000}s...\`);
        onEvent({ type: 'error', error: \`Rate limited. Retrying in \${backoff / 1000}s...\`, transient: true });
        await sleepWithAbort(backoff, abortSignal);
        continue;
      }

      // Retry on transient request failures
      if (apiError?.status >= 500 || retryableStatus || retryableCode) {
        const backoff = Math.min(2 ** iterationCount * 1000, 30_000);
        logger.info(\`Request failed, retrying in \${backoff / 1000}s...\`);
        onEvent({ type: 'error', error: \`Request failed. Retrying in \${backoff / 1000}s...\`, transient: true });
        await sleepWithAbort(backoff, abortSignal);
        continue;
      }

      // 400 error that couldn't be fixed by sanitization or truncation
      if (apiError?.status === 400) {
        onEvent({
          type: 'error',
          error: \`Request failed: \${errMsg}\\n\\nThe conversation history could not be automatically repaired. Try /clear to start fresh.\`,
          transient: false,
        });
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      // Non-retryable error
      onEvent({ type: 'error', error: errMsg });
      onEvent({ type: 'done' });
      return updatedMessages;
    }
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}

/**
 * Initialize the conversation with the system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt } as Message];
}
`,
  },
  {
    path: "src/cli.tsx",
    content: `#!/usr/bin/env node
/**
 * CLI entry point for ProtoAgent.
 *
 * Parses command-line flags and launches either the main chat UI
 * or the configuration wizard.
 */

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, InitComponent, readConfig, writeConfig, writeInitConfig } from './config.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: TRACE, DEBUG, INFO, WARN, ERROR', 'DEBUG')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    // Default action - start the main app
    render(
      <App
        dangerouslySkipPermissions={options.dangerouslySkipPermissions || false}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });

// Configure subcommand
program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(\`\${selected.provider} / \${selected.model}\`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program
  .command('init')
  .description('Create a project-local or shared ProtoAgent runtime config')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--force', 'Overwrite an existing target file')
  .action((options) => {
    if (options.project || options.user) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }

      const result = writeInitConfig(options.project ? 'project' : 'user', process.cwd(), {
        overwrite: Boolean(options.force),
      });
      const message = result.status === 'created'
        ? 'Created ProtoAgent config:'
        : result.status === 'overwritten'
          ? 'Overwrote ProtoAgent config:'
          : 'ProtoAgent config already exists:';
      console.log(message);
      console.log(result.path);
      return;
    }

    render(<InitComponent />);
  });

program.parse(process.argv);
`,
  },
  {
    path: "src/components/CollapsibleBox.tsx",
    content: `/**
 * CollapsibleBox — A component that hides long content with expand/collapse controls
 *
 * Used for system prompts, tool results, and other verbose output.
 * Use /expand and /collapse commands to toggle visibility.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { LeftBar } from './LeftBar.js';

export interface CollapsibleBoxProps {
  title: string;
  content: string;
  titleColor?: string;
  dimColor?: boolean;
  maxPreviewLines?: number;
  maxPreviewChars?: number;
  expanded?: boolean;
  marginBottom?: number;
}

export const CollapsibleBox: React.FC<CollapsibleBoxProps> = ({
  title,
  content,
  titleColor,
  dimColor = false,
  maxPreviewLines = 3,
  maxPreviewChars = 500,
  expanded = false,
  marginBottom = 0,
}) => {
  const lines = content.split('\\n');
  const isTooManyLines = lines.length > maxPreviewLines;
  const isTooManyChars = content.length > maxPreviewChars;
  const isLong = isTooManyLines || isTooManyChars;

  // If content is short, always show it
  if (!isLong) {
    return (
      <LeftBar color={titleColor ?? 'white'} marginBottom={marginBottom}>
        <Text color={titleColor} dimColor={dimColor} bold>
          {title}
        </Text>
        <Text dimColor={dimColor}>{content}</Text>
      </LeftBar>
    );
  }

  // For long content, show preview or full content
  let preview: string;
  if (expanded) {
    preview = content;
  } else {
    // Truncate by lines first, then by characters
    const linesTruncated = lines.slice(0, maxPreviewLines).join('\\n');
    preview = linesTruncated.length > maxPreviewChars
      ? linesTruncated.slice(0, maxPreviewChars)
      : linesTruncated;
  }
  const hasMore = !expanded;

  return (
    <LeftBar color={titleColor ?? 'white'} marginBottom={marginBottom}>
      <Text color={titleColor} dimColor={dimColor} bold>
        {expanded ? '▼' : '▶'} {title}
      </Text>
      <Text dimColor={dimColor}>{preview}</Text>
      {hasMore && <Text dimColor={true}>... (use /expand to see all)</Text>}
    </LeftBar>
  );
};
`,
  },
  {
    path: "src/components/ConsolidatedToolMessage.tsx",
    content: `/**
 * ConsolidatedToolMessage — Displays a tool call and its result together
 *
 * Groups a tool call (from assistant message) with its corresponding
 * tool result message into a single consolidated view.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { FormattedMessage } from './FormattedMessage.js';
import { LeftBar } from './LeftBar.js';

export interface ConsolidatedToolMessageProps {
  toolCalls: Array<{ id: string; name: string }>;
  toolResults: Map<string, { content: string; name: string }>;
  expanded?: boolean;
}

export const ConsolidatedToolMessage: React.FC<ConsolidatedToolMessageProps> = ({
  toolCalls,
  toolResults,
  expanded = false,
}) => {
  const toolNames = toolCalls.map((toolCall) => toolCall.name);
  const title = \`Called: \${toolNames.join(', ')}\`;
  const containsTodoTool = toolCalls.some((toolCall) => toolCall.name === 'todo_read' || toolCall.name === 'todo_write');
  const titleColor = containsTodoTool ? 'green' : 'cyan';
  const isExpanded = expanded || containsTodoTool;

  if (isExpanded) {
    return (
      <LeftBar color={titleColor}>
        <Text color={titleColor} bold>▼ {title}</Text>
        {toolCalls.map((toolCall, idx) => {
          const result = toolResults.get(toolCall.id);
          if (!result) return null;

          return (
            <Box key={idx} flexDirection="column">
              <Text color="cyan" bold>[{result.name}]:</Text>
              <FormattedMessage content={result.content} />
            </Box>
          );
        })}
      </LeftBar>
    );
  }

  const compactLines = toolCalls.flatMap((toolCall) => {
    const result = toolResults.get(toolCall.id);
    if (!result) return [];

    const compactContent = result.content
      .replace(/\\s+/g, ' ')
      .trim();

    return [\`[\${result.name}] \${compactContent}\`];
  });

  const compactPreview = compactLines.join(' | ');
  const previewLimit = 180;
  const preview = compactPreview.length > previewLimit
    ? \`\${compactPreview.slice(0, previewLimit).trimEnd()}... (use /expand)\`
    : compactPreview;

  return (
    <LeftBar color="white">
      <Text color={titleColor} dimColor bold>
        ▶ {title}
      </Text>
      <Text dimColor>{preview}</Text>
    </LeftBar>
  );
};
`,
  },
  {
    path: "src/components/FormattedMessage.tsx",
    content: `import React from 'react';
import { Box, Text } from 'ink';
import { renderFormattedText } from '../utils/format-message.js';
import { LeftBar } from './LeftBar.js';

interface FormattedMessageProps {
  content: string;
  deferTables?: boolean;
}

export const DEFERRED_TABLE_PLACEHOLDER = 'table loading';

const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

const COMBINING_MARK_PATTERN = /\\p{Mark}/u;
const ZERO_WIDTH_PATTERN = /[\\u200B-\\u200D\\uFE0E\\uFE0F]/u;
const DOUBLE_WIDTH_PATTERN = /[\\u1100-\\u115F\\u2329\\u232A\\u2E80-\\uA4CF\\uAC00-\\uD7A3\\uF900-\\uFAFF\\uFE10-\\uFE19\\uFE30-\\uFE6F\\uFF00-\\uFF60\\uFFE0-\\uFFE6\\u{1F300}-\\u{1FAFF}\\u{1F900}-\\u{1F9FF}\\u{1F1E6}-\\u{1F1FF}]/u;

function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

function getGraphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (ZERO_WIDTH_PATTERN.test(grapheme)) return 0;
  if (COMBINING_MARK_PATTERN.test(grapheme)) return 0;
  if (/^[\\u0000-\\u001F\\u007F-\\u009F]\$/.test(grapheme)) return 0;
  if (DOUBLE_WIDTH_PATTERN.test(grapheme)) return 2;
  return 1;
}

function getTextWidth(text: string): number {
  return splitGraphemes(text).reduce((width, grapheme) => width + getGraphemeWidth(grapheme), 0);
}

function padToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - getTextWidth(text));
  return text + ' '.repeat(padding);
}

function parseMarkdownTableToRows(markdown: string): string[][] | null {
  const lines = markdown.trim().split('\\n');
  if (lines.length < 3) return null;

  const parseRow = (row: string) =>
    row.split('|')
      .map((cell) => cell.trim())
      .filter((cell, index, array) => {
        if (index === 0 && cell === '') return false;
        if (index === array.length - 1 && cell === '') return false;
        return true;
      });

  const header = parseRow(lines[0]);
  const separator = parseRow(lines[1]);
  if (header.length === 0 || separator.length === 0) return null;
  if (!separator.every((cell) => /^:?-{3,}:?\$/.test(cell.replace(/\\s+/g, '')))) return null;

  const rows = lines.slice(2).map(parseRow);
  return [header, ...rows];
}

function renderPreformattedTable(markdown: string): string {
  const rows = parseMarkdownTableToRows(markdown);
  if (!rows || rows.length === 0) {
    return markdown.trim();
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  );
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...normalizedRows.map((row) => getTextWidth(row[index])))
  );

  const formatRow = (row: string[]) => row
    .map((cell, index) => padToWidth(cell, widths[index]))
    .join('  ')
    .trimEnd();

  const header = formatRow(normalizedRows[0]);
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = normalizedRows.slice(1).map(formatRow);

  return [header, divider, ...body].join('\\n');
}

/**
 * FormattedMessage component
 * 
 * Parses a markdown string and renders:
 * - Standard text with ANSI formatting
 * - Markdown tables as preformatted monospace text
 * - Code blocks (rendered in a box)
 */
export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content, deferTables = false }) => {
  if (!content) return null;

  const lines = content.split('\\n');
  const blocks: Array<{ type: 'text' | 'table' | 'code'; content: string }> = [];

  let currentBlockContent: string[] = [];
  let currentBlockType: 'text' | 'table' | 'code' = 'text';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 1. Handle Code Blocks
    if (currentBlockType === 'code') {
      currentBlockContent.push(line);
      // Check for end of code block
      if (trimmedLine.startsWith('\`\`\`')) {
        blocks.push({ type: 'code', content: currentBlockContent.join('\\n') });
        currentBlockContent = [];
        currentBlockType = 'text';
      }
      continue;
    }

    // Start Code Block
    if (trimmedLine.startsWith('\`\`\`')) {
      // Finish pending text block
      if (currentBlockContent.length > 0) {
        blocks.push({ type: 'text', content: currentBlockContent.join('\\n') });
      }
      currentBlockContent = [line];
      currentBlockType = 'code';
      continue;
    }

    // 2. Handle Tables
    if (currentBlockType === 'table') {
      if (trimmedLine.startsWith('|')) {
        currentBlockContent.push(line);
        continue;
      } else {
        // End of table block found (line doesn't start with |)
        blocks.push({ type: 'table', content: currentBlockContent.join('\\n') });
        
        // Reset to text and fall through to re-process this line
        currentBlockContent = [];
        currentBlockType = 'text';
      }
    }

    // Start Table Block check
    // A table start requires a pipe AND a subsequent separator line
    const isTableStart = trimmedLine.startsWith('|');
    const nextLine = lines[i+1];
    const isNextLineSeparator = nextLine && nextLine.trim().startsWith('|') && nextLine.includes('---');

    if (isTableStart && isNextLineSeparator) {
      // Finish pending text block
      if (currentBlockContent.length > 0) {
        blocks.push({ type: 'text', content: currentBlockContent.join('\\n') });
      }
      currentBlockContent = [line];
      currentBlockType = 'table';
      continue;
    }

    // 3. Handle Text
    currentBlockContent.push(line);
  }

  // Push final block
  if (currentBlockContent.length > 0) {
    blocks.push({ type: currentBlockType, content: currentBlockContent.join('\\n') });
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        if (block.type === 'table') {
          if (!block.content.trim()) return null;
          if (deferTables) {
            return (
              <Box key={index} marginY={1}>
                <Text dimColor>{DEFERRED_TABLE_PLACEHOLDER}</Text>
              </Box>
            );
          }
          return (
            <LeftBar key={index} color="gray" marginTop={1} marginBottom={1}>
              <Text>{renderPreformattedTable(block.content)}</Text>
            </LeftBar>
          );
        }
        
        if (block.type === 'code') {
           return (
             <LeftBar key={index} color="gray" marginTop={1} marginBottom={1}>
               <Text dimColor>{block.content}</Text>
             </LeftBar>
           );
        }
        
        // Text Block
        if (!block.content.trim()) return null;
        return (
          <Box key={index} marginBottom={0}>
             <Text>{renderFormattedText(block.content)}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
`,
  },
  {
    path: "src/components/LeftBar.tsx",
    content: `/**
 * LeftBar — renders a bold green vertical bar (│) on the left side of
 * content, like a GitHub "note" callout. The bar stretches to match the
 * full height of the content by measuring the content box after each render
 * and repeating the │ character once per row.
 *
 * Uses Ink's measureElement (available in stock Ink) rather than a Box
 * border, so it adds zero extra border lines and avoids ghosting on resize.
 */

import React, { useRef, useState, useLayoutEffect } from 'react';
import { Box, Text, measureElement } from 'ink';
import type { DOMElement } from 'ink';

export interface LeftBarProps {
  color?: string;
  children: React.ReactNode;
  marginTop?: number;
  marginBottom?: number;
}

export const LeftBar: React.FC<LeftBarProps> = ({
  color = 'green',
  children,
  marginTop = 0,
  marginBottom = 0,
}) => {
  const contentRef = useRef<DOMElement>(null);
  const [height, setHeight] = useState(1);

  useLayoutEffect(() => {
    if (contentRef.current) {
      try {
        const { height: h } = measureElement(contentRef.current);
        if (h > 0) setHeight(h);
      } catch {
        // measureElement can throw before layout is complete; keep previous height
      }
    }
  });

  const bar = Array.from({ length: height }, () => '│').join('\\n');

  return (
    <Box flexDirection="row" marginTop={marginTop} marginBottom={marginBottom}>
      <Box flexDirection="column" marginRight={1}>
        <Text color={color} bold>{bar}</Text>
      </Box>
      <Box ref={contentRef} flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
};
`,
  },
  {
    path: "src/config.tsx",
    content: `import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput, PasswordInput } from '@inkjs/ui';
import { parse } from 'jsonc-parser';
import { getActiveRuntimeConfigPath, type RuntimeConfigFile, type RuntimeProviderConfig } from './runtime-config.js';
import { getAllProviders, getProvider } from './providers.js';

export interface Config {
  provider: string;
  model: string;
  apiKey?: string;
}

export type InitConfigTarget = 'project' | 'user';
export type InitConfigWriteStatus = 'created' | 'exists' | 'overwritten';

const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

export function resolveApiKey(config: Pick<Config, 'provider' | 'apiKey'>): string | null {
  const provider = getProvider(config.provider);

  // 1. Provider-specific environment variable
  if (provider?.apiKeyEnvVar) {
    const providerEnvOverride = process.env[provider.apiKeyEnvVar]?.trim();
    if (providerEnvOverride) {
      return providerEnvOverride;
    }
  }

  // 2. Generic environment variable
  const envOverride = process.env.PROTOAGENT_API_KEY?.trim();
  if (envOverride) {
    return envOverride;
  }

  // 3. Config file (either from selected provider or direct apiKey)
  const directApiKey = config.apiKey?.trim();
  if (directApiKey) {
    return directApiKey;
  }

  const providerApiKey = provider?.apiKey?.trim();
  if (providerApiKey) {
    return providerApiKey;
  }

  // Fallback for Cloudflare Gateway or other custom header setups
  if (process.env.PROTOAGENT_CUSTOM_HEADERS) {
    return 'none';
  }

  if (!provider?.apiKeyEnvVar) {
    if (provider?.headers && Object.keys(provider.headers).length > 0) {
      return 'none';
    }
    return null;
  }

  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    return 'none';
  }

  return null;
}

export const getConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent');
};

export const getUserRuntimeConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.config', 'protoagent');
};

export const getUserRuntimeConfigPath = () => {
  return path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc');
};

export const getProjectRuntimeConfigDirectory = (cwd = process.cwd()) => {
  return path.join(cwd, '.protoagent');
};

export const getProjectRuntimeConfigPath = (cwd = process.cwd()) => {
  return path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc');
};

export const getInitConfigPath = (target: InitConfigTarget, cwd = process.cwd()) => {
  return target === 'project' ? getProjectRuntimeConfigPath(cwd) : getUserRuntimeConfigPath();
};

const RUNTIME_CONFIG_TEMPLATE = \`{
  // Add project or user-wide ProtoAgent runtime config here.
  // Example uses:
  // - choose the active provider/model by making it the first provider
  //   and the first model under that provider
  // - custom providers/models
  // - MCP server definitions
  // - request default parameters
  "providers": {
    // "provider-id": {
    //   "name": "Display Name",
    //   "baseURL": "https://api.example.com/v1",
    //   "apiKey": "your-api-key",
    //   "apiKeyEnvVar": "ENV_VAR_NAME",
    //   "headers": {
    //     "X-Custom-Header": "value"
    //   },
    //   "defaultParams": {},
    //   "models": {
    //     "model-id": {
    //       "name": "Display Name",
    //       "contextWindow": 128000,
    //       "inputPricePerMillion": 2.5,
    //       "outputPricePerMillion": 10.0,
    //       "cachedPricePerMillion": 1.25,
    //       "defaultParams": {}
    //     }
    //   }
    // }
  },
  "mcp": {
    "servers": {
      // "server-name": {
      //   "type": "stdio",
      //   "command": "npx",
      //   "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      //   "env": { "KEY": "value" },
      //   "cwd": "/working/directory",
      //   "enabled": true,
      //   "timeoutMs": 30000
      // },
      // "http-server": {
      //   "type": "http",
      //   "url": "https://mcp-server.example.com",
      //   "headers": { "Authorization": "Bearer token" },
      //   "enabled": true,
      //   "timeoutMs": 30000
      // }
    }
  }
}
\`;

function ensureDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  hardenPermissions(targetDir, CONFIG_DIR_MODE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRuntimeConfigFileSync(configPath: string): RuntimeConfigFile | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || !isPlainObject(parsed)) {
      return null;
    }
    return parsed as RuntimeConfigFile;
  } catch (error) {
    console.error('Error reading runtime config file:', error);
    return null;
  }
}

function getConfiguredProviderAndModel(runtimeConfig: RuntimeConfigFile): Config | null {
  for (const [providerId, providerConfig] of Object.entries(runtimeConfig.providers || {})) {
    const modelId = Object.keys(providerConfig.models || {})[0];
    if (!modelId) continue;
    const apiKey = typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.trim().length > 0
      ? providerConfig.apiKey.trim()
      : undefined;
    return {
      provider: providerId,
      model: modelId,
      ...(apiKey ? { apiKey } : {}),
    };
  }

  return null;
}

function writeRuntimeConfigFile(configPath: string, runtimeConfig: RuntimeConfigFile): void {
  ensureDirectory(path.dirname(configPath));
  writeFileSync(configPath, \`\${JSON.stringify(runtimeConfig, null, 2)}\\n\`, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
}

function upsertSelectedConfig(runtimeConfig: RuntimeConfigFile, config: Config): RuntimeConfigFile {
  const existingProviders = runtimeConfig.providers || {};
  const currentProvider = existingProviders[config.provider] || {};
  const currentModels = currentProvider.models || {};
  const selectedModelConfig = currentModels[config.model] || {};

  const nextProvider: RuntimeProviderConfig = {
    ...currentProvider,
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}),
    models: Object.fromEntries([
      [config.model, selectedModelConfig],
      ...Object.entries(currentModels).filter(([modelId]) => modelId !== config.model),
    ]),
  };

  if (!config.apiKey?.trim()) {
    delete nextProvider.apiKey;
  }

  return {
    ...runtimeConfig,
    providers: Object.fromEntries([
      [config.provider, nextProvider],
      ...Object.entries(existingProviders).filter(([providerId]) => providerId !== config.provider),
    ]),
  };
}

export function writeInitConfig(
  target: InitConfigTarget,
  cwd = process.cwd(),
  options: { overwrite?: boolean } = {}
): { path: string; status: InitConfigWriteStatus } {
  const configPath = getInitConfigPath(target, cwd);
  const alreadyExists = existsSync(configPath);
  if (alreadyExists) {
    if (!options.overwrite) {
      return { path: configPath, status: 'exists' };
    }
  } else {
    ensureDirectory(path.dirname(configPath));
  }

  writeFileSync(configPath, RUNTIME_CONFIG_TEMPLATE, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
  return { path: configPath, status: alreadyExists ? 'overwritten' : 'created' };
}

export const readConfig = (target: InitConfigTarget | 'active' = 'active', cwd = process.cwd()): Config | null => {
  const configPath = target === 'active' ? getActiveRuntimeConfigPath() : getInitConfigPath(target, cwd);
  if (!configPath) {
    return null;
  }

  const runtimeConfig = readRuntimeConfigFileSync(configPath);
  if (!runtimeConfig) {
    return null;
  }

  return getConfiguredProviderAndModel(runtimeConfig);
};

export function getDefaultConfigTarget(cwd = process.cwd()): InitConfigTarget {
  const activeConfigPath = getActiveRuntimeConfigPath();
  if (activeConfigPath === getProjectRuntimeConfigPath(cwd)) {
    return 'project';
  }
  return 'user';
}

export const writeConfig = (config: Config, target: InitConfigTarget = 'user', cwd = process.cwd()) => {
  const configPath = getInitConfigPath(target, cwd);
  const runtimeConfig = readRuntimeConfigFileSync(configPath) || { providers: {}, mcp: { servers: {} } };
  const nextRuntimeConfig = upsertSelectedConfig(runtimeConfig, config);
  writeRuntimeConfigFile(configPath, nextRuntimeConfig);
  return configPath;
};

// ─── Step Components ───

interface ResetPromptProps {
  existingConfig: Config;
  setStep: (step: number) => void;
  setConfigWritten: (written: boolean) => void;
}
export const ResetPrompt: React.FC<ResetPromptProps> = ({ existingConfig, setStep, setConfigWritten }) => {
  const [resetInput, setResetInput] = useState('');
  const provider = getProvider(existingConfig.provider);

  return (
    <Box flexDirection="column">
      <Text>Existing configuration found:</Text>
      <Text>  Provider: {provider?.name || existingConfig.provider}</Text>
      <Text>  Model: {existingConfig.model}</Text>
      <Text>  API Key: {'*'.repeat(8)}</Text>
      <Text> </Text>
      <Text>Do you want to reset and configure a new one? (y/n)</Text>
      <TextInput
        onSubmit={(answer: string) => {
          if (answer.toLowerCase() === 'y') {
            setStep(2);
          } else {
            setConfigWritten(false);
            setStep(4);
          }
        }}
      />
    </Box>
  );
};

interface TargetSelectionProps {
  title?: string;
  subtitle?: string;
  onSelect: (target: InitConfigTarget) => void;
}
export const TargetSelection: React.FC<TargetSelectionProps> = ({
  title,
  subtitle,
  onSelect,
}) => {
  return (
    <Box flexDirection="column">
      {title && <Text color="green" bold>{title}</Text>}
      {subtitle && <Text>{subtitle}</Text>}
      <Box marginTop={1}>
        <Select
          options={[
            { label: \`Project config — \${getProjectRuntimeConfigPath()}\`, value: 'project' },
            { label: \`Shared user config — \${getUserRuntimeConfigPath()}\`, value: 'user' },
          ]}
          onChange={(value) => onSelect(value as InitConfigTarget)}
        />
      </Box>
    </Box>
  );
};

interface ModelSelectionProps {
  setSelectedProviderId: (id: string) => void;
  setSelectedModelId: (id: string) => void;
  onSelect?: (providerId: string, modelId: string) => void;
  setStep?: (step: number) => void;
  title?: string;
}
export const ModelSelection: React.FC<ModelSelectionProps> = ({
  setSelectedProviderId,
  setSelectedModelId,
  onSelect,
  setStep,
  title,
}) => {
  const items = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: \`\${provider.name} - \${model.name}\`,
      value: \`\${provider.id}:::\${model.id}\`,
    })),
  );

  const handleSelect = (value: string) => {
    const [providerId, modelId] = value.split(':::');
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    if (onSelect) {
      onSelect(providerId, modelId);
    } else {
      setStep?.(3);
    }
  };

  return (
    <Box flexDirection="column">
      {title && <Text color="green" bold>{title}</Text>}
      <Text>Select an AI Model:</Text>
      <Select options={items} onChange={handleSelect} />
    </Box>
  );
};

interface ApiKeyInputProps {
  selectedProviderId: string;
  selectedModelId: string;
  target?: InitConfigTarget;
  title?: string;
  showProviderHeaders?: boolean;
  onComplete?: (config: Config) => void;
  setStep?: (step: number) => void;
  setConfigWritten?: (written: boolean) => void;
}
export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  selectedProviderId,
  selectedModelId,
  target = 'user',
  title,
  showProviderHeaders = true,
  onComplete,
  setStep,
  setConfigWritten,
}) => {
  const [errorMessage, setErrorMessage] = useState('');
  const provider = getProvider(selectedProviderId);
  const canUseResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  const handleApiKeySubmit = (value: string) => {
    if (value.trim().length === 0 && !canUseResolvedAuth) {
      setErrorMessage('API key cannot be empty.');
      return;
    }

    const newConfig: Config = {
      provider: selectedProviderId,
      model: selectedModelId,
      ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
    };
    writeConfig(newConfig, target);

    if (onComplete) {
      onComplete(newConfig);
    } else {
      setConfigWritten?.(true);
      setStep?.(4);
    }
  };

  return (
    <Box flexDirection="column">
      {title && <Text color="green" bold>{title}</Text>}
      <Text>
        {canUseResolvedAuth ? 'Optional API Key' : 'Enter API Key'} for {provider?.name || selectedProviderId}:
      </Text>
      {showProviderHeaders && provider?.headers && Object.keys(provider.headers).length > 0 && (
        <Text dimColor>
          This provider can authenticate with configured headers or environment variables.
        </Text>
      )}
      {errorMessage && <Text color="red">{errorMessage}</Text>}
      <PasswordInput
        placeholder={canUseResolvedAuth ? 'Press enter to keep resolved auth' : \`Enter your \${provider?.apiKeyEnvVar || 'API'} key\`}
        onSubmit={handleApiKeySubmit}
      />
    </Box>
  );
};

interface ConfigResultProps {
  configWritten: boolean;
}
export const ConfigResult: React.FC<ConfigResultProps> = ({ configWritten }) => {
  return (
    <Box flexDirection="column">
      {configWritten ? (
        <Text color="green">Configuration saved successfully!</Text>
      ) : (
        <Text color="yellow">Configuration not changed.</Text>
      )}
      <Text>You can now run ProtoAgent.</Text>
    </Box>
  );
};

export const ConfigureComponent = () => {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<InitConfigTarget>(getDefaultConfigTarget());
  const [existingConfig, setExistingConfig] = useState<Config | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [configWritten, setConfigWritten] = useState(false);

  if (step === 0) {
    return (
      <TargetSelection
        subtitle="Choose where to configure ProtoAgent:"
        onSelect={(value) => {
          setTarget(value);
          const existing = readConfig(value);
          setExistingConfig(existing);
          setStep(existing ? 1 : 2);
        }}
      />
    );
  }

  switch (step) {
    case 1:
      return <ResetPrompt existingConfig={existingConfig!} setStep={setStep} setConfigWritten={setConfigWritten} />;
    case 2:
      return (
        <ModelSelection
          setSelectedProviderId={setSelectedProviderId}
          setSelectedModelId={setSelectedModelId}
          setStep={setStep}
        />
      );
    case 3:
      return (
        <ApiKeyInput
          selectedProviderId={selectedProviderId}
          selectedModelId={selectedModelId}
          target={target}
          setStep={setStep}
          setConfigWritten={setConfigWritten}
        />
      );
    case 4:
      return <ConfigResult configWritten={configWritten} />;
    default:
      return <Text>Unknown step.</Text>;
  }
};

export const InitComponent = () => {
  const [selectedTarget, setSelectedTarget] = useState<InitConfigTarget | null>(null);
  const [result, setResult] = useState<{ path: string; status: InitConfigWriteStatus } | null>(null);
  const options: Array<{ label: string; value: InitConfigTarget; description: string }> = [
    {
      label: 'Project config',
      value: 'project',
      description: getProjectRuntimeConfigPath(),
    },
    {
      label: 'Shared user config',
      value: 'user',
      description: getUserRuntimeConfigPath(),
    },
  ];
  const activeTarget = selectedTarget ?? 'project';
  const activeOption = options.find((option) => option.value === activeTarget) ?? options[0];

  if (selectedTarget && !result) {
    const selectedPath = getInitConfigPath(selectedTarget);
    return (
      <Box flexDirection="column">
        <Text>Config already exists:</Text>
        <Text>{selectedPath}</Text>
        <Text>Overwrite it? (y/n)</Text>
        <TextInput
          onSubmit={(answer: string) => {
            if (answer.trim().toLowerCase() === 'y') {
              setResult(writeInitConfig(selectedTarget, process.cwd(), { overwrite: true }));
            } else {
              setResult({ path: selectedPath, status: 'exists' });
            }
          }}
        />
      </Box>
    );
  }

  if (result) {
    const color = result.status === 'exists' ? 'yellow' : 'green';
    const message = result.status === 'created'
      ? 'Created ProtoAgent config:'
      : result.status === 'overwritten'
        ? 'Overwrote ProtoAgent config:'
        : 'ProtoAgent config already exists:';
    return (
      <Box flexDirection="column">
        <Text color={color}>{message}</Text>
        <Text>{result.path}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>Create a ProtoAgent runtime config:</Text>
      <Text dimColor>Select where to write \`protoagent.jsonc\`.</Text>
      <Text dimColor>{activeOption.description}</Text>
      <Box marginTop={1}>
        <Select
          options={options.map((option) => ({ label: option.label, value: option.value }))}
          onChange={(value) => {
            const target = value as InitConfigTarget;
            const configPath = getInitConfigPath(target);
            if (existsSync(configPath)) {
              setSelectedTarget(target);
              return;
            }
            setResult(writeInitConfig(target));
          }}
        />
      </Box>
    </Box>
  );
};
`,
  },
  {
    path: "src/mcp.ts",
    content: `/**
 * MCP (Model Context Protocol) client.
 *
 * Uses the official @modelcontextprotocol/sdk to connect to MCP servers
 * over both stdio (spawned processes) and HTTP transports.
 *
 * Configuration in \`protoagent.jsonc\` under \`mcp.servers\`:
 * {
 *   "servers": {
 *     "my-stdio-server": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@my/mcp-server"],
 *       "env": { "API_KEY": "..." }
 *     },
 *     "my-http-server": {
 *       "type": "http",
 *       "url": "http://localhost:3000/mcp"
 *     }
 *   }
 * }
 *
 * Stdio servers are spawned as child processes communicating over stdin/stdout.
 * HTTP servers connect to a running server via HTTP POST/GET with SSE streaming.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from './runtime-config.js';
import { logger } from './utils/logger.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';

// ─── MCP Server Configuration ───

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

// ─── MCP Server Connection Manager ───

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();

/**
 * Create an MCP client connection for a stdio server.
 */
async function connectStdioServer(
  serverName: string,
  config: StdioServerConfig
): Promise<McpConnection> {
  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: {
      ...process.env,
      ...(config.env || {}),
    } as Record<string, string>,
    cwd: config.cwd,
    stderr: 'pipe',
  });

  const client = new Client(
    {
      name: 'protoagent',
      version: '0.0.1',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  // Pipe stderr from the spawned process to the logger instead of letting it
  // bleed through to the terminal and corrupt the Ink UI.
  (transport as any).stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString('utf-8').split('\\n')) {
      if (line.trim()) logger.debug(\`MCP [\${serverName}] \${line}\`);
    }
  });

  return {
    client,
    serverName,
    transport,
  };
}

/**
 * Create an MCP client connection for an HTTP server.
 */
async function connectHttpServer(
  serverName: string,
  config: HttpServerConfig
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  const client = new Client(
    {
      name: 'protoagent',
      version: '0.0.1',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return {
    client,
    serverName,
    transport,
  };
}

/**
 * Register all tools from an MCP server into the dynamic tool registry.
 */
async function registerMcpTools(conn: McpConnection): Promise<void> {
  try {
    const response = await conn.client.listTools();
    const tools = response.tools || [];

    logger.info(\`MCP [\${conn.serverName}] discovered \${tools.length} tools\`);

    for (const tool of tools) {
      const toolName = \`mcp_\${conn.serverName}_\${tool.name}\`;

      registerDynamicTool({
        type: 'function' as const,
        function: {
          name: toolName,
          description: \`[MCP: \${conn.serverName}] \${tool.description || tool.name}\`,
          parameters: tool.inputSchema as any,
        },
      });

      registerDynamicHandler(toolName, async (args: unknown) => {
        const result = await conn.client.callTool({
          name: tool.name,
          arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
        });

        // MCP tool results are arrays of content blocks
        if (Array.isArray(result.content)) {
          return result.content
            .map((c: any) => {
              if (c.type === 'text') return c.text;
              return JSON.stringify(c);
            })
            .join('\\n');
        }

        return JSON.stringify(result);
      });
    }
  } catch (err) {
    logger.error(\`Failed to register tools for MCP [\${conn.serverName}]: \${err}\`);
  }
}

/**
 * Load MCP configuration and connect to all configured servers.
 * Registers their tools in the dynamic tool registry.
 */
export async function initializeMcp(): Promise<void> {
  await loadRuntimeConfig();
  const servers = getRuntimeConfig().mcp?.servers || {};

  if (Object.keys(servers).length === 0) return;

  logger.info('Loading MCP servers from merged runtime config');

  for (const [name, serverConfig] of Object.entries(servers)) {
    if (serverConfig.enabled === false) {
      logger.debug(\`Skipping disabled MCP server: \${name}\`);
      continue;
    }

    try {
      let conn: McpConnection;

      if (serverConfig.type === 'stdio') {
        logger.debug(\`Connecting to stdio MCP server: \${name}\`);
        conn = await connectStdioServer(name, serverConfig);
      } else if (serverConfig.type === 'http') {
        logger.debug(\`Connecting to HTTP MCP server: \${name} (\${serverConfig.url})\`);
        conn = await connectHttpServer(name, serverConfig);
      } else {
        logger.error(\`Unknown MCP server type for "\${name}": \${(serverConfig as any).type}\`);
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      logger.error(\`Failed to connect to MCP server "\${name}": \${err}\`);
    }
  }
}

/**
 * Close all MCP connections.
 */
export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      logger.debug(\`Closing MCP connection: \${name}\`);
      await conn.client.close();
    } catch (err) {
      logger.error(\`Error closing MCP connection [\${name}]: \${err}\`);
    }
  }
  connections.clear();
}

/**
 * Get the names of all connected MCP servers.
 */
export function getConnectedMcpServers(): string[] {
  return Array.from(connections.keys());
}
`,
  },
  {
    path: "src/providers.ts",
    content: `/**
 * Provider and model registry.
 *
 * Built-in providers are declared in source and merged with runtime overrides
 * from \`protoagent.jsonc\`.
 */

import { getRuntimeConfig } from './runtime-config.js';

export interface ModelDetails {
  id: string;
  name: string;
  contextWindow: number;
  pricingPerMillionInput: number;
  pricingPerMillionOutput: number;
  pricingPerMillionCached?: number;
  defaultParams?: Record<string, unknown>;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models: ModelDetails[];
}

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 1_048_576, pricingPerMillionInput: 2.50, pricingPerMillionOutput: 15.00 },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', contextWindow: 1_000_000, pricingPerMillionInput: 0.25, pricingPerMillionOutput: 2.00 },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1_048_576, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 8.00 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200_000, pricingPerMillionInput: 5.0, pricingPerMillionOutput: 25.0 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200_000, pricingPerMillionInput: 3.0, pricingPerMillionOutput: 15.0 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, pricingPerMillionInput: 1.0, pricingPerMillionOutput: 5.0 },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 0.50, pricingPerMillionOutput: 3.0 },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 12.0 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000, pricingPerMillionInput: 0.30, pricingPerMillionOutput: 2.5 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000, pricingPerMillionInput: 1.25, pricingPerMillionOutput: 10.0 },
    ],
  },
];

function sanitizeDefaultParams(defaultParams?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!defaultParams || Object.keys(defaultParams).length === 0) return undefined;
  return defaultParams;
}

function toProviderMap(providers: ModelProvider[]): Map<string, ModelProvider> {
  return new Map(providers.map((provider) => [provider.id, provider]));
}

function mergeModelLists(baseModels: ModelDetails[], overrideModels?: Record<string, any>): ModelDetails[] {
  const merged = new Map(baseModels.map((model) => [model.id, model]));
  for (const [modelId, override] of Object.entries(overrideModels || {})) {
    const current = merged.get(modelId);
    merged.set(modelId, {
      id: modelId,
      name: override.name ?? current?.name ?? modelId,
      contextWindow: override.contextWindow ?? current?.contextWindow ?? 0,
      pricingPerMillionInput: override.inputPricePerMillion ?? current?.pricingPerMillionInput ?? 0,
      pricingPerMillionOutput: override.outputPricePerMillion ?? current?.pricingPerMillionOutput ?? 0,
      pricingPerMillionCached: override.cachedPricePerMillion ?? current?.pricingPerMillionCached,
      defaultParams: sanitizeDefaultParams({
        ...(current?.defaultParams || {}),
        ...(override.defaultParams || {}),
      }),
    });
  }
  return Array.from(merged.values());
}

export function getAllProviders(): ModelProvider[] {
  const runtimeProviders = getRuntimeConfig().providers || {};
  const mergedProviders = toProviderMap(BUILTIN_PROVIDERS);

  for (const [providerId, providerConfig] of Object.entries(runtimeProviders)) {
    const current = mergedProviders.get(providerId);
    mergedProviders.set(providerId, {
      id: providerId,
      name: providerConfig.name ?? current?.name ?? providerId,
      baseURL: providerConfig.baseURL ?? current?.baseURL,
      apiKey: providerConfig.apiKey ?? current?.apiKey,
      apiKeyEnvVar: providerConfig.apiKeyEnvVar ?? current?.apiKeyEnvVar,
      headers: providerConfig.headers ?? current?.headers,
      defaultParams: sanitizeDefaultParams({
        ...(current?.defaultParams || {}),
        ...(providerConfig.defaultParams || {}),
      }),
      models: mergeModelLists(current?.models || [], providerConfig.models),
    });
  }

  return Array.from(mergedProviders.values());
}

export function getProvider(providerId: string): ModelProvider | undefined {
  return getAllProviders().find((provider) => provider.id === providerId);
}

export function getModelDetails(providerId: string, modelId: string): ModelDetails | undefined {
  return getProvider(providerId)?.models.find((model) => model.id === modelId);
}

export function getModelPricing(providerId: string, modelId: string) {
  const details = getModelDetails(providerId, modelId);
  if (!details) return undefined;
  return {
    inputPerToken: details.pricingPerMillionInput / 1_000_000,
    outputPerToken: details.pricingPerMillionOutput / 1_000_000,
    cachedPerToken: details.pricingPerMillionCached != null ? details.pricingPerMillionCached / 1_000_000 : undefined,
    contextWindow: details.contextWindow,
  };
}

export function getRequestDefaultParams(providerId: string, modelId: string): Record<string, unknown> {
  const provider = getProvider(providerId);
  const model = getModelDetails(providerId, modelId);
  return {
    ...(provider?.defaultParams || {}),
    ...(model?.defaultParams || {}),
  };
}
`,
  },
  {
    path: "src/runtime-config.ts",
    content: `import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';
import { logger } from './utils/logger.js';

export interface RuntimeModelConfig {
  name?: string;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cachedPricePerMillion?: number;
  defaultParams?: Record<string, unknown>;
}

const RESERVED_DEFAULT_PARAM_KEYS = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
]);

export interface RuntimeProviderConfig {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models?: Record<string, RuntimeModelConfig>;
}

interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

interface HttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

export type RuntimeMcpServerConfig = StdioServerConfig | HttpServerConfig;

export interface RuntimeConfigFile {
  providers?: Record<string, RuntimeProviderConfig>;
  mcp?: {
    servers?: Record<string, RuntimeMcpServerConfig>;
  };
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigFile = {
  providers: {},
  mcp: { servers: {} },
};

let runtimeConfigCache: RuntimeConfigFile | null = null;

function getProjectRuntimeConfigPath(): string {
  return path.join(process.cwd(), '.protoagent', 'protoagent.jsonc');
}

function getUserRuntimeConfigPath(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc');
}

export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) {
    return projectPath;
  }

  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) {
    return userPath;
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\\\$\\{([A-Z0-9_]+)\\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      logger.warn(\`Missing environment variable \${envVar} while loading \${sourcePath}\`);
      return '';
    }
    return resolved;
  });
}

function interpolateValue<T>(value: T, sourcePath: string): T {
  if (typeof value === 'string') {
    return interpolateString(value, sourcePath) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => interpolateValue(entry, sourcePath)) as T;
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const interpolated = interpolateValue(entry, sourcePath);
      if (key === 'headers' && isPlainObject(interpolated)) {
        const filtered = Object.fromEntries(
          Object.entries(interpolated).filter(([, headerValue]) => typeof headerValue !== 'string' || headerValue.length > 0)
        );
        next[key] = filtered;
        continue;
      }
      next[key] = interpolated;
    }
    return next as T;
  }

  return value;
}

function sanitizeDefaultParamsInConfig(config: RuntimeConfigFile): RuntimeConfigFile {
  const nextProviders = Object.fromEntries(
    Object.entries(config.providers || {}).map(([providerId, provider]) => {
      const providerDefaultParams = Object.fromEntries(
        Object.entries(provider.defaultParams || {}).filter(([key]) => {
          const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
          if (!allowed) {
            logger.warn(\`Ignoring reserved provider default param '\${key}' for provider \${providerId}\`);
          }
          return allowed;
        })
      );

      const nextModels = Object.fromEntries(
        Object.entries(provider.models || {}).map(([modelId, model]) => {
          const modelDefaultParams = Object.fromEntries(
            Object.entries(model.defaultParams || {}).filter(([key]) => {
              const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
              if (!allowed) {
                logger.warn(\`Ignoring reserved model default param '\${key}' for model \${providerId}/\${modelId}\`);
              }
              return allowed;
            })
          );

          return [
            modelId,
            {
              ...model,
              ...(Object.keys(modelDefaultParams).length > 0 ? { defaultParams: modelDefaultParams } : {}),
            },
          ];
        })
      );

      return [
        providerId,
        {
          ...provider,
          ...(Object.keys(providerDefaultParams).length > 0 ? { defaultParams: providerDefaultParams } : {}),
          models: nextModels,
        },
      ];
    })
  );

  return {
    ...config,
    providers: nextProviders,
  };
}

function mergeRuntimeConfig(base: RuntimeConfigFile, overlay: RuntimeConfigFile): RuntimeConfigFile {
  const mergedProviders: Record<string, RuntimeProviderConfig> = {
    ...(base.providers || {}),
  };

  for (const [providerId, providerConfig] of Object.entries(overlay.providers || {})) {
    const currentProvider = mergedProviders[providerId] || {};
    mergedProviders[providerId] = {
      ...currentProvider,
      ...providerConfig,
      models: {
        ...(currentProvider.models || {}),
        ...(providerConfig.models || {}),
      },
    };
  }

  const mergedServers: Record<string, RuntimeMcpServerConfig> = {
    ...(base.mcp?.servers || {}),
  };

  for (const [serverName, serverConfig] of Object.entries(overlay.mcp?.servers || {})) {
    const currentServer = mergedServers[serverName];
    mergedServers[serverName] = currentServer && isPlainObject(currentServer)
      ? { ...currentServer, ...serverConfig }
      : serverConfig;
  }

  return {
    providers: mergedProviders,
    mcp: {
      servers: mergedServers,
    },
  };
}

async function readRuntimeConfigFile(configPath: string): Promise<RuntimeConfigFile | null> {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      const details = errors
        .map((error) => \`\${printParseErrorCode(error.error)} at offset \${error.offset}\`)
        .join(', ');
      throw new Error(\`Failed to parse \${configPath}: \${details}\`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error(\`Failed to parse \${configPath}: top-level value must be an object\`);
    }
    return sanitizeDefaultParamsInConfig(interpolateValue(parsed as RuntimeConfigFile, configPath));
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function loadRuntimeConfig(forceReload = false): Promise<RuntimeConfigFile> {
  if (!forceReload && runtimeConfigCache) {
    return runtimeConfigCache;
  }

  const configPath = getActiveRuntimeConfigPath();
  let loaded = DEFAULT_RUNTIME_CONFIG;

  if (configPath) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (fileConfig) {
      logger.debug('Loaded runtime config', { path: configPath });
      loaded = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, fileConfig);
    }
  }

  runtimeConfigCache = loaded;
  return loaded;
}

export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}
`,
  },
  {
    path: "src/sessions.ts",
    content: `/**
 * Session persistence — Save and load conversation history.
 *
 * Sessions are stored as JSON files in \`~/.local/share/protoagent/sessions/\`.
 * Each session has a unique ID, a title, and the full message history.
 *
 * The agent can resume a previous session or start a new one.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chmodSync } from 'node:fs';
import type OpenAI from 'openai';
import type { TodoItem } from './tools/todo.js';
import { logger } from './utils/logger.js';

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$/i;
const SHORT_ID_PATTERN = /^[0-9a-z]{8}\$/i;

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

function assertValidSessionId(id: string): void {
  // Accept both legacy UUIDs and new short IDs
  if (!SESSION_ID_PATTERN.test(id) && !SHORT_ID_PATTERN.test(id)) {
    throw new Error(\`Invalid session ID: \${id}\`);
  }
}

/** Generate a short, readable session ID (8 alphanumeric characters). */
function generateSessionId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: string;
  todos: TodoItem[];
  completionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export function ensureSystemPromptAtTop(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  systemPrompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const firstSystemIndex = messages.findIndex((message) => message.role === 'system');

  if (firstSystemIndex === -1) {
    return [{ role: 'system', content: systemPrompt } as OpenAI.Chat.Completions.ChatCompletionMessageParam, ...messages];
  }

  const firstSystemMessage = messages[firstSystemIndex] as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  const normalizedSystemMessage = {
    ...firstSystemMessage,
    role: 'system',
    content: systemPrompt,
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;

  return [
    normalizedSystemMessage,
    ...messages.slice(0, firstSystemIndex),
    ...messages.slice(firstSystemIndex + 1),
  ];
}

function getSessionsDir(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'sessions');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'sessions');
}

async function ensureSessionsDir(): Promise<string> {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true, mode: SESSION_DIR_MODE });
  hardenPermissions(dir, SESSION_DIR_MODE);
  return dir;
}

function sessionPath(id: string): string {
  assertValidSessionId(id);
  return path.join(getSessionsDir(), \`\${id}.json\`);
}

/** Create a new session. */
export function createSession(model: string, provider: string): Session {
  return {
    id: generateSessionId(),
    title: 'New session',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    provider,
    todos: [],
    completionMessages: [],
  };
}

/** Save a session to disk. */
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  const filePath = sessionPath(session.id);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: SESSION_FILE_MODE });
  hardenPermissions(filePath, SESSION_FILE_MODE);
  logger.debug(\`Session saved: \${session.id}\`);
}

/** Load a session by ID. Returns null if not found. */
export async function loadSession(id: string): Promise<Session | null> {
  try {
    const content = await fs.readFile(sessionPath(id), 'utf8');
    const session = JSON.parse(content) as Partial<Session>;
    return {
      id: session.id ?? id,
      title: session.title ?? 'New session',
      createdAt: session.createdAt ?? new Date().toISOString(),
      updatedAt: session.updatedAt ?? new Date().toISOString(),
      model: session.model ?? '',
      provider: session.provider ?? '',
      todos: Array.isArray(session.todos) ? session.todos : [],
      completionMessages: Array.isArray(session.completionMessages) ? session.completionMessages : [],
    };
  } catch {
    return null;
  }
}

/** List all sessions (sorted by most recently updated). */
export async function listSessions(): Promise<SessionSummary[]> {
  const dir = getSessionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), 'utf8');
      const session = JSON.parse(content) as Session;
      summaries.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.completionMessages.length,
      });
    } catch {
      // Skip corrupt session files
    }
  }

  // Sort by most recently updated
  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}

/** Delete a session. */
export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a short title for a session from the first user message.
 * Uses the LLM to summarise if the message is long.
 */
export function generateTitle(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg || !('content' in firstUserMsg) || typeof firstUserMsg.content !== 'string') {
    return 'New session';
  }
  const content = firstUserMsg.content;
  // Simple heuristic: take first 60 chars of the first user message
  if (content.length <= 60) return content;
  return content.slice(0, 57) + '...';
}
`,
  },
  {
    path: "src/skills.ts",
    content: `import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  registerDynamicHandler,
  registerDynamicTool,
  unregisterDynamicHandler,
  unregisterDynamicTool,
} from './tools/index.js';
import { setAllowedPathRoots } from './utils/path-validation.js';
import { logger } from './utils/logger.js';

export interface Skill {
  name: string;
  description: string;
  source: 'project' | 'user';
  location: string;
  skillDir: string;
  body: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface SkillDiscoveryOptions {
  cwd?: string;
  homeDir?: string;
}

interface SkillRoot {
  dir: string;
  source: 'project' | 'user';
}

const ACTIVATE_SKILL_TOOL_NAME = 'activate_skill';
const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\$/;
const MAX_RESOURCE_FILES = 200;

function getSkillRoots(options: SkillDiscoveryOptions = {}): SkillRoot[] {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  return [
    { dir: path.join(homeDir, '.agents', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.protoagent', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.config', 'protoagent', 'skills'), source: 'user' },
    { dir: path.join(cwd, '.agents', 'skills'), source: 'project' },
    { dir: path.join(cwd, '.protoagent', 'skills'), source: 'project' },
  ];
}

function parseFrontmatter(rawContent: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = rawContent.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)\$/);
  if (!match) {
    throw new Error('SKILL.md must begin with YAML frontmatter delimited by --- lines.');
  }

  const document = YAML.parse(match[1]);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Frontmatter must parse to an object.');
  }

  return {
    frontmatter: document as Record<string, unknown>,
    body: match[2].trim(),
  };
}

function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && VALID_SKILL_NAME.test(name);
}

// normalizeMetadata ensures the metadata field is an object with string values, or undefined if not provided or invalid
function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const entries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === 'string');
  if (entries.length === 0) return undefined;

  return Object.fromEntries(entries);
}

function validateSkill(parsed: { frontmatter: Record<string, unknown>; body: string }, skillDir: string, source: 'project' | 'user', location: string): Skill {
  const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
  const description = typeof parsed.frontmatter.description === 'string'
    ? parsed.frontmatter.description.trim()
    : '';
  const compatibility = typeof parsed.frontmatter.compatibility === 'string'
    ? parsed.frontmatter.compatibility.trim()
    : undefined;
  const license = typeof parsed.frontmatter.license === 'string'
    ? parsed.frontmatter.license.trim()
    : undefined;
  const allowedToolsValue = typeof parsed.frontmatter['allowed-tools'] === 'string'
    ? parsed.frontmatter['allowed-tools'].trim()
    : undefined;

  if (!isValidSkillName(name)) {
    throw new Error(\`Skill name "\${name}" is invalid.\`);
  }

  if (path.basename(skillDir) !== name) {
    throw new Error(\`Skill name "\${name}" must match directory name "\${path.basename(skillDir)}".\`);
  }

  if (!description || description.length > 1024) {
    throw new Error('Skill description is required and must be 1-1024 characters.');
  }

  if (compatibility !== undefined && (compatibility.length === 0 || compatibility.length > 500)) {
    throw new Error('Skill compatibility must be 1-500 characters when provided.');
  }

  return {
    name,
    description,
    source,
    location,
    skillDir,
    body: parsed.body,
    compatibility,
    license,
    metadata: normalizeMetadata(parsed.frontmatter.metadata),
    allowedTools: allowedToolsValue ? allowedToolsValue.split(/\\s+/).filter(Boolean) : undefined,
  };
}

async function loadSkillFromDirectory(skillDir: string, source: 'project' | 'user'): Promise<Skill | null> {
  const location = path.join(skillDir, 'SKILL.md');

  try {
    const rawContent = await fs.readFile(location, 'utf8');
    const parsed = parseFrontmatter(rawContent);
    const skill = validateSkill(parsed, skillDir, source, location);
    logger.info(\`Loaded skill: \${skill.name} (\${source})\`, { location });
    return skill;
  } catch (error) {
    logger.warn(\`Skipping invalid skill at \${location}\`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function discoverSkillsInRoot(root: SkillRoot): Promise<Skill[]> {
  let entries: Dirent[] = [];

  try {
    entries = await fs.readdir(root.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const loaded = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => loadSkillFromDirectory(path.join(root.dir, entry.name), root.source))
  );

  return loaded.filter((skill): skill is Skill => skill !== null);
}

export async function loadSkills(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const roots = getSkillRoots(options);
  const merged = new Map<string, Skill>();

  for (const root of roots) {
    const skills = await discoverSkillsInRoot(root);
    for (const skill of skills) {
      if (merged.has(skill.name)) {
        logger.warn(\`Skill collision detected for "\${skill.name}". Using \${skill.source}-level version.\`, {
          location: skill.location,
        });
      }
      merged.set(skill.name, skill);
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSkillsCatalogSection(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const catalog = skills
    .map((skill) => [
      '  <skill>',
      \`    <name>\${escapeXml(skill.name)}</name>\`,
      \`    <description>\${escapeXml(skill.description)}</description>\`,
      \`    <location>\${escapeXml(skill.location)}</location>\`,
      '  </skill>',
    ].join('\\n'))
    .join('\\n');

  return \`AVAILABLE SKILLS

The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the \${ACTIVATE_SKILL_TOOL_NAME} tool with the skill's name before proceeding.
After activation, treat paths listed in the skill output as readable resources and resolve relative paths against the skill directory.

<available_skills>
\${catalog}
</available_skills>\`;
}

async function listSkillResources(skillDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    if (files.length >= MAX_RESOURCE_FILES) return;

    const absoluteDir = path.join(skillDir, relativeDir);
    let entries: Dirent[] = [];

    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_RESOURCE_FILES) return;

      const nextRelative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        await walk(nextRelative);
      } else {
        files.push(nextRelative.split(path.sep).join('/'));
      }
    }
  }

  await Promise.all(['scripts', 'references', 'assets'].map((dir) => walk(dir)));
  return files.sort();
}

export async function activateSkill(skillName: string, options: SkillDiscoveryOptions = {}): Promise<string> {
  const skills = await loadSkills(options);
  const skill = skills.find((entry) => entry.name === skillName);

  if (!skill) {
    return \`Error: Unknown skill "\${skillName}".\`;
  }

  const resources = await listSkillResources(skill.skillDir);
  const resourcesBlock = resources.length > 0
    ? \`<skill_resources>\\n\${resources.map((resource) => \`  <file>\${escapeXml(resource)}</file>\`).join('\\n')}\\n</skill_resources>\`
    : '<skill_resources />';

  return \`<skill_content name="\${escapeXml(skill.name)}">\\n\${skill.body}\\n\\nSkill directory: \${escapeXml(skill.skillDir)}\\nRelative paths in this skill are relative to the skill directory. Use absolute paths in tool calls when needed.\\n\\n\${resourcesBlock}\\n</skill_content>\`;
}

export async function initializeSkillsSupport(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const skills = await loadSkills(options);
  await setAllowedPathRoots(skills.map((skill) => skill.skillDir));

  if (skills.length === 0) {
    unregisterDynamicTool(ACTIVATE_SKILL_TOOL_NAME);
    unregisterDynamicHandler(ACTIVATE_SKILL_TOOL_NAME);
    return [];
  }

  registerDynamicTool({
    type: 'function',
    function: {
      name: ACTIVATE_SKILL_TOOL_NAME,
      description: 'Load the full instructions for a discovered skill so you can follow it for the current task.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: skills.map((skill) => skill.name),
            description: 'The exact skill name to activate.',
          },
        },
        required: ['name'],
      },
    },
  });

  registerDynamicHandler(ACTIVATE_SKILL_TOOL_NAME, async (args) => activateSkill(args.name, options));

  return skills;
}
`,
  },
  {
    path: "src/sub-agent.ts",
    content: `/**
 * Sub-agents — Spawn isolated child agent sessions.
 *
 * Sub-agents prevent context pollution by running tasks in a separate
 * message history. The parent agent delegates a task, the sub-agent
 * executes it with its own tool calls, and returns a summary.
 *
 * This is exposed as a \`sub_agent\` tool that the main agent can call.
 */

import type OpenAI from 'openai';
import crypto from 'node:crypto';
import { handleToolCall, getAllTools } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { logger } from './utils/logger.js';
import { clearTodos } from './tools/todo.js';
import type { ModelPricing } from './utils/cost-tracker.js';

export const subAgentTool = {
  type: 'function' as const,
  function: {
    name: 'sub_agent',
    description:
      'Spawn an isolated sub-agent to handle a task without polluting the main conversation context. ' +
      'Use this for independent subtasks like exploring a codebase, researching a question, or making changes to a separate area. ' +
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
          description: 'Maximum tool-call iterations for the sub-agent. Defaults to 500.',
        },
      },
      required: ['task'],
    },
  },
};

export type SubAgentProgressHandler = (event: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> }) => void;

export interface SubAgentUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface SubAgentResult {
  response: string;
  usage: SubAgentUsage;
}

/**
 * Run a sub-agent with its own isolated conversation.
 * Returns the sub-agent's final text response.
 */
export async function runSubAgent(
  client: OpenAI,
  model: string,
  task: string,
  maxIterations = 500,
  requestDefaults: Record<string, unknown> = {},
  onProgress?: SubAgentProgressHandler,
  abortSignal?: AbortSignal,
  pricing?: ModelPricing,
): Promise<SubAgentResult> {
  const op = logger.startOperation('sub-agent');
  const subAgentSessionId = \`sub-agent-\${crypto.randomUUID()}\`;

  const systemPrompt = await generateSystemPrompt();
  const subSystemPrompt = \`\${systemPrompt}

## Sub-Agent Mode

You are running as a sub-agent. You were given a specific task by the parent agent.
Complete the task thoroughly and return a clear, concise summary of what you did and found.
Do NOT ask the user questions — work autonomously with the tools available.\`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: subSystemPrompt },
    { role: 'user', content: task },
  ];

  // Track cumulative usage across all API calls in the sub-agent
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  try {
    for (let i = 0; i < maxIterations; i++) {
      // Check abort at the top of each iteration
      if (abortSignal?.aborted) {
        return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }

      let assistantMessage: any;
      let hasToolCalls = false;

      try {
        const stream = await client.chat.completions.create({
          ...requestDefaults,
          model,
          messages,
          tools: getAllTools(),
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }, { signal: abortSignal });

        // Accumulate the streamed response
        assistantMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [],
        };
        let streamedContent = '';
        hasToolCalls = false;
        let actualUsage: OpenAI.CompletionUsage | undefined;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (chunk.usage) {
            actualUsage = chunk.usage;
          }

          // Stream text content
          if (delta?.content) {
            streamedContent += delta.content;
            assistantMessage.content = streamedContent;
          }

          // Accumulate tool calls across stream chunks
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
              if (tc.function?.name) {
                assistantMessage.tool_calls[idx].function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }

        // Accumulate usage for this iteration
        const iterationInputTokens = actualUsage?.prompt_tokens || 0;
        const iterationOutputTokens = actualUsage?.completion_tokens || 0;
        totalInputTokens += iterationInputTokens;
        totalOutputTokens += iterationOutputTokens;

        // Calculate cost if pricing is available
        if (pricing && (iterationInputTokens > 0 || iterationOutputTokens > 0)) {
          const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
          if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
            const uncachedTokens = iterationInputTokens - cachedTokens;
            totalCost += uncachedTokens * pricing.inputPerToken + cachedTokens * pricing.cachedPerToken + iterationOutputTokens * pricing.outputPerToken;
          } else {
            totalCost += iterationInputTokens * pricing.inputPerToken + iterationOutputTokens * pricing.outputPerToken;
          }
        }
      } catch (err) {
        // If aborted during streaming, return gracefully
        if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
          logger.debug('Sub-agent aborted during streaming');
          return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
        }
        throw err;
      }

      const message = assistantMessage;
      if (!message) break;

      // Check for tool calls
      if (hasToolCalls && assistantMessage.tool_calls.length > 0) {
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        // Filter out tool calls with malformed JSON arguments (can happen if stream aborted mid-tool-call)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return true; // No args is valid
          try {
            JSON.parse(args);
            return true;
          } catch {
            logger.warn('Filtering out sub-agent tool call with malformed JSON', {
              tool: tc.function?.name,
              argsPreview: args.slice(0, 100),
            });
            return false;
          }
        });
        // Only add message if we have valid tool calls
        if (assistantMessage.tool_calls.length === 0) {
          hasToolCalls = false;
        } else {
          messages.push(message as any);
        }

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
          }

          const { name, arguments: argsStr } = toolCall.function;
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(argsStr);
          } catch {
            args = {};
          }
          logger.debug(\`Sub-agent tool call: \${name}\`, { args });
          onProgress?.({ tool: name, status: 'running', iteration: i, args });

          try {
            const result = await handleToolCall(name, args, { sessionId: subAgentSessionId, abortSignal });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
            onProgress?.({ tool: name, status: 'done', iteration: i });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: \`Error: \${msg}\`,
            } as any);
            onProgress?.({ tool: name, status: 'error', iteration: i });
          }
        }
        continue;
      }

      // Plain text response — we're done
      if (message.content) {
        messages.push({
          role: 'assistant',
          content: message.content,
        });
        return { response: message.content, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }
      // The model produced an empty text response (e.g. it only called tools
      // and issued no final summary).  Log it and return a sentinel so the
      // parent agent knows the sub-agent finished but had nothing to say.
      logger.debug('Sub-agent returned empty content', { iteration: i });
      return { response: '(sub-agent completed with no response)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
    }

    return { response: '(sub-agent reached iteration limit)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
  } finally {
    op.end();
    clearTodos(subAgentSessionId);
  }
}
`,
  },
  {
    path: "src/system-prompt.ts",
    content: `/**
 * System prompt generation.
 *
 * Builds a dynamic system prompt that includes:
 *  - Role and behavioural instructions
 *  - Working directory and project structure
 *  - Tool descriptions (auto-generated from tool schemas)
 *  - Skills catalog (loaded progressively from skill directories)
 *  - AGENTS.md content (custom instructions for the agent)
 *  - Guidelines for file operations, TODO tracking, etc.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllTools } from './tools/index.js';
import { buildSkillsCatalogSection, initializeSkillsSupport } from './skills.js';
import { getActiveRuntimeConfigPath } from './runtime-config.js';

/**
 * Load AGENTS.md content from cwd and parent directories.
 *
 * AGENTS.md (https://agents.md/) is a simple, open format for guiding coding agents.
 * It's like a README for agents — a dedicated place to give AI coding tools the
 * context they need to work on a project.
 *
 * The lookup is hierarchical:
 *  - Checks cwd, then parent directories up to the filesystem root
 *  - First AGENTS.md found wins
 *  - Returns null if no AGENTS.md is found
 */
async function loadAgentsMd(): Promise<{ content: string; path: string } | null> {
  let currentDir = path.resolve('.');

  while (true) {
    const agentsPath = path.join(currentDir, 'AGENTS.md');
    try {
      await fs.access(agentsPath);
      const content = await fs.readFile(agentsPath, 'utf-8');
      return { content, path: agentsPath };
    } catch {
      // File doesn't exist here — check parent
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
  }

  return null;
}

/** Build a filtered directory tree (depth 3, excludes noise). */
async function buildDirectoryTree(dirPath = '.', depth = 0, maxDepth = 3): Promise<string> {
  if (depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  let tree = '';

  try {
    const fullPath = path.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const filtered = entries.filter((e) => {
      const n = e.name;
      return !n.startsWith('.') && !['node_modules', 'dist', 'build', 'coverage', '__pycache__', '.git'].includes(n) && !n.endsWith('.log');
    });

    for (const entry of filtered.slice(0, 20)) {
      if (entry.isDirectory()) {
        tree += \`\${indent}\${entry.name}/\\n\`;
        tree += await buildDirectoryTree(path.join(dirPath, entry.name), depth + 1, maxDepth);
      } else {
        tree += \`\${indent}\${entry.name}\\n\`;
      }
    }

    if (filtered.length > 20) {
      tree += \`\${indent}... (\${filtered.length - 20} more)\\n\`;
    }
  } catch {
    // Can't read directory — skip
  }

  return tree;
}

/** Auto-generate tool descriptions from their JSON schemas. */
function generateToolDescriptions(): string {
  return getAllTools()
    .map((tool, i) => {
      const fn = tool.function;
      const params = fn.parameters as { required?: string[]; properties?: Record<string, any> };
      const required = params.required || [];
      const props = Object.keys(params.properties || {});
      const paramList = props
        .map((p) => \`\${p}\${required.includes(p) ? ' (required)' : ' (optional)'}\`)
        .join(', ');
      return \`\${i + 1}. \${fn.name} — \${fn.description}\\n   Parameters: \${paramList || 'none'}\`;
    })
    .join('\\n\\n');
}

/** Generate the complete system prompt. */
export async function generateSystemPrompt(): Promise<string> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const tree = await buildDirectoryTree();
  const skills = await initializeSkillsSupport();
  const toolDescriptions = generateToolDescriptions();
  const skillsSection = buildSkillsCatalogSection(skills);
  const configPath = getActiveRuntimeConfigPath();
  const agentsMd = await loadAgentsMd();

  const agentsMdSection = agentsMd
    ? \`\\nAGENTS.md INSTRUCTIONS\\n\\nThe following instructions are from the AGENTS.md file at: \${agentsMd.path}\\n\\n\${agentsMd.content}\\n\`
    : '';

  return \`You are ProtoAgent, a coding assistant with file system and shell command capabilities.
Your job is to help the user complete coding tasks in their project. You must be absolutely careful and diligent in your work, and follow all guidelines to the letter. Always prefer thoroughness and correctness over speed. Never cut corners.

PROJECT CONTEXT

Working Directory: \${cwd}
Project Name: \${projectName}
Configuration Path: \${configPath || 'none (using defaults)'}

PROJECT STRUCTURE:
\${tree}
\${agentsMdSection}
PROTOAGENT DOCUMENTATION

ProtoAgent is a build-your-own coding agent — a lean, readable implementation that gives you the blueprint to understand and build your own AI coding assistant.

Configuration guide: https://protoagent.dev/guide/configuration

AVAILABLE TOOLS

\${toolDescriptions}
\${skillsSection ? \`\\n\${skillsSection}\\n\` : ''}
GUIDELINES

OUTPUT FORMAT:
- You are running in a terminal. Be concise. Optimise for scannability.
- Use **bold** and *italic* formatting tastefully to highlight key points and structure your responses.
- Do NOT use # headers, --- dividers, or other structural Markdown.
- Do NOT use Markdown code fences (backticks) unless the content is actual code or a command.
- For structured data, use plain text with aligned columns (spaces, not pipes/dashes).
- Keep tables compact: narrower columns, minimal padding. Wrap cell content rather than making very wide tables.
- Use flat plain-text lists with a simple dash or symbol prefix (e.g. - item, or ✅ done, ❌ failed).
- NEVER use nested indentation. Keep all lists flat — one level only.
- Do NOT use Markdown links [text](url) — just write URLs inline.

SUBAGENT STRATEGY:
Delegate work to specialized subagents aggressively. They excel at focused, parallel tasks.
- **When to use subagents**: Any task involving deep research, broad codebase exploration, complex analysis, or multi-step investigations.
- **Parallelizable tasks**: When a request can be split into independent subtasks, strongly prefer delegating those pieces to subagents so they can run concurrently.
- **Parallel work**: Launch multiple subagents simultaneously for independent tasks (e.g., search different parts of codebase, investigate different issues).
- **Thorough context**: Always provide subagents with complete task descriptions, relevant background, and specific success criteria. Be explicit about what "done" looks like.
- **Trust the delegation**: Subagents have access to the same tools and can work autonomously. Don't re-do their work in your main context.
- **Examples of good delegation**:
  - Complex codebase exploration → Use Explore agent with "very thorough" or "medium" setting
  - Cross-file code searches → Launch Bash agent for grep/find operations in parallel
  - Architecture/design planning → Use Plan agent to explore codebase and design approach
  - Multi-step debugging → Use general-purpose agent for systematic investigation

WORKFLOW:
- Before making tool calls, briefly explain what you're about to do and why.
- Always read files before editing them.
- Prefer edit_file over write_file for existing files.
- Use TODO tracking (todo_write / todo_read) by default for almost all work. The only exceptions are when the user explicitly asks you not to use TODOs, or when the task is truly trivial and can be completed in a single obvious step.
- Start by creating or refreshing the TODO list before doing substantive work, then keep it current throughout the task: mark items in_progress/completed as you go, and read it back whenever you need to check or communicate progress.
- When you update the TODO list, always write the full latest list so the user can see the current plan and status clearly in the tool output.
- Search first when you need to find something — use search_files or bash with grep/find, or delegate to a subagent for thorough exploration.
- Shell commands: safe commands (ls, grep, git status, etc.) run automatically. Other commands require user approval.
- **Diligence**: Don't cut corners. Verify assumptions before acting. Read related code. Test changes where possible. Leave the codebase better than you found it.

FILE OPERATIONS:
- ALWAYS use read_file before editing to get exact content.
- NEVER write over existing files unless explicitly asked — use edit_file instead.
- Create parent directories before creating files in them.
- INDENTATION: when writing new_string for edit_file, preserve the exact indentation of every line. Copy the indent character-for-character from the file. A single dropped space is a bug.
- STRICT TYPO PREVENTION: You have a tendency to drop characters or misspell words (e.g., "commands" vs "comands") when generating long code blocks. Before submitting a tool call, perform a character-by-character mental audit.
- VERIFICATION STEP: After generating a new_string, compare it against the old_string. Ensure that only the intended changes are present and that no existing words have been accidentally altered or truncated.
- NO TRUNCATION: Never truncate code or leave "..." in your tool calls. Every string must be literal and complete.
- IF edit_file FAILS: do NOT retry by guessing or reconstructing old_string from memory. Call read_file on the file first, then copy the exact text verbatim for old_string. The error output shows exactly which lines differ between your old_string and the file — read those carefully before retrying.

IMPLEMENTATION STANDARDS:
- **Thorough investigation**: Before implementing, understand the existing codebase, patterns, and related systems.
- **Completeness**: Ensure implementations are complete and tested, not partial or left in a broken state.
- **Code quality**: Follow existing code style and conventions. Make changes that fit naturally into the codebase.
- **Documentation**: Update relevant documentation and comments if the code isn't self-evident.
- **No half measures**: If a task requires 3 steps to do properly, do all 3 steps. Don't leave TODOs for later work unless explicitly scoped that way.\`;
}
`,
  },
  {
    path: "src/tools/bash.ts",
    content: `/**
 * bash tool — Execute shell commands with security controls.
 *
 * Three-tier security model:
 *  1. Hard-blocked dangerous commands (cannot be overridden)
 *  2. Auto-approved safe commands (read-only / info commands)
 *  3. Everything else requires user approval
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { requestApproval } from '../utils/approval.js';
import { logger } from '../utils/logger.js';
import { getWorkingDirectory, validatePath } from '../utils/path-validation.js';

export const bashTool = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description:
      'Execute a shell command. Safe commands (ls, grep, git status, etc.) run automatically. ' +
      'Other commands require user approval. Some dangerous commands are blocked entirely.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 30000 (30s).' },
      },
      required: ['command'],
    },
  },
};

// Hard-blocked commands — these CANNOT be run, even with --dangerously-skip-permissions
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'sudo',
  'su ',
  'chmod 777',
  'dd if=',
  'mkfs',
  'fdisk',
  'format c:',
];

// Auto-approved safe commands — read-only / informational
const SAFE_COMMANDS = [
  'pwd', 'whoami', 'date',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'npm list', 'npm ls', 'yarn list',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
];

const SHELL_CONTROL_PATTERN = /(^|[^\\\\])(?:;|&&|\\|\\||\\||>|<|\`|\\\$\\(|\\*|\\?)/;
const UNSAFE_BASH_TOKENS = new Set(['cat', 'head', 'tail', 'grep', 'rg', 'find', 'awk', 'sed', 'sort', 'uniq', 'cut', 'wc', 'tree', 'file', 'dir', 'ls', 'echo', 'which', 'type']);

function isDangerous(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}

function hasShellControlOperators(command: string): boolean {
  return SHELL_CONTROL_PATTERN.test(command);
}

function tokenizeCommand(command: string): string[] | null {
  const tokens = command.match(/"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\S+/g);
  return tokens && tokens.length > 0 ? tokens : null;
}

function stripOuterQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function looksLikePath(token: string): boolean {
  if (!token) return false;
  if (token === '.' || token === '..') return true;
  if (token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.startsWith('~/')) {
    return true;
  }
  return token.includes(path.sep) || /\\.[A-Za-z0-9_-]+\$/.test(token);
}

async function validateCommandPaths(tokens: string[]): Promise<boolean> {
  for (let index = 1; index < tokens.length; index++) {
    const token = stripOuterQuotes(tokens[index]);
    if (!looksLikePath(token)) continue;
    if (token.startsWith('~')) return false;

    try {
      await validatePath(token);
    } catch {
      return false;
    }
  }

  return true;
}

async function isSafe(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed || hasShellControlOperators(trimmed)) {
    return false;
  }

  const tokens = tokenizeCommand(trimmed);
  if (!tokens) {
    return false;
  }

  const firstWord = trimmed.split(/\\s+/)[0];
  if (UNSAFE_BASH_TOKENS.has(firstWord)) {
    return false;
  }

  const matchedSafeCommand = SAFE_COMMANDS.some((safe) => {
    if (safe.includes(' ')) {
      return trimmed === safe || trimmed.startsWith(\`\${safe} \`);
    }
    return firstWord === safe;
  });

  if (!matchedSafeCommand) {
    return false;
  }

  return validateCommandPaths(tokens);
}

export async function runBash(
  command: string,
  timeoutMs = 30_000,
  sessionId?: string,
  abortSignal?: AbortSignal
): Promise<string> {
  // Layer 1: hard block
  if (isDangerous(command)) {
    return \`Error: Command blocked for safety. "\${command}" contains a dangerous pattern that cannot be executed.\`;
  }

  // Layer 2: safe commands skip approval
  if (!(await isSafe(command))) {
    // Layer 3: interactive approval
    const approved = await requestApproval({
      id: \`bash-\${Date.now()}\`,
      type: 'shell_command',
      description: \`Run command: \${command}\`,
      detail: \`Working directory: \${getWorkingDirectory()}\\nCommand: \${command}\`,
      sessionId,
      sessionScopeKey: \`shell:\${command}\`,
    });

    if (!approved) {
      return \`Command cancelled by user: \${command}\`;
    }
  }

  logger.debug(\`Executing: \${command}\`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    const child = spawn(command, [], {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    const terminateChild = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    };

    const onAbort = () => {
      aborted = true;
      terminateChild();
    };

    if (abortSignal?.aborted) {
      onAbort();
    } else {
      abortSignal?.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);

      if (aborted) {
        resolve(\`Command aborted by user.\\nPartial stdout:\\n\${stdout.slice(0, 5000)}\\nPartial stderr:\\n\${stderr.slice(0, 2000)}\`);
        return;
      }

      if (timedOut) {
        resolve(\`Command timed out after \${timeoutMs / 1000}s.\\nPartial stdout:\\n\${stdout.slice(0, 5000)}\\nPartial stderr:\\n\${stderr.slice(0, 2000)}\`);
        return;
      }

      // Truncate very long output
      const maxLen = 50_000;
      const truncatedStdout = stdout.length > maxLen
        ? stdout.slice(0, maxLen) + \`\\n... (output truncated, \${stdout.length} chars total)\`
        : stdout;

      if (code === 0) {
        resolve(truncatedStdout || '(command completed successfully with no output)');
      } else {
        resolve(\`Command exited with code \${code}.\\nstdout:\\n\${truncatedStdout}\\nstderr:\\n\${stderr.slice(0, 5000)}\`);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      resolve(\`Error executing command: \${err.message}\`);
    });
  });
}
`,
  },
  {
    path: "src/tools/edit-file.ts",
    content: `/**
 * edit_file tool — Find-and-replace in an existing file. Requires approval.
 *
 * Uses a fuzzy match cascade of 5 strategies to find the old_string,
 * tolerating minor whitespace discrepancies from the model.
 * Returns a unified diff on success so the model can verify its edit.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath, getWorkingDirectory } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';
import { checkReadBefore, recordRead } from '../utils/file-time.js';

export const editFileTool = {
  type: 'function' as const,
  function: {
    name: 'edit_file',
    description:
      'Edit an existing file by replacing an exact string match with new content. ' +
      'The old_string must match exactly (including whitespace and indentation). ' +
      'Always read the file first to get the exact content to replace.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit.' },
        old_string: { type: 'string', description: 'The exact text to find and replace.' },
        new_string: { type: 'string', description: 'The text to replace it with.' },
        expected_replacements: {
          type: 'number',
          description: 'Expected number of replacements (default 1). Fails if actual count differs.',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

// ─── Path suggestion helper (mirrors read_file behaviour) ───

async function findSimilarPaths(requestedPath: string): Promise<string[]> {
  const cwd = getWorkingDirectory();
  const segments = requestedPath.split('/').filter(Boolean);
  const MAX_DEPTH = 6;
  const MAX_ENTRIES = 200;
  const MAX_SUGGESTIONS = 3;
  const candidates: string[] = [];

  async function walkSegments(dir: string, segIndex: number, currentPath: string): Promise<void> {
    if (segIndex >= segments.length || segIndex >= MAX_DEPTH || candidates.length >= MAX_SUGGESTIONS) return;
    const targetSegment = segments[segIndex].toLowerCase();
    let entries: string[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })).slice(0, MAX_ENTRIES).map(e => e.name);
    } catch {
      return;
    }
    const isLastSegment = segIndex === segments.length - 1;
    for (const entry of entries) {
      if (candidates.length >= MAX_SUGGESTIONS) break;
      const entryLower = entry.toLowerCase();
      if (!entryLower.includes(targetSegment) && !targetSegment.includes(entryLower)) continue;
      const entryPath = path.join(currentPath, entry);
      const fullPath = path.join(dir, entry);
      if (isLastSegment) {
        try { await fs.stat(fullPath); candidates.push(entryPath); } catch { /* skip */ }
      } else {
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) await walkSegments(fullPath, segIndex + 1, entryPath);
        } catch { /* skip */ }
      }
    }
  }

  await walkSegments(cwd, 0, '');
  return candidates;
}

// ─── Fuzzy Match Strategies ───

interface MatchStrategy {
  name: string;
  /** Given file content and the model's oldString, return the actual substring in content to replace, or null. */
  findMatch(content: string, oldString: string): string | null;
}

/** Strategy 1: Exact verbatim match (current behavior). */
const exactReplacer: MatchStrategy = {
  name: 'exact',
  findMatch(content, oldString) {
    return content.includes(oldString) ? oldString : null;
  },
};

/** Strategy 2: Per-line .trim() comparison — uses file's actual indentation. */
const lineTrimmedReplacer: MatchStrategy = {
  name: 'line-trimmed',
  findMatch(content, oldString) {
    const searchLines = oldString.split('\\n').map(l => l.trim());
    const contentLines = content.split('\\n');

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (contentLines[i + j].trim() !== searchLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Return the actual lines from the file content
        return contentLines.slice(i, i + searchLines.length).join('\\n');
      }
    }
    return null;
  },
};

/** Strategy 3: Strip common leading indent from both before comparing. */
const indentFlexReplacer: MatchStrategy = {
  name: 'indent-flexible',
  findMatch(content, oldString) {
    const oldLines = oldString.split('\\n');
    const commonIndent = getCommonIndent(oldLines);
    if (commonIndent === 0) return null;

    const stripped = oldLines.map(l => l.slice(commonIndent)).join('\\n');
    const contentLines = content.split('\\n');

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const fileSlice = contentLines.slice(i, i + oldLines.length);
      const fileCommonIndent = getCommonIndent(fileSlice);
      const fileStripped = fileSlice.map(l => l.slice(fileCommonIndent)).join('\\n');

      if (fileStripped === stripped) {
        return fileSlice.join('\\n');
      }
    }
    return null;
  },
};

/** Strategy 4: Collapse all whitespace runs to single space before comparing. */
const whitespaceNormReplacer: MatchStrategy = {
  name: 'whitespace-normalized',
  findMatch(content, oldString) {
    const normalize = (s: string) => s.replace(/\\s+/g, ' ').trim();
    const target = normalize(oldString);
    if (!target) return null;

    const contentLines = content.split('\\n');
    const oldLineCount = oldString.split('\\n').length;

    // Slide a window of oldLineCount lines across the file
    for (let i = 0; i <= contentLines.length - oldLineCount; i++) {
      const window = contentLines.slice(i, i + oldLineCount).join('\\n');
      if (normalize(window) === target) {
        return window;
      }
    }
    return null;
  },
};

/** Strategy 5: .trim() the entire oldString before searching. */
const trimmedBoundaryReplacer: MatchStrategy = {
  name: 'trimmed-boundary',
  findMatch(content, oldString) {
    const trimmed = oldString.trim();
    if (trimmed === oldString) return null; // no change from exact
    return content.includes(trimmed) ? trimmed : null;
  },
};

const STRATEGIES: MatchStrategy[] = [
  exactReplacer,
  lineTrimmedReplacer,
  indentFlexReplacer,
  whitespaceNormReplacer,
  trimmedBoundaryReplacer,
];

function getCommonIndent(lines: string[]): number {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue; // skip blank lines
    const indent = line.length - line.trimStart().length;
    min = Math.min(min, indent);
  }
  return min === Infinity ? 0 : min;
}

/**
 * Count non-overlapping occurrences of \`needle\` in \`haystack\`.
 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * Try each strategy in order. Return the actual substring to replace,
 * the strategy name used, and how many occurrences exist.
 * Only accepts strategies that find exactly one match (unambiguous).
 */
function findWithCascade(
  content: string,
  oldString: string,
  expectedReplacements: number,
): { actual: string; strategy: string; count: number } | null {
  for (const strategy of STRATEGIES) {
    const actual = strategy.findMatch(content, oldString);
    if (!actual) continue;

    const count = countOccurrences(content, actual);
    if (count === expectedReplacements) {
      return { actual, strategy: strategy.name, count };
    }
    // If count doesn't match expected, skip this strategy
  }
  return null;
}

// ─── Unified Diff ───

function computeUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\\n');
  const newLines = newContent.split('\\n');

  // Find changed regions
  const hunks: Array<{ oldStart: number; oldLines: string[]; newStart: number; newLines: string[] }> = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Skip matching lines
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }

    // Found a difference — collect the changed region
    const oldStart = i;
    const newStart = j;
    const hunkOld: string[] = [];
    const hunkNew: string[] = [];

    // Collect differing lines
    while (i < oldLines.length && j < newLines.length && oldLines[i] !== newLines[j]) {
      hunkOld.push(oldLines[i]);
      hunkNew.push(newLines[j]);
      i++;
      j++;
    }

    // Handle remaining lines in either side
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      hunkOld.push(oldLines[i]);
      i++;
    }
    while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      hunkNew.push(newLines[j]);
      j++;
    }

    hunks.push({ oldStart, oldLines: hunkOld, newStart, newLines: hunkNew });
  }

  if (hunks.length === 0) return '';

  // Build unified diff output with 2 lines of context
  const CONTEXT = 2;
  const diffLines: string[] = [
    \`--- a/\${filePath}\`,
    \`+++ b/\${filePath}\`,
  ];

  let totalChanged = 0;
  for (const hunk of hunks) {
    totalChanged += hunk.oldLines.length + hunk.newLines.length;
    if (totalChanged > 50) {
      // Add what we have so far, then truncate
      break;
    }

    const ctxBefore = Math.max(0, hunk.oldStart - CONTEXT);
    const ctxAfterOld = Math.min(oldLines.length, hunk.oldStart + hunk.oldLines.length + CONTEXT);
    const ctxAfterNew = Math.min(newLines.length, hunk.newStart + hunk.newLines.length + CONTEXT);

    const oldHunkSize = (hunk.oldStart - ctxBefore) + hunk.oldLines.length + (ctxAfterOld - hunk.oldStart - hunk.oldLines.length);
    const newHunkSize = (hunk.newStart - ctxBefore) + hunk.newLines.length + (ctxAfterNew - hunk.newStart - hunk.newLines.length);

    diffLines.push(\`@@ -\${ctxBefore + 1},\${oldHunkSize} +\${ctxBefore + 1},\${newHunkSize} @@\`);

    // Context before
    for (let k = ctxBefore; k < hunk.oldStart; k++) {
      diffLines.push(\` \${oldLines[k]}\`);
    }

    // Removed lines
    for (const line of hunk.oldLines) {
      diffLines.push(\`-\${line}\`);
    }

    // Added lines
    for (const line of hunk.newLines) {
      diffLines.push(\`+\${line}\`);
    }

    // Context after
    for (let k = hunk.oldStart + hunk.oldLines.length; k < ctxAfterOld; k++) {
      diffLines.push(\` \${oldLines[k]}\`);
    }
  }

  if (totalChanged > 50) {
    diffLines.push('... (truncated)');
  }

  return diffLines.join('\\n');
}

// ─── Main editFile function ───

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  expectedReplacements = 1,
  sessionId?: string,
): Promise<string> {
  if (oldString.length === 0) {
    return 'Error: old_string cannot be empty.';
  }

  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      const suggestions = await findSimilarPaths(filePath);
      let msg = \`File not found: '\${filePath}'.\`;
      if (suggestions.length > 0) {
        msg += ' Did you mean one of these?\\n' + suggestions.map(s => \`  \${s}\`).join('\\n');
      }
      return msg;
    }
    throw err;
  }

  // Staleness guard: must have read file before editing
  if (sessionId) {
    const staleError = checkReadBefore(sessionId, validated);
    if (staleError) return staleError;
  }

  const content = await fs.readFile(validated, 'utf8');

  // Use fuzzy match cascade
  const match = findWithCascade(content, oldString, expectedReplacements);

  if (!match) {
    // Check if we found it with wrong count
    for (const strategy of STRATEGIES) {
      const actual = strategy.findMatch(content, oldString);
      if (actual) {
        const count = countOccurrences(content, actual);
        return \`Error: found \${count} occurrence(s) of old_string (via \${strategy.name} match), but expected \${expectedReplacements}. Be more specific or set expected_replacements=\${count}.\`;
      }
    }

    // Build a per-strategy diagnostic to help the model self-correct without
    // requiring a full re-read. For each strategy, find the closest partial
    // match and report ALL lines where it diverges (not just the first).
    const searchLines = oldString.split('\\n');
    const contentLines = content.split('\\n');
    const diagnostics: string[] = [];

    for (const strategy of STRATEGIES) {
      // Find the window in the file that shares the most lines with oldString
      let bestWindowStart = -1;
      let bestMatchedLines = 0;

      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        let matched = 0;
        for (let j = 0; j < searchLines.length; j++) {
          const fileLine = strategy.name === 'whitespace-normalized'
            ? contentLines[i + j].replace(/\\s+/g, ' ').trim()
            : contentLines[i + j].trim();
          const searchLine = strategy.name === 'whitespace-normalized'
            ? searchLines[j].replace(/\\s+/g, ' ').trim()
            : searchLines[j].trim();
          if (fileLine === searchLine) matched++;
        }
        if (matched > bestMatchedLines) {
          bestMatchedLines = matched;
          bestWindowStart = i;
        }
      }

      if (bestWindowStart >= 0 && bestMatchedLines > 0 && bestMatchedLines < searchLines.length) {
        // Collect all diverging lines, not just the first
        const diffLines: string[] = [];
        const MAX_DIFFS = 6;
        for (let j = 0; j < searchLines.length && diffLines.length < MAX_DIFFS; j++) {
          const fileLine = contentLines[bestWindowStart + j] ?? '(end of file)';
          const searchLine = searchLines[j];
          const fileNorm = strategy.name === 'whitespace-normalized'
            ? fileLine.replace(/\\s+/g, ' ').trim()
            : fileLine.trim();
          const searchNorm = strategy.name === 'whitespace-normalized'
            ? searchLine.replace(/\\s+/g, ' ').trim()
            : searchLine.trim();
          if (fileNorm !== searchNorm) {
            diffLines.push(
              \`    line \${bestWindowStart + j + 1}:\\n\` +
              \`      yours: \${searchLine.trim().slice(0, 120)}\\n\` +
              \`      file:  \${fileLine.trim().slice(0, 120)}\`
            );
          }
        }
        const truncNote = diffLines.length === MAX_DIFFS ? \`\\n    ... (more diffs not shown)\` : '';
        diagnostics.push(
          \`  \${strategy.name}: \${bestMatchedLines}/\${searchLines.length} lines match, \${searchLines.length - bestMatchedLines} differ:\\n\` +
          diffLines.join('\\n') + truncNote
        );
      } else if (bestMatchedLines === 0) {
        diagnostics.push(\`  \${strategy.name}: no lines matched — old_string may be from a different file or heavily rewritten\`);
      } else {
        diagnostics.push(\`  \${strategy.name}: no partial match found\`);
      }
    }

    const hint = diagnostics.length > 0
      ? '\\nDiagnostics per strategy:\\n' + diagnostics.join('\\n')
      : '';
    return \`Error: old_string not found in \${filePath}.\${hint}\\nDo NOT retry with a guess. Call read_file on \${filePath} first to get the exact current content, then construct old_string by copying verbatim from the file.\`;
  }

  const { actual, strategy, count } = match;

  // Request approval
  const oldPreview = oldString.length > 200 ? oldString.slice(0, 200) + '...' : oldString;
  const newPreview = newString.length > 200 ? newString.slice(0, 200) + '...' : newString;
  const strategyNote = strategy !== 'exact' ? \` [matched via \${strategy}]\` : '';

  const approved = await requestApproval({
    id: \`edit-\${Date.now()}\`,
    type: 'file_edit',
    description: \`Edit file: \${filePath} (\${count} replacement\${count > 1 ? 's' : ''})\${strategyNote}\`,
    detail: \`Replace:\\n\${oldPreview}\\n\\nWith:\\n\${newPreview}\`,
    sessionId,
    sessionScopeKey: \`file_edit:\${validated}\`,
  });

  if (!approved) {
    return \`Operation cancelled: edit to \${filePath} was rejected by user.\`;
  }

  // Perform replacement using the actual matched string (not the model's version)
  const newContent = content.split(actual).join(newString);
  const directory = path.dirname(validated);
  const tempPath = path.join(directory, \`.protoagent-edit-\${process.pid}-\${Date.now()}-\${path.basename(validated)}\`);
  try {
    await fs.writeFile(tempPath, newContent, 'utf8');
    await fs.rename(tempPath, validated);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }

  // Re-read file after write (captures any formatter changes)
  // Also record the read so subsequent edits don't fail the mtime check
  const finalContent = await fs.readFile(validated, 'utf8');
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  // Compute and return unified diff
  const diff = computeUnifiedDiff(content, finalContent, filePath);
  const header = \`Successfully edited \${filePath}: \${count} replacement(s) made.\`;

  if (diff) {
    return \`\${header}\\n\${diff}\`;
  }
  return header;
}
`,
  },
  {
    path: "src/tools/index.ts",
    content: `/**
 * Tool registry — collects all tool definitions and provides a dispatcher.
 *
 * Each tool file exports:
 *  - A tool definition (OpenAI function-calling JSON schema)
 *  - A handler function (args) => Promise<string>
 *
 * This file wires them together into a single \`tools\` array and
 * a \`handleToolCall(name, args)\` dispatcher.
 */

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { bashTool, runBash } from './bash.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
}

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  bashTool,
  todoReadTool,
  todoWriteTool,
  webfetchTool,
];

export type DynamicTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// Mutable tools list — MCP and sub-agent tools get appended at runtime
let dynamicTools: DynamicTool[] = [];

export function registerDynamicTool(tool: DynamicTool): void {
  const toolName = tool.function.name;
  dynamicTools = dynamicTools.filter((existing) => existing.function.name !== toolName);
  dynamicTools.push(tool);
}

export function unregisterDynamicTool(toolName: string): void {
  dynamicTools = dynamicTools.filter((tool) => tool.function.name !== toolName);
}

export function clearDynamicTools(): void {
  dynamicTools = [];
}

export function getAllTools() {
  return [...tools, ...dynamicTools];
}

// Dynamic tool handlers (for MCP tools, etc.)
const dynamicHandlers = new Map<string, (args: any) => Promise<string>>();

export function registerDynamicHandler(name: string, handler: (args: any) => Promise<string>): void {
  dynamicHandlers.set(name, handler);
}

export function unregisterDynamicHandler(name: string): void {
  dynamicHandlers.delete(name);
}

/**
 * Dispatch a tool call to the appropriate handler.
 * Returns the tool result as a string.
 */
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
      case 'write_file':
        return await writeFile(args.file_path, args.content, context.sessionId);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'bash':
        return await runBash(args.command, args.timeout_ms, context.sessionId, context.abortSignal);
      case 'todo_read':
        return readTodos(context.sessionId);
      case 'todo_write':
        return writeTodos(args.todos, context.sessionId);
      case 'webfetch': {
        const result = await webfetch(args.url, args.format, args.timeout);
        return JSON.stringify(result);
      }
      default: {
        // Check dynamic handlers (MCP tools, sub-agent tools)
        const handler = dynamicHandlers.get(toolName);
        if (handler) {
          return await handler(args);
        }
        return \`Error: Unknown tool "\${toolName}"\`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return \`Error executing \${toolName}: \${msg}\`;
  }
}
`,
  },
  {
    path: "src/tools/list-directory.ts",
    content: `/**
 * list_directory tool — List contents of a directory.
 */

import fs from 'node:fs/promises';
import { validatePath } from '../utils/path-validation.js';

export const listDirectoryTool = {
  type: 'function' as const,
  function: {
    name: 'list_directory',
    description: 'List the contents of a directory. Returns entries with [FILE] or [DIR] prefixes.',
    parameters: {
      type: 'object',
      properties: {
        directory_path: {
          type: 'string',
          description: 'Path to the directory to list (relative to working directory). Defaults to ".".',
        },
      },
      required: [],
    },
  },
};

export async function listDirectory(directoryPath = '.'): Promise<string> {
  const validated = await validatePath(directoryPath);
  const entries = await fs.readdir(validated, { withFileTypes: true });

  const lines = entries.map((entry) => {
    const prefix = entry.isDirectory() ? '[DIR] ' : '[FILE]';
    return \`\${prefix} \${entry.name}\`;
  });

  return \`Contents of \${directoryPath} (\${entries.length} entries):\\n\${lines.join('\\n')}\`;
}
`,
  },
  {
    path: "src/tools/read-file.ts",
    content: `/**
 * read_file tool — Read file contents with optional offset and limit.
 *
 * When a file is not found, suggests similar paths to help the model
 * recover from typos without repeated failed attempts.
 */

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { validatePath, getWorkingDirectory } from '../utils/path-validation.js';
import { recordRead } from '../utils/file-time.js';

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

/**
 * Find similar paths when a requested file doesn't exist.
 * Walks from the repo root, matching segments case-insensitively.
 */
async function findSimilarPaths(requestedPath: string): Promise<string[]> {
  const cwd = getWorkingDirectory();
  const segments = requestedPath.split('/').filter(Boolean);
  const MAX_DEPTH = 6;
  const MAX_ENTRIES = 200;
  const MAX_SUGGESTIONS = 3;

  const candidates: string[] = [];

  async function walkSegments(dir: string, segIndex: number, currentPath: string): Promise<void> {
    if (segIndex >= segments.length || segIndex >= MAX_DEPTH || candidates.length >= MAX_SUGGESTIONS) return;

    const targetSegment = segments[segIndex].toLowerCase();
    let entries: string[];

    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      entries = dirEntries
        .slice(0, MAX_ENTRIES)
        .map(e => e.name);
    } catch {
      return;
    }

    const isLastSegment = segIndex === segments.length - 1;

    for (const entry of entries) {
      if (candidates.length >= MAX_SUGGESTIONS) break;
      const entryLower = entry.toLowerCase();

      // Match if entry contains the target segment as a substring (case-insensitive)
      if (!entryLower.includes(targetSegment) && !targetSegment.includes(entryLower)) continue;

      const entryPath = path.join(currentPath, entry);
      const fullPath = path.join(dir, entry);

      if (isLastSegment) {
        // Check if this file/dir actually exists
        try {
          await fs.stat(fullPath);
          candidates.push(entryPath);
        } catch {
          // skip
        }
      } else {
        // Continue walking deeper
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            await walkSegments(fullPath, segIndex + 1, entryPath);
          }
        } catch {
          // skip
        }
      }
    }
  }

  await walkSegments(cwd, 0, '');
  return candidates;
}

export async function readFile(filePath: string, offset = 0, limit = 2000, sessionId?: string): Promise<string> {
  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    // If file not found, try to suggest similar paths
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      const suggestions = await findSimilarPaths(filePath);
      let msg = \`File not found: '\${filePath}'\`;
      if (suggestions.length > 0) {
        msg += '\\nDid you mean one of these?\\n' + suggestions.map(s => \`  \${s}\`).join('\\n');
      }
      return msg;
    }
    throw err;
  }

  const start = Math.max(0, offset);
  const maxLines = Math.max(0, limit);
  const lines: string[] = [];

  const stream = createReadStream(validated, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    let lineIndex = 0;
    for await (const line of lineReader) {
      if (lineIndex >= start && lines.length < maxLines) {
        lines.push(line);
      }
      lineIndex++;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  // Truncate very long individual lines but don't reformat content
  const slice = lines.map(line =>
    line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line
  );

  // Record successful read for staleness tracking
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  return slice.join('\\n')
}`,
  },
  {
    path: "src/tools/search-files.ts",
    content: `/**
 * search_files tool — Recursive text search across files.
 *
 * Uses ripgrep (rg) when available for fast, .gitignore-aware searching.
 * Falls back to a pure JS recursive directory walk if rg is not found.
 */

import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validatePath } from '../utils/path-validation.js';

export const searchFilesTool = {
  type: 'function' as const,
  function: {
    name: 'search_files',
    description: 'Search for a text pattern across files in a directory (recursive). Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'The text or regex pattern to search for.' },
        directory_path: { type: 'string', description: 'Directory to search in. Defaults to ".".' },
        file_extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by file extensions, e.g. [".ts", ".js"]. Searches all files if omitted.',
        },
        case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive. Defaults to true.' },
      },
      required: ['search_term'],
    },
  },
};

// Detect ripgrep availability at module load
let hasRipgrep = false;
try {
  execFileSync('rg', ['--version'], { stdio: 'pipe' });
  hasRipgrep = true;
} catch {
  // ripgrep not available, will use JS fallback
}

const MAX_RESULTS = 100;

export async function searchFiles(
  searchTerm: string,
  directoryPath = '.',
  caseSensitive = true,
  fileExtensions?: string[]
): Promise<string> {
  const validated = await validatePath(directoryPath);

  if (hasRipgrep) {
    return searchWithRipgrep(searchTerm, validated, directoryPath, caseSensitive, fileExtensions);
  }
  return searchWithJs(searchTerm, validated, directoryPath, caseSensitive, fileExtensions);
}

// ─── Ripgrep implementation ───

function searchWithRipgrep(
  searchTerm: string,
  validated: string,
  directoryPath: string,
  caseSensitive: boolean,
  fileExtensions?: string[],
): string {
  const args: string[] = [
    '--line-number',
    '--with-filename',
    '--no-heading',
    '--color=never',
    '--max-count=1',
    '--max-filesize=1M',
  ];

  if (!caseSensitive) {
    args.push('--ignore-case');
  }

  if (fileExtensions && fileExtensions.length > 0) {
    for (const ext of fileExtensions) {
      // rg glob expects *.ext format
      const globExt = ext.startsWith('.') ? \`*\${ext}\` : \`*.\${ext}\`;
      args.push(\`--glob=\${globExt}\`);
    }
  }

  args.push('--regexp', searchTerm, validated);

  try {
    const output = execFileSync('rg', args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });

    const lines = output.trim().split('\\n').filter(Boolean);

    if (lines.length === 0) {
      return \`No matches found for "\${searchTerm}" in \${directoryPath}\`;
    }

    // Parse rg output and sort by mtime
    const parsed = lines.slice(0, MAX_RESULTS).map(line => {
      // rg output: filepath:linenum:content
      const firstColon = line.indexOf(':');
      const secondColon = line.indexOf(':', firstColon + 1);
      const filePath = line.slice(0, firstColon);
      const lineNum = line.slice(firstColon + 1, secondColon);
      let content = line.slice(secondColon + 1).trim();

      if (content.length > 500) {
        content = content.slice(0, 500) + '... (truncated)';
      }

      const relativePath = path.relative(validated, filePath);
      let mtime = 0;
      try {
        mtime = statSync(filePath).mtimeMs;
      } catch { /* ignore */ }

      return { display: \`\${relativePath}:\${lineNum}: \${content}\`, mtime };
    });

    // Sort by mtime descending (most recently modified first)
    parsed.sort((a, b) => b.mtime - a.mtime);

    const results = parsed.map(r => r.display);
    const suffix = lines.length > MAX_RESULTS ? \`\\n(results truncated at \${MAX_RESULTS})\` : '';
    return \`Found \${results.length} match(es) for "\${searchTerm}":\\n\${results.join('\\n')}\${suffix}\`;

  } catch (err: any) {
    // rg exits with code 1 if no matches found (not an error)
    if (err.status === 1) {
      return \`No matches found for "\${searchTerm}" in \${directoryPath}\`;
    }
    // rg exits with code 2 for actual errors
    if (err.status === 2) {
      const msg = err.stderr?.toString() || err.message;
      return \`Error: ripgrep error: \${msg}\`;
    }
    // Fall back to JS search on any other error
    return \`Error: ripgrep failed: \${err.message}\`;
  }
}

// ─── JS fallback implementation ───

async function searchWithJs(
  searchTerm: string,
  validated: string,
  directoryPath: string,
  caseSensitive: boolean,
  fileExtensions?: string[],
): Promise<string> {
  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(searchTerm, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return \`Error: invalid regex pattern "\${searchTerm}": \${message}\`;
  }

  const results: string[] = [];

  async function search(dir: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;

      const fullPath = path.join(dir, entry.name);

      // Skip common non-useful directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__'].includes(entry.name)) continue;
        await search(fullPath);
        continue;
      }

      // Filter by extension
      if (fileExtensions && fileExtensions.length > 0) {
        const ext = path.extname(entry.name);
        if (!fileExtensions.includes(ext)) continue;
      }

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const lines = content.split('\\n');
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            const relativePath = path.relative(validated, fullPath);
            let lineContent = lines[i].trim();

            // Truncate long lines
            if (lineContent.length > 500) {
              lineContent = lineContent.slice(0, 500) + '... (truncated)';
            }

            results.push(\`\${relativePath}:\${i + 1}: \${lineContent}\`);
          }
          regex.lastIndex = 0; // reset regex state
        }
      } catch {
        // Skip files we can't read (binary, permission issues)
      }
    }
  }

  await search(validated);

  if (results.length === 0) {
    return \`No matches found for "\${searchTerm}" in \${directoryPath}\`;
  }

  const suffix = results.length >= MAX_RESULTS ? \`\\n(results truncated at \${MAX_RESULTS})\` : '';
  return \`Found \${results.length} match(es) for "\${searchTerm}":\\n\${results.join('\\n')}\${suffix}\`;
}
`,
  },
  {
    path: "src/tools/todo.ts",
    content: `/**
 * todo_read / todo_write tools - in-memory task tracking.
 *
 * The agent uses these to plan multi-step work and track progress.
 * Todos are stored per session. The active session can also persist them
 * through the session store.
 */

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

const DEFAULT_SESSION_ID = '__default__';

// Session-scoped in-memory storage
const todosBySession = new Map<string, TodoItem[]>();

function getSessionKey(sessionId?: string): string {
  return sessionId ?? DEFAULT_SESSION_ID;
}

function cloneTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map((todo) => ({ ...todo }));
}

function formatTodos(todos: TodoItem[], heading: string): string {
  if (todos.length === 0) {
    return \`\${heading}\\nNo TODOs.\`;
  }

  const statusIcons: Record<TodoItem['status'], string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  const lines = todos.map((t) => \`\${statusIcons[t.status]} [\${t.priority}] \${t.content} (\${t.id})\`);
  return \`\${heading}\\n\${lines.join('\\n')}\`;
}

export const todoReadTool = {
  type: 'function' as const,
  function: {
    name: 'todo_read',
    description: 'Read the current TODO list to check progress on tasks.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const todoWriteTool = {
  type: 'function' as const,
  function: {
    name: 'todo_write',
    description: 'Replace the TODO list with an updated version. Use this to plan tasks, update progress, and mark items complete.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete updated TODO list.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the item.' },
              content: { type: 'string', description: 'Description of the task.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Current status.',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level.',
              },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

export function readTodos(sessionId?: string): string {
  const todos = todosBySession.get(getSessionKey(sessionId)) ?? [];
  return formatTodos(todos, \`TODO List (\${todos.length} items):\`);
}

export function writeTodos(newTodos: TodoItem[], sessionId?: string): string {
  const todos = cloneTodos(newTodos);
  todosBySession.set(getSessionKey(sessionId), todos);
  return formatTodos(todos, \`TODO List Updated (\${todos.length} items):\`);
}

export function getTodosForSession(sessionId?: string): TodoItem[] {
  return cloneTodos(todosBySession.get(getSessionKey(sessionId)) ?? []);
}

export function setTodosForSession(sessionId: string, todos: TodoItem[]): void {
  todosBySession.set(getSessionKey(sessionId), cloneTodos(todos));
}

export function clearTodos(sessionId?: string): void {
  todosBySession.delete(getSessionKey(sessionId));
}
`,
  },
  {
    path: "src/tools/webfetch.ts",
    content: `/**
 * webfetch tool — Fetch and process web content
 *
 * Features:
 * - Single URL fetch per invocation
 * - Three output formats: text, markdown, html
 * - Configurable timeout (default 30s, max 120s)
 * - 5MB response size limit + 2MB output limit
 * - HTML to text/markdown conversion
 * - AbortController support for cancellation
 * - Robust HTML entity decoding
 * - Proper redirect limiting
 * - Charset-aware content decoding
 */

import { convert } from 'html-to-text';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 10;
const MAX_URL_LENGTH = 4096;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

// Text-based MIME types that are safe to process
const TEXT_MIME_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/x-www-form-urlencoded',
  'application/atom+xml',
  'application/rss+xml',
  'application/javascript',
  'application/typescript',
];

// Lazy-loaded Turndown instance (CJS module — dynamic import avoids forcing esbuild CJS output)
let _turndownService: any = null;
async function getTurndownService() {
  if (!_turndownService) {
    const { default: TurndownService } = await import('turndown');
    _turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    });
    _turndownService.remove(['script', 'style', 'meta', 'link']);
  }
  return _turndownService;
}

// Lazy-loaded he module (CJS module)
let _he: any = null;
async function getHe() {
  if (!_he) {
    const { default: he } = await import('he');
    _he = he;
  }
  return _he;
}

/**
 * Check if MIME type is text-based
 */
function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.some((type) => mimeType.includes(type));
}

/**
 * Detect if content is HTML
 */
function detectHTML(content: string, contentType: string): boolean {
  // Header says HTML
  if (contentType.includes('text/html')) {
    return true;
  }

  // Sniff content for HTML signature
  const trimmed = content.slice(0, 1024).trim().toLowerCase();
  return /^<!doctype html|^<html|^<head|^<body|^<meta/.test(trimmed);
}

/**
 * Parse charset from Content-Type header
 */
function parseCharset(contentType: string): string {
  const match = contentType.match(/charset=([^\\s;]+)/i);
  if (match) {
    const charset = match[1].replace(/['"]/g, '');
    // Validate charset is supported by TextDecoder
    try {
      new TextDecoder(charset);
      return charset;
    } catch {
      return 'utf-8';
    }
  }
  return 'utf-8';
}

/**
 * Truncate output if too large
 */
function truncateOutput(output: string, maxSize: number): string {
  if (output.length > maxSize) {
    const truncatedSize = Math.max(100, maxSize - 100);
    return (
      output.slice(0, truncatedSize) +
      \`\\n\\n[Content truncated: \${output.length} characters exceeds \${maxSize} limit]\`
    );
  }
  return output;
}

export const webfetchTool = {
  type: 'function' as const,
  function: {
    name: 'webfetch',
    description: 'Fetch and process content from a web URL. Supports text (plain text extraction), markdown (HTML to markdown conversion), or html (raw HTML) output formats.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP(S) URL to fetch (must start with http:// or https://)',
        },
        format: {
          type: 'string',
          enum: ['text', 'markdown', 'html'],
          description: 'Output format: text (plain text), markdown (HTML to markdown), or html (raw HTML)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default 30, min 1, max 120)',
        },
      },
      required: ['url', 'format'],
    },
  },
};

/**
 * Convert HTML to plain text using html-to-text library
 */
function htmlToText(html: string): string {
  try {
    return convert(html, {
      wordwrap: 120,
      selectors: [
        { selector: 'img', options: { ignoreHref: true } },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    });
  } catch (error) {
    // Fallback: basic regex if library fails
    return html
      .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, '')
      .replace(/<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .split('\\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\\n');
  }
}

/**
 * Convert HTML to Markdown using Turndown (cached instance)
 */
async function htmlToMarkdown(html: string): Promise<string> {
  try {
    const turndown = await getTurndownService();
    return turndown.turndown(html);
  } catch (error) {
    // Fallback: treat as code block
    return \`\\\`\\\`\\\`html\\n\${html}\\n\\\`\\\`\\\`\`;
  }
}

/**
 * Fetch with redirect limiting
 */
async function fetchWithRedirectLimit(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  let redirectCount = 0;
  let currentUrl = url;

  // Create a custom fetch wrapper that tracks redirects
  const originalFetch = global.fetch;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await originalFetch(currentUrl, {
      signal,
      headers: FETCH_HEADERS,
      redirect: 'manual', // Handle redirects manually to count them
    });

    // Check for redirect status
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        redirectCount++;
        // Resolve relative URLs
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
    }

    return response;
  }

  throw new Error(\`Too many redirects (max \${MAX_REDIRECTS})\`);
}

/**
 * Fetch and process a URL
 *
 * @param url - HTTP(S) URL to fetch
 * @param format - Output format: 'text', 'markdown', or 'html'
 * @param timeout - Optional timeout in seconds (default 30, max 120)
 * @returns Object with output, title, and metadata
 * @throws Error on validation, network, or processing failures
 */
export async function webfetch(
  url: string,
  format: 'text' | 'markdown' | 'html',
  timeout?: number,
): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  // Validate URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Invalid URL format. Must start with http:// or https://');
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(\`URL too long (\${url.length} characters, max \${MAX_URL_LENGTH})\`);
  }

  // Validate format
  if (!['text', 'markdown', 'html'].includes(format)) {
    throw new Error("Invalid format. Must be 'text', 'markdown', or 'html'");
  }

  // Validate timeout
  const timeoutSeconds = Math.min(timeout ?? 30, 120);
  if (timeoutSeconds < 1) {
    throw new Error('Timeout must be between 1 and 120 seconds');
  }

  // Setup timeout for entire operation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const startTime = Date.now();

    // Fetch with redirect limiting
    const response = await fetchWithRedirectLimit(url, controller.signal);

    // Check HTTP status
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status} error: \${response.statusText}\`);
    }

    // Validate response size by header
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(
        \`Response too large (exceeds 5MB limit). Content-Length: \${contentLength}\`,
      );
    }

    // Get content type
    const contentType = response.headers.get('content-type') ?? 'text/plain';

    // Check if content type is text-based
    if (!isTextMimeType(contentType)) {
      throw new Error(
        \`Content type '\${contentType}' is not supported. Only text-based formats are allowed.\`,
      );
    }

    // Get response as ArrayBuffer
    const arrayBuffer = await response.arrayBuffer();

    // Check actual response size
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error(
        \`Response too large (exceeds 5MB limit). Size: \${arrayBuffer.byteLength}\`,
      );
    }

    // Parse charset from Content-Type header
    const charset = parseCharset(contentType);

    // Decode response with appropriate charset
    const decoder = new TextDecoder(charset, { fatal: false });
    const content = decoder.decode(arrayBuffer);

    const isHTML = detectHTML(content, contentType);

    // Format content based on requested format
    let output: string;
    if (format === 'text') {
      output = isHTML ? htmlToText(content) : content;
    } else if (format === 'markdown') {
      output = isHTML ? await htmlToMarkdown(content) : \`\\\`\\\`\\\`\\n\${content}\\n\\\`\\\`\\\`\`;
    } else {
      // format === 'html'
      output = content;
    }

    // Decode HTML entities ONLY for text/markdown formats (not for raw HTML)
    if (format !== 'html') {
      const he = await getHe();
      output = he.decode(output);
    }

    // Truncate output if too large
    output = truncateOutput(output, MAX_OUTPUT_SIZE);

    const fetchTime = Date.now() - startTime;
    const title = \`\${url} (\${contentType})\`;
    const metadata = {
      url,
      format,
      contentType,
      charset,
      contentLength: arrayBuffer.byteLength,
      outputLength: output.length,
      fetchTime,
    };

    return { output, title, metadata };
  } catch (error) {
    // Handle AbortError (timeout or cancellation)
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(\`Fetch timeout after \${timeoutSeconds} seconds\`);
    }

    // Re-throw our errors as-is
    if (error instanceof Error) {
      throw error;
    }

    // Handle unexpected errors
    throw new Error(\`Failed to fetch \${url}: \${String(error)}\`);
  } finally {
    clearTimeout(timeoutId);
  }
}
`,
  },
  {
    path: "src/tools/write-file.ts",
    content: `/**
 * write_file tool — Create or overwrite a file. Requires approval.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';
import { recordRead } from '../utils/file-time.js';

export const writeFileTool = {
  type: 'function' as const,
  function: {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with the given content. Prefer edit_file for modifying existing files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to write (relative to working directory).' },
        content: { type: 'string', description: 'The full content to write to the file.' },
      },
      required: ['file_path', 'content'],
    },
  },
};

export async function writeFile(filePath: string, content: string, sessionId?: string): Promise<string> {
  const validated = await validatePath(filePath);

  // Request approval
  const preview = content.length > 500
    ? \`\${content.slice(0, 250)}\\n... (\${content.length} chars total) ...\\n\${content.slice(-250)}\`
    : content;

  const approved = await requestApproval({
    id: \`write-\${Date.now()}\`,
    type: 'file_write',
    description: \`Write file: \${filePath}\`,
    detail: preview,
    sessionId,
    sessionScopeKey: \`file_write:\${validated}\`,
  });

  if (!approved) {
    return \`Operation cancelled: write to \${filePath} was rejected by user.\`;
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(validated), { recursive: true });

  // Atomic write: write to temp file then rename
  const tmpPath = path.join(path.dirname(validated), \`.protoagent-write-\${process.pid}-\${Date.now()}-\${path.basename(validated)}\`);
  try {
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, validated);
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }

  const lines = content.split('\\n').length;

  // Record the write as a read so a subsequent edit_file on this file doesn't
  // immediately fail the staleness guard with "you must read first".
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  return \`Successfully wrote \${lines} lines to \${filePath}\`;
}
`,
  },
  {
    path: "src/utils/approval.ts",
    content: `/**
 * Approval system for destructive operations.
 *
 * Two categories of approval:
 *  1. File operations (write_file, edit_file)
 *  2. Shell commands (non-whitelisted)
 *
 * Approval can be granted:
 *  - Per-operation (one-time)
 *  - Per-operation-type for the session (e.g., "approve all writes")
 *  - Globally via --dangerously-skip-permissions
 *
 * In the Ink UI, approvals are handled by emitting an event and waiting
 * for the UI to resolve it (instead of blocking on stdin with inquirer).
 */

export type ApprovalRequest = {
  id: string;
  type: 'file_write' | 'file_edit' | 'shell_command';
  description: string;
  detail?: string;
  sessionId?: string;
  sessionScopeKey?: string;
};

export type ApprovalResponse = 'approve_once' | 'approve_session' | 'reject';

// Global state
let dangerouslySkipPermissions = false;
const sessionApprovals = new Set<string>(); // stores approval keys scoped by session

// Callback that the Ink UI provides to handle interactive approval
let approvalHandler: ((req: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;

export function setDangerouslySkipPermissions(value: boolean): void {
  dangerouslySkipPermissions = value;
}

export function isDangerouslySkipPermissions(): boolean {
  return dangerouslySkipPermissions;
}

export function setApprovalHandler(handler: (req: ApprovalRequest) => Promise<ApprovalResponse>): void {
  approvalHandler = handler;
}

export function clearApprovalHandler(): void {
  approvalHandler = null;
}

export function clearSessionApprovals(): void {
  sessionApprovals.clear();
}

function getApprovalScopeKey(req: ApprovalRequest): string {
  const sessionId = req.sessionId ?? '__global__';
  const scope = req.sessionScopeKey ?? req.type;
  return \`\${sessionId}:\${scope}\`;
}

/**
 * Request approval for an operation. Returns true if approved.
 *
 * Check order:
 *  1. --dangerously-skip-permissions → auto-approve
 *  2. Session approval for this type → auto-approve
 *  3. Interactive prompt via the UI handler
 *  4. No handler registered → reject (fail closed)
 */
export async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (dangerouslySkipPermissions) return true;

  const sessionKey = getApprovalScopeKey(req);
  if (sessionApprovals.has(sessionKey)) return true;

  if (!approvalHandler) {
    return false;
  }

  const response = await approvalHandler(req);

  switch (response) {
    case 'approve_once':
      return true;
    case 'approve_session':
      sessionApprovals.add(sessionKey);
      return true;
    case 'reject':
      return false;
  }
}
`,
  },
  {
    path: "src/utils/compactor.ts",
    content: `/**
 * Conversation compaction.
 *
 * When the conversation approaches the context window limit (≥ 90%),
 * the compactor summarises the older messages using the LLM and replaces
 * them with a compact summary. The most recent messages are kept
 * verbatim so the agent doesn't lose immediate context.
 */

import type OpenAI from 'openai';
import { estimateConversationTokens } from './cost-tracker.js';
import { logger } from './logger.js';
import { getTodosForSession, type TodoItem } from '../tools/todo.js';

const RECENT_MESSAGES_TO_KEEP = 5;

function isProtectedSkillMessage(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): boolean {
  return message.role === 'tool' && typeof message.content === 'string' && message.content.includes('<skill_content ');
}

const COMPRESSION_PROMPT = \`You are a conversation state manager. Your job is to compress a conversation history into a compact summary that preserves all important context.

Produce a structured summary in this format:

<state_snapshot>
<overall_goal>What the user is trying to accomplish</overall_goal>
<key_knowledge>Important facts, conventions, constraints discovered</key_knowledge>
<file_system_state>Files created, read, modified, or deleted (with paths)</file_system_state>
<recent_actions>Last significant actions and their outcomes</recent_actions>
<current_plan>Current step-by-step plan with status: [DONE], [IN PROGRESS], [TODO]</current_plan>
</state_snapshot>

Be thorough but concise. Do not lose any information that would be needed to continue the conversation.\`;

/**
 * Compact a conversation if it exceeds the context window threshold.
 * Returns the original messages if compaction isn't needed or fails.
 */
export async function compactIfNeeded(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  contextWindow: number,
  currentTokens: number,
  requestDefaults: Record<string, unknown> = {},
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const utilisation = (currentTokens / contextWindow) * 100;
  if (utilisation < 90) return messages;

  logger.info(\`Compacting conversation (\${utilisation.toFixed(1)}% of context window used)\`);

  try {
    return await compactConversation(client, model, messages, requestDefaults, sessionId);
  } catch (err) {
    logger.error(\`Compaction failed, continuing with original messages: \${err}\`);
    return messages;
  }
}

async function compactConversation(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  requestDefaults: Record<string, unknown>,
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  // Separate system message, history to compress, and recent messages
  const systemMessage = messages[0];
  const recentMessages = messages.slice(-RECENT_MESSAGES_TO_KEEP);
  const middleMessages = messages.slice(1, messages.length - RECENT_MESSAGES_TO_KEEP);
  const protectedMessages = middleMessages.filter(isProtectedSkillMessage);
  const historyToCompress = middleMessages.filter((message) => !isProtectedSkillMessage(message));

  if (historyToCompress.length === 0) {
    logger.debug('Nothing to compact — conversation too short');
    return messages;
  }

  // Build compression request
  const activeTodos = getTodosForSession(sessionId);
  const todoReminder = activeTodos.length > 0
    ? \`\\n\\nActive TODOs:\\n\${activeTodos.map((todo: TodoItem) => \`- [\${todo.status}] \${todo.content}\`).join('\\n')}\\n\\nThe agent must not stop until the TODO list is fully complete. Preserve that instruction in the summary if work remains.\`
    : '';

  const compressionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPRESSION_PROMPT },
    {
      role: 'user',
      content: \`Here is the conversation history to compress:\\n\\n\${historyToCompress
        .map((m) => \`[\${(m as any).role}]: \${(m as any).content || JSON.stringify((m as any).tool_calls || '')}\`)
        .join('\\n\\n')}\${todoReminder}\`,
    },
  ];

  const response = await client.chat.completions.create({
    ...requestDefaults,
    model,
    messages: compressionMessages,
    max_tokens: 2000,
    temperature: 0.1,
  });

  const summary = response.choices[0]?.message?.content;
  if (!summary) {
    throw new Error('Compression returned empty response');
  }

  // Reconstruct: system + summary + recent messages
  const compacted: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    systemMessage,
    { role: 'system', content: \`Previous conversation summary:\\n\\n\${summary}\` },
    ...protectedMessages,
    ...recentMessages,
  ];

  const oldTokens = estimateConversationTokens(messages);
  const newTokens = estimateConversationTokens(compacted);
  logger.info(\`Compacted \${oldTokens} → \${newTokens} tokens (\${((1 - newTokens / oldTokens) * 100).toFixed(0)}% reduction)\`);

  return compacted;
}
`,
  },
  {
    path: "src/utils/cost-tracker.ts",
    content: `/**
 * Token estimation and cost tracking.
 *
 * Uses a rough heuristic (~4 chars per token) for estimation.
 * Prefers actual usage data from the API when available.
 */

import type OpenAI from 'openai';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ContextInfo {
  currentTokens: number;
  maxTokens: number;
  utilizationPercentage: number;
  needsCompaction: boolean;
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cachedPerToken?: number;
  contextWindow: number;
}

/** Rough token estimation: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens for a single message including overhead. */
export function estimateMessageTokens(msg: OpenAI.Chat.Completions.ChatCompletionMessageParam): number {
  let tokens = 4; // per-message overhead
  if ('content' in msg && typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content);
  }
  if ('tool_calls' in msg && Array.isArray((msg as any).tool_calls)) {
    for (const tc of (msg as any).tool_calls) {
      tokens += estimateTokens(tc.function?.name || '') + estimateTokens(tc.function?.arguments || '') + 10;
    }
  }
  return tokens;
}

/** Estimate total tokens for a conversation. */
export function estimateConversationTokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0) + 10;
}

/** Calculate dollar cost for a given number of tokens. */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): number {
  if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
    const uncachedTokens = inputTokens - cachedTokens;
    return (
      uncachedTokens * pricing.inputPerToken +
      cachedTokens * pricing.cachedPerToken +
      outputTokens * pricing.outputPerToken
    );
  }
  return inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken;
}

/** Get context window utilisation info. */
export function getContextInfo(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  pricing: ModelPricing
): ContextInfo {
  const currentTokens = estimateConversationTokens(messages);
  const maxTokens = pricing.contextWindow;
  const utilizationPercentage = (currentTokens / maxTokens) * 100;
  return {
    currentTokens,
    maxTokens,
    utilizationPercentage,
    needsCompaction: utilizationPercentage >= 90,
  };
}

/** Build a UsageInfo from actual or estimated token counts. */
export function createUsageInfo(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): UsageInfo {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: calculateCost(inputTokens, outputTokens, pricing, cachedTokens),
  };
}
`,
  },
  {
    path: "src/utils/file-time.ts",
    content: `/**
 * File read-time tracking — staleness guard for edit_file.
 *
 * Ensures the model has read a file before editing it,
 * and that the file hasn't changed on disk since it was last read.
 */

import fs from 'node:fs';

const readTimes = new Map<string, number>(); // key: "sessionId:absolutePath" → epoch ms

/**
 * Record that a file was read at the current time.
 */
export function recordRead(sessionId: string, absolutePath: string): void {
  readTimes.set(\`\${sessionId}:\${absolutePath}\`, Date.now());
}

/**
 * Check that a file was previously read and hasn't changed on disk since.
 * Returns an error string if the check fails, or null if all is well.
 * Use this instead of assertReadBefore so staleness errors surface as normal
 * tool return values rather than exceptions that get swallowed into a generic
 * "Error executing edit_file: ..." message.
 */
export function checkReadBefore(sessionId: string, absolutePath: string): string | null {
  const key = \`\${sessionId}:\${absolutePath}\`;
  const lastRead = readTimes.get(key);

  if (!lastRead) {
    return \`You must read '\${absolutePath}' before editing it. Call read_file first.\`;
  }

  try {
    const mtime = fs.statSync(absolutePath).mtimeMs;
    if (mtime > lastRead + 100) {
      // Clear stale entry so the error message stays accurate on retry
      readTimes.delete(key);
      return \`'\${absolutePath}' has changed on disk since you last read it. Re-read it before editing.\`;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      readTimes.delete(key);
      return \`'\${absolutePath}' no longer exists on disk.\`;
    }
    // Ignore other stat errors — don't block edits on stat failures
  }

  return null;
}

/**
 * Clear all read-time entries for a session (e.g. on session end).
 */
export function clearSession(sessionId: string): void {
  for (const key of readTimes.keys()) {
    if (key.startsWith(\`\${sessionId}:\`)) {
      readTimes.delete(key);
    }
  }
}
`,
  },
  {
    path: "src/utils/format-message.tsx",
    content: `import React from 'react';
import { Text } from 'ink';

/**
 * Parse Markdown-style formatting and render as Ink Text elements.
 *
 * Supports:
 * - **bold** → <Text bold>bold</Text>
 * - *italic* → <Text italic>italic</Text>
 * - ***bold italic*** → <Text bold italic>bold italic</Text>
 */

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];

  // Strip markdown headers
  const cleaned = text.replace(/^#+\\s+/gm, '');

  // Pattern to match ***bold italic***, **bold**, *italic*
  const pattern = /(\\*\\*\\*[^*]+?\\*\\*\\*|\\*\\*[^*]+?\\*\\*|\\*[^\\s*][^*]*?\\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    // Add plain text before match
    if (match.index > lastIndex) {
      segments.push({ text: cleaned.slice(lastIndex, match.index) });
    }

    const fullMatch = match[0];
    let content: string;
    let bold = false;
    let italic = false;

    if (fullMatch.startsWith('***')) {
      content = fullMatch.slice(3, -3);
      bold = true;
      italic = true;
    } else if (fullMatch.startsWith('**')) {
      content = fullMatch.slice(2, -2);
      bold = true;
    } else {
      content = fullMatch.slice(1, -1);
      italic = true;
    }

    segments.push({ text: content, bold, italic });
    lastIndex = pattern.lastIndex;
  }

  // Add remaining plain text
  if (lastIndex < cleaned.length) {
    segments.push({ text: cleaned.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: cleaned }];
}

/**
 * Render formatted text as Ink Text elements.
 * Returns an array of <Text> components that can be nested inside a parent <Text>.
 */
export function renderFormattedText(text: string): React.ReactNode {
  const segments = parseSegments(text);

  if (segments.length === 1 && !segments[0].bold && !segments[0].italic) {
    return segments[0].text;
  }

  return segments.map((seg, i) => (
    <Text key={i} bold={seg.bold} italic={seg.italic}>
      {seg.text}
    </Text>
  ));
}
`,
  },
  {
    path: "src/utils/logger.ts",
    content: `/**
 * Logger utility with configurable log levels.
 *
 * Levels (from least to most verbose):
 *   ERROR (0) → WARN (1) → INFO (2) → DEBUG (3) → TRACE (4)
 *
 * Set the level via \`setLogLevel()\` or the \`--log-level\` CLI flag.
 * Logs are written to a file to avoid interfering with Ink UI rendering.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

let currentLevel: LogLevel = LogLevel.INFO;
let logFilePath: string | null = null;

// In-memory log buffer for UI display
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

let logBuffer: LogEntry[] = [];
let logListeners: Array<(entry: LogEntry) => void> = [];

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function onLog(listener: (entry: LogEntry) => void): () => void {
  logListeners.push(listener);
  // Return unsubscribe function
  return () => {
    logListeners = logListeners.filter(l => l !== listener);
  };
}

export function getRecentLogs(count: number = 50): LogEntry[] {
  return logBuffer.slice(-count);
}

export function initLogFile(): string {
  // Create logs directory
  const logsDir = join(homedir(), '.local', 'share', 'protoagent', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Create log file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFilePath = join(logsDir, \`protoagent-\${timestamp}.log\`);

  // Write header
  writeToFile(\`\\n\${'='.repeat(80)}\\nProtoAgent Log - \${new Date().toISOString()}\\n\${'='.repeat(80)}\\n\`);

  return logFilePath;
}

function writeToFile(message: string): void {
  if (!logFilePath) {
    initLogFile();
  }
  try {
    appendFileSync(logFilePath!, message);
  } catch (err) {
    // Silently fail if we can't write to log file
  }
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return \`\${hh}:\${mm}:\${ss}.\${ms}\`;
}

function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  if (level > currentLevel) return;
  const ts = timestamp();

  // Create log entry
  const entry: LogEntry = {
    timestamp: ts,
    level,
    message,
    context,
  };

  // Add to buffer (keep last 100 entries)
  logBuffer.push(entry);
  if (logBuffer.length > 100) {
    logBuffer.shift();
  }

  // Notify listeners
  logListeners.forEach(listener => listener(entry));

  // Write to file
  const ctx = context ? \` \${JSON.stringify(context)}\` : '';
  writeToFile(\`[\${ts}] \${label.padEnd(5)} \${message}\${ctx}\\n\`);
}

export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.ERROR, 'ERROR', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.WARN, 'WARN', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.INFO, 'INFO', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.DEBUG, 'DEBUG', msg, ctx),
  trace: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.TRACE, 'TRACE', msg, ctx),

  /** Start a timed operation. Call the returned \`end()\` to log the duration. */
  startOperation(name: string): { end: () => void } {
    const start = performance.now();
    logger.debug(\`\${name} started\`);
    return {
      end() {
        const ms = (performance.now() - start).toFixed(1);
        logger.debug(\`\${name} completed\`, { durationMs: ms });
      },
    };
  },

  /** Get the path to the current log file */
  getLogFilePath(): string | null {
    return logFilePath;
  },
};
`,
  },
  {
    path: "src/utils/path-validation.ts",
    content: `/**
 * Path validation utility shared by all file tools.
 *
 * Ensures that every file path the agent operates on is within the
 * working directory (process.cwd()). Prevents directory traversal
 * and symlink escape attacks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const workingDirectory = process.cwd();
let allowedRoots: string[] = [];

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedPath(targetPath: string): boolean {
  return isWithinRoot(targetPath, workingDirectory) || allowedRoots.some((root) => isWithinRoot(targetPath, root));
}

export async function setAllowedPathRoots(roots: string[]): Promise<void> {
  const normalizedRoots = await Promise.all(
    roots.map(async (root) => {
      const resolved = path.resolve(root);
      try {
        const realRoot = await fs.realpath(resolved);
        return [path.normalize(resolved), realRoot];
      } catch {
        return [path.normalize(resolved)];
      }
    })
  );

  allowedRoots = Array.from(new Set(normalizedRoots.flat()));
}

export function getAllowedPathRoots(): string[] {
  return [...allowedRoots];
}

/**
 * Resolve and validate a path. Throws if the path is outside cwd.
 * For files that don't exist yet, validates the parent directory.
 */
export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  // First check: is the normalised path within cwd?
  if (!isAllowedPath(normalized)) {
    throw new Error(\`Path "\${requestedPath}" is outside the working directory.\`);
  }

  // Second check: resolve symlinks and re-check
  try {
    const realPath = await fs.realpath(normalized);
    if (!isAllowedPath(realPath)) {
      throw new Error(\`Path "\${requestedPath}" resolves (via symlink) outside the working directory.\`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — validate the parent directory instead
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        if (!isAllowedPath(realParent)) {
          throw new Error(\`Parent directory of "\${requestedPath}" resolves outside the working directory.\`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(\`Parent directory of "\${requestedPath}" does not exist.\`);
      }
    }
    throw err;
  }
}

export function getWorkingDirectory(): string {
  return workingDirectory;
}
`,
  },
  {
    path: "tailwind.config.js",
    content: `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./docs/**/*.{md,vue,ts}', './docs/.vitepress/**/*.{js,ts,vue}'],
  theme: {
    extend: {
      colors: {
        // ProtoAgent CLI green
        accent: {
          DEFAULT: '#09A469',
          light: '#0FD68C',
          dim: '#067A4E',
          bg: 'rgba(9, 164, 105, 0.08)',
          border: 'rgba(9, 164, 105, 0.2)',
        },
        // Dark surfaces
        dark: {
          black: '#0c0c0c',
          surface: '#141414',
          'surface-2': '#1a1a1a',
          border: '#2a2a2a',
          'border-bright': '#3a3a3a',
        },
        // Text colors
        text: {
          DEFAULT: '#c0c0c0',
          bright: '#f0f0f0',
          dim: '#999',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'Menlo', 'monospace'],
        sans: ['Instrument Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: '0.65rem',
        sm: '0.8rem',
        base: '0.88rem',
        lg: '1.1rem',
        xl: '1.3rem',
        '2xl': '1.6rem',
        '3xl': '3rem',
      },
      backgroundColor: {
        black: '#0c0c0c',
        surface: '#141414',
        'surface-2': '#1a1a1a',
      },
      borderColor: {
        dark: '#2a2a2a',
      },
      textColor: {
        DEFAULT: '#c0c0c0',
        bright: '#f0f0f0',
        dim: '#999',
      },
    },
  },
  plugins: [],
}
`,
  },
  {
    path: "tsconfig.json",
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`,
  }
];

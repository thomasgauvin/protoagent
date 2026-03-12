# ProtoAgent

A minimal, educational AI coding agent CLI written in TypeScript. It stays small enough to read in an afternoon, but it still has the core pieces you expect from a real coding agent: a streaming tool-use loop, approvals, sessions, MCP, skills, sub-agents, and cost tracking.

## Features

- **Multi-provider chat** — OpenAI, Anthropic, Google Gemini, and Cerebras via the OpenAI SDK
- **Built-in tools** — Read, write, edit, list, search, run shell commands, manage todos, and fetch web pages with `webfetch`
- **Approval system** — Inline confirmation for file writes, file edits, and non-safe shell commands
- **Session persistence** — Conversations and TODO state are saved automatically and can be resumed with `--session`
- **Dynamic extensions** — Load skills on demand and add external tools through MCP servers
- **Sub-agents** — Delegate self-contained tasks to isolated child conversations
- **Usage tracking** — Live token, context, and estimated cost display in the TUI

## Quick Start

```bash
npm install -g protoagent
protoagent
```

On first run, ProtoAgent shows an inline setup flow where you pick a provider/model pair and enter an API key. ProtoAgent stores that selection in `protoagent.jsonc`.

Runtime config lookup is simple:

- if `<cwd>/.protoagent/protoagent.jsonc` exists, ProtoAgent uses it
- otherwise it falls back to the shared user config at `~/.config/protoagent/protoagent.jsonc` on macOS/Linux and `~/AppData/Local/protoagent/protoagent.jsonc` on Windows

You can also run the standalone wizard directly:

```bash
protoagent configure
```

Or configure a specific target non-interactively:

```bash
protoagent configure --project --provider openai --model gpt-5-mini
protoagent configure --user --provider anthropic --model claude-sonnet-4-6
```

To create a runtime config file for the current project or your shared user config, run:

```bash
protoagent init
```

`protoagent init` creates `protoagent.jsonc` in either `<cwd>/.protoagent/protoagent.jsonc` or your shared user config location and prints the exact path it used.

For scripts or non-interactive setup, use:

```bash
protoagent init --project
protoagent init --user
protoagent init --project --force
```

## Interactive Commands

- `/help` — Show available slash commands
- `/clear` — Start a fresh conversation in a new session
- `/collapse` — Collapse long system and tool output
- `/expand` — Expand collapsed messages
- `/quit` or `/exit` — Save and exit

Other useful shortcuts:

- `Esc` — Abort the current in-flight completion
- `Ctrl-C` — Exit immediately

## Building From Source

```bash
npm install
npm run build
npm run dev
```

## Documentation

Full guides and tutorials live in `docs/`:

- `docs/guide/getting-started.md`
- `docs/guide/configuration.md`
- `docs/guide/tools.md`
- `docs/guide/sessions.md`
- `docs/guide/skills.md`
- `docs/guide/sub-agents.md`
- `docs/guide/mcp.md`

Build the docs site locally:

```bash
npm run docs:dev
npm run docs:build
```

Top-level technical references:

- `SPEC.md` — current implementation specification
- `ARCHITECTURE.md` — current runtime architecture and module relationships

## Architecture

The codebase is organized so each part is easy to trace:

- `src/cli.tsx` — CLI flags and the `configure` subcommand
- `src/App.tsx` — Ink app shell, runtime orchestration, slash commands, approvals, session display
- `src/agentic-loop.ts` — Streaming tool-use loop and error handling
- `src/tools/` — Built-in tools such as file I/O, shell, todo tracking, and `webfetch`
- `src/config.tsx` — Config persistence and setup wizard
- `src/providers.ts` — Provider/model catalog and pricing metadata
- `src/sessions.ts` — Session save/load and TODO persistence
- `src/skills.ts` — Skill discovery and dynamic `activate_skill` tool registration
- `src/mcp.ts` — MCP server loading and dynamic tool registration
- `src/sub-agent.ts` — Isolated child agent execution

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

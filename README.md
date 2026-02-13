# ProtoAgent

A minimal, educational AI coding agent CLI written in TypeScript. Learn how to build multi-turn agentic systems from first principles — no frameworks, just clear, annotated code.

## Features

- **Multi-turn conversation** — Talk to any LLM (OpenAI, Anthropic, Google, Cerebras, Cloudflare)
- **Tool use** — Read/write files, search code, execute shell commands, manage todos, trigger sub-agents
- **MCP support** — Connect to Claude's Model Context Protocol servers for extended capabilities
- **Approval workflows** — Confirm dangerous operations before they run (or approve all for the session)
- **Session persistence** — Save conversations and resume them later
- **Skills system** — Load custom instructions and tools into your session
- **Sub-agents** — Spawn parallel AI agents for independent research tasks
- **Cost tracking** — See real-time token usage and pricing for each model

## Quick Start

```bash
npm install -g protoagent
protoagent
```

On first run, you'll be prompted to select an LLM provider (OpenAI, Anthropic, Google, or free tier options) and enter an API key. Your config is saved to `~/.protoagent-config.json`.

## Configuration

Set up a new provider or change your active model anytime:

```
/config
```

This opens the inline setup wizard. You can also edit your config manually — see `docs/guide/configuration.md` for details.

## Available Commands

- `/help` — Show all available commands
- `/config` — Re-run the configuration wizard
- `/session-save` — Save current conversation
- `/session-load <id>` — Resume a saved session
- `/skill-load <name>` — Load a skill (custom instructions + tools)
- `/mcp-start <name>` — Start an MCP server
- `/mcp-stop <name>` — Stop an MCP server
- `/approve-all <type>` — Auto-approve all tool calls of a type for this session
- `/reject-all <type>` — Auto-reject all tool calls of a type for this session
- `/model-switch <name>` — Switch to a different model mid-session

## Building from Source

```bash
npm install
npm run build
npm run dev  # Run in dev mode (tsx)
```

## Documentation

Full guides and tutorials are available in `docs/`:

- **Getting Started** — `docs/guide/getting-started.md`
- **Configuration** — `docs/guide/configuration.md`
- **Tools** — `docs/guide/tools.md`
- **Skills** — `docs/guide/skills.md`
- **MCP** — `docs/guide/mcp.md`
- **Sessions** — `docs/guide/sessions.md`
- **Sub-agents** — `docs/guide/sub-agents.md`

Build the docs site locally:

```bash
npm run docs:dev
npm run docs:build
```

## Architecture

This is a learning project. The source code is annotated and organized to be readable:

- `src/cli.tsx` — Entry point and CLI argument parsing
- `src/App.tsx` — React terminal UI
- `src/agentic-loop.ts` — Core agent logic (tool use, conversation loop)
- `src/tools/` — Tool implementations (file operations, shell, todos, etc.)
- `src/config.tsx` — Config management
- `src/providers.ts` — LLM provider definitions (OpenAI, Anthropic, Google, etc.)
- `src/sessions.ts` — Session save/load
- `src/mcp.ts` — MCP client
- `src/skills.ts` — Skill system

## Supported Models

### OpenAI
- GPT-5.2 (premium reasoning)
- GPT-5 Mini (fast, cheap)
- GPT-4.1

### Anthropic
- Claude Opus 4.6 (flagship)
- Claude Sonnet 4.5 (balanced)
- Claude Haiku 4.5 (fast)

### Google
- Gemini 2.5 Flash (multimodal)
- Gemini 2.5 Pro

### Free Tier
- Cerebras (free API)
- Cloudflare (free with workers account)

## Why ProtoAgent?

ProtoAgent is not meant to be a production framework. It's an experiment in building understandable AI systems — every line of code should teach something. Read through the tutorial (`docs/tutorial/`) to see how to build:

1. Configuration and provider selection
2. Agentic loops and tool registries
3. File and shell command tools
4. Approval workflows
5. Session persistence
6. Cost tracking
7. Dynamic system prompts
8. MCP integration
9. Skills and sub-agents

Perfect for learning or as a foundation for your own agent experiments.

## License

MIT

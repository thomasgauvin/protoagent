# Architecture

ProtoAgent is layered so that each piece has one job and minimal coupling to the others. Here's how it fits together.

## The stack

```
CLI (Commander)
  └─ Ink React TUI
       └─ Agentic Loop
            ├─ LLM Client (OpenAI SDK)
            ├─ Built-in Tools (file, shell, todo)
            ├─ MCP Tools (external servers)
            └─ Sub-agents (isolated child sessions)
```

The CLI parses arguments and decides whether to show the main app or the config wizard. The Ink TUI handles rendering and user input. The agentic loop does the actual work — calling the LLM, executing tools, looping until done. Everything below the loop is a tool or a service the loop uses.

## Key design decisions

### The loop doesn't know about the UI

The agentic loop is a plain TypeScript module that emits events — text deltas, tool calls, results, errors. The Ink component subscribes to these events and updates React state. This means you can test the loop without rendering anything, and you could swap the UI entirely without touching the core logic.

This is the same pattern the production agents use. OpenCode writes to a store and the TUI subscribes via a bus. Codex sends events through a channel. pi-mono uses pub/sub. The principle is always the same: decouple the brain from the display.

### Tools are self-describing

Each tool exports a JSON schema and a handler function. The registry collects the schemas (to send to the LLM) and dispatches calls to the right handler. Adding a new tool means creating a new file — no wiring, no registration ceremony.

### Dynamic tool registration

The tool registry isn't locked at startup. MCP tools and the sub-agent tool are registered at runtime, appearing alongside built-in tools. The LLM doesn't know the difference — a tool is a tool.

### Security by default

All file operations validate paths against the working directory. Shell commands are classified by safety tier. Writes require approval. You can override all of this with `--dangerously-accept-all`, but the default is cautious.

## File map

| File | What it does |
|---|---|
| `cli.tsx` | Argument parsing, subcommand routing |
| `App.tsx` | Terminal rendering, user input, event handling |
| `config.tsx` | Configuration wizard |
| `providers.ts` | Provider and model definitions |
| `agentic-loop.ts` | The tool-use loop |
| `system-prompt.ts` | Dynamic prompt generation |
| `mcp.ts` | MCP client — server spawning, tool discovery |
| `sub-agent.ts` | Child session spawning |
| `sessions.ts` | Save/load conversations |
| `skills.ts` | Skill file discovery and loading |
| `tools/index.ts` | Tool registry and dispatch |
| `tools/*.ts` | Individual tool implementations |
| `utils/*.ts` | Cost tracking, compaction, approval, logging, path validation |

# Part 10: MCP & Sub-agents

These are the two features that move ProtoAgent from "educational project" to "actually extensible tool." MCP lets you plug in external tools without changing agent code. Sub-agents let you delegate tasks without polluting context.

## What you'll build

- An MCP client that reads `.protoagent/mcp.json`, spawns servers, discovers tools, and forwards calls
- A sub-agent tool that creates isolated child conversations with their own message history
- Dynamic tool registration — MCP and sub-agent tools show up alongside built-in tools at runtime

## Key concepts

- **Model Context Protocol** — JSON-RPC over stdio. The agent sends `tools/list` to discover what a server offers, then `tools/call` to use them. It's simpler than it sounds. I wrote about [how MCP works at the protocol level](https://thomasgauvin.com/writing/learning-how-mcp-works-by-reading-logs-and-building-mcp-interceptor) if you want the full picture.
- **Context pollution** — the main reason sub-agents exist. An exploration task can generate dozens of tool calls that clutter the parent's context. Isolating it keeps the parent focused.
- **Dynamic tools** — the tool registry isn't static. Tools can be added at runtime, which is how MCP and sub-agents integrate without special-casing anything.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::

# Part 10: MCP & Sub-agents

This is where ProtoAgent becomes extensible beyond its built-in tool set.

## MCP in the current source

MCP support lives in `src/mcp.ts` and uses the official `@modelcontextprotocol/sdk`.

Current support includes:

- `stdio` servers
- `http` servers via Streamable HTTP transport

Configured servers come from `.protoagent/mcp.json`, and discovered tools are registered dynamically with names like `mcp_<server>_<tool>`.

## Sub-agents in the current source

Sub-agent support lives in `src/sub-agent.ts`, with special handling in `src/agentic-loop.ts`.

Current behavior:

- sub-agents get isolated conversations
- they use the normal tool stack from `getAllTools()`
- `sub_agent` is not exposed recursively inside the child
- child runs return only their final summary to the parent
- child TODO state is cleared after completion

## Core takeaway

MCP extends ProtoAgent outward to external tool servers. Sub-agents extend it inward by letting the runtime create focused child investigations.

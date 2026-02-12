# MCP Servers

If you've used MCP servers with Claude Desktop or Claude Code, you already know the idea — you configure a tool server, and the agent automatically discovers and uses its tools. ProtoAgent works the same way.

If you haven't used MCP before, here's the short version: [Model Context Protocol](https://modelcontextprotocol.io/) is an open standard for connecting AI agents to external tools. Instead of building every possible tool into the agent, you run separate servers that expose tools (database queries, API calls, documentation search, whatever) and the agent discovers them at startup.

I wrote a more detailed breakdown of [how MCP works at the protocol level](https://thomasgauvin.com/writing/learning-how-mcp-works-by-reading-logs-and-building-mcp-interceptor) if you're curious about what's happening under the hood.

## Setting up an MCP server

Create a `.protoagent/mcp.json` file in your project:

```json
{
  "servers": {
    "my-server": {
      "command": "npx",
      "args": ["-y", "@example/mcp-server"],
      "env": {
        "API_KEY": "your-key-here"
      }
    }
  }
}
```

Each entry has:

- **command**: what to run to start the server
- **args**: command-line arguments
- **env**: environment variables to pass along

That's the same format Claude Desktop uses, so if you've configured MCP servers before, this should look familiar.

## What happens at startup

When ProtoAgent launches, it reads `.protoagent/mcp.json` and spawns each server as a child process. Communication happens over stdio using JSON-RPC — the same protocol all MCP clients and servers speak.

ProtoAgent sends a `tools/list` request to discover what tools each server provides, then registers them in the tool registry with namespaced names (like `my-server__search_docs`). From that point on, the LLM can call these tools just like it calls built-in ones.

When you exit ProtoAgent, all MCP server processes get shut down cleanly.

## What's supported (and what's not)

ProtoAgent implements a minimal MCP client — enough to cover the most common use case of running local tool servers:

- **Stdio transport** — supported
- **HTTP transport** — not supported
- **OAuth authentication** — not supported

If you need HTTP transport or OAuth, production agents like [OpenCode](https://github.com/anomalyco/opencode) have full implementations. ProtoAgent keeps it simple.

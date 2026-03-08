# MCP Servers

ProtoAgent supports MCP servers so external tools can be discovered at startup and exposed alongside built-in tools.

Configuration lives in project-local `.protoagent/mcp.json`.

## Supported server types

ProtoAgent currently supports:

- `stdio` servers started as child processes
- `http` servers reached through Streamable HTTP transport

The implementation uses the official `@modelcontextprotocol/sdk`.

## Stdio servers

```json
{
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
```

Fields:

- `type`: must be `"stdio"`
- `command`: executable to run
- `args`: optional command-line arguments
- `env`: optional environment variables

`type` is expected explicitly in the current implementation.

## HTTP servers

```json
{
  "servers": {
    "remote-server": {
      "type": "http",
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

Fields:

- `type`: must be `"http"`
- `url`: full MCP endpoint URL

## What happens at startup

When ProtoAgent launches, it reads `.protoagent/mcp.json` and:

1. connects to each configured server
2. calls `listTools()` through the MCP client
3. registers each remote tool dynamically
4. exposes them to the model with names like `mcp_<server>_<tool>`

For example, a tool named `search_docs` from a server named `github` becomes `mcp_github_search_docs`.

## Tool results

When an MCP tool is called, ProtoAgent forwards the arguments with `callTool()` and flattens text content blocks into a single string result. Non-text blocks are JSON-stringified.

## Shutdown

On app cleanup, ProtoAgent closes MCP client connections.

## Current limits

- OAuth support is not implemented
- tool results are flattened into strings rather than preserved as rich structured blocks

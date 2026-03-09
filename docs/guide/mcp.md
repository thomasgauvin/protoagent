# MCP Servers

MCP is how ProtoAgent grows beyond its built-in tools.

Instead of baking every possible tool into the app, you point ProtoAgent at one or more MCP servers and it discovers their tools at startup.

Configuration lives in merged `protoagent.jsonc` files under `mcp.servers`.

## Supported server types

ProtoAgent currently supports:

- `stdio` servers started as child processes
- `http` servers reached through Streamable HTTP transport

The implementation uses the official `@modelcontextprotocol/sdk`.

## Stdio servers

```jsonc
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
```

Fields:

- `type`: must be `"stdio"`
- `command`: executable to run
- `args`: optional command-line arguments
- `env`: optional environment variables
- `cwd`: optional working directory
- `enabled`: optional toggle

`type` is expected explicitly in the current implementation.

## HTTP servers

```jsonc
{
  "mcp": {
    "servers": {
      "remote-server": {
        "type": "http",
        "url": "http://localhost:3000/mcp",
        "headers": {
          "Authorization": "Bearer ${MY_MCP_TOKEN}"
        }
      }
    }
  }
}
```

Fields:

- `type`: must be `"http"`
- `url`: full MCP endpoint URL
- `headers`: optional request headers

## What happens at startup

When ProtoAgent launches, it loads merged `protoagent.jsonc` config and:

1. connects to each configured server
2. calls `listTools()` through the MCP client
3. registers each remote tool dynamically
4. exposes them to the model with names like `mcp_<server>_<tool>`

So if a server named `github` exposes a tool named `search_docs`, the model sees `mcp_github_search_docs`.

## Tool results

When an MCP tool is called, ProtoAgent forwards the arguments with `callTool()` and flattens text content blocks into a single string result. Non-text blocks are JSON-stringified.

That flattening is a simplification, but it keeps the tool surface easy to work with in the current app.

## Shutdown

On app cleanup, ProtoAgent closes MCP client connections.

## Current limits

- OAuth support is not implemented
- tool results are flattened into strings rather than preserved as rich structured blocks

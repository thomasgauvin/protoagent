# Configuration

Configuration is what turns ProtoAgent from a generic CLI into a usable local coding tool.

ProtoAgent now has two configuration layers:

- `config.json` for the selected provider, model, and optional explicit API key
- `protoagent.jsonc` for provider definitions, provider overrides, MCP servers, headers, and request defaults

## `config.json`

ProtoAgent stores the active selection at:

- **macOS/Linux**: `~/.local/share/protoagent/config.json`
- **Windows**: `%USERPROFILE%/AppData/Local/protoagent/config.json`

Shape:

```json
{
  "provider": "openai",
  "model": "gpt-5-mini",
  "apiKey": "..."
}
```

On non-Windows platforms, ProtoAgent hardens directory and file permissions.

ProtoAgent still supports:

- inline first-run setup with `protoagent`
- the standalone wizard with `protoagent configure`
- legacy `credentials` compatibility at read time

## `protoagent.jsonc`

ProtoAgent loads `protoagent.jsonc` from:

- `<process.cwd()>/.protoagent/protoagent.jsonc`
- `~/.protoagent/protoagent.jsonc`
- `~/.config/protoagent/protoagent.jsonc`

All files are optional. They are merged with built-in defaults, and project config wins over user config.

This file replaces separate provider and MCP extension files. It may define:

- custom providers
- overrides to built-in providers
- custom model metadata
- request default parameters
- MCP servers

Example:

```jsonc
{
  "providers": {
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

## Environment variable interpolation

Any string in `protoagent.jsonc` may contain `${VAR_NAME}`.

- interpolation happens at load time
- unresolved variables become empty strings
- unresolved variables log a warning
- headers with empty values are dropped

## Precedence rules

Environment variables are still allowed and take priority over file-based runtime config.

At runtime, ProtoAgent resolves the API key in this order:

1. `config.apiKey`
2. explicit env override for the active provider
3. `PROTOAGENT_API_KEY`
4. `provider.apiKey`
5. the selected provider's `apiKeyEnvVar`
6. `'none'` for header-based providers that do not need a bearer token

Base URL precedence:

1. `PROTOAGENT_BASE_URL`
2. `provider.baseURL`
3. built-in default

Header precedence:

1. `PROTOAGENT_CUSTOM_HEADERS`
2. `provider.headers`
3. built-in default headers

## Provider and model definitions

Built-in providers still ship in source, but the runtime registry is the merged result of built-ins plus all loaded `protoagent.jsonc` files.

That means `protoagent.jsonc` can:

- add a new provider
- override a built-in provider by ID
- override a model entry by model ID under a provider

Each model may include:

- display name
- context window
- input and output pricing
- model-level `defaultParams`

Providers may include provider-level `defaultParams` that apply to all models unless a model overrides them.

Reserved request fields like `model`, `messages`, `tools`, `tool_choice`, `stream`, and `stream_options` should not be overridden by config.

## MCP configuration

MCP server configuration now lives inside `protoagent.jsonc` under `mcp.servers`.

ProtoAgent supports:

- stdio MCP servers
- HTTP / Streamable HTTP MCP servers

Example:

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

## Cloudflare Gateway setup

This config model makes Cloudflare-style setups much simpler.

Shell:

```bash
export CF_ACCESS_TOKEN=$(cloudflared access login --no-verbose -app=https://opencode.cloudflare.dev)
protoagent
```

Project config:

```jsonc
{
  "providers": {
    "cf-openai": {
      "name": "OpenAI via CF Gateway",
      "baseURL": "https://opencode.cloudflare.dev/openai/",
      "apiKey": "none",
      "headers": {
        "cf-access-token": "${CF_ACCESS_TOKEN}",
        "X-Requested-With": "xmlhttprequest"
      },
      "models": {
        "gpt-4o": {
          "name": "GPT-4o",
          "contextWindow": 128000
        }
      }
    }
  }
}
```

With this setup, provider config lives in the repo instead of ad hoc shell functions or hardcoded source changes.

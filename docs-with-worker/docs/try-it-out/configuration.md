# Configuration

ProtoAgent uses a runtime config file: `protoagent.jsonc`.

It stores:

- provider definitions and overrides
- MCP servers
- request defaults

## Config locations

ProtoAgent checks for config in two locations. The first one found wins:

1. `<process.cwd()>/.protoagent/protoagent.jsonc` (project config)
2. `~/.config/protoagent/protoagent.jsonc` (user config)

Project config takes precedence, allowing per-project overrides of user defaults.

## `protoagent init`

Use `protoagent init` when you want ProtoAgent to create a starter `protoagent.jsonc` for you.

It offers two targets:

- project-local: `<process.cwd()>/.protoagent/protoagent.jsonc`
- shared user config: `~/.config/protoagent/protoagent.jsonc` on macOS/Linux, `%USERPROFILE%/AppData/Local/protoagent/protoagent.jsonc` on Windows

After creating the file, ProtoAgent prints the exact path so you can open and edit it immediately. If the file already exists, it leaves it untouched and prints that existing path instead.

For non-interactive usage, you can target the destination directly:

```bash
protoagent init --project
protoagent init --user
protoagent init --project --force
```

`--force` overwrites an existing target file with the starter template.

See the tutorial for implementing config management: [Part 3 - Configuration Management](/build-your-own/part-3)

## `protoagent.jsonc`

This file may define:

- custom providers
- overrides to built-in providers
- custom model metadata
- request default parameters
- MCP servers

Example:

```jsonc
{
  "providers": {
    "gemini": {
      "name": "Google Gemini",
      "baseURL": "https://generativelanguage.googleapis.com/v1beta/openai/",
      "apiKey": "${GEMINI_API_KEY}",
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
```

See the tutorial for implementing runtime configuration: [Part 11 - Runtime Config](/build-your-own/part-11)

## Precedence rules

At runtime, ProtoAgent resolves the API key in this order:

1. Provider-specific environment variable (`apiKeyEnvVar`, e.g. `OPENAI_API_KEY`)
2. Generic environment variable (`PROTOAGENT_API_KEY`)
3. `apiKey` in `protoagent.jsonc`

If no API key is found but custom headers are configured, ProtoAgent returns `'none'` for header-based authentication (e.g., Cloudflare Gateway setups).

Base URL precedence:

1. `PROTOAGENT_BASE_URL`
2. `provider.baseURL`
3. built-in default

Header precedence:

1. `PROTOAGENT_CUSTOM_HEADERS`
2. `provider.headers`
3. built-in default headers

## Built-in providers and models

Built-in providers have default environment variables. Set the corresponding env var to use a provider without any config file:

| Provider | Env Var | Models |
|---|---|---|
| **openai** | `OPENAI_API_KEY` | GPT-5.4 (200k), GPT-5.4-pro (200k), GPT-5.2 (200k), GPT-5 Mini (200k), GPT-5 Nano (200k), GPT-4.1 (128k) |
| **anthropic** | `ANTHROPIC_API_KEY` | Claude Opus 4.6 (200k), Claude Sonnet 4.6 (200k), Claude Haiku 4.5 (200k) |
| **google** | `GEMINI_API_KEY` | Gemini 3 Flash Preview (1M), Gemini 3 Pro Preview (1M), Gemini 2.5 Flash (1M), Gemini 2.5 Pro (1M) |

Example:

```bash
export OPENAI_API_KEY=sk-...
protoagent --provider openai --model gpt-5.2
```

You can override these in `protoagent.jsonc` by defining `apiKey` or `apiKeyEnvVar`.

See the tutorial for how built-in providers are set up: [Part 3 - Provider Catalog](/build-your-own/part-3)

### Extending built-in providers

`protoagent.jsonc` can:

- add a new provider
- override a built-in provider by ID
- override a model entry by model ID under a provider

Each model may include:

- display name
- context window
- input pricing (`inputPricePerMillion`)
- output pricing (`outputPricePerMillion`)
- cached token pricing (`cachedPricePerMillion`) - for providers that support prompt caching
- model-level `defaultParams`

Providers may include provider-level `defaultParams` that apply to all models unless a model overrides them.

Reserved request fields are stripped from config-defined defaults and logged as warnings. These reserved keys include: `model`, `messages`, `tools`, `tool_choice`, `stream`, `stream_options`.

## MCP configuration

MCP server configuration lives inside `protoagent.jsonc` under `mcp.servers`.

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
        "url": "http://localhost:3000/mcp",
        "headers": {
          "Authorization": "Bearer ${API_TOKEN}"
        }
      }
    }
  }
}
```

## Custom gateway setup

Route requests through a custom gateway or proxy by setting `baseURL` and custom headers:

```jsonc
{
  "providers": {
    "cf-openai": {
      "name": "OpenAI via CF Gateway",
      "baseURL": "https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai",
      "apiKey": "${OPENAI_API_KEY}",
      "headers": {
        "cf-aig-authorization": "Bearer ${CF_AIG_TOKEN}"
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
```

This example uses [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/). For gateways that store provider keys server-side, set `"apiKey": "none"`.

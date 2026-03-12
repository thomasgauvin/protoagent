# Configuration

Configuration is what turns ProtoAgent from a generic CLI into a usable local coding tool.

ProtoAgent uses a single runtime config file: `protoagent.jsonc`.

It stores:

- the active provider/model choice
- optional explicit API keys
- provider definitions and overrides
- MCP servers
- request defaults

## Active config location

ProtoAgent does not merge user and project config files.

Instead it uses exactly one active file:

1. `<process.cwd()>/.protoagent/protoagent.jsonc` if it exists
2. otherwise the shared user config:
   - macOS/Linux: `~/.config/protoagent/protoagent.jsonc`
   - Windows: `%USERPROFILE%/AppData/Local/protoagent/protoagent.jsonc`

On non-Windows platforms, ProtoAgent hardens directory permissions to `0o700` and file permissions to `0o600` when it creates config files.

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

## `protoagent.jsonc`

ProtoAgent reads exactly one active `protoagent.jsonc` file using the lookup rule above.

The first provider entry in the file is treated as the active provider, and the first model entry inside that provider is treated as the active model.

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

Example:

```jsonc
{
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "models": {
        "gpt-5-mini": {
          "name": "GPT-5 Mini"
        }
      }
    }
  },
  "mcp": {
    "servers": {}
  }
}
```

## Precedence rules

At runtime, ProtoAgent resolves the API key in this order:

1. the selected provider's `apiKey` from `protoagent.jsonc`
2. the selected provider's `apiKeyEnvVar` environment variable (e.g. `OPENAI_API_KEY`)
3. `PROTOAGENT_API_KEY`
4. `PROTOAGENT_CUSTOM_HEADERS` environment variable (returns `'none'`)
5. `provider.headers` with non-empty entries (returns `'none'` for header-based auth)

Base URL precedence:

1. `PROTOAGENT_BASE_URL`
2. `provider.baseURL`
3. built-in default

Header precedence:

1. `PROTOAGENT_CUSTOM_HEADERS`
2. `provider.headers`
3. built-in default headers

## Built-in providers and models

The built-in provider catalog includes:

| Provider | Models |
|---|---|
| **OpenAI** | GPT-5.2 (200k), GPT-5 Mini (200k), GPT-4.1 (128k) |
| **Anthropic Claude** | Claude Opus 4.6 (200k), Claude Sonnet 4.6 (200k), Claude Haiku 4.5 (200k) |
| **Google Gemini** | Gemini 3 Flash Preview (1M), Gemini 3 Pro Preview (1M), Gemini 2.5 Flash (1M), Gemini 2.5 Pro (1M) |
| **Cerebras** | Llama 4 Scout 17B (128k) |

The runtime registry is the result of built-ins plus the active `protoagent.jsonc` file. That means `protoagent.jsonc` can:

- add a new provider
- override a built-in provider by ID
- override a model entry by model ID under a provider

Each model may include:

- display name
- context window
- input and output pricing
- model-level `defaultParams`

Providers may include provider-level `defaultParams` that apply to all models unless a model overrides them.

Reserved request fields (`model`, `messages`, `tools`, `tool_choice`, `stream`, `stream_options`) are stripped from config-defined defaults and logged as warnings.

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

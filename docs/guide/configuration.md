# Configuration

ProtoAgent stores the selected provider, selected model, and an optional API key.

## Supported providers

ProtoAgent uses the OpenAI SDK as a common client layer. Some providers use the default OpenAI endpoint, while others use OpenAI-compatible base URLs.

| Provider | Models | API key env fallback |
|---|---|---|
| **OpenAI** | GPT-5.2, GPT-5 Mini, GPT-4.1 | `OPENAI_API_KEY` |
| **Anthropic Claude** | Claude Opus 4.6, Claude Sonnet 4.6, Claude Haiku 4.5 | `ANTHROPIC_API_KEY` |
| **Google Gemini** | Gemini 3 Flash Preview, Gemini 3 Pro Preview, Gemini 2.5 Flash, Gemini 2.5 Pro | `GEMINI_API_KEY` |
| **Cerebras** | Llama 4 Scout 17B | `CEREBRAS_API_KEY` |

The current provider catalog lives in `src/providers.ts`.

## Ways to configure ProtoAgent

### First run

```bash
protoagent
```

If no config exists, ProtoAgent opens an inline setup flow inside the main TUI.

### Standalone wizard

```bash
protoagent configure
```

### Mid-session

Inside the app, run:

```text
/config
```

That opens the config dialog and writes the updated config back to disk.

## Where config lives

- **macOS/Linux**: `~/.local/share/protoagent/config.json`
- **Windows**: `%USERPROFILE%/AppData/Local/protoagent/config.json`

On non-Windows platforms, ProtoAgent also hardens directory and file permissions.

## Current config shape

```json
{
  "provider": "openai",
  "model": "gpt-5-mini",
  "apiKey": "..."
}
```

`apiKey` is optional if the selected provider's environment variable is already set.

ProtoAgent still reads a legacy config shape that stored keys under `credentials`, but it now writes the flat `apiKey` form.

## Manual edits

The config file is plain JSON, so you can edit it by hand if you want. On startup, ProtoAgent resolves the API key in this order:

1. `config.apiKey`
2. the selected provider's environment variable

## Adding a provider

To add another provider, update `src/providers.ts` with:

- a provider ID and display name
- an API key environment variable name
- an optional OpenAI-compatible `baseURL`
- one or more models with context-window and pricing metadata

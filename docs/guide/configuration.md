# Configuration

ProtoAgent needs an API key to talk to an LLM. The configuration system handles that — it stores your provider, model, and credentials so you don't have to think about it after the first run.

## Supported providers

ProtoAgent uses the OpenAI SDK as a universal client. Most providers expose OpenAI-compatible endpoints these days, so switching between them is just a matter of changing the base URL and API key.

| Provider | Models | How it connects |
|---|---|---|
| **OpenAI** | GPT-4o Mini, GPT-4o, o3-mini | Direct OpenAI API |
| **Google Gemini** | Gemini 2.5 Flash, Gemini 2.5 Pro | OpenAI-compatible endpoint |
| **Anthropic** | Claude Sonnet 4, Claude 3.5 Haiku | OpenAI-compatible endpoint |
| **Cerebras** | Llama 4 Scout 17B | OpenAI-compatible endpoint |

## Setting it up

Run the wizard:

```bash
protoagenta configure
```

It asks you three things: which provider, which model, and your API key. That's it.

## Where the config lives

Your config is saved at:

- **macOS/Linux**: `~/.local/share/protoagent/config.json`
- **Windows**: `%USERPROFILE%/AppData/Local/protoagent/config.json`

It's a plain JSON file — you can edit it by hand if you prefer.

## Adding a new provider

If your provider has an OpenAI-compatible chat completions endpoint, you can add it to `src/providers.ts`. You just need the base URL, model name, and pricing info. No SDK changes required — that's the nice thing about standardising on the OpenAI SDK.

The trade-off is that you lose access to provider-specific features (like Anthropic's extended thinking or prompt caching). For most use cases, the OpenAI-compatible endpoint works fine. If you need native features, you'd want to look at something like the Vercel AI SDK — but that's a complexity trade-off we intentionally avoid in ProtoAgent.

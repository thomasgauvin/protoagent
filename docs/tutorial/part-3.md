# Part 3: Configuration Management

Configuration is how ProtoAgent turns a generic CLI into a usable local tool.

## Current implementation

Configuration lives in `src/config.tsx` and stores:

- `provider`
- `model`
- optional `apiKey`

Storage paths:

- macOS/Linux: `~/.local/share/protoagent/config.json`
- Windows: `%USERPROFILE%/AppData/Local/protoagent/config.json`

On non-Windows systems, ProtoAgent also hardens directory and file permissions.

## Config flows

The current app supports three paths:

1. first-run inline setup inside `App.tsx`
2. standalone `protoagent configure`
3. mid-session `/config` through `ConfigDialog`

## Legacy compatibility

ProtoAgent now writes the flat `apiKey` shape, but it still reads an older `credentials`-based format for backward compatibility.

## Provider catalog

Provider and model metadata live in `src/providers.ts`. Each provider defines:

- a provider ID and name
- an optional OpenAI-compatible `baseURL`
- an API key env var name
- models with context and pricing metadata

## Core takeaway

Good config handling is not only about saving JSON. The current source also uses config as the glue between:

- the CLI
- provider selection
- API key resolution
- model pricing
- session metadata

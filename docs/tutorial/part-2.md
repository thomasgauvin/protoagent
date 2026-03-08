# Part 2: AI Integration

This part is where the CLI stops being a terminal shell and starts talking to a model.

## What the current source does

ProtoAgent builds clients with the OpenAI SDK, even for non-OpenAI providers that expose compatible endpoints.

The main pieces are:

- `src/App.tsx` for client creation and UI wiring
- `src/providers.ts` for provider metadata
- `src/config.tsx` for persisted provider/model selection

`buildClient()` in `src/App.tsx` resolves the selected provider, reads the API key from config or the provider env var, and applies a provider-specific `baseURL` when needed.

## Current providers

The app currently ships with:

- OpenAI
- Anthropic Claude
- Google Gemini
- Cerebras

## Streaming model output

ProtoAgent streams assistant output rather than waiting for a full response. That streaming behavior is later reused by the full tool loop in `src/agentic-loop.ts`.

The important idea is unchanged from the early tutorial versions: the UI reacts to incremental text updates instead of waiting for one big blob.

## Core takeaway

AI integration is not just "call the model." In the current codebase it also means:

- provider abstraction
- API key resolution
- streaming updates
- error handling
- stable client reuse across turns

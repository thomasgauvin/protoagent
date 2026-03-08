# Part 4: The Agentic Loop

This is the core pattern that makes ProtoAgent an agent instead of a chatbot.

## Current implementation

The loop lives in `src/agentic-loop.ts`.

At a high level, each iteration does this:

1. refresh the system prompt
2. compact history if context is too full
3. send messages plus tool definitions to the model
4. stream text and tool-call fragments
5. execute requested tools
6. append tool results
7. repeat until the model returns plain assistant text

## Event model

The loop emits events instead of rendering UI directly:

- `text_delta`
- `tool_call`
- `tool_result`
- `usage`
- `error`
- `done`

That separation lets `src/App.tsx` stay responsible for presentation while the loop stays reusable and testable.

## Current extras beyond the minimal pattern

The current source also includes:

- streamed tool-call assembly
- malformed tool payload repair
- transient retry handling for 429 and 5xx responses
- abort support through `AbortSignal`
- sub-agent special handling

## Core takeaway

The basic loop is still simple: model asks for tools, the runtime executes them, and the model keeps going until it can answer directly.

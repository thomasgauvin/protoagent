# Part 4: The Agentic Loop

This is the big one. Up to this point, we've had a chatbot — you type, the AI responds, that's it. In this part, we turn it into an agent by adding tool-calling support.

The agentic loop is the core pattern that powers every coding agent. It's surprisingly simple once you see it: call the LLM, check if it wants to use a tool, execute the tool, feed the result back, repeat. That's it. Everything else is just adding more tools.

## What you'll build

- An `AgenticLoop` module that implements the tool-use loop
- A tool registry with a dispatcher
- Streaming response handling with tool call argument accumulation
- Event-based decoupling so the loop doesn't know about the UI

## Key concepts

- **The tool-use loop** — the LLM can either respond with text (done) or request tool calls (keep going). You loop until it stops requesting tools.
- **Tool call streaming** — the LLM doesn't give you the full tool call at once. Arguments arrive as `delta` chunks that you need to accumulate across multiple stream events.
- **Events over direct rendering** — the loop emits events (text deltas, tool calls, results, errors) and the Ink UI subscribes to them. This keeps the core logic testable without any UI.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::

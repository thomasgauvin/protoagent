# Part 8: Compaction & Cost Tracking

Long conversations hit a wall — the context window. Every message, every tool call, every file read adds to the token count. Eventually you run out of space and the LLM starts dropping important context. This part handles that gracefully.

## What you'll build

- Token estimation (~4 chars per token) and cost calculation based on model pricing
- Context window utilisation tracking — how full is the context?
- Automatic conversation compaction when utilisation hits 90%
- A usage display in the Ink UI showing tokens and estimated cost

## Key concepts

- **Context windows** — they're finite, and in a coding agent session they fill up fast. A single large file read can eat thousands of tokens.
- **Summarisation** — when the context gets too full, we use the LLM itself to summarise the older conversation into a compact snapshot, then replace the old messages with the summary.
- **Cost awareness** — API calls cost money. Showing the running total helps you understand your spending and decide when to start a fresh session.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::

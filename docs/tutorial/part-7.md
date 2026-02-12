# Part 7: System Prompt

The system prompt is how you tell the agent who it is and what it's working on. A generic system prompt gets generic results. A system prompt that includes the project's directory tree, available tools, and coding conventions gets much better results.

## What you'll build

- Dynamic system prompt generation that includes project context
- A filtered directory tree (depth 3, excluding `node_modules`, `dist`, `.git`, etc.)
- Auto-generated tool descriptions from the JSON schemas
- Behavioural guidelines — when to use edit vs write, when to read before editing, how to track multi-step tasks

## Key concepts

- **Prompt engineering** — system prompt design has a massive impact on how well the agent performs. Too little context and it makes bad decisions. Too much and you burn through your context window.
- **Project awareness** — including a directory tree helps the agent navigate without needing to `list_directory` everything first.
- **Self-documenting tools** — the tool schemas already describe what each tool does. We reuse them in the prompt rather than maintaining separate documentation.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::

# Part 9: Skills & Sessions

Two features that make the difference between a demo and a tool you actually use: skills let you customise how the agent behaves, and sessions let you pick up where you left off.

## What you'll build

- A skills loader that discovers `.md` files from `.protoagent/skills/` and `~/.config/protoagent/skills/`
- System prompt injection — skill content gets appended to the prompt automatically
- Session save/load/list/delete to `~/.local/share/protoagent/sessions/`
- The `--session <id>` CLI flag for resuming conversations

## Key concepts

- **User customisation without code** — skills are just markdown files. Drop one in, restart, and the agent follows your instructions.
- **Conversation persistence** — serialise the messages array to a JSON file. It's the simplest approach that works.
- **Session management** — listing past sessions, resuming them, cleaning up old ones.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::

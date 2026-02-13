# Sessions

Here's something annoying about most CLI tools: you close the terminal and everything's gone. All that context the agent built up — what files it read, what it learned about your codebase, what you were working on — just disappears.

ProtoAgent saves your conversations automatically, so you can pick up right where you left off.

## How it works

After each turn, ProtoAgent saves the full conversation to a JSON file in `~/.local/share/protoagent/sessions/`. Each session gets a unique ID and a title generated from your first message.

There's nothing to configure. It just happens.

## Resuming a session

Use the `--session` flag:

```bash
protoagent --session abc123
```

ProtoAgent restores the full message history — your messages, the agent's responses, tool calls and results — and continues the conversation as if you never left.

## What gets saved

- The full messages array (everything the agent needs to continue)
- Session metadata — ID, title, when it was created, message count

## What doesn't get saved

A few things are ephemeral by design:

- **TODO list** — the agent's in-memory task tracker resets each session
- **MCP connections** — re-established on startup
- **Approval decisions** — you start fresh each time (security-first default)

## Managing sessions

Sessions are stored as plain JSON files. You can list them, inspect them, or delete old ones to free up space. Nothing fancy — it's files on disk.

## Why not something fancier?

Production agents have more sophisticated session systems. Codex uses JSONL streaming with a session index. pi-mono has tree-structured entries with branching (like git for conversations). OpenCode uses a full storage layer with migrations.

ProtoAgent goes with the simplest thing that works — serialize the messages array to JSON. It covers the main use case (resume a conversation) without the complexity. If you want branching or streaming persistence, those are great upgrade paths.

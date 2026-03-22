# Sessions

ProtoAgent saves session state so you can stop in the middle of a task, come back later, and keep going.

## Where sessions live

- **macOS/Linux**: `~/.local/share/protoagent/sessions/`
- **Windows**: `%USERPROFILE%/AppData/Local/protoagent/sessions/`

Each session is stored as a JSON file named by an 8-character alphanumeric ID (a-z, 0-9).

On non-Windows platforms, ProtoAgent hardens session directory permissions to `0o700` and file permissions to `0o600`.

## What gets saved

Each session stores:

- a session ID (8-character alphanumeric)
- a generated title (first 60 characters of the first user message)
- creation and update timestamps
- provider and model metadata
- `completionMessages` (the full message history)
- the session TODO list

## What does not get saved

- approval decisions
- live MCP connections
- in-flight request state

## Resuming a session

Use:

```bash
protoagent --session <id>
```

When a session loads, ProtoAgent refreshes the top system prompt before continuing.

When you quit from the UI with `/quit` or `/exit`, ProtoAgent saves the session and prints the exact resume command.

## Session IDs

Session IDs are 8-character alphanumeric strings (a-z, 0-9).

See the tutorial for implementing sessions: [Part 10 - Sessions](/build-your-own/part-10)

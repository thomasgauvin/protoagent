# Sessions

Most toy CLIs forget everything the moment you close the terminal. ProtoAgent does not.

It saves session state so you can stop in the middle of a task, come back later, and keep going.

## Where sessions live

- **macOS/Linux**: `~/.local/share/protoagent/sessions/`
- **Windows**: `%USERPROFILE%/AppData/Local/protoagent/sessions/`

Each session is stored as a JSON file named by UUID.

On non-Windows platforms, ProtoAgent also hardens session directory and file permissions.

## What gets saved

Each session stores:

- a UUID session ID
- a generated title
- creation and update timestamps
- provider and model metadata
- `completionMessages`
- the session TODO list

## What does not get saved

- approval decisions
- live MCP connections
- in-flight request state

## Resuming a session

Use:

```bash
protoagent --session <uuid>
```

When a session loads, ProtoAgent refreshes the top system prompt before continuing.

When you quit from the UI with `/quit` or `/exit`, ProtoAgent saves the session and prints the exact resume command.

## Session IDs

Session IDs are validated as UUIDs. Invalid IDs are rejected before a session file path is built.

## Starting fresh

Inside the UI, `/clear` starts a new session, resets the visible conversation, clears TODO state for the previous session, and creates a fresh session ID.

That distinction matters. `/clear` is not just wiping visible messages. It is starting a new persisted thread of work.

## Titles

Session titles are currently generated with a simple heuristic: ProtoAgent takes the first user message and truncates it if needed.

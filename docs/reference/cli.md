# CLI Reference

## Basic usage

```bash
protoagent [options] [command]
```

Running with no command starts the interactive TUI.

## Commands

### `protoagent`

Starts the main interactive app. If no config exists, ProtoAgent shows the first-run setup flow inside the TUI.

### `protoagent configure`

Launches the standalone configuration wizard for provider, model, and API key selection.

## Flags

### `--dangerously-accept-all`

Skips normal approval prompts for file writes, file edits, and non-safe shell commands.

Hard-blocked shell patterns are still denied.

```bash
protoagent --dangerously-accept-all
```

### `--log-level <level>`

Controls log verbosity.

| Level | Meaning |
|---|---|
| `ERROR` | only errors |
| `WARN` | errors and warnings |
| `INFO` | normal operational info |
| `DEBUG` | detailed debugging output |
| `TRACE` | very verbose tracing |

When logging is enabled, ProtoAgent initializes a log file and shows its path in the UI.

### `--session <id>`

Resumes a previously saved session by UUID.

```bash
protoagent --session 123e4567-e89b-12d3-a456-426614174000
```

## Slash commands

| Command | What it does |
|---|---|
| `/quit` or `/exit` | save the session and exit |
| `/clear` | start a fresh session |
| `/config` | change provider, model, or API key |
| `/collapse` | collapse long messages |
| `/expand` | expand all messages |
| `/help` | show available slash commands |

When quitting through `/quit` or `/exit`, ProtoAgent prints the exact `protoagent --session <id>` resume command.

## Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| `Esc` | abort the current in-flight completion |
| `Ctrl-C` | exit immediately |

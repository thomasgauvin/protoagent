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

Launches the configuration wizard for provider, model, and API key selection.

Interactive mode (default):
```bash
protoagent configure
```

Non-interactive mode with flags:
```bash
protoagent configure --provider <id> --model <id> --api-key <key>
protoagent configure --provider <id> --model <id> --api-key <key> --project
protoagent configure --provider <id> --model <id> --api-key <key> --user
```

Flags:
- `--provider <id>` — select provider by ID (e.g., `openai`, `anthropic`)
- `--model <id>` — select model by ID (e.g., `gpt-5.2`, `claude-sonnet-4-6`)
- `--api-key <key>` — set the API key
- `--project` — save to project config (`<cwd>/.protoagent/protoagent.jsonc`)
- `--user` — save to user config (`~/.config/protoagent/protoagent.jsonc`)

When both `--project` and `--user` are omitted, ProtoAgent defaults to project config.

### `protoagent init`

Creates a starter `protoagent.jsonc` and lets you choose between:

- project-local config in `<cwd>/.protoagent/protoagent.jsonc`
- shared user config in `~/.config/protoagent/protoagent.jsonc` on macOS/Linux or `%USERPROFILE%/AppData/Local/protoagent/protoagent.jsonc` on Windows

After the file is created, ProtoAgent prints the full path. If the target file already exists, it is not overwritten.

For non-interactive usage:

```bash
protoagent init --project
protoagent init --user
protoagent init --project --force
```

- `--project` writes `<cwd>/.protoagent/protoagent.jsonc`
- `--user` writes the shared user config path
- `--force` overwrites an existing target file

## Flags

### `--dangerously-skip-permissions`

Skips normal approval prompts for file writes, file edits, and non-safe shell commands.

Hard-blocked shell patterns are still denied.

```bash
protoagent --dangerously-skip-permissions
```

### `--log-level <level>`

Controls log verbosity. Default is `INFO`.

| Level | Meaning |
|---|---|
| `ERROR` | only errors |
| `WARN` | errors and warnings |
| `INFO` | normal operational info |
| `DEBUG` | detailed debugging output |
| `TRACE` | very verbose tracing |

ProtoAgent initializes a log file and shows its path in the UI.

### `--session <id>`

Resumes a previously saved session by ID.

```bash
protoagent --session abc123de
```

Session IDs are 8-character alphanumeric strings (a-z, 0-9). Legacy UUID format is also accepted.

### `--version`

Prints the current version.

## Slash commands

| Command | What it does |
|---|---|
| `/quit` | save the session and exit |
| `/exit` | alias for `/quit` |
| `/collapse` | collapse all long messages |
| `/expand` | expand all collapsed messages |
| `/help` | show available slash commands |

When quitting through `/quit` or `/exit`, ProtoAgent prints the exact `protoagent --session <id>` resume command.

## Keyboard shortcuts

| Shortcut | What it does |
|---|---|
| `Esc` | abort the current in-flight completion |
| `Ctrl-C` | exit immediately |

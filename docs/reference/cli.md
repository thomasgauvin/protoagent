# CLI Reference

Everything you can do from the command line.

## Basic usage

```bash
protoagent [options] [command]
```

Run it with no arguments to start an interactive session.

## Commands

### `protoagent`

Starts an interactive agent session. The agent reads your project, accepts natural language input, and uses tools to get things done.

### `protoagent configure`

Launches the configuration wizard. Walks you through picking a provider, choosing a model, and entering your API key. Run this on first use, or anytime you want to switch models.

## Flags

### `--dangerously-accept-all`

Skips all approval prompts for file writes, edits, and shell commands. The agent gets unrestricted access to modify files and run commands.

Use with caution — or in CI where there's no one to click "approve."

```bash
protoagent --dangerously-accept-all
```

### `--log-level <level>`

Controls how much logging output you see. Logs go to stderr so they don't interfere with the Ink UI.

| Level | What you see |
|---|---|
| `error` | Only errors |
| `warn` | Errors and warnings |
| `info` | General operational info (this is the default) |
| `debug` | Detailed debugging output |
| `trace` | Everything — including raw API calls |

```bash
protoagent --log-level debug
```

### `--session <id>`

Resume a previously saved session. The full conversation history gets restored and you continue where you left off.

```bash
protoagent --session abc123def
```

## Slash commands

These work during an interactive session:

| Command | What it does |
|---|---|
| `/quit` or `/exit` | Exit the agent |
| `/clear` | Clear the conversation history and start fresh |
| `/cost` | Show token usage and estimated cost for the current session |
| `/help` | Show available slash commands |

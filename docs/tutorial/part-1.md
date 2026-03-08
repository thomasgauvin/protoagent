# Part 1: Scaffolding

Part 1 is the structural foundation: a Node CLI entrypoint, Commander for argument parsing, and Ink for the terminal UI.

## What the current source does

Today that foundation lives mainly in:

- `src/cli.tsx`
- `src/App.tsx`

`src/cli.tsx` defines the main `protoagent` command, the `configure` subcommand, and three top-level flags:

- `--dangerously-accept-all`
- `--log-level <level>`
- `--session <id>`

The default command renders the Ink app, while `protoagent configure` renders the standalone configuration flow.

## What changed since the earliest version

The original scaffold was just a chat-shaped terminal app. The current foundation is richer:

- the UI is session-aware
- slash commands are built in
- config can be edited inline or mid-session
- approvals are rendered inline in the same TUI
- the app can resume previous sessions by ID

## Core takeaway

Even in the current codebase, the architecture still starts with the same simple split:

1. parse CLI arguments
2. decide which Ink component to render
3. keep the app stateful and interactive inside `App.tsx`

That separation makes every later feature easier to layer on.

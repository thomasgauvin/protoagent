# Getting Started

ProtoAgent is a TypeScript coding-agent CLI built to stay readable. It uses an Ink terminal UI, an OpenAI-compatible client layer, a streaming tool loop, inline approvals, and session persistence.

## Install it

Install globally via npm:

```bash
npm install -g protoagent
```

Or run it from a local checkout:

```bash
npm install
npm run dev
```

## First run

Launch ProtoAgent:

```bash
protoagent
```

If no config exists yet, ProtoAgent opens an inline setup flow where you pick a provider, choose a model, and enter an API key.

You can reopen configuration later with:

```bash
protoagent configure
```

Or, during a running session:

```text
/config
```

## Using it

Once configured, type a task and press Enter. ProtoAgent reads the project, decides which tools to call, asks for approval when needed, and keeps iterating until it reaches a final answer.

Example prompts:

- `Read the README and explain the project`
- `Find every TODO in src/`
- `Add error handling to the fetchData function`
- `Run the tests and fix any failures`

## Interactive commands

- `/help`
- `/config`
- `/clear`
- `/collapse`
- `/expand`
- `/quit` or `/exit`

Useful shortcuts:

- `Esc` aborts the current in-flight completion
- `Ctrl-C` exits immediately

`/quit` and `/exit` save the current session first and print the exact resume command.

## CLI flags

| Flag | What it does |
|---|---|
| `--dangerously-accept-all` | Skip normal approval prompts for writes, edits, and non-safe shell commands |
| `--log-level <level>` | Set log verbosity: `TRACE`, `DEBUG`, `INFO`, `WARN`, or `ERROR` |
| `--session <id>` | Resume a previously saved session |

## What you see while working

- streamed assistant output
- consolidated tool calls and tool results
- inline approval prompts
- token, context, and cost status
- auto-saved session state and TODOs
- a log file path when logging is enabled

## What's next

- [Configuration](/guide/configuration)
- [Tools](/guide/tools)
- [Approvals](/guide/approvals)
- [Sessions](/guide/sessions)
- [Skills](/guide/skills)
- [Build your own](/tutorial/)

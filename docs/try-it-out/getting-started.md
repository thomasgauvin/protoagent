# Getting Started

You've probably used coding agents that read files, run commands, and make edits without you really seeing what is going on under the hood. ProtoAgent is the same kind of tool, but with a simple codebase that is easy to understand. So easy to understand that you could build it yourself.

It's a TypeScript CLI with an Ink terminal UI, a streaming tool loop, inline approvals, and persisted sessions and the other features you would expect from coding agents like MCP and Skills.

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

Start ProtoAgent:

```bash
protoagent
```

If no config exists yet, ProtoAgent opens an inline setup flow right inside the TUI. You pick a provider, pick a model, and enter an API key.

You can reopen configuration later with:

```bash
protoagent configure
```

See the [Configuration guide](/try-it-out/configuration) for more details.

## Use it like you would any coding agent

Once it is configured, type a task and press Enter. ProtoAgent reads the project, decides which tools to call, asks for approval when it needs to, and keeps iterating until it has a final answer.

Some good first prompts:

- `Read the README and tell me what this project does`
- `Find every TODO in src/`
- `Add error handling to the fetchData function`
- `Run the tests and fix any failures`

## Interactive commands

Inside the app, you can use:

- `/help` — show available slash commands
- `/collapse` — collapse all long messages
- `/expand` — expand all collapsed messages
- `/quit` — save the session and exit (also accepts `/exit`)

Useful shortcuts:

- `Esc` aborts the current in-flight completion
- `Ctrl-C` exits immediately

## CLI flags

| Flag | What it does |
|---|---|
| `--dangerously-skip-permissions` | Skip normal approval prompts for writes, edits, and non-safe shell commands |
| `--log-level <level>` | Set log verbosity: `TRACE`, `DEBUG`, `INFO`, `WARN`, or `ERROR` |
| `--session <id>` | Resume a previously saved session |

## What you see while working

As ProtoAgent runs, you see the loop rather than just the final answer:

- streamed assistant output
- grouped tool calls and tool results
- inline approval prompts
- token, context, and cost info
- auto-saved session state and TODOs
- the active log file path

## Where to go next

- [Configuration](/try-it-out/configuration)
- [Tools](/try-it-out/tools)
- [Sessions](/try-it-out/sessions)
- [Skills](/try-it-out/skills)
- [Build your own](/build-your-own/)

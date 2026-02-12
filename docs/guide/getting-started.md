# Getting Started

You've probably used coding agents like Claude Code, Cursor, or Copilot. They read your files, run commands, write code — it feels like magic. But have you ever wondered what's actually happening under the hood?

That's what ProtoAgent is. It's a fully functional coding agent CLI that you can read, understand, and hack on. The entire source is around 2,000 lines of TypeScript — small enough to read in one sitting, but capable enough to use as a real day-to-day tool.

## Install it

Install globally via npm:

```bash
npm install -g protoagenta
```

Or clone and run from source:

```bash
git clone https://github.com/user/protoagent.git
cd protoagent
npm install
npm run dev
```

## First run

The first time you launch ProtoAgent, it walks you through picking a provider and entering your API key. Nothing fancy — just a terminal wizard.

```bash
protoagenta
```

You can come back and change this anytime with:

```bash
protoagenta configure
```

## Using it

Once you're set up, just type what you want and hit Enter. ProtoAgent reads your project, calls tools as needed, and gets things done.

Some things you might try:

- "Read the README and tell me what this project does"
- "Find all TODO comments in the codebase"
- "Add error handling to the fetchData function"
- "Run the tests and fix any failures"

The agent decides which tools to call, asks for your approval on anything destructive, and keeps going until the task is done.

## CLI flags

| Flag | What it does |
|---|---|
| `--dangerously-accept-all` | Skip all approval prompts (use with caution) |
| `--log-level <level>` | Set log verbosity (error, warn, info, debug, trace) |
| `--session <id>` | Resume a previous conversation |

## What's next

- [Configuration](/guide/configuration) — set up providers and models
- [Tools](/guide/tools) — what the agent can actually do
- [Skills](/guide/skills) — customise agent behaviour with markdown files
- [Build your own](/tutorial/) — the step-by-step tutorial

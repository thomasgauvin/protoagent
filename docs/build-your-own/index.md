# Build Your Own Coding Agent

ProtoAgent was built to understand how coding agents actually work, not just use them.

If you've used tools like Claude Code, Cursor, or Copilot, you have probably had that same moment: it reads files, runs commands, edits code, and somehow keeps the whole loop together. It feels a bit magical.

This tutorial is about removing that magic.

Every chapter includes complete, copy-pasteable code for every file at every stage. You can rebuild the entire project from scratch by following the parts in order.

## How to use this tutorial

Each part has two jobs:

- explain why that layer exists
- give you the exact code to build it

Every chapter is cumulative. Start at Part 1 and move forward in order.

For each stage, you should end up with a folder that matches one of these snapshots:

- `protoagent-tutorial-again-part-1`
- `protoagent-tutorial-again-part-2`
- `protoagent-tutorial-again-part-3`
- `protoagent-tutorial-again-part-4`
- `protoagent-tutorial-again-part-5`
- `protoagent-tutorial-again-part-6`
- `protoagent-tutorial-again-part-7`
- `protoagent-tutorial-again-part-8`
- `protoagent-tutorial-again-part-9`
- `protoagent-tutorial-again-part-10`
- `protoagent-tutorial-again-part-11`
- `protoagent-tutorial-again-part-12`
- `protoagent-tutorial-again-part-13`

The snapshots are the verification path. If a part says you should match `protoagent-tutorial-again-part-6`, that folder represents the completed result of following Parts 1 through 6 in order.

## Before you start

You'll want:

- Node.js 22+
- npm
- an API key for one of the supported providers (OpenAI, Anthropic, or Google)
- basic TypeScript knowledge
- a terminal you are comfortable working in

## The parts

### Foundation

1. **[Scaffolding](/build-your-own/part-1)** — Commander, Ink, and the basic CLI shell
2. **[AI Integration](/build-your-own/part-2)** — OpenAI SDK streaming and message flow
3. **[Configuration Management](/build-your-own/part-3)** — provider/model selection, persisted config, and API key resolution

### Core runtime

4. **[The Agentic Loop](/build-your-own/part-4)** — the tool-use loop, streaming events, retries, and termination
5. **[Core Tools: Files, TODOs, and Web Fetching](/build-your-own/part-5)** — path validation, approval system, file tools, TODO tracking, and web fetching
6. **[Shell Commands & Approvals](/build-your-own/part-6)** — `bash` tool with three-tier security (hard-blocked, auto-approved, requires approval)
7. **[System Prompt & Runtime Policy](/build-your-own/part-7)** — dynamic system prompt with directory tree and tool descriptions
8. **[Compaction & Cost Tracking](/build-your-own/part-8)** — token estimation, cost display, logger, and long-context compaction

### Persistence and reuse

9. **[Skills & AGENTS.md](/build-your-own/part-9)** — `SKILL.md` and `AGENTS.md` discovery, validation, activation, and catalog generation
10. **[Sessions](/build-your-own/part-10)** — persisted conversations, TODO restore, and resume flows

### Extensibility

11. **[MCP Integration](/build-your-own/part-11)** — runtime config, MCP client for stdio and HTTP servers, dynamic tool registration
12. **[Sub-agents](/build-your-own/part-12)** — isolated child agent execution for context-heavy tasks

### UI and operations

13. **[Polish, Rendering & Logging](/build-your-own/part-13)** — components, formatted output, grouped tool rendering, slash commands, fuzzy edit matching, and the final App

## Philosophy

ProtoAgent is intentionally small. It has persisted sessions, TODO state, web fetching, skills, MCP, sub-agents, compaction, and a rich terminal UI.

That is exactly why this tutorial exists. Once you understand the core loop and the runtime boundaries, the rest of the codebase stops feeling mysterious.

By the end, the tutorial should not just make the codebase feel understandable. It should make it reproducible.

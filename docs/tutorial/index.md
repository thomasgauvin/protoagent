# Build Your Own Coding Agent

This tutorial mirrors the same feature set that exists in the current `src/` tree, but it stays focused on the concepts and module boundaries rather than trying to inline every current source file verbatim.

## Before you start

You'll want:

- Node.js 20+
- an API key for one of the supported providers
- basic TypeScript knowledge
- comfort with the terminal and React-style state management

## The parts

### Foundation

1. **[Scaffolding](/tutorial/part-1)** — Commander, Ink, and the basic CLI shell
2. **[AI Integration](/tutorial/part-2)** — OpenAI SDK streaming and message flow
3. **[Configuration](/tutorial/part-3)** — provider/model selection and persisted config

### Core agent

4. **[The Agentic Loop](/tutorial/part-4)** — the tool-use loop, streaming events, retries, and termination
5. **[File Tools](/tutorial/part-5)** — read, write, edit, list, search, and path validation
6. **[Shell Commands](/tutorial/part-6)** — `bash`, approvals, and command safety tiers
7. **[System Prompt](/tutorial/part-7)** — project context, tool descriptions, and skills catalog

### Making it useful

8. **[Compaction & Cost Tracking](/tutorial/part-8)** — token estimates, cost display, and long-context compaction
9. **[Skills & Sessions](/tutorial/part-9)** — `SKILL.md` discovery, activation, and persisted sessions
10. **[MCP & Sub-agents](/tutorial/part-10)** — remote tools plus isolated child runs
11. **[Polish & UI](/tutorial/part-11)** — approvals, collapsible rendering, formatted output, logging, and usability details

## Philosophy

ProtoAgent is intentionally small, but the current codebase is no longer a tiny toy. It now includes sessions, TODO persistence, web fetching, MCP, skills activation, sub-agents, compaction, and a richer terminal UI.

The point of this tutorial is still the same: understand the core mechanics well enough that the full codebase feels approachable.

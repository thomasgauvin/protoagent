# Build Your Own Coding Agent

ProtoAgent was built to understand how coding agents actually work, not just use them.

If you've used tools like Claude Code, Cursor, or Copilot, you have probably had that same moment: it reads files, runs commands, edits code, and somehow keeps the whole loop together. It feels a bit magical.

This tutorial is about removing that magic.

It still mirrors the current `src/` tree, but there is one important shift now: this is no longer just an architecture walkthrough. The goal is to make each part concrete enough that you can rebuild the project from scratch, step by step, and compare your result with the staged snapshot folders.

## How to use this tutorial

Each part now has two jobs:

- explain why that layer exists
- tell you exactly what to build next

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

The snapshots are not there as separate examples. They are the verification path.

If a part says you should end up at `protoagent-tutorial-again-part-6`, that folder should represent the completed result of following Parts 1 through 6 in order.

One caveat: the late historical recreation path is not perfectly clean. Parts 1 through 10 behave like normal additive checkpoints. From Parts 11 through 13, the staged folders bunch some later features together earlier than the rewritten narrative ideally would, so those last chapters should be read as checkpoint interpretation plus verification, not perfectly isolated feature drops.

## Before you start

You'll want:

- Node.js 20+
- npm
- an API key for one of the supported providers
- basic TypeScript knowledge
- a terminal you are comfortable working in

You should also be willing to build this in order. The later parts assume the earlier wiring is already in place.

## What each part includes

Every part is being treated as a rebuild checkpoint. So each chapter includes:

- what that part adds
- which files to create or change
- the important implementation order
- what to verify before moving on
- which snapshot folder you should match

The idea is simple: you should be able to follow the tutorial from top to bottom, compare your work to the staged snapshots, and end up with the final app.

## The parts

### Foundation

1. **[Scaffolding](/tutorial/part-1)** — Commander, Ink, and the basic CLI shell
2. **[AI Integration](/tutorial/part-2)** — OpenAI SDK streaming and message flow
3. **[Configuration Management](/tutorial/part-3)** — provider/model selection, persisted config, and merged `protoagent.jsonc` runtime config

### Core runtime

4. **[The Agentic Loop](/tutorial/part-4)** — the tool-use loop, streaming events, retries, and termination
5. **[Core Tools: Files, TODOs, and Web Fetching](/tutorial/part-5)** — file tools first, then the broader non-shell tool family that later stages complete
6. **[Shell Commands & Approvals](/tutorial/part-6)** — `bash`, approval flow, and command safety tiers
7. **[System Prompt & Runtime Policy](/tutorial/part-7)** — project context, tool descriptions, and workflow rules that later skill-aware prompts build on
8. **[Compaction & Cost Tracking](/tutorial/part-8)** — token estimates, cost display, and long-context compaction

### Persistence and reuse

9. **[Skills](/tutorial/part-9)** — `SKILL.md` discovery, validation, and activation
10. **[Sessions](/tutorial/part-10)** — persisted conversations, TODO restore, and resume flows

### Extensibility

11. **[MCP Integration](/tutorial/part-11)** — understand and verify where MCP lands in the late staged recreation path
12. **[Sub-agents](/tutorial/part-12)** — understand and verify the sub-agent layer in the same late staged checkpoint band

### UI and operations

13. **[Polish, Rendering & Logging](/tutorial/part-13)** — approvals UI, grouped tool rendering, formatted output, slash commands, and logs

## Philosophy

ProtoAgent is still intentionally small, but it is not a toy anymore. It has persisted sessions, TODO state, web fetching, skills, MCP, sub-agents, compaction, and a richer terminal UI.

That is exactly why this tutorial exists. Once you understand the core loop and the runtime boundaries, the rest of the codebase stops feeling mysterious.

Now the bar is a little higher: by the end, the tutorial should not just make the codebase feel understandable. It should make it reproducible.

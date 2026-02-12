# Sub-agents

If you've used a coding agent for more than a few minutes, you've probably hit this problem: you ask the agent to explore something, it reads a bunch of files and does a bunch of searches, and by the time it's done, the context is so cluttered that it's forgotten what you were originally working on.

This is context pollution, and it's a real problem in long agent sessions.

## The fix: isolated child sessions

When the agent needs to do something self-contained — like "figure out how authentication works in this codebase" — it can spawn a sub-agent instead of doing the work in the main conversation. The sub-agent gets its own message history, does the work autonomously, and returns just the final answer. The parent's context stays clean.

Think of it like opening a new terminal tab to investigate something, then closing it and going back to what you were doing — but the agent does it automatically.

## How it works

1. The main agent calls the `sub_agent` tool with a description of what it needs done.
2. ProtoAgent creates a fresh conversation with its own system prompt and message history.
3. The child runs autonomously — no user interaction, no approval prompts — with a configurable iteration limit so it can't run forever.
4. When the child finishes, its final response comes back to the parent as a tool result.
5. The child's full message history is discarded, keeping the parent's context focused.

The parent agent sees a clean result like "Authentication is handled by middleware in `src/auth/`, using JWT tokens stored in HTTP-only cookies, with refresh token rotation." Instead of the 15 file reads and 8 searches it took to figure that out.

## When the agent uses sub-agents

Sub-agents are most useful for:

- **Exploration** — "understand how this module works"
- **Research** — "find all the places where we handle errors"
- **Independent subtasks** — "write tests for this function" while the parent continues other work

The agent decides when to use a sub-agent based on the system prompt guidelines. Generally, it reaches for one when the task is self-contained and the exploration would pollute the parent's context.

## Design details

A few things worth knowing:

- The child inherits the parent's tools and config — it can read files, run commands, everything the parent can do.
- There's a max iteration limit to prevent runaway sessions.
- The child runs in auto-approve mode (it inherits the parent's approval state) so it can work without blocking on user input.
- Sub-agent sessions can optionally be persisted for debugging, but by default they're discarded.

# Part 12: Sub-agents

Sub-agents solve a very specific problem: context pollution.

Sometimes the model needs to do a bunch of noisy work just to answer one focused question. It might search a repo, read ten files, follow imports, and compare a few implementations. That is all useful work, but you usually do not want every intermediate step sitting in the parent conversation forever.

So ProtoAgent pushes that work into a child run.

By the end, your project should match `protoagent-tutorial-again-part-12`.

## What you are building in this part

Starting from Part 11, you are adding the first real sub-agent layer:

- a `sub_agent` tool definition
- a child-run execution path
- isolated message history for child tasks
- parent-side handling for child summaries
- App startup wiring that makes the tool available to the model

This is the stage where the runtime becomes capable of doing noisy work off to the side instead of stuffing everything into the main conversation.

## Starting point

Copy your Part 11 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-12`

## Files to create or change

This stage mainly touches:

- `src/tools/sub-agent.ts`
- `src/agentic-loop.ts`
- `src/App.tsx`

This checkpoint is cumulative, so it still includes skills, sessions, MCP, compaction, and approvals from earlier parts. The new thing you are layering in here is delegation.

## Step 1: Define the `sub_agent` tool

The tool should let the model describe a focused child task and optionally set an iteration limit.

That tool is not just a normal tool wrapper around some utility function. It is the entrypoint into a whole child execution flow.

## Step 2: Create the child-run implementation

The child run should get:

- a fresh system prompt
- a fresh message history
- access to the normal tool stack
- its own iteration limit

The important rule is that the child should return only its final summary back to the parent.

In `protoagent-tutorial-again-part-12`, the child path calls back into the same runtime pieces instead of creating a completely separate runner abstraction. That keeps the stage understandable even if it is not the final architecture yet.

## Step 3: Update the main loop to special-case `sub_agent`

The parent loop should detect when the model called `sub_agent` and route it through the child execution path instead of the normal tool handler path.

That is what keeps the feature isolated rather than just another dynamic tool.

You also need to register the `sub_agent` tool during app startup so it is present in the tool list before the first completion begins.

## Verification

Run the app:

```bash
npm run dev
```

Then prompt it with something that would benefit from delegation, like:

```text
Investigate how `protoagent.jsonc` and `config.json` are loaded and summarize the flow.
```

If it worked, you should see:

- a `sub_agent` tool call
- child work happening in isolation
- only the child summary surfaced back to the parent transcript

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-12`

## Pitfalls

- forgetting to register `sub_agent` in the runtime before the first turn
- leaking child history into the parent transcript
- treating the child like a plain function call instead of its own loop
- forgetting to define a clear completion contract for the child result

## Core takeaway

Sub-agents are how ProtoAgent keeps the main thread cleaner without giving up the ability to do deep investigation.

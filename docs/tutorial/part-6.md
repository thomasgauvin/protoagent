# Part 6: Shell Commands & Approvals

Sooner or later, a coding agent needs the shell.

It needs to run tests, inspect git state, look at the filesystem, maybe run a build. But the moment you give an agent shell access, you also need a safety model that is more realistic than "I hope the model behaves."

That is what this part covers.

By the end, your project should match `protoagent-tutorial-again-part-6`.

## What you are building in this part

Starting from Part 5, you are adding:

- a `bash` tool
- shared approval state and approval callbacks
- a small shell safety model
- UI support for approval prompts

This is also the point where the runtime starts distinguishing between safe reads and risky actions.

## Starting point

Copy your Part 5 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-6`

## Files to create or change

This stage centers on:

- `src/tools/bash.ts`
- `src/utils/approval.ts`
- `src/tools/index.ts`
- `src/App.tsx`
- `src/cli.tsx`

## Step 1: Create `src/utils/approval.ts`

This file becomes the small shared runtime for approvals.

At this stage, it should define:

- the approval request shape
- the approval response type
- a way for tools to ask for approval
- a way for the UI to register the active approval handler
- session-level approval memory

This is the mechanism that lets tool code stay separate from Ink UI code while still pausing for approval when necessary.

## Step 2: Create `src/tools/bash.ts`

This stage adds shell execution with guardrails.

The staged snapshot introduces:

- a `bashTool` schema
- a `bash()` implementation
- explicit hard-blocked patterns
- a narrower list of commands that can run without approval
- timeout support

Even at this stage, the lesson is the same as in the current main app: shell access is useful, but it should never be treated as harmless by default.

## Step 3: Register `bash` in `src/tools/index.ts`

Add `bashTool` to the exported tool list and register a static handler for `bash`.

That turns the shell into a first-class tool instead of a special case.

## Step 4: Wire approvals into `src/App.tsx`

The app now needs a small approval UI state machine.

The historical stage sequence introduces approval state directly in `App.tsx`, including:

- the current approval request
- a resolver callback for the pending promise
- UI to approve once, approve for session, or reject

That keeps the tool-side runtime generic while the Ink app stays responsible for interaction.

## Step 5: Add the top-level bypass flag in `src/cli.tsx`

This stage also introduces:

- `--dangerously-accept-all`

That flag should disable normal approval prompts for writes, edits, and shell commands, while still leaving hard-blocked commands blocked.

## Verification

Run the app:

```bash
npm run dev
```

Then try prompts that force shell use, like:

```text
Run git status and summarize it.
```

```text
Run ls in the current directory.
```

If it worked, you should see:

- `bash` tool calls
- approval prompts for non-safe commands
- a final assistant answer grounded in command output

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-6`

## Pitfalls

- treating all shell commands as safe reads
- coupling tool logic directly to Ink components
- forgetting to clear approval state after a choice is made
- allowing `--dangerously-accept-all` to bypass hard-blocked commands

## Core takeaway

The shell layer is conservative on purpose. It still gives the agent enough power to do useful work, but it makes the model earn trust before it gets to run broader commands.

# Part 8: Compaction & Cost Tracking

Once an agent is useful, it starts running into a different class of problem: long sessions.

Every message, every tool result, every file read, every edit, every search result adds more context. At some point, you either measure that pressure and manage it, or the session quietly degrades.

By the end, your project should match `protoagent-tutorial-again-part-8`.

## What you are building in this part

Starting from Part 7, you are adding:

- token and cost estimation utilities
- context-window utilization tracking
- a compaction pass for oversized histories
- usage display in the UI

This is the stage where ProtoAgent starts acting like a tool built for longer sessions instead of one-shot prompts.

One staging note: the historical recreation path starts to bunch later features together after this point. So Part 8 is one of the last especially clean checkpoints in the staged sequence.

## Starting point

Copy your Part 7 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-8`

## Files to create or change

This stage centers on:

- `src/utils/cost-tracker.ts`
- `src/utils/compactor.ts`
- `src/agentic-loop.ts`
- `src/App.tsx`

## Step 1: Add token and cost tracking in `src/utils/cost-tracker.ts`

The stage snapshot introduces helper functions for:

- estimating tokens from text and message history
- reading provider/model pricing metadata
- computing estimated cost
- computing context utilization

The key idea is that the runtime should not be blind to how much context it is consuming.

## Step 2: Add history compaction in `src/utils/compactor.ts`

This file introduces the first long-context recovery strategy in the tutorial.

The staged version takes older conversation history and compresses it into a shorter summary while preserving the important state needed to keep the session coherent.

## Step 3: Call compaction from `src/agentic-loop.ts`

Before each model request, the loop should:

- estimate current usage
- decide whether compaction is needed
- compact the history before continuing if necessary

This is the first point where the loop becomes context-aware.

## Step 4: Emit and render usage information

The stage snapshot also adds a `usage` event and App-side state for:

- input tokens
- output tokens
- accumulated cost
- context percentage

That gives the UI a simple, visible readout of what the session is costing and how full the context window is getting.

## Verification

Run the app:

```bash
npm run dev
```

Then do a few multi-step prompts that trigger file reads and tool calls.

If it worked, you should see:

- usage information in the UI
- token and cost numbers increase across turns
- the loop remain usable over longer sessions

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-8`

## Pitfalls

- compacting too aggressively and losing useful context
- forgetting to preserve the top system message
- mixing estimated usage and real usage without labeling either correctly
- treating compaction as a UI concern instead of a loop concern

## Core takeaway

Compaction is what keeps a long coding session usable instead of quietly degrading once the context window fills up.

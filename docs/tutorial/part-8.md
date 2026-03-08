# Part 8: Compaction & Cost Tracking

Long-running coding-agent sessions need visibility into tokens, cost, and context pressure.

## Current implementation

The main pieces are:

- `src/utils/cost-tracker.ts`
- `src/utils/compactor.ts`
- usage handling in `src/agentic-loop.ts`
- usage display in `src/App.tsx`

## Cost tracking

ProtoAgent estimates tokens heuristically when exact provider usage is unavailable, using the provider/model pricing metadata from `src/providers.ts`.

The UI shows:

- input tokens
- output tokens
- current context percentage
- accumulated estimated cost

## Compaction

When conversation usage reaches roughly 90% of the model context window, ProtoAgent compacts older history.

The current compactor:

- preserves the active system prompt
- keeps the most recent messages verbatim
- summarizes older history into a compact state snapshot
- preserves activated skill payloads so important skill instructions are not lost

## Core takeaway

Compaction is what keeps a long coding session usable instead of quietly degrading once the context window fills up.

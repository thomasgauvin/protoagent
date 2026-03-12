# Sub-agents

Sub-agents exist for a pretty simple reason: long-running agent sessions get noisy.

If the model has to explore a bunch of files just to answer one focused question, the main conversation fills up with tool chatter that is useful in the moment and then mostly noise afterward.

Sub-agents move that work into an isolated child run.

## How it works

1. the main agent calls `sub_agent` with a `task` description
2. ProtoAgent creates a fresh child conversation with a new system prompt (the normal system prompt plus a sub-agent mode suffix)
3. the child uses the normal tool stack in that isolated context
4. only the child's final text answer comes back to the parent

This is useful for repo exploration, focused research, and independent subtasks.

## Implementation details

- `max_iterations` defaults to `30`
- child runs use the normal tool registry from `getAllTools()`
- `sub_agent` is not re-exposed recursively inside the child (the child cannot spawn its own sub-agents)
- child TODOs use an ephemeral session ID (`sub-agent-<uuid>`) and are cleared afterward
- child history is not persisted as a normal user-facing session
- the parent receives a progress callback for each tool call in the child (`running`, `done`, `error` status per iteration)

## Approvals

Sub-agents share the same process-level tool handlers, so writes, edits, and non-safe shell commands can still surface the normal approval UI.

## Why use them

Sub-agents reduce context pollution. A child can do the noisy work of exploring files and tools, while the parent keeps only the distilled result.

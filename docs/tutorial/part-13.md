# Part 13: Polish, Rendering & Logging

This is the part that takes ProtoAgent from "the loop technically works" to "I would actually use this for real work."

By the end, your project should match `protoagent-tutorial-again-part-13`.

## What you are building in this part

Starting from Part 12, you are converging onto the full final app.

That means this chapter is not just one isolated feature drop. `protoagent-tutorial-again-part-13` is the real end-state checkpoint, using the full current app source layout.

This final stage adds or sharpens:

- richer message rendering
- grouped tool-call rendering
- collapsible long output
- slash commands and interaction controls
- better formatted assistant output
- file-backed logging
- the full final module layout for sessions, MCP, runtime config, skills, sub-agents, and tools

## Starting point

Copy your Part 12 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-13`

## Files to create or change

This stage mainly touches:

- `src/App.tsx`
- `src/cli.tsx`
- `src/components/CollapsibleBox.tsx`
- `src/components/ConsolidatedToolMessage.tsx`
- `src/components/FormattedMessage.tsx`
- `src/components/Table.tsx`
- `src/utils/logger.ts`
- `src/utils/format-message.tsx`
- `src/tools/index.ts`
- top-level runtime modules like `src/sessions.ts`, `src/mcp.ts`, `src/skills.ts`, and `src/sub-agent.ts`

Practically, the easiest way to think about Part 13 is: this is where the staged rebuild stops being "one more checkpoint" and becomes the full app.

## Step 1: Move to the final app structure

Unlike the earlier stages, this one is intentionally a convergence step.

The final checkpoint uses the real top-level runtime layout:

- `src/sessions.ts` instead of the earlier `src/utils/sessions.ts`
- `src/mcp.ts` instead of the earlier `src/utils/mcp.ts`
- `src/runtime-config.ts` for merged `protoagent.jsonc` loading
- `src/skills.ts` and `src/sub-agent.ts` as first-class runtime modules
- a fuller `src/tools/index.ts` with TODO and `webfetch` support

That matches the real current app, which is exactly what the user asked for in the final snapshot.

## Step 2: Separate archived content from live streaming content

One of the most important rendering details in the final app is that archived messages and live in-flight content are not treated as the same thing.

That is a big reason the interface stays readable.

## Step 3: Improve tool rendering

Instead of showing every tool call as raw noise, group tool calls with their corresponding results and render them in a more deliberate way.

This is where the terminal UI starts feeling intentional instead of purely functional.

## Step 4: Add formatting helpers

The final UI adds formatting support for:

- fenced code blocks
- simple markdown-like structure
- tables
- long output previews with expansion

These are all readability features, but they materially change how usable the tool is in practice.

## Step 5: Add slash commands and controls

The modern UI also adds a control layer for:

- `/clear`
- `/expand`
- `/collapse`
- `/help`
- `/quit`
- `/exit`

Plus keyboard behavior like aborting a running completion.

## Step 6: Replace ad-hoc debug output with file-backed logging

The final main app no longer relies on scattered stderr debugging. It uses a file-backed logger with levels and an exposed log path.

That turns debugging from "look at random console noise" into something you can actually use over time.

In the full final app, logging is also woven back into the rest of the runtime: MCP startup, session saves, and other internal flows can all write to the same log file without wrecking the Ink UI.

## Verification

Run the app with logging enabled:

```bash
npm run dev -- --log-level DEBUG
```

If it worked, you should see:

- richer output rendering in the UI
- cleaner grouped tool activity
- a visible log file path
- slash command support
- the full final app building and running from this checkpoint

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-13`

## Pitfalls

- treating Part 13 like a tiny polish patch instead of a convergence-to-final-app step
- mixing live and archived content into one undifferentiated render path
- treating logging as stderr spam instead of a real runtime facility
- adding formatting features without keeping the terminal output scannable
- forgetting that polish also includes approvals, controls, sessions, and recovery paths

## Core takeaway

Polish is not just cosmetics. In ProtoAgent it is the layer that makes the tool loop readable, debuggable, and survivable over a long session - and in this rebuild path, it is also the point where the tutorial lands on the full final app instead of a partial approximation.

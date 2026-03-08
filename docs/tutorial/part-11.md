# Part 11: Polish & UI

The last layer is the one that makes ProtoAgent usable for longer sessions rather than only technically functional.

## Current implementation highlights

Most of this work lives in:

- `src/App.tsx`
- `src/components/CollapsibleBox.tsx`
- `src/components/ConsolidatedToolMessage.tsx`
- `src/components/FormattedMessage.tsx`
- `src/components/Table.tsx`
- `src/utils/logger.ts`
- `src/utils/format-message.tsx`

## What the current UI does

- groups tool calls with their following tool results
- collapses long content and supports `/expand` and `/collapse`
- renders simple markdown-style formatting, tables, and fenced code blocks
- shows inline approval prompts with selectable options
- displays usage and accumulated cost
- exposes inline setup and mid-session config flows

## Logging

Earlier versions described a stderr logger. The current implementation is file-backed instead.

ProtoAgent now:

- initializes a log file under the ProtoAgent data directory
- supports `ERROR`, `WARN`, `INFO`, `DEBUG`, and `TRACE`
- keeps a small in-memory recent-log buffer for UI use
- shows the active log file path in the interface

## TODO behavior

TODOs are no longer throwaway scratch state only. In the current app they are stored per session and persisted with session saves.

## Core takeaway

Polish is not just cosmetics. In ProtoAgent it includes readability, recoverability, visibility, and enough structure that a long tool-heavy session stays understandable.

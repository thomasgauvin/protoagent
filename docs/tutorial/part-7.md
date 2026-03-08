# Part 7: System Prompt

The system prompt tells ProtoAgent what it is, what project it is in, what tools exist, and how it should behave.

## Current implementation

Prompt generation lives in `src/system-prompt.ts`.

The prompt currently includes:

- working directory and project name
- a filtered directory tree
- auto-generated tool descriptions from the tool schemas
- a skills catalog when skills are available
- workflow and output-format guidance

## Directory tree

The tree builder caps depth and entry count so the prompt stays readable:

- max depth: 3
- max entries per directory: 20
- excludes noise like `node_modules`, `.git`, `dist`, and log files

## Tool descriptions

The prompt reads tool metadata from `getAllTools()`, so built-in tools and dynamic tools share one source of truth.

## Skills in the prompt

The current implementation does not eagerly inject every skill body. Instead it:

1. discovers skills
2. builds a catalog section
3. registers `activate_skill`
4. lets the model load a full skill only when needed

## One subtle mismatch

Some wording inside the prompt is broader than the runtime behavior, especially around auto-approved shell commands. The runtime implementation in `src/tools/bash.ts` is the real source of truth.

## Core takeaway

The system prompt is not static documentation. It is a runtime-generated contract between the app, the tool layer, and the model.

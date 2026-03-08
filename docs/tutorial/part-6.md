# Part 6: Shell Commands

The `bash` tool gives ProtoAgent access to the shell, but only through a safety layer.

## Current implementation

The shell tool lives in `src/tools/bash.ts`, and approval state lives in `src/utils/approval.ts`.

It uses three tiers:

1. hard-block dangerous patterns
2. auto-approve a narrow safe list
3. ask for approval for everything else

## Important current behavior

The safe list is intentionally narrower than many earlier tutorial versions suggested.

Current auto-approved examples include:

- `pwd`
- `whoami`
- `date`
- `git status`, `git log`, `git diff`, `git branch`, `git show`, `git remote`
- `npm list`, `npm ls`, `yarn list`
- version commands like `node --version`

Commands such as `ls`, `cat`, `grep`, `rg`, `find`, `awk`, and `sed` are not auto-approved in the current source.

## Approval scoping

Session approvals are keyed by session and scope. In practice that means:

- shell approvals are typically scoped to the exact command string
- file writes and edits are scoped to exact validated file paths

## Hard blocks

Patterns like `sudo`, `rm -rf /`, `dd if=`, `mkfs`, and `fdisk` are denied even with `--dangerously-accept-all`.

## Core takeaway

The current shell layer is conservative on purpose: it still enables real work, but it makes the model earn trust before running broader commands.

# Approvals

ProtoAgent asks for approval before operations that can modify files or run non-safe shell commands.

## What can trigger approval

In normal interactive use, these operations can prompt:

- `write_file`
- `edit_file`
- `bash` when the command is not auto-approved

The prompt offers three choices:

- approve once
- approve for session
- reject

## Session scoping

Session approval is not always a broad "approve all writes" grant.

In the current implementation, ProtoAgent often scopes session approvals to an exact path or exact shell command by using a session scope key:

- writes are scoped to the validated file path
- edits are scoped to the validated file path
- shell commands are scoped to the exact command string

If no scope key is provided, approval falls back to the operation type.

Approval choices are process-local and are not persisted when you resume a session later.

## Safe shell commands

Only a narrow set of commands is auto-approved. Examples include:

- `pwd`
- `whoami`
- `date`
- `git status`
- `git diff`
- `git log`
- `npm list`

Commands like `ls`, `cat`, `grep`, `rg`, and `find` are not currently in the safe list.

## Hard-blocked shell patterns

Some patterns are denied outright even with `--dangerously-accept-all`. Examples include:

- `rm -rf /`
- `sudo`
- `su `
- `dd if=`
- `mkfs`
- `fdisk`

## Global bypass

```bash
protoagent --dangerously-accept-all
```

This skips normal approval prompts for writes, edits, and non-safe shell commands, but it does not bypass the hard-blocked shell denylist.

## Fail-closed behavior

If no approval handler is registered, ProtoAgent rejects the operation rather than auto-approving it.

## Where approvals appear

Approvals are rendered inline in the Ink interface. The prompt includes a short description plus contextual detail such as the working directory, file preview, or command text.

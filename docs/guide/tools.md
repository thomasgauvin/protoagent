# Tools

Tools are how the agent interacts with the world. When you ask ProtoAgent to "fix the failing test," it doesn't just generate text — it reads the test file, reads the source, edits the code, and runs the tests again. Each of those actions is a tool call.

## How tools work

Every tool has two parts: a JSON schema that tells the LLM what the tool does and what parameters it needs, and a handler function that actually does the work. The LLM decides when to call a tool and generates the arguments — ProtoAgent executes it and feeds the result back.

This is the same pattern that OpenCode, Codex, and Claude Code all use. It's the standard way coding agents work.

## File tools

### read_file

Reads a file and returns its contents with line numbers. Supports offset and limit for large files — the agent doesn't need to read a 10,000 line file all at once.

### write_file

Creates a new file or overwrites an existing one. This requires your approval before it runs. Under the hood, it uses atomic writes (write to a temp file, then rename) so you don't end up with half-written files if something goes wrong.

### edit_file

Find-and-replace in an existing file. The agent provides the exact string to find and what to replace it with. It validates that the search string exists exactly once — if it's ambiguous, the edit fails and the agent has to be more specific. Also requires approval.

### list_directory

Lists the contents of a directory with `[FILE]` and `[DIR]` prefixes so the agent can tell what's what.

### search_files

Recursively searches for text across files. Supports case sensitivity and filtering by file extension. This is how the agent explores a codebase it hasn't seen before.

## Shell tool

### bash

Runs a shell command. This is where security gets important, so commands are classified into three tiers:

1. **Safe** (auto-approved): `ls`, `find`, `grep`, `git status`, `cat`, `pwd` — read-only stuff.
2. **Dangerous** (blocked): `rm -rf /`, `sudo`, `dd`, `mkfs` — things that could ruin your day.
3. **Everything else**: requires your approval. You can approve once, or approve for the rest of the session.

If you're feeling brave (or running in CI), the `--dangerously-accept-all` flag skips all prompts.

## Task tracking

### todo_read / todo_write

An in-memory task list the agent uses to plan multi-step work. When you ask it to do something complex — like "refactor this module and update the tests" — it breaks the work into steps and tracks its own progress. It's a simple tool, but it makes a real difference in how reliably the agent completes multi-step tasks.

## Path security

Every file tool validates that the target path resolves to within your current working directory. Symlinks are resolved before checking. The agent can't read your `~/.ssh` or write to `/etc` — it's restricted to the project you're working in.

## MCP tools

You can also add tools from external servers via [MCP](/guide/mcp). These show up alongside the built-in tools — the agent doesn't know or care whether a tool is built-in or comes from an MCP server.

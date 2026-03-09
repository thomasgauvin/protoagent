# Tools

Tools are how ProtoAgent actually gets work done.

When you ask it to fix a bug or understand a repo, it is not just generating text. It is reading files, searching code, editing content, running commands, fetching docs, and feeding those results back into the loop.

## How tools work

Each tool has two parts:

- a JSON schema shown to the model
- a handler function that actually does the work

When the model calls a tool, ProtoAgent executes it, captures the result, and adds that result back into the conversation.

## Built-in tools

ProtoAgent currently ships with:

- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `search_files`
- `bash`
- `todo_read`
- `todo_write`
- `webfetch`

Dynamic tools can also be registered by MCP servers, and the skills system can register `activate_skill` when skills are available.

## File tools

### `read_file`

This is the basic "show me what is in the file" tool. It returns line-numbered output and supports `offset` and `limit` so the model can inspect big files in chunks.

One small detail that matters: the schema describes `offset` as 0-based, while the returned line numbers are still 1-based.

### `write_file`

This creates or overwrites a file. In normal interactive use it requires approval, and it writes atomically through a temporary file plus rename.

There is also an important constraint in the current implementation: path validation requires the parent directory to already exist before the write happens.

### `edit_file`

This is the tool that makes the editing loop reliable. It performs exact-string find-and-replace, fails if the old string does not exist, and also fails if the actual occurrence count does not match `expected_replacements`.

Like `write_file`, it uses approval and an atomic temp-file swap.

### `list_directory`

Lists directory contents with `[DIR]` and `[FILE]` prefixes.

### `search_files`

Recursively searches files using regular-expression semantics, not literal-text matching. It supports optional extension filters, defaults to case-sensitive search, skips common build/noise directories, and caps results at 100 matches.

## Shell tool

### `bash`

The `bash` tool uses a three-tier safety model:

1. hard-blocked dangerous patterns are always denied
2. a narrow set of safe commands runs without approval
3. everything else asks for approval

The safe list is intentionally narrower than people usually expect. Current auto-approved commands include things like:

- `pwd`
- `whoami`
- `date`
- `git status`, `git log`, `git diff`, `git branch`, `git show`, `git remote`
- `npm list`, `npm ls`, `yarn list`
- version commands like `node --version`

Important detail: many common read-style commands such as `ls`, `cat`, `grep`, `rg`, `find`, `awk`, and `sed` are *not* auto-approved in the current implementation.

Hard-blocked patterns include commands such as `rm -rf /`, `sudo`, `dd if=`, `mkfs`, and `fdisk`.

## TODO tools

### `todo_read` and `todo_write`

These tools give the agent a structured scratchpad for multi-step work.

TODOs are stored per session in memory, and the main app also persists them with session state so they survive resume.

`todo_write` replaces the full list each time.

## Web fetching

### `webfetch`

This lets ProtoAgent fetch a single HTTP or HTTPS URL and return processed content as JSON.

Supported formats are:

- `text`
- `markdown`
- `html`

It returns structured output with fetched content plus request metadata, and it enforces URL, timeout, redirect, MIME, and response-size limits.

## Path security

File tools validate paths against the working directory and resolve symlinks before allowing access.

The skills system can also add discovered skill directories as extra allowed roots so bundled `scripts/`, `references/`, and `assets/` files can be accessed through the normal file tools.

## Approvals

Writes, edits, and non-safe shell commands all flow through the approval system.

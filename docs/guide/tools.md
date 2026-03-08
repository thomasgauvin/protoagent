# Tools

Tools are how ProtoAgent actually does work. The model can read files, edit code, run shell commands, fetch web content, update a TODO list, and call dynamically registered tools from MCP or the skills system.

## How tools work

Each tool has:

- a JSON schema shown to the model
- a handler function that performs the work

When the model calls a tool, ProtoAgent executes it, captures the result, and feeds that result back into the conversation.

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

Reads a file and returns line-numbered output. It supports `offset` and `limit` for chunked reads. The tool schema describes `offset` as 0-based, while returned line numbers stay 1-based.

### `write_file`

Creates or overwrites a file. It requires approval in normal interactive use, creates parent directories if needed, and writes atomically through a temporary file plus rename.

### `edit_file`

Performs exact-string find-and-replace in an existing file. It fails if the old string is missing or the occurrence count does not match `expected_replacements`. Like `write_file`, it uses approval plus an atomic temp-file swap.

### `list_directory`

Lists directory contents with `[DIR]` and `[FILE]` prefixes.

### `search_files`

Recursively searches files using a regular expression, not literal-text matching. It supports optional extension filtering, defaults to case-sensitive search, skips common build/noise directories, and caps results at 100 matches.

## Shell tool

### `bash`

`bash` uses a three-tier safety model:

1. hard-blocked dangerous patterns are always denied
2. a narrow set of safe commands runs without approval
3. everything else asks for approval

Current auto-approved commands are intentionally limited. They include things like:

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

These tools let the agent plan and track multi-step work. TODOs are stored per session in memory, and the main app also persists them with session state so they survive resume.

`todo_write` replaces the full list each time.

## Web fetching

### `webfetch`

Fetches a single HTTP or HTTPS URL and returns processed content as JSON. Supported formats are:

- `text`
- `markdown`
- `html`

See [Web Fetch](/guide/webfetch) for limits and return shape.

## Path security

File tools validate paths against the working directory and resolve symlinks before allowing access.

The skills system can also add discovered skill directories as extra readable roots so bundled `scripts/`, `references/`, and `assets/` files can be used safely.

## Approvals

Writes, edits, and non-safe shell commands all flow through the approval system. See [Approvals](/guide/approvals) for the exact behavior.

# Tools

Tools are how ProtoAgent actually gets work done.

When you ask it to fix a bug or understand a repo, it is not just generating text. It is reading files, searching code, editing content, running commands, fetching docs, and feeding those results back into the loop.

## How tools work

Each tool has two parts:

- a JSON schema shown to the model
- a handler function that actually does the work

When the model calls a tool, ProtoAgent executes it, captures the result, and adds that result back into the conversation.

## Built-in tools

ProtoAgent ships with 9 static tools:

- `read_file`
- `write_file`
- `edit_file`
- `list_directory`
- `search_files`
- `bash`
- `todo_read`
- `todo_write`
- `webfetch`

Dynamic tools are registered at runtime:

- `activate_skill` — registered when at least one valid skill is discovered
- `sub_agent` — exposed by the agentic loop (not part of the normal tool registry)
- `mcp_<server>_<tool>` — registered for each tool discovered from MCP servers

## File tools

### `read_file`

This is the basic "show me what is in the file" tool. It returns line-numbered output and supports `offset` and `limit` so the model can inspect big files in chunks.

It also records the read timestamp per session, which is used by the staleness guard in `edit_file`.

### `write_file`

This creates or overwrites a file. In normal interactive use it requires approval, and it writes atomically through a temporary file plus rename.

There is also an important constraint in the current implementation: path validation requires the parent directory to already exist before the write happens.

### `edit_file`

This is the tool that makes the editing loop reliable. It performs string find-and-replace with a 5-strategy fuzzy match cascade:

1. **exact** — verbatim string match
2. **line-trimmed** — per-line `.trim()` comparison, using the file's actual indentation
3. **indent-flexible** — strips common leading indent from both sides before comparing
4. **whitespace-normalized** — collapses all whitespace runs to single space
5. **trimmed-boundary** — trims the entire search string before matching

The edit fails if the old string is not found by any strategy, or if the actual occurrence count does not match `expected_replacements` (defaults to 1).

Like `write_file`, it requires approval and uses an atomic temp-file swap. It also returns a unified diff on success so the model can verify its edit.

### `list_directory`

Lists directory contents with `[DIR]` and `[FILE]` prefixes.

### `search_files`

Recursively searches files using regular-expression semantics, not literal-text matching. It tries to use `ripgrep` if available and falls back to a built-in JavaScript implementation. It supports optional extension filters, defaults to case-sensitive search, skips common build/noise directories, and caps results at 100 matches.

## Shell tool

### `bash`

The `bash` tool uses a three-tier safety model:

1. hard-blocked dangerous patterns are always denied
2. a narrow set of safe commands runs without approval
3. everything else asks for approval

The safe list is intentionally narrower than people usually expect. Current auto-approved commands include:

- `pwd`, `whoami`, `date`
- `git status`, `git log`, `git diff`, `git branch`, `git show`, `git remote`
- `npm list`, `npm ls`, `yarn list`
- version commands like `node --version`, `npm --version`, `python --version`, `python3 --version`

Important detail: many common read-style commands such as `ls`, `cat`, `grep`, `rg`, `find`, `awk`, `sed`, `sort`, `uniq`, `cut`, `wc`, `tree`, `file`, `dir`, `echo`, and `which` are *not* auto-approved in the current implementation. They are listed in the `UNSAFE_BASH_TOKENS` set and always require approval.

Commands with shell control operators (`;`, `&&`, `||`, `|`, `>`, `<`, `` ` ``, `$()`, `*`, `?`) also always require approval, even if the base command would normally be safe.

Hard-blocked patterns include commands such as `rm -rf /`, `sudo`, `su `, `chmod 777`, `dd if=`, `mkfs`, `fdisk`, and `format c:`.

The default timeout is 30 seconds. Long-running output is truncated at 50,000 characters.

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

Writes, edits, and non-safe shell commands all flow through the approval system. The three approval categories are:

- `file_write`
- `file_edit`
- `shell_command`

Approval can be granted per-operation (one-time), per-type for the session, or globally via `--dangerously-accept-all`. Hard-blocked shell patterns are still denied even with `--dangerously-accept-all`.

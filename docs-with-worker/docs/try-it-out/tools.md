# Tools

Tools are how ProtoAgent actually gets work done.

When you ask it to fix a bug or understand a repo, it is not just generating text. It is reading files, searching code, editing content, running commands, fetching docs, and feeding those results back into the loop.

## How tools work

Each tool has two parts:

- **JSON schema** — shown to the model in the system prompt. It describes the tool's name, a description of what it does, and a parameters object with types, required fields, and field descriptions.
- **Handler function** — the implementation that executes when the model calls the tool.

The model responds with tool calls containing the tool name and parameter values. ProtoAgent routes each call to its handler, captures the result, and appends a tool response message to the conversation. The model then uses that result to continue its work.

See the tutorial for implementing the tool system: [Part 4 - The Agentic Loop](/build-your-own/part-4), [Part 5 - Core Tools](/build-your-own/part-5)

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
- `sub_agent` — spawns isolated sub-agents for parallel work
- `mcp_<server>_<tool>` — registered for each tool discovered from MCP servers

## File tools

### `read_file`

This is the basic "show me what is in the file" tool. It returns raw file content and supports `offset` and `limit` so the model can inspect big files in chunks.

### `write_file`

This creates or overwrites a file. In normal interactive use it requires approval, and it writes atomically through a temporary file plus rename.

### `edit_file`

This performs string find-and-replace. The edit fails if the old string is not found, or if the actual occurrence count does not match `expected_replacements` (defaults to 1).

### `list_directory`

Lists directory contents with `[DIR]` and `[FILE]` prefixes.

### `search_files`

Recursively searches files using regular-expression semantics, not literal-text matching. It tries to use `ripgrep` if available and falls back to a built-in JavaScript implementation.

## Shell tool

### `bash`

The `bash` tool uses a three-tier safety model:

1. hard-blocked dangerous patterns are always denied
2. a narrow set of safe commands runs without approval
3. everything else asks for approval

The safe list is intentionally narrow. Current auto-approved commands include:

- `pwd`, `whoami`, `date`
- `git status`, `git log`, `git diff`, `git branch`, `git show`, `git remote`
- `npm list`, `npm ls`, `yarn list`
- version commands like `node --version`, `npm --version`, `python --version`, `python3 --version`

Important detail: many common read-style commands such as `ls`, `cat`, `grep`, `rg`, `find`, `awk`, `sed`, `sort`, `uniq`, `cut`, `wc`, `tree`, `file`, `dir`, `echo`, and `which` are *not* auto-approved. They always require approval.

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

- `text` — converts HTML to plain text using html-to-text
- `markdown` — converts HTML to Markdown using Turndown
- `html` — returns raw HTML

For text and markdown formats, HTML entities are decoded. Output is truncated to 2MB if necessary.

Limits:

- **Timeout:** 30 seconds default, maximum 120 seconds
- **Response size:** 5 MB maximum
- **Output size:** 2 MB maximum (after processing)
- **Redirects:** Maximum 5 redirects followed
- **URL scheme:** Only http:// and https:// allowed

## Path security

File tools validate paths against the working directory and resolve symlinks before allowing access. File operations are restricted to the working directory (where ProtoAgent was launched) plus any allowed skill roots.

The skills system can add discovered skill directories as extra allowed roots so bundled `scripts/`, `references/`, and `assets/` files can be accessed through the normal file tools.

## Approvals

Writes, edits, and non-safe shell commands all flow through the approval system. The three approval categories are:

- `file_write`
- `file_edit`
- `shell_command`

Approval can be granted per-operation (one-time), per-type for the session, or globally via `--dangerously-skip-permissions`. Hard-blocked shell patterns are still denied even with `--dangerously-skip-permissions`.

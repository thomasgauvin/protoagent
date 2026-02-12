# Part 5: File Tools

An agent that can't read or write files isn't very useful as a coding assistant. In this part, we give it the full set — read, write, edit, search, and list — with proper path security so it can't escape the project directory.

## What you'll build

- `read_file`, `write_file`, `edit_file`, `list_directory`, and `search_files` tools
- A path validation utility that restricts all operations to the current working directory
- User approval flow for writes and edits, integrated with the Ink UI

## Key concepts

- **Path security** — every file path gets resolved and checked against `cwd()`. Symlinks are resolved too, so you can't trick it with `../../../etc/passwd`.
- **Atomic writes** — write to a temp file, then rename. If something goes wrong mid-write, you don't end up with a half-written file.
- **Edit validation** — the find-and-replace edit tool validates that the search string exists exactly once. Ambiguous edits fail loudly rather than silently breaking things.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::

# Part 5: File Tools

File tools are how ProtoAgent reads and changes a local project safely.

## Current built-ins

The file-focused tools live in `src/tools/`:

- `read-file.ts`
- `write-file.ts`
- `edit-file.ts`
- `list-directory.ts`
- `search-files.ts`

Path validation lives in `src/utils/path-validation.ts`.

## What each tool does

### `read_file`

Reads a file, supports `offset` and `limit`, and returns line-numbered output.

### `write_file`

Creates or overwrites a file, asks for approval, creates parent directories, and writes atomically through a temp file.

### `edit_file`

Performs exact-string replacement, validates occurrence counts, asks for approval, and now also writes atomically through a temp file.

### `list_directory`

Returns directory entries with `[DIR]` and `[FILE]` prefixes.

### `search_files`

Recursively searches with regex semantics, optional extension filters, and a 100-result cap.

## Path safety

The current implementation validates file paths against the working directory, resolves symlinks, and can widen readable roots for skills.

## Core takeaway

The file tool layer is where ProtoAgent becomes useful on a real codebase: it can inspect, modify, and verify local files while still enforcing clear boundaries.

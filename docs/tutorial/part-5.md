# Part 5: Core Tools: Files, TODOs, and Web Fetching

By this point you have an agent loop, but it still is not very useful. A coding agent becomes practical the moment it can inspect a repo, change files, track a plan, and fetch outside context when it needs it.

That is what Part 5 is about.

There is one important staging note here: the historical snapshot sequence you asked me to preserve does not add TODOs and `webfetch` in the old Part 5 folder yet. So the actual staged rebuild checkpoint for `protoagent-tutorial-again-part-5` focuses on the core file tools first.

The richer TODO and web-fetch path lands later in the staged recreation path, even though they belong to the same broader non-shell tools family in the final product.

## What you are building in this part

Starting from Part 4, you are expanding the tool layer from a single `read_file` tool into a real file-oriented toolkit.

The stage snapshot adds:

- `write_file`
- `edit_file`
- `list_directory`
- `search_files`
- path validation helpers
- approval primitives used by file writes and edits

This is the stage where the runtime stops being "a tool-calling demo" and starts becoming useful on a local codebase.

## Starting point

Copy your Part 4 result and continue from there.

The target snapshot for this stage is:

- `protoagent-tutorial-again-part-5`

## Files to create or change

This stage expands `src/tools/` and adds file-safety helpers:

- `src/tools/index.ts`
- `src/tools/write-file.ts`
- `src/tools/edit-file.ts`
- `src/tools/list-directory.ts`
- `src/tools/search-files.ts`
- `src/utils/path-validation.ts`
- `src/utils/approval.ts`
- `src/App.tsx`

## Step 1: Expand the tool registry in `src/tools/index.ts`

In Part 4, the registry only exposed `read_file`.

Now it should export a `tools` array containing:

- `readFileTool`
- `writeFileTool`
- `editFileTool`
- `listDirectoryTool`
- `searchFilesTool`

And it should register static handlers for all five tools.

That is the key structural change for the part. Once that file is updated, the model can see and call the rest of the file toolkit.

## Step 2: Add `write_file`

Create `src/tools/write-file.ts`.

This stage introduces the ability to create or overwrite files. The historical snapshot sequence also introduces approval-aware behavior here, which is why this part needs `src/utils/approval.ts` and `src/utils/path-validation.ts` even before the shell tool arrives.

The important things this tool should do at this stage are:

- validate the target path
- block writes outside the working directory
- request approval before writing
- write the content to disk

Do not try to make this version perfect yet. The point is to establish the edit/write control points the runtime will use later.

## Step 3: Add `edit_file`

Create `src/tools/edit-file.ts`.

The stage version uses exact-string replacement rather than line-number-based edits.

That matters because exact-string replacement is much more stable in an agent loop. Once the model has read a file, it can refer back to the actual text instead of trying to reason about shifting line numbers.

At this stage, the tool should:

- validate the target path
- load the file
- replace `old_string` with `new_string`
- optionally check `expected_replacements`
- request approval before saving the result

## Step 4: Add `list_directory`

Create `src/tools/list-directory.ts`.

This tool gives the model a way to explore folder structure without reading full files. It should return a readable directory listing with `[DIR]` and `[FILE]` markers.

That is one of those simple tools that ends up getting used constantly.

## Step 5: Add `search_files`

Create `src/tools/search-files.ts`.

This is the first broad repo-discovery tool. It should:

- walk a directory tree
- search file contents
- support optional extension filtering
- return readable match output

This stage is still an early version, but it is the feature that makes the agent stop guessing where things live.

## Step 6: Add path validation in `src/utils/path-validation.ts`

This file introduces the first explicit file-safety boundary for the tutorial sequence.

At minimum, it should:

- resolve paths against the current working directory
- reject traversal outside the project root
- support file tools consistently

The current main app goes further than this, but the stage snapshot is already moving in the right direction.

## Step 7: Add approval plumbing in `src/utils/approval.ts`

The historical stage sequence starts introducing approval-aware file operations here.

That means you need a small shared approval mechanism that file tools can use. Even if the UI is still simple at this point, this is the right place to introduce the concept that some operations should not just run blindly.

## Step 8: Update `src/App.tsx`

This part also evolves the app state model a bit.

The snapshot uses:

- a stronger single-source-of-truth message flow
- temporary streaming UI state for live text and tool activity
- a more explicit system prompt that tells the model to use file tools frequently

That system prompt is still inline in `App.tsx` at this stage. It moves into its own runtime-generated file later.

## About TODOs and web fetching

The full modern ProtoAgent has `todo_read`, `todo_write`, and `webfetch`, and those are absolutely part of the current product.

But `protoagent-tutorial-again-part-5` does not contain them yet.

So for rebuild purposes, treat this part as:

- the file-tool expansion checkpoint
- the conceptual home of the broader non-shell tool family

That keeps the tutorial honest to the staged build path instead of pretending the old stage snapshot contains features it does not.

## Verification

Run the app and give it prompts that force it to inspect the repo.

```bash
npm run dev
```

Then try prompts like:

```text
List the files in src/tools.
```

```text
Search the project for the word Config.
```

```text
Read src/config.tsx and explain what it does.
```

If it worked, you should see:

- tool calls for `list_directory`, `search_files`, and `read_file`
- readable tool results in the UI
- final assistant answers grounded in those results

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-5`

## Pitfalls

- wiring the tool schemas into `tools[]` but forgetting to register the matching handlers
- letting path resolution escape the working directory
- trying to jump ahead to the final modern tool system instead of matching the staged checkpoint
- conflating committed message history with temporary streaming display state

## Core takeaway

This is the part where ProtoAgent stops being "an agent that can call tools" and becomes "an agent that can inspect and navigate a real codebase without immediately getting lost."

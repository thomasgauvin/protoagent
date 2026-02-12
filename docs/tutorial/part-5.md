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

## Path security first

Before we write any tools, we need to solve a fundamental problem: the LLM can ask to read or write any path it wants. If you pass `../../../etc/passwd` to `fs.readFile`, Node will happily try to open it. That's not great.

The fix lives in `src/utils/path-validation.ts`. Every file tool calls `validatePath()` before doing anything with the filesystem.

The function does two checks, not one. The first is straightforward — resolve the path against `process.cwd()`, normalize it, and make sure the result starts with the working directory:

```ts
const workingDirectory = process.cwd();

export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  // First check: is the normalised path within cwd?
  if (!normalized.startsWith(workingDirectory)) {
    throw new Error(`Path "${requestedPath}" is outside the working directory.`);
  }
```

That catches the obvious `../../` traversal attacks. But it doesn't catch symlinks. Someone could create a symlink inside the project that points to `/etc/passwd`, and the normalized path would look perfectly fine. So there's a second check — resolve the symlink and verify the *real* path is still inside the working directory:

```ts
  // Second check: resolve symlinks and re-check
  try {
    const realPath = await fs.realpath(normalized);
    if (!realPath.startsWith(workingDirectory)) {
      throw new Error(`Path "${requestedPath}" resolves (via symlink) outside the working directory.`);
    }
    return realPath;
  }
```

There's one wrinkle. When the agent creates a new file, `fs.realpath` fails with `ENOENT` because the file doesn't exist yet. You can't just skip the check — that would be a security hole. Instead, we validate the parent directory:

```ts
  catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — validate the parent directory instead
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        if (!realParent.startsWith(workingDirectory)) {
          throw new Error(`Parent directory of "${requestedPath}" resolves outside the working directory.`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(`Parent directory of "${requestedPath}" does not exist.`);
      }
    }
    throw err;
  }
}
```

If the parent directory is inside the working directory, the new file will be too. If the parent doesn't exist either, we throw — we're not going to create deeply nested directories based on LLM hallucinations.

There's also a `getWorkingDirectory()` export for tools that need to reference it.

## The tool pattern

Every file tool follows the same structure. Each file exports two things:

1. A **tool definition** — the JSON schema that gets sent to the LLM so it knows what parameters to provide.
2. A **handler function** — the actual implementation that runs when the LLM calls the tool.

Here's `read_file` as the simplest example:

```ts
export const readFileTool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read.' },
        offset: { type: 'number', description: 'Line number to start reading from (0-based).' },
        limit: { type: 'number', description: 'Maximum number of lines to read.' },
      },
      required: ['file_path'],
    },
  },
};

export async function readFile(filePath: string, offset = 0, limit = 2000): Promise<string> {
  const validated = await validatePath(filePath);
  const content = await fs.readFile(validated, 'utf8');
  // ... format with line numbers and return
}
```

The definition is just an OpenAI-compatible function schema. The description matters — it's what the LLM reads to decide when to use the tool and what arguments to pass. The handler always starts with `validatePath()`, does its work, and returns a string result.

Every tool follows this exact pattern. Definition object, handler function, `validatePath` first.

## write_file — atomic writes with approval

Writing files is where things get more interesting. You need two things beyond basic I/O: user approval (because you probably want to review what the agent is about to write) and atomic writes (because half-written files are worse than no write at all).

The tool definition in `src/tools/write-file.ts` is simple — just `file_path` and `content`, both required. The handler is where the work happens.

First, we build a preview for the approval prompt. If the content is over 500 characters, we show the first 250 and last 250 with a size indicator in the middle. Then we call `requestApproval`:

```ts
export async function writeFile(filePath: string, content: string): Promise<string> {
  const validated = await validatePath(filePath);

  // Request approval
  const preview = content.length > 500
    ? `${content.slice(0, 250)}\n... (${content.length} chars total) ...\n${content.slice(-250)}`
    : content;

  const approved = await requestApproval({
    id: `write-${Date.now()}`,
    type: 'file_write',
    description: `Write file: ${filePath}`,
    detail: preview,
  });

  if (!approved) {
    return `Operation cancelled: write to ${filePath} was rejected by user.`;
  }
```

The `requestApproval` function — which we set up in the approval utility — checks a few things in order: is `--dangerously-accept-all` enabled? Has the user already approved this type of operation for the session? If neither, it shows an interactive prompt in the Ink UI. The agent gets back a simple boolean.

If the user rejects, we return a message and the agent sees it rejected. No exception, no crash — just a string that says "nope." The LLM can decide what to do next.

After approval, we write the file. But not directly — we use the temp-file-then-rename pattern:

```ts
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(validated), { recursive: true });

  // Atomic write: write to temp file then rename
  const tmpPath = path.join(os.tmpdir(), `protoagent-${Date.now()}-${path.basename(validated)}`);
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, validated);

  const lines = content.split('\n').length;
  return `Successfully wrote ${lines} lines to ${filePath}`;
}
```

Why atomic writes? If you write directly to the target file and the process crashes mid-write — or the user hits Ctrl+C — you're left with a partial file. That can be worse than the original, especially if it was a config file or something the build depends on. With the temp-file approach, the `rename` call is atomic on most filesystems. Either the whole file appears at the target path, or it doesn't. No in-between state.

The `mkdir` with `recursive: true` handles the case where the agent is creating a file in a directory that doesn't exist yet. It won't fail if the directory already exists, and it'll create any missing parents.

## edit_file — find-and-replace done right

This is arguably the most important file tool. Agents edit files far more often than they create them from scratch, and the edit mechanism you choose has a huge impact on reliability.

Some coding agents use line-number-based editing — "replace lines 15-20 with this." The problem is that line numbers shift constantly. If the agent reads a file, then makes one edit, the line numbers for everything below that edit are now wrong. The second edit in the same turn frequently targets the wrong lines. It's fragile.

ProtoAgent uses find-and-replace instead. The agent provides `old_string` (the exact text to find) and `new_string` (what to replace it with). No line numbers. The text either matches or it doesn't.

Here's the key part from `src/tools/edit-file.ts` — the occurrence counting:

```ts
export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  expectedReplacements = 1
): Promise<string> {
  const validated = await validatePath(filePath);
  const content = await fs.readFile(validated, 'utf8');

  // Count occurrences
  let count = 0;
  let idx = 0;
  while ((idx = content.indexOf(oldString, idx)) !== -1) {
    count++;
    idx += oldString.length;
  }

  if (count === 0) {
    return `Error: old_string not found in ${filePath}. Make sure you read the file first and use the exact text.`;
  }

  if (count !== expectedReplacements) {
    return `Error: found ${count} occurrence(s) of old_string, but expected ${expectedReplacements}. Be more specific or set expected_replacements=${count}.`;
  }
```

Three things to notice here.

First, when `old_string` isn't found at all, the error message tells the agent to *read the file first*. This is deliberate — it nudges the LLM toward the right workflow. LLMs sometimes try to edit a file from memory without reading it first, and the content has drifted from what they expect. The error message is part of the tool's interface.

Second, the `expected_replacements` parameter defaults to 1. If the string appears three times but the agent only expects one, that's an error. The agent has to either be more specific with the search string or explicitly set `expected_replacements=3`. This prevents accidental mass replacements of common strings like `return null;`.

Third, we count occurrences using a manual `indexOf` loop instead of a regex. This is intentional — `old_string` is literal text from the file, which could contain regex special characters. We don't want `[` or `(` to be interpreted as regex syntax.

After validation, approval works the same way as `write_file` — show a diff-like preview, ask the user, proceed or bail:

```ts
  const approved = await requestApproval({
    id: `edit-${Date.now()}`,
    type: 'file_edit',
    description: `Edit file: ${filePath} (${count} replacement${count > 1 ? 's' : ''})`,
    detail: `Replace:\n${oldPreview}\n\nWith:\n${newPreview}`,
  });
```

The actual replacement uses `split().join()` — a simple way to replace all occurrences of a literal string without regex:

```ts
  const newContent = content.split(oldString).join(newString);
  await fs.writeFile(validated, newContent, 'utf8');
```

You'll notice `edit_file` doesn't use atomic writes the way `write_file` does. That's a reasonable tradeoff — edits are typically small changes to existing files, and the overhead of temp-file-then-rename matters less when you're modifying rather than creating. You could add it here too if you wanted the extra safety.

## list_directory and search_files

These two are read-only tools, so they're simpler — no approval flow needed.

`list_directory` in `src/tools/list-directory.ts` is about as minimal as a tool gets. It reads a directory with `withFileTypes` and formats each entry with a `[DIR]` or `[FILE]` prefix:

```ts
export async function listDirectory(directoryPath = '.'): Promise<string> {
  const validated = await validatePath(directoryPath);
  const entries = await fs.readdir(validated, { withFileTypes: true });

  const lines = entries.map((entry) => {
    const prefix = entry.isDirectory() ? '[DIR] ' : '[FILE]';
    return `${prefix} ${entry.name}`;
  });

  return `Contents of ${directoryPath} (${entries.length} entries):\n${lines.join('\n')}`;
}
```

The `directory_path` parameter defaults to `"."`, so the LLM can call it with no arguments to see the project root. The prefixes help the LLM distinguish files from directories without a follow-up call.

`search_files` in `src/tools/search-files.ts` is more involved. It does a recursive text search with a few practical constraints:

```ts
export async function searchFiles(
  searchTerm: string,
  directoryPath = '.',
  caseSensitive = true,
  fileExtensions?: string[]
): Promise<string> {
  const validated = await validatePath(directoryPath);
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegex(searchTerm), flags);

  const results: string[] = [];
  const MAX_RESULTS = 100;
```

A few design decisions worth calling out. The search term gets escaped before being compiled into a regex — so searching for `useState(` doesn't crash with a regex syntax error. There's a hard cap of 100 results, because dumping thousands of matches into the context window wastes tokens and confuses the LLM.

The recursive search skips directories you'd never want to search — `node_modules`, `.git`, `dist`, `build`, `coverage`, `__pycache__`:

```ts
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__'].includes(entry.name)) continue;
        await search(fullPath);
        continue;
      }
```

Results come back in `path:line: content` format — the same format as `grep` output, which LLMs are already familiar with from training data. Files that can't be read (binary files, permission issues) are silently skipped.

## Wiring tools into the registry

Each tool file exports its definition and handler independently, but the agentic loop needs a single list of tools and a single function to dispatch calls. That's what `src/tools/index.ts` does.

It imports everything and assembles two things. First, the `tools` array — all the tool definitions that get sent to the LLM:

```ts
import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';

export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  // ... plus bash, todo tools
];
```

Second, the `handleToolCall` dispatcher — a switch statement that routes tool names to their handler functions:

```ts
export async function handleToolCall(toolName: string, args: any): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit);
      case 'write_file':
        return await writeFile(args.file_path, args.content);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      // ...
      default: {
        const handler = dynamicHandlers.get(toolName);
        if (handler) {
          return await handler(args);
        }
        return `Error: Unknown tool "${toolName}"`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${toolName}: ${msg}`;
  }
}
```

The whole thing is wrapped in a try-catch. If a tool throws — path validation fails, file doesn't exist, whatever — the error gets caught and returned as a string. The agentic loop never crashes from a tool error. The LLM sees the error message and can decide what to do about it.

Notice the `default` branch checks `dynamicHandlers` — a `Map` that MCP tools and sub-agent tools register into at runtime. This is how the tool system stays extensible without the registry needing to know about every possible tool ahead of time. We'll get into that in later parts.

The registry also exports `getAllTools()`, which merges the static tool list with any dynamically registered tools. The agentic loop calls this when building its request to the LLM, so new tools appear automatically once registered.

---

Next up: [Part 6 — Shell Commands](/tutorial/part-6). We'll add the `bash` tool with a three-tier security model — safe commands auto-approve, dangerous commands get blocked, and everything in between asks the user.

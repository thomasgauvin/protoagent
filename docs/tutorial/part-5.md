# Part 5: Core Tools: Files, TODOs, and Web Fetching

This part expands your single `read_file` tool into a full toolkit: file writes, edits, directory listing, search, TODO tracking, and web fetching. It also introduces the path-validation and approval subsystems that every destructive tool uses.

## What you are building

Starting from Part 4, you add:

- `src/utils/path-validation.ts` — shared path security boundary
- `src/utils/approval.ts` — approval system for destructive operations
- `src/tools/write-file.ts` — create or overwrite files (with approval)
- `src/tools/edit-file.ts` — exact-string find-and-replace (with approval)
- `src/tools/list-directory.ts` — list directory contents
- `src/tools/search-files.ts` — recursive text search across files
- `src/tools/todo.ts` — in-memory task tracking for multi-step work
- `src/tools/webfetch.ts` — fetch and process web content
- Updated `src/tools/read-file.ts` — now uses the shared path-validation module
- Updated `src/tools/index.ts` — registers all 9 tools
- Updated `src/App.tsx` — adds approval UI and wires usage display

## Install new dependencies

```bash
npm install html-to-text turndown he
npm install -D @types/turndown @types/he
```

## Step 1: Path validation — `src/utils/path-validation.ts`

Every file tool resolves paths through this module. It ensures all operations stay inside the working directory and prevents symlink escape.

```typescript
// src/utils/path-validation.ts

import fs from 'node:fs/promises';
import path from 'node:path';

const workingDirectory = process.cwd();

export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  // First check: is the normalised path within cwd?
  const relative = path.relative(workingDirectory, normalized);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Path "${requestedPath}" is outside the working directory.`);
  }

  // Second check: resolve symlinks and re-check
  try {
    const realPath = await fs.realpath(normalized);
    const realRelative = path.relative(workingDirectory, realPath);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new Error(`Path "${requestedPath}" resolves (via symlink) outside the working directory.`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — validate the parent directory instead
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        const parentRelative = path.relative(workingDirectory, realParent);
        if (parentRelative.startsWith('..') || path.isAbsolute(parentRelative)) {
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

export function getWorkingDirectory(): string {
  return workingDirectory;
}
```

## Step 2: Approval system — `src/utils/approval.ts`

File writes, edits, and (later) shell commands all go through this system. Approval can be per-operation, per-session, or globally bypassed with `--dangerously-accept-all`.

```typescript
// src/utils/approval.ts

export type ApprovalRequest = {
  id: string;
  type: 'file_write' | 'file_edit' | 'shell_command';
  description: string;
  detail?: string;
  sessionId?: string;
  sessionScopeKey?: string;
};

export type ApprovalResponse = 'approve_once' | 'approve_session' | 'reject';

// Global state
let dangerouslyAcceptAll = false;
const sessionApprovals = new Set<string>();

// Callback that the Ink UI provides to handle interactive approval
let approvalHandler: ((req: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;

export function setDangerouslyAcceptAll(value: boolean): void {
  dangerouslyAcceptAll = value;
}

export function isDangerouslyAcceptAll(): boolean {
  return dangerouslyAcceptAll;
}

export function setApprovalHandler(handler: (req: ApprovalRequest) => Promise<ApprovalResponse>): void {
  approvalHandler = handler;
}

export function clearApprovalHandler(): void {
  approvalHandler = null;
}

export function clearSessionApprovals(): void {
  sessionApprovals.clear();
}

function getApprovalScopeKey(req: ApprovalRequest): string {
  const sessionId = req.sessionId ?? '__global__';
  const scope = req.sessionScopeKey ?? req.type;
  return `${sessionId}:${scope}`;
}

/**
 * Request approval for an operation. Returns true if approved.
 *
 * Check order:
 *  1. --dangerously-accept-all → auto-approve
 *  2. Session approval for this type → auto-approve
 *  3. Interactive prompt via the UI handler
 *  4. No handler registered → reject (fail closed)
 */
export async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (dangerouslyAcceptAll) return true;

  const sessionKey = getApprovalScopeKey(req);
  if (sessionApprovals.has(sessionKey)) return true;

  if (!approvalHandler) {
    return false;
  }

  const response = await approvalHandler(req);

  switch (response) {
    case 'approve_once':
      return true;
    case 'approve_session':
      sessionApprovals.add(sessionKey);
      return true;
    case 'reject':
      return false;
  }
}
```

## Step 3: `write_file` — `src/tools/write-file.ts`

Creates or overwrites a file. Requires approval. Uses atomic write (temp file + rename).

```typescript
// src/tools/write-file.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';

export const writeFileTool = {
  type: 'function' as const,
  function: {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with the given content. Prefer edit_file for modifying existing files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to write (relative to working directory).' },
        content: { type: 'string', description: 'The full content to write to the file.' },
      },
      required: ['file_path', 'content'],
    },
  },
};

export async function writeFile(filePath: string, content: string, sessionId?: string): Promise<string> {
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
    sessionId,
    sessionScopeKey: `file_write:${validated}`,
  });

  if (!approved) {
    return `Operation cancelled: write to ${filePath} was rejected by user.`;
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(validated), { recursive: true });

  // Atomic write: write to temp file then rename
  const tmpPath = path.join(path.dirname(validated), `.protoagent-write-${process.pid}-${Date.now()}-${path.basename(validated)}`);
  try {
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, validated);
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
  }

  const lines = content.split('\n').length;
  return `Successfully wrote ${lines} lines to ${filePath}`;
}
```

## Step 4: `edit_file` — `src/tools/edit-file.ts`

Find-and-replace using exact string matching. This version uses straightforward exact match — a fuzzy match cascade is added in Part 13.

```typescript
// src/tools/edit-file.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';

export const editFileTool = {
  type: 'function' as const,
  function: {
    name: 'edit_file',
    description:
      'Edit an existing file by replacing an exact string match with new content. ' +
      'The old_string must match exactly (including whitespace and indentation). ' +
      'Always read the file first to get the exact content to replace.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit.' },
        old_string: { type: 'string', description: 'The exact text to find and replace.' },
        new_string: { type: 'string', description: 'The text to replace it with.' },
        expected_replacements: {
          type: 'number',
          description: 'Expected number of replacements (default 1). Fails if actual count differs.',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  expectedReplacements = 1,
  sessionId?: string,
): Promise<string> {
  if (oldString.length === 0) {
    return 'Error: old_string cannot be empty.';
  }

  const validated = await validatePath(filePath);
  const content = await fs.readFile(validated, 'utf8');

  // Check if old_string exists in the file
  const count = countOccurrences(content, oldString);

  if (count === 0) {
    return `Error: old_string not found in ${filePath}. Re-read the file and try again.`;
  }

  if (count !== expectedReplacements) {
    return `Error: found ${count} occurrence(s) of old_string, but expected ${expectedReplacements}. Be more specific or set expected_replacements=${count}.`;
  }

  // Request approval
  const oldPreview = oldString.length > 200 ? oldString.slice(0, 200) + '...' : oldString;
  const newPreview = newString.length > 200 ? newString.slice(0, 200) + '...' : newString;

  const approved = await requestApproval({
    id: `edit-${Date.now()}`,
    type: 'file_edit',
    description: `Edit file: ${filePath} (${count} replacement${count > 1 ? 's' : ''})`,
    detail: `Replace:\n${oldPreview}\n\nWith:\n${newPreview}`,
    sessionId,
    sessionScopeKey: `file_edit:${validated}`,
  });

  if (!approved) {
    return `Operation cancelled: edit to ${filePath} was rejected by user.`;
  }

  // Perform replacement
  const newContent = content.split(oldString).join(newString);
  const directory = path.dirname(validated);
  const tempPath = path.join(directory, `.protoagent-edit-${process.pid}-${Date.now()}-${path.basename(validated)}`);
  try {
    await fs.writeFile(tempPath, newContent, 'utf8');
    await fs.rename(tempPath, validated);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }

  return `Successfully edited ${filePath}: ${count} replacement(s) made.`;
}
```

## Step 5: `list_directory` — `src/tools/list-directory.ts`

Simple directory listing with `[DIR]` and `[FILE]` markers.

```typescript
// src/tools/list-directory.ts

import fs from 'node:fs/promises';
import { validatePath } from '../utils/path-validation.js';

export const listDirectoryTool = {
  type: 'function' as const,
  function: {
    name: 'list_directory',
    description: 'List the contents of a directory. Returns entries with [FILE] or [DIR] prefixes.',
    parameters: {
      type: 'object',
      properties: {
        directory_path: {
          type: 'string',
          description: 'Path to the directory to list (relative to working directory). Defaults to ".".',
        },
      },
      required: [],
    },
  },
};

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

## Step 6: `search_files` — `src/tools/search-files.ts`

Recursive text search. This version uses a pure JS directory walk. Ripgrep support is added in Part 13.

```typescript
// src/tools/search-files.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';

export const searchFilesTool = {
  type: 'function' as const,
  function: {
    name: 'search_files',
    description: 'Search for a text pattern across files in a directory (recursive). Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'The text or regex pattern to search for.' },
        directory_path: { type: 'string', description: 'Directory to search in. Defaults to ".".' },
        file_extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by file extensions, e.g. [".ts", ".js"]. Searches all files if omitted.',
        },
        case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive. Defaults to true.' },
      },
      required: ['search_term'],
    },
  },
};

const MAX_RESULTS = 100;

export async function searchFiles(
  searchTerm: string,
  directoryPath = '.',
  caseSensitive = true,
  fileExtensions?: string[]
): Promise<string> {
  const validated = await validatePath(directoryPath);

  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(searchTerm, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: invalid regex pattern "${searchTerm}": ${message}`;
  }

  const results: string[] = [];

  async function search(dir: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;

      const fullPath = path.join(dir, entry.name);

      // Skip common non-useful directories
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage', '__pycache__'].includes(entry.name)) continue;
        await search(fullPath);
        continue;
      }

      // Filter by extension
      if (fileExtensions && fileExtensions.length > 0) {
        const ext = path.extname(entry.name);
        if (!fileExtensions.includes(ext)) continue;
      }

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            const relativePath = path.relative(validated, fullPath);
            let lineContent = lines[i].trim();

            if (lineContent.length > 500) {
              lineContent = lineContent.slice(0, 500) + '... (truncated)';
            }

            results.push(`${relativePath}:${i + 1}: ${lineContent}`);
          }
          regex.lastIndex = 0;
        }
      } catch {
        // Skip files we can't read (binary, permission issues)
      }
    }
  }

  await search(validated);

  if (results.length === 0) {
    return `No matches found for "${searchTerm}" in ${directoryPath}`;
  }

  const suffix = results.length >= MAX_RESULTS ? `\n(results truncated at ${MAX_RESULTS})` : '';
  return `Found ${results.length} match(es) for "${searchTerm}":\n${results.join('\n')}${suffix}`;
}
```

## Step 7: TODO tools — `src/tools/todo.ts`

In-memory task tracking for multi-step work. The agent uses these to plan work and track progress. TODOs are stored per session.

```typescript
// src/tools/todo.ts

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

const DEFAULT_SESSION_ID = '__default__';

const todosBySession = new Map<string, TodoItem[]>();

function getSessionKey(sessionId?: string): string {
  return sessionId ?? DEFAULT_SESSION_ID;
}

function cloneTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map((todo) => ({ ...todo }));
}

function formatTodos(todos: TodoItem[], heading: string): string {
  if (todos.length === 0) {
    return `${heading}\nNo TODOs.`;
  }

  const statusIcons: Record<TodoItem['status'], string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  const lines = todos.map((t) => `${statusIcons[t.status]} [${t.priority}] ${t.content} (${t.id})`);
  return `${heading}\n${lines.join('\n')}`;
}

export const todoReadTool = {
  type: 'function' as const,
  function: {
    name: 'todo_read',
    description: 'Read the current TODO list to check progress on tasks.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const todoWriteTool = {
  type: 'function' as const,
  function: {
    name: 'todo_write',
    description: 'Replace the TODO list with an updated version. Use this to plan tasks, update progress, and mark items complete.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete updated TODO list.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the item.' },
              content: { type: 'string', description: 'Description of the task.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Current status.',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level.',
              },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

export function readTodos(sessionId?: string): string {
  const todos = todosBySession.get(getSessionKey(sessionId)) ?? [];
  return formatTodos(todos, `TODO List (${todos.length} items):`);
}

export function writeTodos(newTodos: TodoItem[], sessionId?: string): string {
  const todos = cloneTodos(newTodos);
  todosBySession.set(getSessionKey(sessionId), todos);
  return formatTodos(todos, `TODO List Updated (${todos.length} items):`);
}

export function getTodosForSession(sessionId?: string): TodoItem[] {
  return cloneTodos(todosBySession.get(getSessionKey(sessionId)) ?? []);
}

export function setTodosForSession(sessionId: string, todos: TodoItem[]): void {
  todosBySession.set(getSessionKey(sessionId), cloneTodos(todos));
}

export function clearTodos(sessionId?: string): void {
  todosBySession.delete(getSessionKey(sessionId));
}
```

## Step 8: Web fetch — `src/tools/webfetch.ts`

Fetch and process web content with HTML-to-text/markdown conversion, size limits, and redirect handling.

```typescript
// src/tools/webfetch.ts

import { convert } from 'html-to-text';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 10;
const MAX_URL_LENGTH = 4096;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

const TEXT_MIME_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
];

// Lazy-loaded Turndown instance
let _turndownService: any = null;
async function getTurndownService() {
  if (!_turndownService) {
    const { default: TurndownService } = await import('turndown');
    _turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*',
    });
    _turndownService.remove(['script', 'style', 'meta', 'link']);
  }
  return _turndownService;
}

// Lazy-loaded he module
let _he: any = null;
async function getHe() {
  if (!_he) {
    const { default: he } = await import('he');
    _he = he;
  }
  return _he;
}

function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.some((type) => mimeType.includes(type));
}

function detectHTML(content: string, contentType: string): boolean {
  if (contentType.includes('text/html')) return true;
  const trimmed = content.slice(0, 1024).trim().toLowerCase();
  return /^<!doctype html|^<html|^<head|^<body|^<meta/.test(trimmed);
}

function parseCharset(contentType: string): string {
  const match = contentType.match(/charset=([^\s;]+)/i);
  if (match) {
    const charset = match[1].replace(/['"]/g, '');
    try {
      new TextDecoder(charset);
      return charset;
    } catch {
      return 'utf-8';
    }
  }
  return 'utf-8';
}

function truncateOutput(output: string, maxSize: number): string {
  if (output.length > maxSize) {
    const truncatedSize = Math.max(100, maxSize - 100);
    return (
      output.slice(0, truncatedSize) +
      `\n\n[Content truncated: ${output.length} characters exceeds ${maxSize} limit]`
    );
  }
  return output;
}

export const webfetchTool = {
  type: 'function' as const,
  function: {
    name: 'webfetch',
    description: 'Fetch and process content from a web URL. Supports text (plain text extraction), markdown (HTML to markdown conversion), or html (raw HTML) output formats.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP(S) URL to fetch (must start with http:// or https://)',
        },
        format: {
          type: 'string',
          enum: ['text', 'markdown', 'html'],
          description: 'Output format: text (plain text), markdown (HTML to markdown), or html (raw HTML)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default 30, min 1, max 120)',
        },
      },
      required: ['url', 'format'],
    },
  },
};

function htmlToText(html: string): string {
  try {
    return convert(html, {
      wordwrap: 120,
      selectors: [
        { selector: 'img', options: { ignoreHref: true } },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    });
  } catch {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  try {
    const turndown = await getTurndownService();
    return turndown.turndown(html);
  } catch {
    return `\`\`\`html\n${html}\n\`\`\``;
  }
}

async function fetchWithRedirectLimit(url: string, signal: AbortSignal): Promise<Response> {
  let redirectCount = 0;
  let currentUrl = url;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await fetch(currentUrl, {
      signal,
      headers: FETCH_HEADERS,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        redirectCount++;
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
    }

    return response;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

export async function webfetch(
  url: string,
  format: 'text' | 'markdown' | 'html',
  timeout?: number,
): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Invalid URL format. Must start with http:// or https://');
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`URL too long (${url.length} characters, max ${MAX_URL_LENGTH})`);
  }

  const timeoutSeconds = Math.min(timeout ?? 30, 120);
  if (timeoutSeconds < 1) {
    throw new Error('Timeout must be between 1 and 120 seconds');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const startTime = Date.now();
    const response = await fetchWithRedirectLimit(url, controller.signal);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} error: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (exceeds 5MB limit).`);
    }

    const contentType = response.headers.get('content-type') ?? 'text/plain';

    if (!isTextMimeType(contentType)) {
      throw new Error(`Content type '${contentType}' is not supported.`);
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (exceeds 5MB limit).`);
    }

    const charset = parseCharset(contentType);
    const decoder = new TextDecoder(charset, { fatal: false });
    const content = decoder.decode(arrayBuffer);
    const isHTML = detectHTML(content, contentType);

    let output: string;
    if (format === 'text') {
      output = isHTML ? htmlToText(content) : content;
    } else if (format === 'markdown') {
      output = isHTML ? await htmlToMarkdown(content) : `\`\`\`\n${content}\n\`\`\``;
    } else {
      output = content;
    }

    if (format !== 'html') {
      const he = await getHe();
      output = he.decode(output);
    }

    output = truncateOutput(output, MAX_OUTPUT_SIZE);

    const fetchTime = Date.now() - startTime;
    return {
      output,
      title: `${url} (${contentType})`,
      metadata: { url, format, contentType, charset, contentLength: arrayBuffer.byteLength, outputLength: output.length, fetchTime },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Fetch timeout after ${timeoutSeconds} seconds`);
    }
    if (error instanceof Error) throw error;
    throw new Error(`Failed to fetch ${url}: ${String(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## Step 9: Update `read_file` — `src/tools/read-file.ts`

Update to use the shared path-validation module instead of inline validation.

```typescript
// src/tools/read-file.ts

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import { validatePath } from '../utils/path-validation.js';

export const readFileTool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers. Use offset and limit to read specific sections of large files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read (relative to working directory).' },
        offset: { type: 'number', description: 'Line number to start reading from (0-based). Defaults to 0.' },
        limit: { type: 'number', description: 'Maximum number of lines to read. Defaults to 2000.' },
      },
      required: ['file_path'],
    },
  },
};

export async function readFile(filePath: string, offset = 0, limit = 2000, sessionId?: string): Promise<string> {
  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      return `File not found: '${filePath}'`;
    }
    throw err;
  }

  const start = Math.max(0, offset);
  const maxLines = Math.max(0, limit);
  const lines: string[] = [];
  let totalLines = 0;

  const stream = createReadStream(validated, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lineReader) {
      if (totalLines >= start && lines.length < maxLines) {
        lines.push(line);
      }
      totalLines++;
    }

    const stats = await fs.stat(validated);
    if (stats.size === 0) {
      totalLines = 0;
    } else if (lines.length === 0 && totalLines === 0) {
      totalLines = 1;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  const end = Math.min(totalLines, start + lines.length);

  const numbered = lines.map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, ' ');
    const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
    return `${lineNum} | ${truncated}`;
  });

  const rangeLabel = lines.length === 0
    ? 'none'
    : `${Math.min(start + 1, totalLines)}-${end}`;
  const header = `File: ${filePath} (${totalLines} lines total, showing ${rangeLabel})`;
  return `${header}\n${numbered.join('\n')}`;
}
```

## Step 10: Update tool registry — `src/tools/index.ts`

Register all 9 tools and their handlers.

```typescript
// src/tools/index.ts

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslyAcceptAll, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
}

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  todoReadTool,
  todoWriteTool,
  webfetchTool,
];

// Dispatch a tool call to the appropriate handler.
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
      case 'write_file':
        return await writeFile(args.file_path, args.content, context.sessionId);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'todo_read':
        return readTodos(context.sessionId);
      case 'todo_write':
        return writeTodos(args.todos, context.sessionId);
      case 'webfetch': {
        const result = await webfetch(args.url, args.format, args.timeout);
        return JSON.stringify(result);
      }
      default:
        return `Error: Unknown tool "${toolName}"`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${toolName}: ${msg}`;
  }
}
```

## Step 11: Update `src/App.tsx`

The main changes: wire up the approval handler so `write_file` and `edit_file` can request user approval, and add the `ApprovalPrompt` component.

Replace your `App.tsx` with this version. Key additions over Part 4:

- `ApprovalPrompt` component for interactive approval
- `setApprovalHandler` wired up in initialization
- `pendingApproval` state to manage approval flow
- Usage display stub for cost tracking (wired fully in Part 8)

```typescript
// src/App.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getProvider } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';
import { setDangerouslyAcceptAll, setApprovalHandler, clearApprovalHandler } from './tools/index.js';
import type { ApprovalRequest, ApprovalResponse } from './utils/approval.js';

export interface AppProps {
  dangerouslyAcceptAll?: boolean;
}

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? `Missing API key for ${providerName}. Set it in config or export ${envVar}.`
        : `Missing API key for ${providerName}.`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };

  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim();
  const baseURL = baseURLOverride || provider?.baseURL;
  if (baseURL) {
    clientOptions.baseURL = baseURL;
  }

  return new OpenAI(clientOptions);
}

/** Interactive approval prompt rendered inline. */
const ApprovalPrompt: React.FC<{
  request: ApprovalRequest;
  onRespond: (response: ApprovalResponse) => void;
}> = ({ request, onRespond }) => {
  const sessionApprovalLabel = request.sessionScopeKey
    ? 'Approve this operation for session'
    : `Approve all "${request.type}" for session`;

  const items = [
    { label: 'Approve once', value: 'approve_once' as const },
    { label: sessionApprovalLabel, value: 'approve_session' as const },
    { label: 'Reject', value: 'reject' as const },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginY={1}>
      <Text color="green" bold>Approval Required</Text>
      <Text>{request.description}</Text>
      {request.detail && (
        <Text dimColor>{request.detail.length > 200 ? request.detail.slice(0, 200) + '...' : request.detail}</Text>
      )}
      <Box marginTop={1}>
        <Select
          options={items.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onRespond(value as ApprovalResponse)}
        />
      </Box>
    </Box>
  );
};

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{
  onComplete: (config: Config) => void;
}> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}:::${model.id}`,
    })),
  );

  if (setupStep === 'provider') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>First-time setup</Text>
        <Text dimColor>Select a provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setSetupStep('api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>
        Selected: {provider?.name} / {selectedModelId}
      </Text>
      <Text>{hasResolvedAuth ? 'Optional API key:' : 'Enter your API key:'}</Text>
      {apiKeyError && <Text color="red">{apiKeyError}</Text>}
      <PasswordInput
        placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : `Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={(value) => {
          if (value.trim().length === 0 && !hasResolvedAuth) {
            setApiKeyError('API key cannot be empty.');
            return;
          }
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
          };
          writeConfig(newConfig);
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

export const App: React.FC<AppProps> = ({ dangerouslyAcceptAll = false }) => {
  const { exit } = useApp();

  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [inputResetKey, setInputResetKey] = useState(0);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  const clientRef = useRef<OpenAI | null>(null);

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);
    clientRef.current = buildClient(loadedConfig);

    const initialMessages = await initializeMessages();
    setCompletionMessages(initialMessages);
    setNeedsSetup(false);
    setInitialized(true);
  }, []);

  useEffect(() => {
    const init = async () => {
      if (dangerouslyAcceptAll) {
        setDangerouslyAcceptAll(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      const loadedConfig = readConfig();
      if (!loadedConfig) {
        setNeedsSetup(true);
        return;
      }

      await initializeWithConfig(loadedConfig);
    };

    init().catch((err) => {
      setError(`Initialization failed: ${err.message}`);
    });

    return () => {
      clearApprovalHandler();
    };
  }, []);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !clientRef.current || !config) return;

    setInputText('');
    setInputResetKey((prev) => prev + 1);
    setLoading(true);
    setError(null);

    const userMessage: Message = { role: 'user', content: trimmed };
    setCompletionMessages((prev) => [...prev, userMessage]);

    try {
      const updatedMessages = await runAgenticLoop(
        clientRef.current,
        config.model,
        [...completionMessages, userMessage],
        trimmed,
        (event: AgentEvent) => {
          switch (event.type) {
            case 'text_delta':
              setCompletionMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (event.content || '') }];
                }
                return [...prev, { role: 'assistant', content: event.content || '' }];
              });
              break;
            case 'tool_call':
              if (event.toolCall) {
                setCompletionMessages((prev) => {
                  const assistantMsg = {
                    role: 'assistant' as const,
                    content: '',
                    tool_calls: [{
                      id: event.toolCall!.id,
                      type: 'function' as const,
                      function: { name: event.toolCall!.name, arguments: event.toolCall!.args },
                    }],
                  };
                  return [...prev, assistantMsg as any];
                });
              }
              break;
            case 'tool_result':
              if (event.toolCall) {
                setCompletionMessages((prev) => [
                  ...prev,
                  {
                    role: 'tool',
                    tool_call_id: event.toolCall!.id,
                    content: event.toolCall!.result || '',
                  } as any,
                ]);
              }
              break;
            case 'error':
              setError(event.error || 'Unknown error');
              break;
            case 'done':
              break;
          }
        },
      );

      setCompletionMessages(updatedMessages);
    } catch (err: any) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [loading, config, completionMessages]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>
          Model: {providerInfo?.name || config.provider} / {config.model}
          {dangerouslyAcceptAll && <Text color="red"> (auto-approve all)</Text>}
        </Text>
      )}

      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {needsSetup && (
        <InlineSetup
          onComplete={(newConfig) => {
            initializeWithConfig(newConfig).catch((err) => {
              setError(`Initialization failed: ${err.message}`);
            });
          }}
        />
      )}

      <Box flexDirection="column" flexGrow={1}>
        {completionMessages.map((msg, index) => {
          const displayContent = 'content' in msg && typeof msg.content === 'string' ? msg.content : null;
          const msgAny = msg as any;
          const isToolCall = msg.role === 'assistant' && msgAny.tool_calls?.length > 0;

          if (msg.role === 'system') {
            return (
              <Box key={index} marginBottom={1}>
                <Text dimColor>[System prompt loaded]</Text>
              </Box>
            );
          }

          if (msg.role === 'user') {
            return (
              <Box key={index} flexDirection="column">
                <Text>
                  <Text color="green" bold>{'> '}</Text>
                  <Text>{displayContent}</Text>
                </Text>
              </Box>
            );
          }

          if (isToolCall) {
            return (
              <Box key={index} flexDirection="column">
                {msgAny.tool_calls.map((tc: any) => (
                  <Text key={tc.id} dimColor>
                    Tool: {tc.function?.name}({tc.function?.arguments?.slice(0, 100)})
                  </Text>
                ))}
              </Box>
            );
          }

          if (msg.role === 'tool') {
            const content = displayContent || '';
            return (
              <Box key={index} flexDirection="column">
                <Text dimColor>
                  {content.length > 200 ? content.slice(0, 200) + '...' : content}
                </Text>
              </Box>
            );
          }

          return (
            <Box key={index} flexDirection="column">
              <Text>{displayContent}</Text>
            </Box>
          );
        })}

        {loading && <Text dimColor>Working...</Text>}

        {/* Approval prompt */}
        {pendingApproval && (
          <ApprovalPrompt
            request={pendingApproval.request}
            onRespond={(response) => {
              pendingApproval.resolve(response);
              setPendingApproval(null);
            }}
          />
        )}
      </Box>

      {/* Input */}
      {initialized && !pendingApproval && (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Box width={2} flexShrink={0}>
            <Text color="green" bold>{'>'}</Text>
          </Box>
          <Box flexGrow={1}>
            <TextInput
              key={inputResetKey}
              defaultValue={inputText}
              onChange={setInputText}
              placeholder="Type your message..."
              onSubmit={handleSubmit}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
```

## Verification

```bash
npm run dev
```

Try prompts that exercise the new tools:

- `List the files in src/tools` — uses `list_directory`
- `Search the project for the word "Config"` — uses `search_files`
- `Read src/config.tsx and explain what it does` — uses `read_file`
- `Create a file called test.txt with "hello world"` — uses `write_file` (triggers approval)
- `Read test.txt and change "hello" to "goodbye"` — uses `read_file` then `edit_file` (triggers approval)

You should see approval prompts for write and edit operations (unless using `--dangerously-accept-all`).

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-5`.

## Core takeaway

This is where ProtoAgent stops being a chat demo and becomes a real coding agent. The approval system ensures destructive operations are always gated, and path validation prevents the agent from escaping the project directory.

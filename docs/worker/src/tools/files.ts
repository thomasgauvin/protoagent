/**
 * SQLite-backed file system tools with fuzzy matching for edit_file
 */

import { createPatch } from 'diff';
import type { ToolDefinition } from '../types.js';

// ───────────────────────────────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────────────────────────────

export interface FileStore {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  list(dir?: string): Promise<{ name: string; type: 'file' | 'dir' }[]>;
  delete(path: string): Promise<boolean>;
  getAllPaths(): Promise<string[]>;
}

// ───────────────────────────────────────────────────────────────────────────────
// Path Utilities
// ───────────────────────────────────────────────────────────────────────────────

function normalizePath(path: string): string {
  // Remove leading slashes
  let normalized = path.replace(/^\/+/, '');

  // Prevent path traversal attacks
  const parts = normalized.split('/');
  const safeParts: string[] = [];

  for (const part of parts) {
    if (part === '..') {
      // Path traversal attempt - skip this part
      continue;
    }
    if (part && part !== '.') {
      safeParts.push(part);
    }
  }

  return safeParts.join('/');
}

function validatePath(path: string): { valid: boolean; normalized: string; error?: string } {
  const normalized = normalizePath(path);

  if (!normalized) {
    return { valid: false, normalized: '', error: 'Invalid path: path cannot be empty' };
  }

  if (path.includes('..')) {
    return { valid: false, normalized, error: 'Invalid path: path traversal detected' };
  }

  return { valid: true, normalized };
}

// ───────────────────────────────────────────────────────────────────────────────
// Fuzzy Match Strategies for edit_file
// ───────────────────────────────────────────────────────────────────────────────

interface MatchStrategy {
  name: string;
  findMatch(content: string, oldString: string): string | null;
}

const exactReplacer: MatchStrategy = {
  name: 'exact',
  findMatch(content, oldString) {
    return content.includes(oldString) ? oldString : null;
  },
};

const lineTrimmedReplacer: MatchStrategy = {
  name: 'line-trimmed',
  findMatch(content, oldString) {
    const searchLines = oldString.split('\n').map(l => l.trim());
    const contentLines = content.split('\n');

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (contentLines[i + j].trim() !== searchLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        return contentLines.slice(i, i + searchLines.length).join('\n');
      }
    }
    return null;
  },
};

const indentFlexReplacer: MatchStrategy = {
  name: 'indent-flexible',
  findMatch(content, oldString) {
    const oldLines = oldString.split('\n');
    const commonIndent = getCommonIndent(oldLines);
    if (commonIndent === 0) return null;

    const stripped = oldLines.map(l => l.slice(commonIndent)).join('\n');
    const contentLines = content.split('\n');

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const fileSlice = contentLines.slice(i, i + oldLines.length);
      const fileCommonIndent = getCommonIndent(fileSlice);
      const fileStripped = fileSlice.map(l => l.slice(fileCommonIndent)).join('\n');

      if (fileStripped === stripped) {
        return fileSlice.join('\n');
      }
    }
    return null;
  },
};

const whitespaceNormReplacer: MatchStrategy = {
  name: 'whitespace-normalized',
  findMatch(content, oldString) {
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const target = normalize(oldString);
    if (!target) return null;

    const contentLines = content.split('\n');
    const oldLineCount = oldString.split('\n').length;

    for (let i = 0; i <= contentLines.length - oldLineCount; i++) {
      const window = contentLines.slice(i, i + oldLineCount).join('\n');
      if (normalize(window) === target) {
        return window;
      }
    }
    return null;
  },
};

const trimmedBoundaryReplacer: MatchStrategy = {
  name: 'trimmed-boundary',
  findMatch(content, oldString) {
    const trimmed = oldString.trim();
    if (trimmed === oldString) return null;
    return content.includes(trimmed) ? trimmed : null;
  },
};

const STRATEGIES: MatchStrategy[] = [
  exactReplacer,
  lineTrimmedReplacer,
  indentFlexReplacer,
  whitespaceNormReplacer,
  trimmedBoundaryReplacer,
];

function getCommonIndent(lines: string[]): number {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const indent = line.length - line.trimStart().length;
    min = Math.min(min, indent);
  }
  return min === Infinity ? 0 : min;
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

function findWithCascade(
  content: string,
  oldString: string,
  expectedReplacements: number
): { actual: string; strategy: string; count: number } | null {
  for (const strategy of STRATEGIES) {
    const actual = strategy.findMatch(content, oldString);
    if (!actual) continue;

    const count = countOccurrences(content, actual);
    if (count === expectedReplacements) {
      return { actual, strategy: strategy.name, count };
    }
  }
  return null;
}

function computeUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  const patch = createPatch(filePath, oldContent, newContent, 'a/' + filePath, 'b/' + filePath);
  // Remove the header lines we don't need and truncate if too large
  const lines = patch.split('\n').slice(4); // Remove 'Index:', '===' and '---'/'+++' lines

  // Truncate if too large (more than 50 changed lines)
  const changedLines = lines.filter(l => l.startsWith('+') || l.startsWith('-')).length;
  if (changedLines > 50) {
    const truncatedIndex = lines.findIndex((line, idx) => {
      if (idx < 10) return false;
      const changedSoFar = lines.slice(0, idx).filter(l => l.startsWith('+') || l.startsWith('-')).length;
      return changedSoFar >= 50;
    });
    if (truncatedIndex !== -1) {
      return lines.slice(0, truncatedIndex).join('\n') + '\n... (truncated)';
    }
  }

  return lines.join('\n');
}

// ───────────────────────────────────────────────────────────────────────────────
// Tool Definitions
// ───────────────────────────────────────────────────────────────────────────────

export function createFileTools(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read the contents of a file. Returns truncated content for large files (use offset/limit for full content).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file (relative to workspace root)' },
            offset: { type: 'number', description: 'Line number to start from (1-indexed)' },
            limit: { type: 'number', description: 'Max lines to read' },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create or overwrite a file with the given content. Prefer edit_file for modifying existing files.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file (relative to workspace root)' },
            content: { type: 'string', description: 'Content to write' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'edit_file',
        description: 'Edit an existing file by replacing an exact string match with new content. The old_string must match exactly (including whitespace and indentation). Always read the file first to get the exact content to replace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file (relative to workspace root)' },
            old_string: { type: 'string', description: 'Exact text to find and replace' },
            new_string: { type: 'string', description: 'New text to insert' },
            expected_replacements: { type: 'number', description: 'Expected number of replacements (default 1). Fails if actual count differs.' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'list_directory',
        description: 'List the contents of a directory. Returns entries with [FILE] or [DIR] prefixes.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path (default: root)' },
          },
        },
      },
    },
  ];
}

// ───────────────────────────────────────────────────────────────────────────────
// Tool Handlers
// ───────────────────────────────────────────────────────────────────────────────

export async function handleFileTool(
  name: string,
  args: Record<string, unknown>,
  store: FileStore
): Promise<string> {
  switch (name) {
    case 'read_file': {
      const pathValidation = validatePath(String(args.path));
      if (!pathValidation.valid) {
        return `Error: ${pathValidation.error}`;
      }

      const content = await store.read(pathValidation.normalized);
      if (content === undefined) {
        return `Error: File not found: ${args.path}`;
      }

      const lines = content.split('\n');
      const offset = Math.max(0, (args.offset as number || 1) - 1);
      const limit = args.limit as number || 500;

      if (offset >= lines.length) {
        return `Error: Offset ${args.offset} is beyond end of file (${lines.length} lines)`;
      }

      const end = Math.min(offset + limit, lines.length);
      const result = lines.slice(offset, end).join('\n');

      if (end < lines.length) {
        return result + `\n\n[Showing lines ${offset + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.]`;
      }
      return result;
    }

    case 'write_file': {
      const pathValidation = validatePath(String(args.path));
      if (!pathValidation.valid) {
        return `Error: ${pathValidation.error}`;
      }

      const content = String(args.content);
      await store.write(pathValidation.normalized, content);
      return `Successfully wrote ${content.length} bytes to ${args.path}`;
    }

    case 'edit_file': {
      const pathValidation = validatePath(String(args.path));
      if (!pathValidation.valid) {
        return `Error: ${pathValidation.error}`;
      }

      const oldString = String(args.old_string);
      const newString = String(args.new_string);
      const expectedReplacements = (args.expected_replacements as number) || 1;

      if (oldString.length === 0) {
        return 'Error: old_string cannot be empty.';
      }

      const content = await store.read(pathValidation.normalized);
      if (content === undefined) {
        return `Error: File not found: ${args.path}`;
      }

      const match = findWithCascade(content, oldString, expectedReplacements);

      if (!match) {
        // Check if we found it with wrong count
        for (const strategy of STRATEGIES) {
          const actual = strategy.findMatch(content, oldString);
          if (actual) {
            const count = countOccurrences(content, actual);
            return `Error: found ${count} occurrence(s) of old_string (via ${strategy.name} match), but expected ${expectedReplacements}. Be more specific or set expected_replacements=${count}.`;
          }
        }

        // Build diagnostic
        const searchLines = oldString.split('\n');
        const contentLines = content.split('\n');
        const diagnostics: string[] = [];

        for (const strategy of STRATEGIES) {
          let bestWindowStart = -1;
          let bestMatchedLines = 0;

          for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
            let matched = 0;
            for (let j = 0; j < searchLines.length; j++) {
              const fileLine = strategy.name === 'whitespace-normalized'
                ? contentLines[i + j].replace(/\s+/g, ' ').trim()
                : contentLines[i + j].trim();
              const searchLine = strategy.name === 'whitespace-normalized'
                ? searchLines[j].replace(/\s+/g, ' ').trim()
                : searchLines[j].trim();
              if (fileLine === searchLine) matched++;
            }
            if (matched > bestMatchedLines) {
              bestMatchedLines = matched;
              bestWindowStart = i;
            }
          }

          if (bestWindowStart >= 0 && bestMatchedLines > 0 && bestMatchedLines < searchLines.length) {
            const diffLines: string[] = [];
            const MAX_DIFFS = 6;
            for (let j = 0; j < searchLines.length && diffLines.length < MAX_DIFFS; j++) {
              const fileLine = contentLines[bestWindowStart + j] ?? '(end of file)';
              const searchLine = searchLines[j];
              const fileNorm = strategy.name === 'whitespace-normalized'
                ? fileLine.replace(/\s+/g, ' ').trim()
                : fileLine.trim();
              const searchNorm = strategy.name === 'whitespace-normalized'
                ? searchLine.replace(/\s+/g, ' ').trim()
                : searchLine.trim();
              if (fileNorm !== searchNorm) {
                diffLines.push(
                  `    line ${bestWindowStart + j + 1}:\n` +
                  `      yours: ${searchLine.trim().slice(0, 120)}\n` +
                  `      file:  ${fileLine.trim().slice(0, 120)}`
                );
              }
            }
            const truncNote = diffLines.length === MAX_DIFFS ? `\n    ... (more diffs not shown)` : '';
            diagnostics.push(
              `  ${strategy.name}: ${bestMatchedLines}/${searchLines.length} lines match, ${searchLines.length - bestMatchedLines} differ:\n` +
              diffLines.join('\n') + truncNote
            );
          } else if (bestMatchedLines === 0) {
            diagnostics.push(`  ${strategy.name}: no lines matched — old_string may be from a different file or heavily rewritten`);
          }
        }

        const hint = diagnostics.length > 0
          ? '\nDiagnostics per strategy:\n' + diagnostics.join('\n')
          : '';
        return `Error: old_string not found in ${args.path}.${hint}\nDo NOT retry with a guess. Call read_file on ${args.path} first to get the exact current content, then construct old_string by copying verbatim from the file.`;
      }

      const { actual, strategy, count } = match;

      // Perform replacement
      const newContent = content.split(actual).join(newString);
      await store.write(pathValidation.normalized, newContent);

      // Compute unified diff
      const diff = computeUnifiedDiff(content, newContent, String(args.path));
      const header = `Successfully edited ${args.path}: ${count} replacement(s) made${strategy !== 'exact' ? ` [matched via ${strategy}]` : ''}.`;

      if (diff) {
        return `${header}\n${diff}`;
      }
      return header;
    }

    case 'list_directory': {
      const dirPath = String(args.path || '');
      const pathValidation = validatePath(dirPath);
      // Allow empty path for root, otherwise validate
      if (dirPath && !pathValidation.valid) {
        return `Error: ${pathValidation.error}`;
      }

      const entries = await store.list(dirPath);
      if (entries.length === 0) {
        return '(empty directory)';
      }

      return entries.map(e => {
        const prefix = e.type === 'dir' ? '[DIR] ' : '[FILE] ';
        return prefix + e.name;
      }).join('\n');
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

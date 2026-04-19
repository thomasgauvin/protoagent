/**
 * search_files tool — Recursive text search across files.
 *
 * Uses ripgrep (rg) when available for fast, .gitignore-aware searching.
 * Falls back to a pure JS recursive directory walk if rg is not found.
 */

import fs from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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

// Detect ripgrep availability at module load
let hasRipgrep = false;
try {
  execFileSync('rg', ['--version'], { stdio: 'pipe' });
  hasRipgrep = true;
} catch {
  // ripgrep not available, will use JS fallback
}

const MAX_RESULTS = 100;
const MAX_PATTERN_LENGTH = 1000;



// Directories to skip during recursive search
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.nox',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.hypothesis',
  '.next',
  'out',
  '.turbo',
  '.cache',
]);

// Track visited inodes to detect symlink cycles
interface SearchResult {
  display: string;
  mtime: number;
}

export async function searchFiles(
  searchTerm: string,
  directoryPath = '.',
  caseSensitive = true,
  fileExtensions?: string[],
  abortSignal?: AbortSignal,
): Promise<string> {
  // Check abort before starting
  if (abortSignal?.aborted) {
    return 'Error: Operation aborted by user.';
  }

  const validated = await validatePath(directoryPath);

  // Security: Validate pattern to prevent ReDoS (Catastrophic Backtracking)
  // Attack: Pattern (a+)+$ with input 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' causes exponential backtracking
  // In JS fallback, this hangs the process for minutes/hours with 100% CPU
  if (searchTerm.length > MAX_PATTERN_LENGTH) {
    return `Error: Pattern too long (${searchTerm.length} chars, max ${MAX_PATTERN_LENGTH})`;
  }

  if (hasRipgrep) {
    return searchWithRipgrep(searchTerm, validated, directoryPath, caseSensitive, fileExtensions, abortSignal);
  }
  return searchWithJs(searchTerm, validated, directoryPath, caseSensitive, fileExtensions, abortSignal);
}

// ─── Ripgrep implementation ───

async function searchWithRipgrep(
  searchTerm: string,
  validated: string,
  directoryPath: string,
  caseSensitive: boolean,
  fileExtensions?: string[],
  abortSignal?: AbortSignal,
): Promise<string> {
  const args: string[] = [
    '--line-number',
    '--with-filename',
    '--no-heading',
    '--color=never',
    '--max-filesize=1M',
  ];

  if (!caseSensitive) {
    args.push('--ignore-case');
  }

  if (fileExtensions && fileExtensions.length > 0) {
    for (const ext of fileExtensions) {
      // rg glob expects *.ext format
      const globExt = ext.startsWith('.') ? `*${ext}` : `*.${ext}`;
      args.push(`--glob=${globExt}`);
    }
  }

  args.push('--regexp', searchTerm, validated);

  // Check abort before executing ripgrep
  if (abortSignal?.aborted) {
    return 'Error: Operation aborted by user.';
  }

  try {
    const output = execFileSync('rg', args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
      // Note: execFileSync doesn't support AbortSignal directly
      // but the timeout handles most cases
    });

    const lines = output.trim().split('\n').filter(Boolean);

    if (lines.length === 0) {
      return `No matches found for "${searchTerm}" in ${directoryPath}`;
    }

    // Parse rg output and sort by mtime
    const parsed: SearchResult[] = [];
    for (const line of lines.slice(0, MAX_RESULTS)) {
      // rg output: filepath:linenum:content
      const firstColon = line.indexOf(':');
      const secondColon = line.indexOf(':', firstColon + 1);
      if (firstColon === -1 || secondColon === -1) continue;

      const filePath = line.slice(0, firstColon);
      const lineNum = line.slice(firstColon + 1, secondColon);
      let content = line.slice(secondColon + 1).trim();

      if (content.length > 500) {
        content = content.slice(0, 500) + '... (truncated)';
      }

      const relativePath = path.relative(validated, filePath);
      let mtime = 0;
      try {
        const stats = await stat(filePath);
        mtime = stats.mtimeMs;
      } catch { /* ignore stat errors */ }

      parsed.push({ display: `${relativePath}:${lineNum}: ${content}`, mtime });
    }

    // Sort by mtime descending (most recently modified first)
    parsed.sort((a, b) => b.mtime - a.mtime);

    const results = parsed.map(r => r.display);
    const suffix = lines.length > MAX_RESULTS ? `\n(results truncated at ${MAX_RESULTS})` : '';
    return `Found ${results.length} match(es) for "${searchTerm}":\n${results.join('\n')}${suffix}`;

  } catch (err: any) {
    // rg exits with code 1 if no matches found (not an error)
    if (err.status === 1) {
      return `No matches found for "${searchTerm}" in ${directoryPath}`;
    }
    // rg exits with code 2 for actual errors
    if (err.status === 2) {
      const msg = err.stderr?.toString() || err.message;
      return `Error: ripgrep error: ${msg}`;
    }
    // Fall back to JS search on any other error
    return searchWithJs(searchTerm, validated, directoryPath, caseSensitive, fileExtensions, abortSignal);
  }
}

// ─── JS fallback implementation ───

async function searchWithJs(
  searchTerm: string,
  validated: string,
  directoryPath: string,
  caseSensitive: boolean,
  fileExtensions?: string[],
  abortSignal?: AbortSignal,
): Promise<string> {
  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(searchTerm, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: invalid regex pattern "${searchTerm}": ${message}`;
  }

  const results: SearchResult[] = [];
  const visitedInodes = new Set<string>();

  async function search(dir: string): Promise<void> {
    // Check abort periodically during directory traversal
    if (abortSignal?.aborted) {
      return;
    }

    if (results.length >= MAX_RESULTS) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;

      const fullPath = path.join(dir, entry.name);

      // Skip symlinks to prevent cycles
      if (entry.isSymbolicLink()) {
        continue;
      }

      // Skip common non-useful directories
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;

        // Track inode to detect hardlink cycles
        try {
          const stats = await fs.stat(fullPath);
          const inodeKey = `${stats.dev}:${stats.ino}`;
          if (visitedInodes.has(inodeKey)) {
            continue; // Already visited this directory
          }
          visitedInodes.add(inodeKey);
        } catch {
          // If we can't stat, skip to be safe
          continue;
        }

        await search(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      // Filter by extension
      if (fileExtensions && fileExtensions.length > 0) {
        const ext = path.extname(entry.name);
        if (!fileExtensions.includes(ext)) continue;
      }

      try {
        // Check abort before reading each file
        if (abortSignal?.aborted) {
          return;
        }

        const content = await fs.readFile(fullPath, 'utf8');
        const stats = await stat(fullPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          // Check abort periodically during line processing
          if (i % 100 === 0 && abortSignal?.aborted) {
            return;
          }
          if (regex.test(lines[i])) {
            const relativePath = path.relative(validated, fullPath);
            let lineContent = lines[i].trim();

            // Truncate long lines
            if (lineContent.length > 500) {
              lineContent = lineContent.slice(0, 500) + '... (truncated)';
            }

            results.push({
              display: `${relativePath}:${i + 1}: ${lineContent}`,
              mtime: stats.mtimeMs,
            });
          }
          regex.lastIndex = 0; // reset regex state
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

  // Sort by mtime descending (most recently modified first)
  results.sort((a, b) => b.mtime - a.mtime);

  const displayResults = results.map(r => r.display);
  const suffix = results.length >= MAX_RESULTS ? `\n(results truncated at ${MAX_RESULTS})` : '';
  return `Found ${results.length} match(es) for "${searchTerm}":\n${displayResults.join('\n')}${suffix}`;
}

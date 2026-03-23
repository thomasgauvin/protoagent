// src/tools/search-files.ts

import fs from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';

// Define the tool metadata for the LLM
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
const MAX_PATTERN_LENGTH = 1000;

// Security: Simple regex complexity check to prevent ReDoS
// Naive approach: Only check pattern length, not complexity
// Attack: Pattern (a+)+$ causes exponential backtracking
function isSafeRegex(pattern: string): boolean {
  const dangerousPatterns = [
    /\([^)]*\+[^)]*\)\+/,     // (a+)+ or similar
    /\([^)]*\*[^)]*\)\*/,     // (a*)* or similar
    /\([^)]*\+[^)]*\)\*/,     // (a+)* or similar
    /\([^)]*\*[^)]*\)\+/,     // (a*)+ or similar
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return false;
    }
  }

  const quantifierCount = (pattern.match(/[+*?{}]/g) || []).length;
  if (quantifierCount > 10) {
    return false;
  }

  return true;
}

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
  fileExtensions?: string[]
): Promise<string> {
  const validated = await validatePath(directoryPath);

  // Security: Validate pattern to prevent ReDoS (Catastrophic Backtracking)
  // Naive approach: Only check pattern length, not complexity
  // Attack: Pattern (a+)+$ with input 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' causes exponential backtracking
  if (searchTerm.length > MAX_PATTERN_LENGTH) {
    return `Error: Pattern too long (${searchTerm.length} chars, max ${MAX_PATTERN_LENGTH})`;
  }

  if (!isSafeRegex(searchTerm)) {
    return `Error: Pattern too complex (potential ReDoS attack). Avoid nested quantifiers like (a+)+ or (a*)*`;
  }

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
        const content = await fs.readFile(fullPath, 'utf8');
        const stats = await stat(fullPath);
        const lines = content.split('\n');
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            const relativePath = path.relative(validated, fullPath);
            let lineContent = lines[i].trim();

            if (lineContent.length > 500) {
              lineContent = lineContent.slice(0, 500) + '... (truncated)';
            }

            results.push({
              display: `${relativePath}:${i + 1}: ${lineContent}`,
              mtime: stats.mtimeMs,
            });
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

  // Sort by mtime descending (most recently modified first)
  results.sort((a, b) => b.mtime - a.mtime);

  const displayResults = results.map(r => r.display);
  const suffix = results.length >= MAX_RESULTS ? `\n(results truncated at ${MAX_RESULTS})` : '';
  return `Found ${results.length} match(es) for "${searchTerm}":\n${displayResults.join('\n')}${suffix}`;
}

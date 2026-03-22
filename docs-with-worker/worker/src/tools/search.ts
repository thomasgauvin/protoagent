/**
 * search_files tool - Search for text patterns in the virtual filesystem
 */

import type { ToolDefinition } from '../types.js';
import type { FileStore } from './files.js';

const MAX_RESULTS = 100;
const MAX_FILE_SIZE = 1024 * 1024; // 1MB - skip files larger than this

export const searchFilesTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_files',
    description: 'Search for a text pattern across files in a directory (recursive). Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        search_term: {
          type: 'string',
          description: 'The text or regex pattern to search for.',
        },
        directory_path: {
          type: 'string',
          description: 'Directory to search in. Defaults to ".".',
        },
        file_extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by file extensions, e.g. [".ts", ".js"]. Searches all files if omitted.',
        },
        case_sensitive: {
          type: 'boolean',
          description: 'Whether the search is case-sensitive. Defaults to true.',
        },
      },
      required: ['search_term'],
    },
  },
};

function normalizePath(path: string): string {
  let normalized = path.replace(/^\/+/, '');
  const parts = normalized.split('/');
  const safeParts: string[] = [];

  for (const part of parts) {
    if (part === '..') continue;
    if (part && part !== '.') {
      safeParts.push(part);
    }
  }

  return safeParts.join('/');
}

function isBinaryContent(content: string): boolean {
  // Check for null bytes which indicate binary content
  return content.includes('\x00');
}

function matchesExtension(filePath: string, extensions: string[]): boolean {
  const ext = filePath.includes('.') ? '.' + filePath.split('.').pop() : '';
  return extensions.includes(ext);
}

export async function searchFiles(
  searchTerm: string,
  store: FileStore,
  directoryPath: string = '.',
  caseSensitive: boolean = true,
  fileExtensions?: string[]
): Promise<string> {
  const flags = caseSensitive ? '' : 'i';
  let regex: RegExp;

  try {
    regex = new RegExp(searchTerm, `g${flags}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Error: Invalid regex pattern "${searchTerm}": ${message}`;
  }

  // Get all files from the store
  const allFiles = await store.getAllPaths();

  // Filter by directory prefix
  const normalizedDir = normalizePath(directoryPath);
  const prefix = normalizedDir ? `${normalizedDir}/` : '';

  let filesToSearch = allFiles.filter(filePath =>
    normalizedDir === '' || filePath.startsWith(prefix)
  );

  // Filter by extension if specified
  if (fileExtensions && fileExtensions.length > 0) {
    filesToSearch = filesToSearch.filter(file => matchesExtension(file, fileExtensions));
  }

  const results: string[] = [];

  for (const filePath of filesToSearch) {
    if (results.length >= MAX_RESULTS) break;

    const content = await store.read(filePath);
    if (content === undefined) continue;

    // Skip files that are too large
    if (content.length > MAX_FILE_SIZE) continue;

    // Skip binary files
    if (isBinaryContent(content)) continue;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
      // Reset regex lastIndex for each line
      regex.lastIndex = 0;

      if (regex.test(lines[i])) {
        let lineContent = lines[i].trim();

        // Truncate very long lines
        if (lineContent.length > 500) {
          lineContent = lineContent.slice(0, 500) + '... (truncated)';
        }

        results.push(`${filePath}:${i + 1}: ${lineContent}`);
      }
    }
  }

  if (results.length === 0) {
    return `No matches found for "${searchTerm}"${normalizedDir ? ` in ${directoryPath}` : ''}`;
  }

  const suffix = results.length >= MAX_RESULTS
    ? `\n(results truncated at ${MAX_RESULTS})`
    : '';

  return `Found ${results.length} match(es) for "${searchTerm}":\n${results.join('\n')}${suffix}`;
}

export async function handleSearchTool(
  name: string,
  args: Record<string, unknown>,
  store: FileStore
): Promise<string> {
  if (name !== 'search_files') {
    return `Unknown search tool: ${name}`;
  }

  const searchTerm = String(args.search_term);
  const directoryPath = args.directory_path as string | undefined;
  const caseSensitive = args.case_sensitive as boolean | undefined;
  const fileExtensions = args.file_extensions as string[] | undefined;

  return searchFiles(
    searchTerm,
    store,
    directoryPath,
    caseSensitive ?? true,
    fileExtensions
  );
}

/**
 * Path suggestions utility — Find similar paths when a file isn't found.
 *
 * Used by read_file and edit_file to suggest alternatives when
 * the requested path doesn't exist (helps recover from typos).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import leven from 'leven';
import { getWorkingDirectory } from './path-validation.js';

const MAX_DEPTH = 6;
const MAX_ENTRIES = 200;
const MAX_CANDIDATES = 50;
const MAX_SUGGESTIONS = 3;

/**
 * Collect all file paths recursively up to MAX_DEPTH.
 */
async function collectAllPaths(cwd: string): Promise<string[]> {
  const paths: string[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

  async function walk(dir: string, currentPath: string): Promise<void> {
    if (paths.length >= MAX_CANDIDATES) return;

    let entries: string[];
    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      entries = dirEntries
        .filter(e => !skipDirs.has(e.name))
        .slice(0, MAX_ENTRIES)
        .map(e => e.name);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (paths.length >= MAX_CANDIDATES) return;

      const entryPath = currentPath ? `${currentPath}/${entry}` : entry;
      const fullPath = path.join(dir, entry);

      paths.push(entryPath);

      // Continue walking deeper
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory() && entryPath.split('/').length < MAX_DEPTH) {
          await walk(fullPath, entryPath);
        }
      } catch {
        // skip
      }
    }
  }

  await walk(cwd, '');
  return paths;
}

/**
 * Find similar paths when a requested file doesn't exist.
 * Uses Levenshtein distance to find the closest matches.
 */
export async function findSimilarPaths(requestedPath: string): Promise<string[]> {
  const cwd = getWorkingDirectory();

  // Collect all available paths
  const allPaths = await collectAllPaths(cwd);

  // Calculate Levenshtein distance for each path
  const scored = allPaths.map(candidatePath => ({
    path: candidatePath,
    distance: leven(requestedPath.toLowerCase(), candidatePath.toLowerCase()),
  }));

  // Sort by distance (lower is better) and take top suggestions
  scored.sort((a, b) => a.distance - b.distance);

  return scored
    .slice(0, MAX_SUGGESTIONS)
    .map(s => s.path);
}

/**
 * Handle file not found error with path suggestions.
 * Builds an error message including similar path suggestions if available.
 *
 * @param filePath - The requested file path that doesn't exist
 * @param prefix - Optional prefix for the message (e.g., '.')
 * @returns Error message with suggestions if available
 */
export async function handleFileNotFoundWithSuggestions(
  filePath: string,
  prefix = '',
): Promise<string> {
  const suggestions = await findSimilarPaths(filePath);
  let msg = `File not found: '${prefix}${filePath}'`;
  if (suggestions.length > 0) {
    msg += ' Did you mean one of these?\n' + suggestions.map(s => `  ${s}`).join('\n');
  }
  return msg;
}

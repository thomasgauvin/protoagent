/**
 * Path suggestions utility — Find similar paths when a file isn't found.
 *
 * Used by read_file and edit_file to suggest alternatives when
 * the requested path doesn't exist (helps recover from typos).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkingDirectory } from './path-validation.js';

const MAX_DEPTH = 6;
const MAX_ENTRIES = 200;
const MAX_SUGGESTIONS = 3;

/**
 * Find similar paths when a requested file doesn't exist.
 * Walks from the repo root, matching segments case-insensitively.
 */
export async function findSimilarPaths(requestedPath: string): Promise<string[]> {
  const cwd = getWorkingDirectory();
  const segments = requestedPath.split('/').filter(Boolean);

  const candidates: string[] = [];

  async function walkSegments(dir: string, segIndex: number, currentPath: string): Promise<void> {
    if (segIndex >= segments.length || segIndex >= MAX_DEPTH || candidates.length >= MAX_SUGGESTIONS) return;

    const targetSegment = segments[segIndex].toLowerCase();
    let entries: string[];

    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      entries = dirEntries
        .slice(0, MAX_ENTRIES)
        .map(e => e.name);
    } catch {
      return;
    }

    const isLastSegment = segIndex === segments.length - 1;

    for (const entry of entries) {
      if (candidates.length >= MAX_SUGGESTIONS) break;
      const entryLower = entry.toLowerCase();

      // Match if entry contains the target segment as a substring (case-insensitive)
      if (!entryLower.includes(targetSegment) && !targetSegment.includes(entryLower)) continue;

      const entryPath = path.join(currentPath, entry);
      const fullPath = path.join(dir, entry);

      if (isLastSegment) {
        // Check if this file/dir actually exists
        try {
          await fs.stat(fullPath);
          candidates.push(entryPath);
        } catch {
          // skip
        }
      } else {
        // Continue walking deeper
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            await walkSegments(fullPath, segIndex + 1, entryPath);
          }
        } catch {
          // skip
        }
      }
    }
  }

  await walkSegments(cwd, 0, '');
  return candidates;
}

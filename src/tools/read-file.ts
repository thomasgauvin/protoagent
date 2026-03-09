/**
 * read_file tool — Read file contents with optional offset and limit.
 *
 * When a file is not found, suggests similar paths to help the model
 * recover from typos without repeated failed attempts.
 */

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { validatePath, getWorkingDirectory } from '../utils/path-validation.js';
import { recordRead } from '../utils/file-time.js';

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

/**
 * Find similar paths when a requested file doesn't exist.
 * Walks from the repo root, matching segments case-insensitively.
 */
async function findSimilarPaths(requestedPath: string): Promise<string[]> {
  const cwd = getWorkingDirectory();
  const segments = requestedPath.split('/').filter(Boolean);
  const MAX_DEPTH = 6;
  const MAX_ENTRIES = 200;
  const MAX_SUGGESTIONS = 3;

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

export async function readFile(filePath: string, offset = 0, limit = 2000, sessionId?: string): Promise<string> {
  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    // If file not found, try to suggest similar paths
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      const suggestions = await findSimilarPaths(filePath);
      let msg = `File not found: '${filePath}'`;
      if (suggestions.length > 0) {
        msg += '\nDid you mean one of these?\n' + suggestions.map(s => `  ${s}`).join('\n');
      }
      return msg;
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

  // Add line numbers (1-based)
  const numbered = lines.map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, ' ');
    // Truncate very long lines
    const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
    return `${lineNum} | ${truncated}`;
  });

  // Record successful read for staleness tracking
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  const rangeLabel = lines.length === 0
    ? 'none'
    : `${Math.min(start + 1, totalLines)}-${end}`;
  const header = `File: ${filePath} (${totalLines} lines total, showing ${rangeLabel})`;
  return `${header}\n${numbered.join('\n')}`;
}

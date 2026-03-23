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
import { validatePath } from '../utils/path-validation.js';
import { findSimilarPaths } from '../utils/path-suggestions.js';
import { recordRead } from '../utils/file-time.js';

export const readFileTool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Use offset and limit to read specific sections of large files.',
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

  const stream = createReadStream(validated, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    let lineIndex = 0;
    for await (const line of lineReader) {
      if (lineIndex >= start && lines.length < maxLines) {
        lines.push(line);
      }
      lineIndex++;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  // Truncate very long individual lines but don't reformat content
  const slice = lines.map(line =>
    line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line
  );

  // Record successful read for staleness tracking
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  return slice.join('\n')
}
/**
 * read_file tool — Read file contents with optional offset and limit.
 */

import fs from 'node:fs/promises';
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

export async function readFile(filePath: string, offset = 0, limit = 2000): Promise<string> {
  const validated = await validatePath(filePath);
  const content = await fs.readFile(validated, 'utf8');
  const lines = content.split('\n');

  const start = Math.max(0, offset);
  const end = Math.min(lines.length, start + limit);
  const slice = lines.slice(start, end);

  // Add line numbers (1-based)
  const numbered = slice.map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, ' ');
    // Truncate very long lines
    const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
    return `${lineNum} | ${truncated}`;
  });

  const header = `File: ${filePath} (${lines.length} lines total, showing ${start + 1}-${end})`;
  return `${header}\n${numbered.join('\n')}`;
}

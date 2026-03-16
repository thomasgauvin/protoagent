import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

// Definitions of the read file tool as provided to the LLM
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
  // Resolve path relative to cwd and check it stays within the project
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, filePath);
  if (!resolved.startsWith(cwd)) {
    throw new Error(`Path "${filePath}" is outside the working directory.`);
  }

  // Check file exists
  try {
    await fs.stat(resolved);
  } catch {
    return `File not found: '${filePath}'`;
  }

  const start = Math.max(0, offset);
  const maxLines = Math.max(0, limit);
  const lines: string[] = [];
  let totalLines = 0;

  const stream = createReadStream(resolved, { encoding: 'utf8' });
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
  } finally {
    lineReader.close();
    stream.destroy();
  }

  const end = Math.min(totalLines, start + lines.length);

  // Add line numbers (1-based) and truncate long lines
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
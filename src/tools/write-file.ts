/**
 * write_file tool — Create or overwrite a file. Requires approval.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { validatePath } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';

export const writeFileTool = {
  type: 'function' as const,
  function: {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with the given content. Prefer edit_file for modifying existing files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to write (relative to working directory).' },
        content: { type: 'string', description: 'The full content to write to the file.' },
      },
      required: ['file_path', 'content'],
    },
  },
};

export async function writeFile(filePath: string, content: string): Promise<string> {
  const validated = await validatePath(filePath);

  // Request approval
  const preview = content.length > 500
    ? `${content.slice(0, 250)}\n... (${content.length} chars total) ...\n${content.slice(-250)}`
    : content;

  const approved = await requestApproval({
    id: `write-${Date.now()}`,
    type: 'file_write',
    description: `Write file: ${filePath}`,
    detail: preview,
  });

  if (!approved) {
    return `Operation cancelled: write to ${filePath} was rejected by user.`;
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(validated), { recursive: true });

  // Atomic write: write to temp file then rename
  const tmpPath = path.join(os.tmpdir(), `protoagent-${Date.now()}-${path.basename(validated)}`);
  await fs.writeFile(tmpPath, content, 'utf8');
  await fs.rename(tmpPath, validated);

  const lines = content.split('\n').length;
  return `Successfully wrote ${lines} lines to ${filePath}`;
}

// src/tools/edit-file.ts

import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';

// Define the tool metadata for the LLM
export const editFileTool = {
  type: 'function' as const,
  function: {
    name: 'edit_file',
    description:
      'Edit an existing file by replacing an exact string match with new content. ' +
      'The old_string must match exactly (including whitespace and indentation). ' +
      'Always read the file first to get the exact content to replace.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit.' },
        old_string: { type: 'string', description: 'The exact text to find and replace.' },
        new_string: { type: 'string', description: 'The text to replace it with.' },
        expected_replacements: {
          type: 'number',
          description: 'Expected number of replacements (default 1). Fails if actual count differs.',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  expectedReplacements = 1,
  sessionId?: string,
): Promise<string> {
  if (oldString.length === 0) {
    return 'Error: old_string cannot be empty.';
  }

  const validated = await validatePath(filePath);
  const content = await fs.readFile(validated, 'utf8');

  // Check if old_string exists in the file
  const count = countOccurrences(content, oldString);

  if (count === 0) {
    return `Error: old_string not found in ${filePath}. Re-read the file and try again.`;
  }

  if (count !== expectedReplacements) {
    return `Error: found ${count} occurrence(s) of old_string, but expected ${expectedReplacements}. Be more specific or set expected_replacements=${count}.`;
  }

  // Create a preview of the change for user approval. 
  // If the strings are long, we truncate them for better readability in the approval prompt.
  const oldPreview = oldString.length > 200 ? oldString.slice(0, 200) + '...' : oldString;
  const newPreview = newString.length > 200 ? newString.slice(0, 200) + '...' : newString;

  const approved = await requestApproval({
    id: `edit-${Date.now()}`,
    type: 'file_edit',
    description: `Edit file: ${filePath} (${count} replacement${count > 1 ? 's' : ''})`,
    detail: `Replace:\n${oldPreview}\n\nWith:\n${newPreview}`,
    sessionId,
    sessionScopeKey: `file_edit:${validated}`,
  });

  if (!approved) {
    return `Operation cancelled: edit to ${filePath} was rejected by user.`;
  }

  // Perform replacement
  const newContent = content.split(oldString).join(newString);

  // Security: Atomic write with symlink protection
  // Naive approach: Write directly to temp file, then rename
  // Risk: TOCTOU race - attacker creates symlink at temp path
  // Fix: Use O_CREAT|O_EXCL ('wx' flag) - fails if file exists
  const directory = path.dirname(validated);
  const tempPath = path.join(directory, `.protoagent-edit-${process.pid}-${Date.now()}-${path.basename(validated)}`);

  let fd: FileHandle | undefined;
  try {
    // Open with O_CREAT|O_EXCL - atomically creates or fails if exists
    fd = await fs.open(tempPath, 'wx', 0o600);
    await fd.writeFile(newContent, 'utf8');
    await fd.sync();  // Ensure data hits disk before rename
    await fd.close();
    fd = undefined;
    await fs.rename(tempPath, validated);
  } catch (err: any) {
    if (fd !== undefined) {
      try { await fd.close(); } catch { /* ignore */ }
    }
    try { await fs.unlink(tempPath); } catch { /* ignore */ }
    throw err;
  }

  return `Successfully edited ${filePath}: ${count} replacement(s) made.`;
}
/**
 * File tool implementations.
 */
import { readFile, writeFile, access, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { toolRegistry, readFileTool, writeFileTool, editFileTool, listDirectoryTool, searchFilesTool } from './tool-registry.js';

// Register file tools
toolRegistry.register(readFileTool, async (args) => {
  const { file_path, offset = 0, limit } = args;
  const content = await readFile(file_path as string, 'utf-8');
  const lines = content.split('\n');
  
  let start = offset as number;
  let end = limit ? start + (limit as number) : lines.length;
  
  return lines.slice(start, end).join('\n');
});

toolRegistry.register(writeFileTool, async (args) => {
  const { file_path, content } = args;
  const path = file_path as string;
  
  // Ensure directory exists
  const dir = dirname(path);
  try {
    await access(dir);
  } catch {
    await mkdir(dir, { recursive: true });
  }
  
  await writeFile(path, content as string, 'utf-8');
  return `File written successfully: ${path}`;
});

toolRegistry.register(editFileTool, async (args) => {
  const { file_path, old_string, new_string, expected_replacements } = args;
  const path = file_path as string;
  
  const content = await readFile(path, 'utf-8');
  const oldStr = old_string as string;
  const newStr = new_string as string;
  
  const occurrences = content.split(oldStr).length - 1;
  
  if (expected_replacements && occurrences !== expected_replacements) {
    throw new Error(`Expected ${expected_replacements} occurrences, found ${occurrences}`);
  }
  
  if (occurrences === 0) {
    throw new Error(`String not found in file: ${oldStr.slice(0, 50)}...`);
  }
  
  const newContent = content.split(oldStr).join(newStr);
  await writeFile(path, newContent, 'utf-8');
  
  return `File edited successfully: ${occurrences} replacement(s) made`;
});

toolRegistry.register(listDirectoryTool, async (args) => {
  const { directory_path } = args;
  const entries = await readdir(directory_path as string, { withFileTypes: true });
  
  return entries
    .map((e) => `${e.isDirectory() ? '[DIR]' : '[FILE]'} ${e.name}`)
    .join('\n');
});

toolRegistry.register(searchFilesTool, async (args) => {
  const { search_term, directory_path = '.', file_extensions, case_sensitive = true } = args;
  
  const results: string[] = [];
  const searchDir = directory_path as string;
  const term = search_term as string;
  const extensions = file_extensions as string[] | undefined;
  
  async function searchRecursive(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      
      if (entry.isDirectory()) {
        await searchRecursive(fullPath);
      } else if (entry.isFile()) {
        // Check extension filter
        if (extensions && extensions.length > 0) {
          const ext = entry.name.split('.').pop();
          if (!ext || !extensions.includes(`.${ext}`)) {
            continue;
          }
        }
        
        try {
          const content = await readFile(fullPath, 'utf-8');
          const lines = content.split('\n');
          
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const matches = case_sensitive
              ? line.includes(term)
              : line.toLowerCase().includes(term.toLowerCase());
            
            if (matches) {
              results.push(`${fullPath}:${i + 1}: ${line.slice(0, 100)}`);
            }
          }
        } catch {
          // Skip binary or unreadable files
        }
      }
    }
  }
  
  await searchRecursive(searchDir);
  return results.join('\n') || 'No matches found';
});

/**
 * Tool registry — collects all tool definitions and provides a dispatcher.
 *
 * Each tool file exports:
 *  - A tool definition (OpenAI function-calling JSON schema)
 *  - A handler function (args) => Promise<string>
 *
 * This file wires them together into a single `tools` array and
 * a `handleToolCall(name, args)` dispatcher.
 */

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { bashTool, runBash } from './bash.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';

export { setDangerouslyAcceptAll, setApprovalHandler } from '../utils/approval.js';

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  bashTool,
  todoReadTool,
  todoWriteTool,
];

// Mutable tools list — MCP and sub-agent tools get appended at runtime
let dynamicTools: typeof tools = [];

export function registerDynamicTool(tool: (typeof tools)[number]): void {
  dynamicTools.push(tool);
}

export function clearDynamicTools(): void {
  dynamicTools = [];
}

export function getAllTools() {
  return [...tools, ...dynamicTools];
}

// Dynamic tool handlers (for MCP tools, etc.)
const dynamicHandlers = new Map<string, (args: any) => Promise<string>>();

export function registerDynamicHandler(name: string, handler: (args: any) => Promise<string>): void {
  dynamicHandlers.set(name, handler);
}

/**
 * Dispatch a tool call to the appropriate handler.
 * Returns the tool result as a string.
 */
export async function handleToolCall(toolName: string, args: any): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit);
      case 'write_file':
        return await writeFile(args.file_path, args.content);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'bash':
        return await runBash(args.command, args.timeout_ms);
      case 'todo_read':
        return readTodos();
      case 'todo_write':
        return writeTodos(args.todos);
      default: {
        // Check dynamic handlers (MCP tools, sub-agent tools)
        const handler = dynamicHandlers.get(toolName);
        if (handler) {
          return await handler(args);
        }
        return `Error: Unknown tool "${toolName}"`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${toolName}: ${msg}`;
  }
}

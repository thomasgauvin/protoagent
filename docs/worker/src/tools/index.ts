/**
 * Tool registry - collects all tool definitions and provides a dispatcher
 */

import type { ToolDefinition } from '../types.js';
import type { FileStore } from './files.js';
import { createFileTools, handleFileTool } from './files.js';
import { todoReadTool, todoWriteTool, handleTodoTool, type TodoStore } from './todo.js';
import { searchFilesTool, handleSearchTool } from './search.js';
import { webfetchTool, handleWebfetchTool } from './webfetch.js';

// Re-export types
export type { FileStore } from './files.js';
export type { TodoStore } from './todo.js';

// Re-export tool definitions
export { createFileTools, handleFileTool };
export { todoReadTool, todoWriteTool, handleTodoTool };
export { searchFilesTool, handleSearchTool };
export { webfetchTool, handleWebfetchTool };

/**
 * Context passed to tool handlers
 */
export interface ToolContext {
  fileStore: FileStore;
  todoStore: TodoStore;
}

/**
 * Get all available tool definitions for the LLM
 */
export function getAllTools(): ToolDefinition[] {
  return [
    ...createFileTools(),
    todoReadTool,
    todoWriteTool,
    searchFilesTool,
    webfetchTool,
  ];
}

/**
 * Dispatch a tool call to the appropriate handler
 */
export async function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  // File tools
  const fileTools = ['read_file', 'write_file', 'edit_file', 'list_directory'];
  if (fileTools.includes(toolName)) {
    return handleFileTool(toolName, args, context.fileStore);
  }

  // Todo tools
  const todoTools = ['todo_read', 'todo_write'];
  if (todoTools.includes(toolName)) {
    return handleTodoTool(toolName, args, context.todoStore);
  }

  // Search tools
  if (toolName === 'search_files') {
    return handleSearchTool(toolName, args, context.fileStore);
  }

  // Webfetch tools
  if (toolName === 'webfetch') {
    return handleWebfetchTool(toolName, args);
  }

  return `Error: Unknown tool "${toolName}"`;
}

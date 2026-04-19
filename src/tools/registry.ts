/**
 * Tool registry — collects all tool definitions and provides a dispatcher.
 *
 * Extracted into a class so that each tab can have its own isolated
 * registry (particularly important for dynamic tools like MCP tools).
 *
 * Each tool file exports:
 *  - A tool definition (OpenAI function-calling JSON schema)
 *  - A handler function (args) => Promise<string>
 *
 * This class wires them together into a single `tools` array and
 * a `handleToolCall(name, args)` dispatcher.
 */

import { readFile } from './read-file.js';
import { writeFile } from './write-file.js';
import { editFile } from './edit-file.js';
import { listDirectory } from './list-directory.js';
import { searchFiles } from './search-files.js';
import { runBash } from './bash.js';
import { readTodos, writeTodos } from './todo.js';
import { webfetch } from './webfetch.js';
import { readImageForTool } from './read-image.js';

export interface ToolCallContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
  approvalManager?: any; // TODO: import ApprovalManager once it exists
}

export type DynamicTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * Static tool definitions (built-in tools that are always available)
 */
export const BUILTIN_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read a file or directory from the local filesystem.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file or directory to read.' },
          offset: { type: 'number', description: 'The line number to start reading from (1-indexed).' },
          limit: { type: 'number', description: 'The maximum number of lines to read.' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'write_file',
      description: 'Write a file to the local filesystem.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to write.' },
          content: { type: 'string', description: 'The content to write to the file.' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'edit_file',
      description: 'Perform exact string replacements in files.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'The absolute path to the file to modify.' },
          old_string: { type: 'string', description: 'The text to replace.' },
          new_string: { type: 'string', description: 'The text to replace it with.' },
          expected_replacements: { type: 'number', description: 'Expected number of replacements.' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_directory',
      description: 'List files and directories in a directory.',
      parameters: {
        type: 'object',
        properties: {
          directory_path: { type: 'string', description: 'The directory path to list.' },
        },
        required: ['directory_path'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'search_files',
      description: 'Search for files matching a pattern.',
      parameters: {
        type: 'object',
        properties: {
          search_term: { type: 'string', description: 'The search term.' },
          directory_path: { type: 'string', description: 'The directory to search in.' },
          case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive.' },
          file_extensions: { type: 'array', items: { type: 'string' }, description: 'File extensions to filter by.' },
        },
        required: ['search_term'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'bash',
      description:
        'Execute a shell command. Safe commands (ls, grep, git status, etc.) run automatically. ' +
        'Other commands require user approval. Some dangerous commands are blocked entirely. ' +
        'Default timeout is 60s. Pass timeout_ms for commands that may take longer (e.g. npm install, builds, tests).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute.' },
          timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 60000 (60s).' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'todo_read',
      description: 'Read the current TODO list.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'todo_write',
      description: 'Write the TODO list.',
      parameters: {
        type: 'object',
        properties: {
          todos: { type: 'array', description: 'Array of TODO items.' },
        },
        required: ['todos'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'webfetch',
      description: 'Fetch content from a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch.' },
          format: { type: 'string', enum: ['text', 'markdown', 'html'], description: 'Response format.' },
          timeout: { type: 'number', description: 'Timeout in seconds.' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_image',
      description: 'Read an image file and return it as base64-encoded data for use with vision models. Supports PNG, JPEG, WEBP, and GIF formats.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the image file (relative to working directory).' },
          detail: { type: 'string', enum: ['low', 'high', 'auto'], description: 'Detail level for the image. "low" is faster and cheaper, "high" provides more detail, "auto" lets the model decide. Defaults to "auto".' },
        },
        required: ['file_path'],
      },
    },
  },
];

/**
 * ToolRegistry — manages both built-in and dynamic tools.
 *
 * Each tab gets its own registry so that MCP tool registration doesn't
 * conflict across tabs.
 */
export class ToolRegistry {
  private dynamicTools: DynamicTool[] = [];
  private dynamicHandlers = new Map<string, (args: any) => Promise<string>>();

  /**
   * Get all tools (built-in + dynamic) for the LLM.
   */
  getAllTools() {
    return [...BUILTIN_TOOLS, ...this.dynamicTools];
  }

  /**
   * Register a dynamic tool (MCP tool, sub-agent tool, etc.).
   */
  registerDynamicTool(tool: DynamicTool): void {
    const toolName = tool.function.name;
    this.dynamicTools = this.dynamicTools.filter((existing) => existing.function.name !== toolName);
    this.dynamicTools.push(tool);
  }

  /**
   * Unregister a dynamic tool.
   */
  unregisterDynamicTool(toolName: string): void {
    this.dynamicTools = this.dynamicTools.filter((tool) => tool.function.name !== toolName);
  }

  /**
   * Clear all dynamic tools.
   */
  clearDynamicTools(): void {
    this.dynamicTools = [];
  }

  /**
   * Register a handler for a tool.
   */
  registerDynamicHandler(name: string, handler: (args: any) => Promise<string>): void {
    this.dynamicHandlers.set(name, handler);
  }

  /**
   * Unregister a handler.
   */
  unregisterDynamicHandler(name: string): void {
    this.dynamicHandlers.delete(name);
  }

  /**
   * Dispatch a tool call to the appropriate handler.
   */
  async handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
    try {
      switch (toolName) {
        case 'read_file':
          return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
        case 'write_file':
          return await writeFile(args.file_path, args.content, context.sessionId, context.approvalManager);
        case 'edit_file':
          return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId, context.approvalManager);
        case 'list_directory':
          return await listDirectory(args.directory_path);
        case 'search_files':
          return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
        case 'bash':
          return await runBash(args.command, args.timeout_ms, context.sessionId, context.abortSignal, context.approvalManager);
        case 'todo_read':
          return readTodos(context.sessionId);
        case 'todo_write':
          return writeTodos(args.todos, context.sessionId);
        case 'webfetch': {
          const result = await webfetch(args.url, args.format, args.timeout);
          return JSON.stringify(result);
        }
        case 'read_image':
          return await readImageForTool(args.file_path, args.detail || 'auto');
        default: {
          // Check dynamic handlers (MCP tools, sub-agent tools)
          const handler = this.dynamicHandlers.get(toolName);
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
}

/**
 * For backwards compatibility: maintain module-level exports that delegate to
 * a default shared instance. This allows existing code to work without changes,
 * but gradually migrated code will pass ToolRegistry instances around.
 */
export const defaultRegistry = new ToolRegistry();

export const tools = BUILTIN_TOOLS;

export function registerDynamicTool(tool: DynamicTool): void {
  defaultRegistry.registerDynamicTool(tool);
}

export function unregisterDynamicTool(toolName: string): void {
  defaultRegistry.unregisterDynamicTool(toolName);
}

export function clearDynamicTools(): void {
  defaultRegistry.clearDynamicTools();
}

export function getAllTools() {
  return defaultRegistry.getAllTools();
}

export function registerDynamicHandler(name: string, handler: (args: any) => Promise<string>): void {
  defaultRegistry.registerDynamicHandler(name, handler);
}

export function unregisterDynamicHandler(name: string): void {
  defaultRegistry.unregisterDynamicHandler(name);
}

export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  return defaultRegistry.handleToolCall(toolName, args, context);
}

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

/**
 * Tool Registry — Manages all available tools.
 */
import { z } from 'zod';

// Tool definition following OpenAI function calling format
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface ToolContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
}

export type ToolHandler = (args: Record<string, unknown>, context: ToolContext) => Promise<string>;

class ToolRegistry {
  private tools = new Map<string, { definition: ToolDefinition; handler: ToolHandler }>();

  register(definition: ToolDefinition, handler: ToolHandler): void {
    this.tools.set(definition.function.name, { definition, handler });
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  async execute(name: string, args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return tool.handler(args, context);
  }

  getHandler(name: string): ToolHandler | undefined {
    return this.tools.get(name)?.handler;
  }
}

export const toolRegistry = new ToolRegistry();

// Built-in tool definitions
export const readFileTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Use offset and limit to read specific sections of large files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read' },
        offset: { type: 'number', description: 'Line number to start reading from (0-based)' },
        limit: { type: 'number', description: 'Maximum number of lines to read' },
      },
      required: ['file_path'],
    },
  },
};

export const writeFileTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing file with the given content.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to write' },
        content: { type: 'string', description: 'The full content to write to the file' },
      },
      required: ['file_path', 'content'],
    },
  },
};

export const editFileTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'edit_file',
    description: 'Edit an existing file by replacing an exact string match with new content.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit' },
        old_string: { type: 'string', description: 'The exact text to find and replace' },
        new_string: { type: 'string', description: 'The text to replace it with' },
        expected_replacements: { type: 'number', description: 'Expected number of replacements' },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

export const listDirectoryTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'list_directory',
    description: 'List the contents of a directory. Returns entries with [FILE] or [DIR] prefixes.',
    parameters: {
      type: 'object',
      properties: {
        directory_path: { type: 'string', description: 'Path to the directory to list' },
      },
      required: ['directory_path'],
    },
  },
};

export const searchFilesTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_files',
    description: 'Search for a text pattern across files in a directory (recursive).',
    parameters: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'The text or regex pattern to search for' },
        directory_path: { type: 'string', description: 'Directory to search in' },
        file_extensions: { type: 'array', items: { type: 'string' }, description: 'Filter by file extensions' },
        case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive' },
      },
      required: ['search_term'],
    },
  },
};

export const bashTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'bash',
    description: 'Execute a shell command. Safe commands run automatically, others require approval.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds' },
      },
      required: ['command'],
    },
  },
};

export const todoReadTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'todo_read',
    description: 'Read the current TODO list to check progress on tasks.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
};

export const todoWriteTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'todo_write',
    description: 'Replace the TODO list with an updated version.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              content: { type: 'string' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
              priority: { type: 'string', enum: ['low', 'medium', 'high'] },
            },
          },
        },
      },
      required: ['todos'],
    },
  },
};

export const webfetchTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'webfetch',
    description: 'Fetch and process content from a web URL.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'HTTP(S) URL to fetch' },
        format: { type: 'string', enum: ['text', 'markdown', 'html'], description: 'Output format' },
        timeout: { type: 'number', description: 'Timeout in seconds' },
      },
      required: ['url', 'format'],
    },
  },
};

export const subAgentTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'sub_agent',
    description: 'Spawn an isolated sub-agent to handle a task without polluting the main conversation context. Multiple sub-agents can run in parallel.',
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'A detailed description of the task for the sub-agent to complete' },
        max_iterations: { type: 'number', description: 'Maximum tool-call iterations for the sub-agent' },
      },
      required: ['task'],
    },
  },
};

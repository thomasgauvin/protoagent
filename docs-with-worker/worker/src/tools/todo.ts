/**
 * todo_read / todo_write tools - SQLite-backed task tracking
 */

import type { ToolDefinition } from '../types.js';

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

export interface TodoStore {
  read(): Promise<TodoItem[]>;
  write(todos: TodoItem[]): Promise<void>;
}

export const todoReadTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'todo_read',
    description: 'Read the current TODO list to check progress on tasks.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const todoWriteTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'todo_write',
    description: 'Replace the TODO list with an updated version. Use this to plan tasks, update progress, and mark items complete.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete updated TODO list.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the item.' },
              content: { type: 'string', description: 'Description of the task.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Current status.',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level.',
              },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

export function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return 'TODO List (0 items):\nNo TODOs.';
  }

  const statusIcons: Record<TodoItem['status'], string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  const lines = todos.map((t) => `${statusIcons[t.status]} [${t.priority}] ${t.content} (${t.id})`);
  return `TODO List (${todos.length} items):\n${lines.join('\n')}`;
}

export async function handleTodoTool(
  name: string,
  args: Record<string, unknown>,
  store: TodoStore
): Promise<string> {
  switch (name) {
    case 'todo_read': {
      const todos = await store.read();
      return formatTodos(todos);
    }

    case 'todo_write': {
      const todos = (args.todos as TodoItem[]) || [];
      await store.write(todos);
      return formatTodos(todos);
    }

    default:
      return `Unknown todo tool: ${name}`;
  }
}

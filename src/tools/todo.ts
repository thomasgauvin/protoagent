/**
 * todo_read / todo_write tools - in-memory task tracking.
 *
 * The agent uses these to plan multi-step work and track progress.
 * Todos are stored per session. The active session can also persist them
 * through the session store.
 */

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

const DEFAULT_SESSION_ID = '__default__';

// Session-scoped in-memory storage
const todosBySession = new Map<string, TodoItem[]>();

function getSessionKey(sessionId?: string): string {
  return sessionId ?? DEFAULT_SESSION_ID;
}

function cloneTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map((todo) => ({ ...todo }));
}

function formatTodos(todos: TodoItem[], heading: string): string {
  if (todos.length === 0) {
    return `${heading}\nNo TODOs.`;
  }

  const statusIcons: Record<TodoItem['status'], string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  const lines = todos.map((t) => {
    const content = t.content?.trim() || '(no description)';
    // Fall back gracefully if the model omits status/priority — rather than
    // rendering literal "undefined" in the UI. (The write path already
    // validates the schema and would reject these, but be defensive here
    // in case older persisted todos are missing fields.)
    const icon = statusIcons[t.status] ?? '[?]';
    const priority = t.priority ?? 'medium';
    const id = t.id ?? '(no-id)';
    return `${icon} [${priority}] ${content} (${id})`;
  });
  return `${heading}\n${lines.join('\n')}`;
}

export const todoReadTool = {
  type: 'function' as const,
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

export const todoWriteTool = {
  type: 'function' as const,
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

export function readTodos(sessionId?: string, abortSignal?: AbortSignal): string {
  // Check abort before processing
  if (abortSignal?.aborted) {
    return 'Error: Operation aborted by user.';
  }
  const todos = todosBySession.get(getSessionKey(sessionId)) ?? [];
  return formatTodos(todos, `TODO List (${todos.length} items):`);
}

export function writeTodos(newTodos: TodoItem[], sessionId?: string, abortSignal?: AbortSignal): string {
  // Check abort before processing
  if (abortSignal?.aborted) {
    return 'Error: Operation aborted by user.';
  }

  // Validate every required field up-front and report ALL problems at once,
  // so the model can correct them in a single follow-up call instead of
  // playing ping-pong — "fix content" → "fix status" → "fix priority".
  const validStatuses: Array<TodoItem['status']> = ['pending', 'in_progress', 'completed', 'cancelled'];
  const validPriorities: Array<TodoItem['priority']> = ['high', 'medium', 'low'];
  const problems: string[] = [];
  for (const t of newTodos || []) {
    const id = t?.id ?? '(missing id)';
    if (!t || typeof t !== 'object') {
      problems.push(`${id}: todo must be an object with { id, content, status, priority }`);
      continue;
    }
    if (!t.id || typeof t.id !== 'string') problems.push(`${id}: missing or non-string 'id'`);
    if (!t.content || !t.content.trim()) problems.push(`${id}: missing or empty 'content'`);
    if (!validStatuses.includes(t.status)) {
      problems.push(`${id}: 'status' must be one of ${validStatuses.join(', ')} (got: ${JSON.stringify(t.status)})`);
    }
    if (!validPriorities.includes(t.priority)) {
      problems.push(`${id}: 'priority' must be one of ${validPriorities.join(', ')} (got: ${JSON.stringify(t.priority)})`);
    }
  }
  if (problems.length > 0) {
    return `Error: ${problems.length} validation problem(s) in todo list:\n- ${problems.join('\n- ')}`;
  }

  const todos = cloneTodos(newTodos);
  todosBySession.set(getSessionKey(sessionId), todos);
  return formatTodos(todos, `TODO List Updated (${todos.length} items):`);
}

export function getTodosForSession(sessionId?: string): TodoItem[] {
  return cloneTodos(todosBySession.get(getSessionKey(sessionId)) ?? []);
}

export function setTodosForSession(sessionId: string, todos: TodoItem[]): void {
  todosBySession.set(getSessionKey(sessionId), cloneTodos(todos));
}

export function clearTodos(sessionId?: string): void {
  todosBySession.delete(getSessionKey(sessionId));
}

/**
 * Add a new todo to the session
 */
export function addTodo(content: string, priority: TodoItem['priority'] = 'medium', sessionId?: string): TodoItem {
  const key = getSessionKey(sessionId);
  const todos = getTodosForSession(sessionId);
  const newTodo: TodoItem = {
    id: `todo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    content,
    status: 'pending',
    priority,
  };
  todos.push(newTodo);
  todosBySession.set(key, todos);
  return newTodo;
}

/**
 * Delete a todo by ID
 */
export function deleteTodo(id: string, sessionId?: string): boolean {
  const key = getSessionKey(sessionId);
  const todos = getTodosForSession(sessionId);
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) return false;
  todos.splice(index, 1);
  todosBySession.set(key, todos);
  return true;
}

/**
 * Update a todo by ID
 */
export function updateTodo(id: string, updates: Partial<Omit<TodoItem, 'id'>>, sessionId?: string): TodoItem | null {
  const key = getSessionKey(sessionId);
  const todos = getTodosForSession(sessionId);
  const index = todos.findIndex((t) => t.id === id);
  if (index === -1) return null;
  todos[index] = { ...todos[index], ...updates };
  todosBySession.set(key, todos);
  return todos[index];
}

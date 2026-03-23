// src/sessions.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chmodSync } from 'node:fs';
import type OpenAI from 'openai';
import type { TodoItem } from './tools/todo.js';

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHORT_ID_PATTERN = /^[0-9a-z]{8}$/i;

// Generate a short, readable session ID (8 alphanumeric characters).
function generateSessionId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

// Sets restrictive file/directory permissions (non-Windows only).
function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

// Validates that the session ID matches the expected format.
function assertValidSessionId(id: string): void {
  // Accept both legacy UUIDs and new short IDs
  if (!SESSION_ID_PATTERN.test(id) && !SHORT_ID_PATTERN.test(id)) {
    throw new Error(`Invalid session ID: ${id}`);
  }
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: string;
  todos: TodoItem[];
  completionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

// Ensures the system prompt is at the top of the messages array.
export function ensureSystemPromptAtTop(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  systemPrompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const firstSystemIndex = messages.findIndex((message) => message.role === 'system');

  if (firstSystemIndex === -1) {
    return [{ role: 'system', content: systemPrompt } as OpenAI.Chat.Completions.ChatCompletionMessageParam, ...messages];
  }

  const firstSystemMessage = messages[firstSystemIndex];
  const normalizedSystemMessage = {
    ...firstSystemMessage,
    role: 'system',
    content: systemPrompt,
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;

  return [
    normalizedSystemMessage,
    ...messages.slice(0, firstSystemIndex),
    ...messages.slice(firstSystemIndex + 1),
  ];
}

// Returns the platform-specific directory path for storing sessions.
function getSessionsDir(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'sessions');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'sessions');
}

// Creates the sessions directory if it doesn't exist and hardens its permissions.
async function ensureSessionsDir(): Promise<string> {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true, mode: SESSION_DIR_MODE });
  hardenPermissions(dir, SESSION_DIR_MODE);
  return dir;
}

// Returns the full file path for a session JSON file given its ID.
function sessionPath(id: string): string {
  assertValidSessionId(id);
  return path.join(getSessionsDir(), `${id}.json`);
}

// Create a new session.
export function createSession(model: string, provider: string): Session {
  return {
    id: generateSessionId(),
    title: 'New session',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    provider,
    todos: [],
    completionMessages: [],
  };
}

// Persists a session to disk as JSON with restricted permissions.
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  const filePath = sessionPath(session.id);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: SESSION_FILE_MODE });
  hardenPermissions(filePath, SESSION_FILE_MODE);
}

// Loads a session from disk by ID, returning null if not found or invalid.
export async function loadSession(id: string): Promise<Session | null> {
  try {
    const content = await fs.readFile(sessionPath(id), 'utf8');
    const session = JSON.parse(content) as Partial<Session>;
    return {
      id: session.id ?? id,
      title: session.title ?? 'New session',
      createdAt: session.createdAt ?? new Date().toISOString(),
      updatedAt: session.updatedAt ?? new Date().toISOString(),
      model: session.model ?? '',
      provider: session.provider ?? '',
      todos: Array.isArray(session.todos) ? session.todos : [],
      completionMessages: Array.isArray(session.completionMessages) ? session.completionMessages : [],
    };
  } catch {
    return null;
  }
}

// Lists all saved sessions sorted by most recently updated.
export async function listSessions(): Promise<SessionSummary[]> {
  const dir = getSessionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), 'utf8');
      const session = JSON.parse(content) as Session;
      summaries.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.completionMessages.length,
      });
    } catch {
      // Skip corrupt session files
    }
  }

  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}

// Deletes a session file by ID, returning true if successful.
export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

// Generates a session title from the first user message content.
export function generateTitle(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg || !('content' in firstUserMsg) || typeof firstUserMsg.content !== 'string') {
    return 'New session';
  }
  const content = firstUserMsg.content;
  if (content.length <= 60) return content;
  return content.slice(0, 57) + '...';
}
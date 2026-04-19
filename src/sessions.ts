/**
 * Session persistence — Save and load conversation history.
 *
 * Sessions are stored as JSON files in `~/.local/share/protoagent/sessions/`.
 * Each session has a unique ID, a title, and the full message history.
 *
 * The agent can resume a previous session or start a new one.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chmodSync } from 'node:fs';
import type OpenAI from 'openai';
import type { TodoItem } from './tools/todo.js';
import type { QueuedMessage } from './message-queue.js';
import type { WorkflowState } from './workflow/types.js';
import { logger } from './utils/logger.js';

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHORT_ID_PATTERN = /^[0-9a-z]{8}$/i;

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

function assertValidSessionId(id: string): void {
  // Accept both legacy UUIDs and new short IDs
  if (!SESSION_ID_PATTERN.test(id) && !SHORT_ID_PATTERN.test(id)) {
    throw new Error(`Invalid session ID: ${id}`);
  }
}

/** Generate a short, readable session ID (8 alphanumeric characters). */
function generateSessionId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
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
  queuedMessages: QueuedMessage[];
  interjectMessages: QueuedMessage[];
  workflowState?: WorkflowState;
  deleted?: boolean;
  totalCost?: number;
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export function ensureSystemPromptAtTop(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  systemPrompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const firstSystemIndex = messages.findIndex((message) => message.role === 'system');

  if (firstSystemIndex === -1) {
    return [{ role: 'system', content: systemPrompt } as OpenAI.Chat.Completions.ChatCompletionMessageParam, ...messages];
  }

  const firstSystemMessage = messages[firstSystemIndex] as OpenAI.Chat.Completions.ChatCompletionMessageParam;
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

function getSessionsDir(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'sessions');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'sessions');
}

async function ensureSessionsDir(): Promise<string> {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true, mode: SESSION_DIR_MODE });
  hardenPermissions(dir, SESSION_DIR_MODE);
  return dir;
}

function sessionPath(id: string): string {
  assertValidSessionId(id);
  return path.join(getSessionsDir(), `${id}.json`);
}

/** Create a new session. */
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
    queuedMessages: [],
    interjectMessages: [],
    workflowState: {
      type: 'queue',
      isActive: false,
      iterationCount: 0,
    },
  };
}

/** Save a session to disk. */
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  const filePath = sessionPath(session.id);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: SESSION_FILE_MODE });
  hardenPermissions(filePath, SESSION_FILE_MODE);
  logger.debug(`Session saved: ${session.id}`);
}

export interface LoadSessionOptions {
  includeDeleted?: boolean;
}

/** Load a session by ID. Returns null if not found or marked as deleted (unless includeDeleted is true). */
export async function loadSession(id: string, options?: LoadSessionOptions): Promise<Session | null> {
  try {
    const content = await fs.readFile(sessionPath(id), 'utf8');
    const session = JSON.parse(content) as Partial<Session>;
    // Skip deleted sessions - they should not be restored unless explicitly requested
    if (session.deleted && !options?.includeDeleted) {
      return null;
    }
    return {
      id: session.id ?? id,
      title: session.title ?? 'New session',
      createdAt: session.createdAt ?? new Date().toISOString(),
      updatedAt: session.updatedAt ?? new Date().toISOString(),
      model: session.model ?? '',
      provider: session.provider ?? '',
      todos: Array.isArray(session.todos) ? session.todos : [],
      completionMessages: Array.isArray(session.completionMessages) ? session.completionMessages : [],
      queuedMessages: Array.isArray(session.queuedMessages) ? session.queuedMessages : [],
      interjectMessages: Array.isArray(session.interjectMessages) ? session.interjectMessages : [],
      workflowState: session.workflowState,
      deleted: session.deleted,
      totalCost: typeof session.totalCost === 'number' ? session.totalCost : 0,
    };
  } catch {
    return null;
  }
}

/** Mark a session as deleted without removing the file. */
export async function markSessionDeleted(id: string): Promise<boolean> {
  try {
    const content = await fs.readFile(sessionPath(id), 'utf8');
    const session = JSON.parse(content) as Session;
    session.deleted = true;
    session.updatedAt = new Date().toISOString();
    await saveSession(session);
    logger.debug(`Session marked as deleted: ${id}`);
    return true;
  } catch {
    return false;
  }
}

export interface ListSessionsOptions {
  limit?: number;
  offset?: number;
}

/** List all sessions (sorted by most recently updated). */
export async function listSessions(options?: ListSessionsOptions): Promise<SessionSummary[]> {
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

  // Sort by most recently updated
  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  // Apply pagination
  const offset = options?.offset ?? 0;
  const limit = options?.limit;
  if (offset > 0 || limit !== undefined) {
    return summaries.slice(offset, limit !== undefined ? offset + limit : undefined);
  }

  return summaries;
}

/** List all active (non-deleted) session IDs (sorted by most recently updated). */
export async function listActiveSessionIds(): Promise<string[]> {
  const dir = getSessionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const activeSessions: { id: string; updatedAt: string }[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), 'utf8');
      const session = JSON.parse(content) as Session;
      // Skip deleted sessions
      if (session.deleted) continue;
      activeSessions.push({
        id: session.id,
        updatedAt: session.updatedAt,
      });
    } catch {
      // Skip corrupt session files
    }
  }

  // Sort by most recently updated
  activeSessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return activeSessions.map(s => s.id);
}

/** Count total number of sessions. */
export async function countSessions(): Promise<number> {
  const dir = getSessionsDir();
  try {
    const entries = await fs.readdir(dir);
    // Count only .json files
    let count = 0;
    for (const entry of entries) {
      if (entry.endsWith('.json')) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

export interface SessionSearchResult {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  matchType: 'title' | 'message';
}

/** Search sessions by query string (matches title or message content). */
export async function searchSessions(query: string): Promise<SessionSearchResult[]> {
  if (!query.trim()) return [];
  
  const dir = getSessionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const searchLower = query.toLowerCase();
  const results: SessionSearchResult[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), 'utf8');
      const session = JSON.parse(content) as Session;
      
      // Skip deleted sessions
      if (session.deleted) continue;
      
      const titleMatch = session.title.toLowerCase().includes(searchLower);
      let messageMatch = false;
      
      // Search through message content
      if (Array.isArray(session.completionMessages)) {
        for (const msg of session.completionMessages) {
          if (msg.content && typeof msg.content === 'string') {
            if (msg.content.toLowerCase().includes(searchLower)) {
              messageMatch = true;
              break;
            }
          }
        }
      }
      
      if (titleMatch || messageMatch) {
        results.push({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.completionMessages?.length ?? 0,
          matchType: titleMatch ? 'title' : 'message',
        });
      }
    } catch {
      // Skip corrupt session files
    }
  }

  // Sort by most recently updated
  results.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return results;
}

/** Delete a session. */
export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a short title for a session from the conversation.
 * Simply uses the first user message (truncated if needed).
 * This is called once at the start of a session.
 */
export function generateTitle(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  _client?: OpenAI,
  _model?: string
): string {
  // Find the first user message
  for (const m of messages) {
    if (m.role === 'user' && typeof m.content === 'string') {
      const trimmed = m.content.trim();
      if (trimmed.length > 0) {
        // Truncate to 60 chars max
        if (trimmed.length <= 60) return trimmed;
        return trimmed.slice(0, 57) + '...';
      }
    }
  }

  return 'New session';
}

/**
 * Generate a title using the LLM based on recent user messages.
 * Used by /rename command to create a fresh title based on current context.
 * Bias towards recent activity while considering overall session context.
 */
export async function generateTitleWithLLM(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  client: OpenAI,
  model: string
): Promise<string> {
  // Get the 20 most recent user messages (untruncated)
  const recentUserMessages = messages
    .filter((m): m is { role: 'user'; content: string } => 
      m.role === 'user' && typeof m.content === 'string'
    )
    .slice(-20)
    .map(m => m.content.trim())
    .filter(content => content.length > 0);

  if (recentUserMessages.length === 0) {
    return 'New session';
  }

  // Find the first user message for overall context
  const firstUserMessage = messages.find(
    (m): m is { role: 'user'; content: string } => 
      m.role === 'user' && typeof m.content === 'string'
  )?.content;

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: `Generate a concise, descriptive title (2-6 words) for this coding session.

Rules:
- Focus on the MOST RECENT activity and current task (from recent messages)
- Consider the overall session context but prioritize recent work
- Start with an action verb: Fix, Add, Update, Refactor, Implement, Debug, Create, Migrate, Optimize
- Include specific file names or component names when relevant
- Be specific: "Fix login auth bug" not "Fix bug"
- Keep it under 40 characters
- Respond with ONLY the title, no quotes or explanation`,
        },
        {
          role: 'user',
          content: `Original task: ${firstUserMessage ? firstUserMessage.slice(0, 200) : 'Unknown'}

Recent user messages (most recent last):
${recentUserMessages.map((m, i) => `${i + 1}. ${m}`).join('\n')}

Generate a title that reflects the most recent work while considering the overall session:`,
        },
      ],
      temperature: 0.3,
      max_tokens: 25,
    });

    const title = response.choices[0]?.message?.content?.trim();
    if (title && title.length > 0) {
      // Clean up the title
      const cleaned = title
        .replace(/^["']|["']$/g, '')
        .replace(/^[\s-]+|[\s-]+$/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 60);
      
      // If the cleaned title is too long, try to truncate smartly
      if (cleaned.length > 45) {
        const words = cleaned.split(' ');
        if (words.length > 3) {
          return words.slice(0, 4).join(' ');
        }
      }
      return cleaned;
    }
  } catch (err) {
    logger.debug(`Failed to generate title with LLM: ${err}`);
  }

  // Fallback: use the most recent user message
  const lastMessage = recentUserMessages[recentUserMessages.length - 1];
  if (lastMessage.length <= 60) return lastMessage;
  return lastMessage.slice(0, 57) + '...';
}

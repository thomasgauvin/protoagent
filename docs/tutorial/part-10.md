# Part 10: Sessions

Sessions make ProtoAgent feel like a workspace instead of a one-shot demo. Without them, closing the terminal loses everything: the conversation, the TODO list, what files were touched, and what work remains.

## What you are building

Starting from Part 9, you add:

- `src/sessions.ts` — session creation, save/load, listing, and title generation
- Updated `src/cli.tsx` — adds `--session <id>` flag
- Updated `src/App.tsx` — session lifecycle (create, load, save, resume, quit)

## Step 1: Create `src/sessions.ts`

Sessions are stored as JSON files in `~/.local/share/protoagent/sessions/`. Each has a UUID, title, timestamps, model info, TODO state, and the full message history.

```typescript
// src/sessions.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { chmodSync } from 'node:fs';
import type OpenAI from 'openai';
import type { TodoItem } from './tools/todo.js';
import { logger } from './utils/logger.js';

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

function assertValidSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
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

export function createSession(model: string, provider: string): Session {
  return {
    id: crypto.randomUUID(),
    title: 'New session',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    provider,
    todos: [],
    completionMessages: [],
  };
}

export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  const filePath = sessionPath(session.id);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: SESSION_FILE_MODE });
  hardenPermissions(filePath, SESSION_FILE_MODE);
  logger.debug(`Session saved: ${session.id}`);
}

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

export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

export function generateTitle(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg || !('content' in firstUserMsg) || typeof firstUserMsg.content !== 'string') {
    return 'New session';
  }
  const content = firstUserMsg.content;
  if (content.length <= 60) return content;
  return content.slice(0, 57) + '...';
}
```

## Step 2: Update `src/cli.tsx`

Add the `--session` flag for resuming sessions.

```typescript
// src/cli.tsx

#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent } from './config.js';

const program = new Command();

program
  .name('protoagent')
  .description('A minimal coding agent in your terminal')
  .option('--dangerously-accept-all', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: error, warn, info, debug, trace')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    render(
      <App
        dangerouslyAcceptAll={options.dangerouslyAcceptAll}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });

program
  .command('configure')
  .description('Set up or change your AI provider and model')
  .action(() => {
    render(<ConfigureComponent />);
  });

program.parse();
```

## Step 3: Update `src/App.tsx`

The main App now manages session lifecycle:

1. On startup: load the requested session (if `--session` provided) or create a new one
2. On each turn: save the session after the agentic loop completes
3. On `/quit`: save the session and display the resume command
4. On resume: restore messages, TODOs, and the system prompt

Key additions to your `App.tsx`:

```typescript
// Import sessions
import {
  createSession,
  ensureSystemPromptAtTop,
  saveSession,
  loadSession,
  generateTitle,
  type Session,
} from './sessions.js';
import { clearTodos, getTodosForSession, setTodosForSession } from './tools/todo.js';
import { generateSystemPrompt } from './system-prompt.js';

// Add sessionId to AppProps
export interface AppProps {
  dangerouslyAcceptAll?: boolean;
  logLevel?: string;
  sessionId?: string;
}

// Add session state
const [session, setSession] = useState<Session | null>(null);

// In initializeWithConfig, add session handling:
let loadedSession: Session | null = null;
if (sessionId) {
  loadedSession = await loadSession(sessionId);
  if (loadedSession) {
    const systemPrompt = await generateSystemPrompt();
    loadedSession.completionMessages = ensureSystemPromptAtTop(
      loadedSession.completionMessages,
      systemPrompt
    );
    setTodosForSession(loadedSession.id, loadedSession.todos);
    setSession(loadedSession);
    setCompletionMessages(loadedSession.completionMessages);
  }
}

if (!loadedSession) {
  const initialMessages = await initializeMessages();
  setCompletionMessages(initialMessages);
  const newSession = createSession(loadedConfig.model, loadedConfig.provider);
  clearTodos(newSession.id);
  newSession.completionMessages = initialMessages;
  setSession(newSession);
}

// After successful agentic loop completion, save the session:
if (session) {
  session.completionMessages = updatedMessages;
  session.todos = getTodosForSession(session.id);
  session.title = generateTitle(updatedMessages);
  await saveSession(session);
}
```

## Verification

```bash
npm run dev
```

Have a conversation, then quit. The app should print:

```
Session saved. Resume with:
protoagent --session <uuid>
```

Use that command to resume. You should see prior messages restored and the conversation continuing from where you left off.

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-10`.

## Core takeaway

Sessions are not just storage. They are what let a long-running coding task survive real life — terminals close, machines restart, but the work continues.

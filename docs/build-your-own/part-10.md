# Part 10: Sessions

Sessions make ProtoAgent feel like a workspace instead of a one-shot demo. Without them, closing the terminal loses everything: the conversation, the TODO list, what files were touched, and what work remains.

## What you are building

Starting from Part 9, you add:

- `src/sessions.ts` — session creation, save/load, listing, and title generation
- Updated `src/cli.tsx` — adds `--session <id>` flag
- Updated `src/App.tsx` — session lifecycle (create, load, save, resume)

## Step 1: Create `src/sessions.ts`

Create the file:

```bash
touch src/sessions.ts
```

Sessions are stored as JSON files in `~/.local/share/protoagent/sessions/`. Each has an 8-character alphanumeric ID, title, timestamps, model info, TODO state, and the full message history.

```typescript
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
// Security: Credentials are redacted before saving (see SECURITY.md)
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  const filePath = sessionPath(session.id);

  // Security: Sanitize credentials from session before saving
  // Naive approach: Save session as-is
  // Risk: API keys in tool outputs leak to disk
  // Fix: Redact credential patterns before persisting
  const sanitizedSession = sanitizeSessionForSave(session);

  await fs.writeFile(filePath, JSON.stringify(sanitizedSession, null, 2), { encoding: 'utf8', mode: SESSION_FILE_MODE });
  hardenPermissions(filePath, SESSION_FILE_MODE);
}

// Security: Redact credentials from session messages before saving
function sanitizeSessionForSave(session: Session): Session {
  const sanitizedMessages = session.completionMessages.map((msg) => {
    const msgAny = msg as any;
    if (typeof msgAny.content === 'string') {
      msgAny.content = msgAny.content.replace(/sk-[a-zA-Z0-9]{48}/g, 'sk-***REDACTED***');
    }
    return msg;
  });
  return { ...session, completionMessages: sanitizedMessages };
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
```

## Step 2: Update `src/cli.tsx`

Add the `--session` flag for resuming sessions.

```typescript
// src/cli.tsx
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, readConfig, writeConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: error, warn, info, debug, trace')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    render(<App dangerouslySkipPermissions={options.dangerouslySkipPermissions || false} logLevel={options.logLevel || 'info'} sessionId={options.session || null} />);
  });

program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(`${selected.provider} / ${selected.model}`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program.parse(process.argv);
```

## Step 3: Update `src/App.tsx`

The main App now manages session lifecycle:

1. On startup: load the requested session (if `--session` provided) or create a new one
2. On each turn: save the session after the agentic loop completes
3. Display the current session ID in the UI

Add the session imports and update AppProps:

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
  dangerouslySkipPermissions?: boolean;
  logLevel?: string;
  sessionId?: string;
}
```

Update the component signature to accept `sessionId`:

```typescript
export const App: React.FC<AppProps> = ({ dangerouslySkipPermissions = false, logLevel = 'info', sessionId }) => {
```

Add session state in the `App`:

```typescript
// Add session state
const [session, setSession] = useState<Session | null>(null);
```

Replace the `initializeWithConfig` callback to add session handling:

```typescript
const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
  setConfig(loadedConfig);
  clientRef.current = buildClient(loadedConfig);

  // Session handling:
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

  setNeedsSetup(false);
  setInitialized(true);
}, []);
```


Replace the `handleSubmit` callback to add session saving after successful agentic loop completion:

```typescript
const handleSubmit = useCallback(async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || loading || !clientRef.current || !config) return;

  setInputText('');
  setInputResetKey((prev) => prev + 1);
  setLoading(true);
  setError(null);

  const userMessage: Message = { role: 'user', content: trimmed };
  setCompletionMessages((prev) => [...prev, userMessage]);

  try {
    const pricing = getModelPricing(config.provider, config.model);
    const requestDefaults = getRequestDefaultParams(config.provider, config.model);

    // Create abort controller for this completion
    abortControllerRef.current = new AbortController();

    const updatedMessages = await runAgenticLoop(
      clientRef.current,
      config.model,
      [...completionMessages, userMessage],
      trimmed,
      (event: AgentEvent) => {
        switch (event.type) {
          case 'text_delta':
            setCompletionMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (event.content || '') }];
              }
              return [...prev, { role: 'assistant', content: event.content || '' }];
            });
            break;
          case 'tool_call':
            if (event.toolCall) {
              setCompletionMessages((prev) => {
                const assistantMsg = {
                  role: 'assistant' as const,
                  content: '',
                  tool_calls: [{
                    id: event.toolCall!.id,
                    type: 'function' as const,
                    function: { name: event.toolCall!.name, arguments: event.toolCall!.args },
                  }],
                };
                return [...prev, assistantMsg as any];
              });
            }
            break;
          case 'tool_result':
            if (event.toolCall) {
              setCompletionMessages((prev) => [
                ...prev,
                {
                  role: 'tool',
                  tool_call_id: event.toolCall!.id,
                  content: event.toolCall!.result || '',
                } as any,
              ]);
            }
            break;
          case 'usage':
            if (event.usage) {
              setLastUsage(event.usage);
              setTotalCost((prev) => prev + event.usage!.cost);
            }
            break;
          case 'iteration_done':
            // Reset assistant message tracker between iterations
            break;
          case 'error':
            setError(event.error || 'Unknown error');
            break;
          case 'done':
            break;
        }
      },
      {
        pricing: pricing || undefined,
        abortSignal: abortControllerRef.current.signal,
        requestDefaults,
      }
    );

    // Update session
    if (session) {
      session.completionMessages = updatedMessages;
      session.todos = getTodosForSession(session.id);
      session.title = generateTitle(updatedMessages);
      await saveSession(session);
    }

    setCompletionMessages(updatedMessages);
  } catch (err: any) {
    setError(`Error: ${err.message}`);
  } finally {
    setLoading(false);
  }
}, [loading, config, completionMessages]);
```

Add session ID display in the UI (after the usage display):

```typescript
{session && (
  <Box marginTop={1}>
    <Text dimColor>Session: {session.id}</Text>
  </Box>
)}
```

## Verification

```bash
npm run dev
```

Have a conversation, then press Ctrl+C to quit. Check that a session file was created in `~/.local/share/protoagent/sessions/` (or `AppData/Local/protoagent/sessions` on Windows). The filename should be an 8-character alphanumeric ID like `a1b2c3d4.json`.

Resume the session:

```bash
npm run dev -- --session a1b2c3d4
```

Replace `a1b2c3d4` with your actual session ID. You should see prior messages restored and the conversation continuing from where you left off.

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-10`.

## Core takeaway

Sessions are not just storage. They are what let a long-running coding task survive real life — terminals close, machines restart, but the work continues.

---

## Security Considerations

Sessions introduce a new security concern: credential storage. When the agent uses tools that interact with APIs, those API keys can end up in the conversation history.

### The Credential Leakage Problem

**What Can Go Wrong:**

Imagine this conversation:

```
User: Test the OpenAI API for me
Agent: [Uses bash tool with OPENAI_API_KEY=sk-abc123...]
```

The API key (`sk-abc123...`) is now in the conversation history. When we save the session, that key gets written to disk in plaintext.

**Why This Matters:**

1. **Multi-user systems**: Other users with file access can read your API keys
2. **Backup exposure**: Session files in backups expose credentials
3. **Version control**: Accidentally committing session files leaks keys
4. **Shared development**: Team members might see each other's keys

**The Naive Approach:**

Simply save the session as-is:

```typescript
await fs.writeFile(
  sessionPath,
  JSON.stringify(session, null, 2)
);
```

This writes everything—including API keys—to disk.

### Credential Redaction

**Our Solution:**

We sanitize messages before saving, redacting credential patterns:

```typescript
function sanitizeSessionForSave(session: Session): Session {
  const sanitizedMessages = session.completionMessages.map((msg) => {
    if (typeof msg.content === 'string') {
      // Redact OpenAI API keys
      msg.content = msg.content.replace(
        /sk-[a-zA-Z0-9]{48}/g,
        'sk-***REDACTED***'
      );
    }
    // Also sanitize tool_calls arguments
    if (Array.isArray(msgAny.tool_calls)) {
      msgAny.tool_calls = msgAny.tool_calls.map((tc: any) => {
        if (tc.function?.arguments) {
          tc.function.arguments = tc.function.arguments
            .replace(/sk-[a-zA-Z0-9]{48}/g, 'sk-***REDACTED***');
        }
        return tc;
      });
    }
    return msg;
  });
  return { ...session, completionMessages: sanitizedMessages };
}
```

**What Gets Redacted:**
- OpenAI API keys (`sk-...`)
- Anthropic keys (`sk-ant-...`)
- Google AI keys (`AIza...`)
- Bearer tokens
- AWS access keys (`AKIA...`)

### File Permissions

**Defense in Depth:**

Even with redaction, we set restrictive file permissions:

```typescript
const SESSION_DIR_MODE = 0o700;   // Owner: rwx, Others: nothing
const SESSION_FILE_MODE = 0o600;  // Owner: rw-, Others: nothing
```

This means:
- Only the owner can read/write session files
- Other users on the system cannot access them
- The session directory itself is protected

**Note on Encryption:**

You might wonder: "Why not encrypt the session files?"

We considered this, but it's a trade-off:
- **Pros**: Better protection if file permissions are bypassed
- **Cons**: Requires password/key management, adds complexity

Industry practice (pi-mono, Claude Code, etc.) uses filesystem permissions without encryption. For a tutorial codebase, we follow this approach. If you need encryption for your use case, you could:
1. Prompt for a password on startup
2. Use the OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
3. Use a hardware security module (HSM)

### Session ID Validation

**Preventing Path Traversal:**

Session IDs are user-provided (via `--session` flag). We validate them:

```typescript
const SESSION_ID_PATTERN = /^[0-9a-z]{8}$/i;

function assertValidSessionId(id: string): void {
  if (!SESSION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid session ID: ${id}`);
  }
}
```

This prevents attacks like:
```bash
--session ../../../etc/passwd
```

### Summary of Session Security

1. **Credential redaction**: API keys are masked before saving
2. **File permissions**: 0o600/0o700 restricts access to owner
3. **ID validation**: Prevents path traversal attacks
4. **No encryption**: Relies on filesystem permissions (industry standard)

Sessions are stored in `~/.local/share/protoagent/sessions/` with these protections. The credential redaction is particularly important—without it, your API keys would persist on disk in every conversation that mentions them.

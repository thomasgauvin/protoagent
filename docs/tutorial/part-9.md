# Part 9: Skills & Sessions

Two features that make the difference between a demo and a tool you actually use: skills let you customise how the agent behaves, and sessions let you pick up where you left off.

## What you'll build

- A skills loader that discovers `.md` files from `.protoagent/skills/` and `~/.config/protoagent/skills/`
- System prompt injection — skill content gets appended to the prompt automatically
- Session save/load/list/delete to `~/.local/share/protoagent/sessions/`
- The `--session <id>` CLI flag for resuming conversations

## Key concepts

- **User customisation without code** — skills are just markdown files. Drop one in, restart, and the agent follows your instructions.
- **Conversation persistence** — serialise the messages array to a JSON file. It's the simplest approach that works.
- **Session management** — listing past sessions, resuming them, cleaning up old ones.

## Skills: customisation without code

Most coding agents are opinionated out of the box. They format code how they want, pick patterns they prefer, and generally ignore whatever conventions your team uses. You can fight this by writing elaborate prompts every time, or you can build a system where users drop a markdown file into a folder and the agent just follows it.

That's what skills are. A skill is a `.md` file — nothing more — that gets loaded and injected into the system prompt. Want the agent to always use 2-space indentation? Write a skill. Want it to follow your team's commit message format? Write a skill. Want it to know about your deployment pipeline? Write a skill.

There are two places skills can live:

- **Project skills** — `.protoagent/skills/` in the current working directory. These are project-specific: coding conventions, architecture decisions, deployment quirks. You'd typically commit this folder to your repo so every team member gets the same behaviour.
- **Global skills** — `~/.config/protoagent/skills/` in your home directory. These are personal preferences that follow you across every project: your preferred testing patterns, how you like error messages formatted, whatever.

```typescript
const PROJECT_SKILLS_DIR = path.join(process.cwd(), '.protoagent', 'skills');
const GLOBAL_SKILLS_DIR = path.join(os.homedir(), '.config', 'protoagent', 'skills');
```

The interface is minimal:

```typescript
export interface Skill {
  name: string;     // filename without extension
  source: string;   // 'project' or 'global'
  content: string;  // markdown content
}
```

The `name` is just the filename with `.md` stripped off. A file called `code-style.md` becomes a skill named `code-style`. The `source` tracks where it came from — useful for debugging when you're wondering why the agent is doing something unexpected.

## Loading and merging

`loadSkillsFromDir` is the workhorse. It reads a directory, filters for `.md` files, reads each one, and returns an array of `Skill` objects:

```typescript
async function loadSkillsFromDir(dir: string, source: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      if (!entry.endsWith('.md')) continue;
      try {
        const content = await fs.readFile(path.join(dir, entry), 'utf8');
        skills.push({
          name: entry.replace(/\.md$/, ''),
          source,
          content: content.trim(),
        });
        logger.debug(`Loaded skill: ${entry} (${source})`);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Directory doesn't exist — that's fine
  }

  return skills;
}
```

Two nested try/catch blocks, and both swallow their errors silently. That's deliberate. The outer one handles the case where the skills directory doesn't exist — which is the default state for most users. The inner one handles individual files that can't be read for whatever reason. In both cases, the right thing to do is just move on. Skills are optional. You don't want the agent to crash because someone has a broken symlink in their skills folder.

The `loadSkills` function calls `loadSkillsFromDir` twice — once for global, once for project — and merges the results:

```typescript
export async function loadSkills(): Promise<Skill[]> {
  const globalSkills = await loadSkillsFromDir(GLOBAL_SKILLS_DIR, 'global');
  const projectSkills = await loadSkillsFromDir(PROJECT_SKILLS_DIR, 'project');

  // Project skills override global skills with the same name
  const merged = new Map<string, Skill>();
  for (const skill of globalSkills) merged.set(skill.name, skill);
  for (const skill of projectSkills) merged.set(skill.name, skill);

  return Array.from(merged.values());
}
```

The ordering matters. Global skills go into the Map first, then project skills. Since a Map replaces the value for a key that already exists, a project skill with the same filename as a global skill wins. This is the override mechanic.

Why would you want this? Say you have a global `code-style.md` that says "use 4-space indentation" — your personal preference. But one of your projects uses 2-space. You drop a `code-style.md` into that project's `.protoagent/skills/` directory, and it takes precedence. No conflict, no merging of content, just a clean replacement.

## How skills reach the agent

The path from a `.md` file on disk to the LLM actually reading it is straightforward. In `system-prompt.ts`, `generateSystemPrompt()` calls `loadSkills()` and conditionally injects the results:

```typescript
const skills = await loadSkills();

const skillsSection = skills.length > 0
  ? `\n## Loaded Skills:\n\n${skills.map((s) => `### ${s.name}\n${s.content}`).join('\n\n')}\n`
  : '';
```

If there are no skill files, `skillsSection` is an empty string and nothing gets added to the prompt. No wasted tokens. When skills exist, each one gets its own `###` heading with the skill name, and its full markdown content goes right below it.

So the chain is:

1. You create `.protoagent/skills/code-style.md`
2. `loadSkills()` discovers it, reads it, returns a `Skill` object
3. `generateSystemPrompt()` formats it as a section in the system prompt
4. The system prompt becomes the first message in the conversation
5. Every response the LLM generates is shaped by those instructions

The system prompt is regenerated fresh on every session start — it's not cached. So if you add, edit, or delete a skill file between sessions, the next session picks up the change automatically.

## Example skill

Here's what a real skill file might look like. Save this as `.protoagent/skills/code-style.md`:

```markdown
# Code Style

- Use 2-space indentation
- Always use TypeScript strict mode
- Prefer `const` over `let`
- Use named exports, not default exports
- Error messages should be lowercase and start with a verb: "failed to parse config"
- No abbreviations in variable names — `message` not `msg`, `response` not `res`
```

Or something more specific to a project's architecture:

```markdown
# Project Architecture

This is a Next.js app with the App Router. Key things to know:

- All API routes live in `src/app/api/` and use Route Handlers
- Database access goes through Drizzle ORM — schemas are in `src/db/schema.ts`
- Auth uses NextAuth v5 — the config is in `src/auth.ts`
- Never import server-only code in client components
```

There's no schema, no special syntax, no required headings. It's just markdown. The LLM reads it as natural language instructions, which is exactly what it's good at interpreting.

## Sessions: picking up where you left off

The other half of this part is session persistence. Without it, every time you close the terminal you lose the entire conversation. The agent forgets what files it edited, what decisions you made, what it learned about your codebase. That's fine for quick one-off tasks, but terrible for anything that spans more than a few minutes.

The `Session` interface captures everything needed to resume:

```typescript
export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: string;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}
```

The `id` is a UUID from `crypto.randomUUID()`. The `model` and `provider` fields record what you were using — useful context if you switch models between sessions. The `messages` array is the full OpenAI message history: system messages, user messages, assistant messages, tool calls, tool results, everything.

Storing the full messages array is a deliberate choice. You could try to be clever and only store user messages, then replay them. But that loses all the tool call history, the assistant's reasoning, the system prompt at the time. The messages array is the conversation. Serialising it verbatim means restoring a session puts you back exactly where you were.

There's also a `SessionSummary` for listing sessions without loading the full message history:

```typescript
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}
```

This keeps `listSessions` fast — you only need the metadata, not megabytes of conversation history.

## Save and load

Sessions are stored as JSON files in a platform-appropriate location:

```typescript
function getSessionsDir(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'sessions');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'sessions');
}
```

On macOS and Linux, that's `~/.local/share/protoagent/sessions/`. On Windows, it's `AppData/Local/protoagent/sessions`. Following platform conventions for data storage — not dumping things in the home directory root.

Each session is a single JSON file named `{id}.json`. Creating a new session is synchronous — it's just building an object in memory:

```typescript
export function createSession(model: string, provider: string): Session {
  return {
    id: crypto.randomUUID(),
    title: 'New session',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    provider,
    messages: [],
  };
}
```

Saving writes it to disk. The `updatedAt` timestamp gets refreshed every time you save, so you always know when the last exchange happened:

```typescript
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();
  const filePath = sessionPath(session.id);
  await fs.writeFile(filePath, JSON.stringify(session, null, 2), 'utf8');
  logger.debug(`Session saved: ${session.id}`);
}
```

`ensureSessionsDir()` creates the directory tree if it doesn't exist — `fs.mkdir` with `recursive: true`. This means the first time you run ProtoAgent, it quietly creates the sessions directory. No setup step needed.

The JSON is pretty-printed with 2-space indentation (`JSON.stringify(session, null, 2)`). This makes session files human-readable if you ever need to inspect them, at the cost of slightly larger files. For conversation data, readability wins.

Loading is the inverse:

```typescript
export async function loadSession(id: string): Promise<Session | null> {
  try {
    const content = await fs.readFile(sessionPath(id), 'utf8');
    return JSON.parse(content) as Session;
  } catch {
    return null;
  }
}
```

Returns `null` if the file doesn't exist or can't be parsed. The caller decides what to do — in `App.tsx`, a missing session shows an error message and falls through to creating a new one.

## Listing and managing sessions

`listSessions` reads every `.json` file in the sessions directory, parses each one, extracts the summary fields, and returns them sorted by most recently updated:

```typescript
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
        messageCount: session.messages.length,
      });
    } catch {
      // Skip corrupt session files
    }
  }

  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}
```

This is not the most efficient approach — it reads and parses every session file just to extract metadata. For hundreds of sessions, you'd want an index file or a SQLite database. But for a typical user with a few dozen sessions, it's fast enough and keeps the implementation dead simple. No index to maintain, no corruption to worry about, no migration scripts.

The sort puts the most recently updated session first. That's almost always the one you want when you're looking at a list of past sessions.

Deleting is just unlinking the file:

```typescript
export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}
```

Returns `true` if it worked, `false` if the file didn't exist. No confirmation prompt at this layer — that's a UI concern.

Session titles come from `generateTitle`, which takes the simplest possible approach:

```typescript
export function generateTitle(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg || !('content' in firstUserMsg) || typeof firstUserMsg.content !== 'string') {
    return 'New session';
  }
  const content = firstUserMsg.content;
  if (content.length <= 60) return content;
  return content.slice(0, 57) + '...';
}
```

It finds the first user message and truncates it to 60 characters. That's it. No LLM summarisation call, no clever heuristics. "Fix the type error in auth.ts" is already a pretty good title for a session. If the message is longer — like a multi-paragraph feature request — you get the first 57 characters plus an ellipsis. Good enough.

## The --session flag

The CLI wiring for session resume is in `cli.tsx`:

```typescript
program
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    render(
      <App
        dangerouslyAcceptAll={options.dangerouslyAcceptAll || false}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });
```

The `sessionId` flows into `App.tsx` as a prop. During initialisation, the component checks if a session ID was provided and tries to load it:

```typescript
// Load or create session
let loadedSession: Session | null = null;
if (sessionId) {
  loadedSession = await loadSession(sessionId);
  if (loadedSession) {
    setSession(loadedSession);
    setMessages(loadedSession.messages);
    // Rebuild chat history from loaded messages
    const history: { role: string; content: string }[] = [];
    for (const msg of loadedSession.messages) {
      if ((msg.role === 'user' || msg.role === 'assistant') &&
          'content' in msg && typeof msg.content === 'string') {
        history.push({ role: msg.role, content: msg.content });
      }
    }
    setChatHistory(history);
  } else {
    setError(`Session "${sessionId}" not found. Starting a new session.`);
  }
}

if (!loadedSession) {
  const initialMessages = await initializeMessages();
  setMessages(initialMessages);

  const newSession = createSession(loadedConfig.model, loadedConfig.provider);
  newSession.messages = initialMessages;
  setSession(newSession);
}
```

When a session loads successfully, two things happen. First, the full messages array is restored — this is what gets sent to the LLM on the next turn, so it has the entire conversation history. Second, the chat history for the UI is rebuilt by pulling out just the user and assistant text messages. Tool calls and system messages don't show up in the chat display, but they're still in the messages array where the LLM can see them.

If the session ID doesn't match any file, the user gets an error message and a fresh session starts. No crash, no blank screen.

After every exchange — regardless of whether this is a new or resumed session — the session gets saved:

```typescript
if (session) {
  session.messages = updatedMessages;
  session.title = generateTitle(updatedMessages);
  await saveSession(session);
}
```

The title is regenerated each time. That might seem wasteful, but `generateTitle` is just string slicing — no API calls. And it means if the first user message was somehow empty at creation time but now has content, the title updates correctly.

The session ID also shows up in the header bar — truncated to the first 8 characters, like a git short hash. Enough to identify it without cluttering the UI:

```typescript
{session && <Text dimColor> | Session: {session.id.slice(0, 8)}</Text>}
```

To resume a session, you'd run something like:

```bash
protoagent --session a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

You get the full ID from `listSessions`. In practice, you'd probably build a session picker UI or a slash command for this — but the plumbing is all here.

---

**Next up:** [Part 10: MCP & Sub-agents](./part-10.md) — plugging in external tools with the Model Context Protocol, and delegating tasks to isolated child conversations.

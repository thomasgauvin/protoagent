# Part 7: System Prompt

The system prompt is how you tell the agent who it is and what it's working on. A generic system prompt gets generic results. A system prompt that includes the project's directory tree, available tools, and coding conventions gets much better results.

## What you'll build

- Dynamic system prompt generation that includes project context
- A filtered directory tree (depth 3, excluding `node_modules`, `dist`, `.git`, etc.)
- Auto-generated tool descriptions from the JSON schemas
- Behavioural guidelines — when to use edit vs write, when to read before editing, how to track multi-step tasks

## Key concepts

- **Prompt engineering** — system prompt design has a massive impact on how well the agent performs. Too little context and it makes bad decisions. Too much and you burn through your context window.
- **Project awareness** — including a directory tree helps the agent navigate without needing to `list_directory` everything first.
- **Self-documenting tools** — the tool schemas already describe what each tool does. We reuse them in the prompt rather than maintaining separate documentation.

## Why the system prompt matters

Every message in a conversation has a role — `user`, `assistant`, or `system`. The system message is special. It's the first thing the model sees, it persists across the entire conversation, and it shapes every response the model generates. If you tell the model it's a coding assistant with file system access, it'll behave like one. If you don't, it'll behave like a generic chatbot that hallucinates file contents instead of reading them.

The system prompt is also where you set boundaries. Without explicit instructions like "read files before editing them," the model will happily overwrite files based on its best guess of what's in them. Without "prefer `edit_file` over `write_file`," it'll rewrite entire files when it only needs to change one line. These aren't suggestions — they're load-bearing instructions that prevent real damage.

Our system prompt in `src/system-prompt.ts` is built dynamically every time a session starts. It pulls in the actual project structure, the actual tools available, and any skills the user has configured. Nothing is hard-coded documentation that can drift out of sync.

## Project context: the directory tree

The first thing we give the model is a map of the project. Without this, the agent's first move on almost any task is to call `list_directory` a few times to orient itself — wasting tokens and time.

`buildDirectoryTree` walks the project directory recursively and builds a simple indented text representation:

```typescript
async function buildDirectoryTree(
  dirPath = '.',
  depth = 0,
  maxDepth = 3
): Promise<string> {
  if (depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  let tree = '';

  try {
    const fullPath = path.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    // Filter out hidden files, build artifacts, and noise directories so the tree stays readable
    const filtered = entries.filter((e) => {
      const n = e.name;
      return (
        !n.startsWith('.') &&
        !['node_modules', 'dist', 'build', 'coverage', '__pycache__', '.git'].includes(n) &&
        !n.endsWith('.log')
      );
    });

    // Cap at 20 entries per directory — prevents flat directories from dominating the context window
    for (const entry of filtered.slice(0, 20)) {
      if (entry.isDirectory()) {
        tree += `${indent}${entry.name}/\n`;
        tree += await buildDirectoryTree(
          path.join(dirPath, entry.name),
          depth + 1,
          maxDepth
        );
      } else {
        tree += `${indent}${entry.name}\n`;
      }
    }

    if (filtered.length > 20) {
      tree += `${indent}... (${filtered.length - 20} more)\n`;
    }
  } catch {
    // Can't read directory — skip
  }

  return tree;
}
```

Three constraints keep this from blowing up:

**Depth limit of 3.** Most projects have meaningful structure in the first three levels — `src/tools/`, `src/utils/`, `docs/tutorial/`. Beyond that, you're usually in implementation details the model doesn't need upfront. It can always `list_directory` deeper if needed.

**Noise filtering.** Dotfiles, `node_modules`, `dist`, `build`, `coverage`, `__pycache__`, `.git`, and `.log` files are all excluded. These add nothing useful to the model's understanding of the project structure and they'd dominate the tree if included — a typical `node_modules` folder has thousands of entries.

**Entry cap of 20 per directory.** If a directory has 50 files, we show the first 20 and append `... (30 more)`. This prevents a single flat directory — like a `components/` folder with 80 files — from eating a huge chunk of the context window.

The output looks something like:

```
src/
  tools/
    index.ts
    read-file.ts
    write-file.ts
    edit-file.ts
    bash.ts
  utils/
    logger.ts
    path-security.ts
  App.tsx
  agentic-loop.ts
  system-prompt.ts
docs/
  tutorial/
    part-1.md
    part-2.md
package.json
tsconfig.json
```

Readable, compact, and enough for the model to know where things are.

## Self-documenting tools

Here's one of the nicer design payoffs from using JSON schemas for tool definitions back in Parts 4-6. We already have structured descriptions of every tool — name, description, parameters, which ones are required. `generateToolDescriptions()` just reformats that same data for the system prompt:

```typescript
function generateToolDescriptions(): string {
  return getAllTools()
    .map((tool, i) => {
      const fn = tool.function;
      const params = fn.parameters as {
        required?: string[];
        properties?: Record<string, any>;
      };
      const required = params.required || [];
      const props = Object.keys(params.properties || {});
      const paramList = props
        .map((p) => `${p}${required.includes(p) ? ' (required)' : ' (optional)'}`)
        .join(', ');
      return `${i + 1}. **${fn.name}** — ${fn.description}\n   Parameters: ${paramList || 'none'}`;
    })
    .join('\n\n');
}
```

This pulls the tool list from `getAllTools()` — the same registry the agentic loop uses to dispatch tool calls. So when you add a new tool, it automatically appears in both the API's `tools` parameter and the system prompt's tool descriptions. No separate documentation to maintain. No chance of them drifting out of sync.

The output for each tool looks like:

```
1. **read_file** — Read the contents of a file
   Parameters: file_path (required), offset (optional), limit (optional)

2. **edit_file** — Edit a file by replacing exact text matches
   Parameters: file_path (required), old_string (required), new_string (required), expected_replacements (optional)
```

You might wonder — doesn't the model already know about the tools from the `tools` parameter in the API call? It does. But including a readable summary in the system prompt gives the model a quick reference it can "glance" at without parsing JSON schemas. Think of it as the difference between having API docs open in a tab versus having to read the OpenAPI spec every time.

## Skills injection

Skills are markdown files that get injected into the system prompt — project-specific conventions, coding standards, deployment instructions, whatever the user wants the agent to always keep in mind. They're loaded from `.protoagent/skills/` in the project directory or `~/.config/protoagent/skills/` globally.

The system prompt conditionally includes them:

```typescript
const skills = await loadSkills();

const skillsSection = skills.length > 0
  ? `\n## Loaded Skills:\n\n${skills.map((s) => `### ${s.name}\n${s.content}`).join('\n\n')}\n`
  : '';
```

If there are no skill files, the section is just an empty string and doesn't appear in the prompt at all. No wasted tokens. When skills are present, each one gets its own heading with the filename (minus the `.md` extension) as the title.

We'll dig into the full skills system — how `loadSkills()` merges project and global skills, how project skills override global ones with the same name — in [Part 9](./part-9.md). For now, the important thing is that the system prompt knows how to include them.

## Guidelines and rules

The last sections of the system prompt are the behavioral instructions. These are the rails that keep the agent from doing dumb or dangerous things.

```typescript
## Guidelines

1. **Always read files before editing them** to understand the current content.
2. **Prefer edit_file over write_file** for existing files.
3. **Use TODO tracking** (todo_write / todo_read) for any task with more than 2 steps.
4. **Shell commands**: safe commands (ls, grep, git status, etc.) run automatically.
   Other commands require user approval. Some dangerous commands are blocked.
5. **Be concise** in your responses. Show what you're doing and why.
6. **Search first** when you need to find something — use search_files or bash with grep/find.
```

Each of these exists because without it, the model does the wrong thing often enough to matter:

1. **Read before editing** — without this, the model will fabricate file contents based on what it thinks should be there, then edit based on that fiction. The edit fails because the `old_string` doesn't match, or worse, it matches something unexpected.

2. **Prefer edit over write** — left to its own devices, the model tends to rewrite entire files. That's fine for a 20-line config file, but for a 500-line module it means regenerating the whole thing — slow, expensive, and prone to subtle omissions.

3. **TODO tracking** — multi-step tasks are where agents lose the thread. "Refactor the auth module" is five or six discrete steps, and without a checklist the model will forget step three after getting deep into step two. The TODO tools give it a scratchpad.

4. **Shell command safety** — reminding the model about the approval tiers from Part 6. Without this, it tends to chain dangerous commands or get confused when something blocks.

5. **Be concise** — models love to explain themselves at length. In a coding agent, you want to see the action, not a five-paragraph essay about why the action is correct.

6. **Search first** — without this nudge, the model will often guess at file paths or grep patterns instead of using the tools available to it.

Then there's the file operation rules section:

```typescript
## File Operation Rules

- ALWAYS use read_file before editing to get exact content
- NEVER write over existing files unless explicitly asked — use edit_file instead
- Create parent directories before creating files in them
- Use bash for package management, git, building, testing, etc.
- When running interactive commands, add flags to avoid prompts (--yes, --template, etc.)
```

These overlap with the guidelines intentionally. The model benefits from hearing the same instruction in slightly different words. The last point — about `--yes` flags — prevents a common failure mode where the agent runs `npm init` or `npx create-next-app` and then hangs forever waiting for interactive input that will never come.

## Putting it all together

`generateSystemPrompt()` assembles everything into a single string:

```typescript
export async function generateSystemPrompt(): Promise<string> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const tree = await buildDirectoryTree();
  const toolDescriptions = generateToolDescriptions();
  const skills = await loadSkills();

  const skillsSection = skills.length > 0
    ? `\n## Loaded Skills:\n\n${skills.map((s) => `### ${s.name}\n${s.content}`).join('\n\n')}\n`
    : '';

  return `You are ProtoAgent, a coding assistant with file system and shell command capabilities.
Your job is to help the user complete coding tasks in their project.

## Project Context

**Working Directory:** ${cwd}
**Project Name:** ${projectName}

**Project Structure:**
${tree}

## Available Tools

${toolDescriptions}
${skillsSection}
## Guidelines
...
## File Operation Rules
...`;
}
```

The structure is deliberate. Identity and role come first — the model needs to know what it is before anything else. Then project context, so it understands its environment. Then tools, so it knows its capabilities. Then skills for project-specific knowledge. Then guidelines and rules last, as the behavioral frame.

The entry point for the rest of the system is `initializeMessages()` in `agentic-loop.ts`, which creates the initial conversation with the system prompt as the first message:

```typescript
export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt } as Message];
}
```

This gets called once when the session starts. The system message sits at index 0 of the messages array and stays there for the entire conversation. Every subsequent user message and assistant response builds on top of it.

One thing worth noting — the system prompt is generated fresh each time you start a session, not cached. This means if you add files to the project, create a new skill, or register a new tool between sessions, the next session's prompt reflects those changes automatically.

---

**Next up:** [Part 8: Compaction & Cost Tracking](./part-8.md) — what happens when the conversation gets too long for the context window, and how to keep track of what you're spending.

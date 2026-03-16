# Part 7: System Prompt & Runtime Policy

The system prompt is where ProtoAgent stops being "a model with tools" and becomes "this specific coding agent with this specific workflow." Instead of a static string, the prompt is generated at runtime — reflecting the actual working directory, project structure, and available tools.

## What you are building

Starting from Part 6, you add:

- `src/system-prompt.ts` — dynamic system prompt generator
- Updated `src/agentic-loop.ts` — uses `generateSystemPrompt()` for the `initializeMessages` function
- Updated `src/App.tsx` — calls `initializeMessages()` which now uses the generated prompt

## Step 1: Create `src/system-prompt.ts`

Create the file:

```bash
touch src/system-prompt.ts
```

This module builds the system prompt dynamically from the runtime environment:

- Discovers the working directory and project name
- Builds a filtered directory tree (depth 3, excludes noise)
- Auto-generates tool descriptions from the tool registry schemas
- Includes workflow guidelines for the model

```typescript
// src/system-prompt.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllTools } from './tools/index.js';

/** Build a filtered directory tree (depth 3, excludes noise). */
async function buildDirectoryTree(dirPath = '.', depth = 0, maxDepth = 3): Promise<string> {
  if (depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  let tree = '';

  try {
    const fullPath = path.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const filtered = entries.filter((e) => {
      const n = e.name;
      return !n.startsWith('.') && !['node_modules', 'dist', 'build', 'coverage', '__pycache__', '.git'].includes(n) && !n.endsWith('.log');
    });

    for (const entry of filtered.slice(0, 20)) {
      if (entry.isDirectory()) {
        tree += `${indent}${entry.name}/\n`;
        tree += await buildDirectoryTree(path.join(dirPath, entry.name), depth + 1, maxDepth);
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

/** Auto-generate tool descriptions from their JSON schemas. */
function generateToolDescriptions(): string {
  return getAllTools()
    .map((tool, i) => {
      const fn = tool.function;
      const params = fn.parameters as { required?: string[]; properties?: Record<string, any> };
      const required = params.required || [];
      const props = Object.keys(params.properties || {});
      const paramList = props
        .map((p) => `${p}${required.includes(p) ? ' (required)' : ' (optional)'}`)
        .join(', ');
      return `${i + 1}. ${fn.name} — ${fn.description}\n   Parameters: ${paramList || 'none'}`;
    })
    .join('\n\n');
}

/** Generate the complete system prompt. */
export async function generateSystemPrompt(): Promise<string> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const tree = await buildDirectoryTree();
  const toolDescriptions = generateToolDescriptions();

  return `You are ProtoAgent, a coding assistant with file system and shell command capabilities.
Your job is to help the user complete coding tasks in their project.

PROJECT CONTEXT

Working Directory: ${cwd}
Project Name: ${projectName}

PROJECT STRUCTURE:
${tree}

AVAILABLE TOOLS

${toolDescriptions}

GUIDELINES

OUTPUT FORMAT:
- You are running in a terminal. Be concise. Optimise for scannability.
- Use **bold** for important terms, *italic* for references.
- Use flat bullet lists with emojis to communicate information densely (e.g. ✅ done, ❌ failed, 📁 file, 🔍 searching).
- NEVER use nested indentation. Keep all lists flat — one level only.

WORKFLOW:
- Before making tool calls, briefly explain what you're about to do and why.
- Always read files before editing them.
- Prefer edit_file over write_file for existing files.
- Use TODO tracking (todo_write / todo_read) by default for almost all work.
- Start by creating or refreshing the TODO list before doing substantive work, then keep it current throughout the task.
- Search first when you need to find something — use search_files or bash with grep/find.
- Shell commands: safe commands (ls, grep, git status, etc.) run automatically. Other commands require user approval.

FILE OPERATIONS:
- ALWAYS use read_file before editing to get exact content.
- NEVER write over existing files unless explicitly asked — use edit_file instead.
- Create parent directories before creating files in them.
- Use bash for package management, git, building, testing, etc.

IMPLEMENTATION STANDARDS:
- Thorough investigation: Before implementing, understand the existing codebase, patterns, and related systems.
- Completeness: Ensure implementations are complete and tested, not partial or left in a broken state.
- Code quality: Follow existing code style and conventions.`;
}
```

## Step 2: Update `src/agentic-loop.ts`

The `initializeMessages` function now uses the generated system prompt instead of a hardcoded string.

```typescript
// In src/agentic-loop.ts, update the initializeMessages function:

import { generateSystemPrompt } from './system-prompt.js';

export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt }];
}
```

The rest of the agentic loop stays the same as Part 4. The only change is this one function.

## Verification

```bash
npm run dev
```

Ask the model to describe the project:

```text
Explain the structure of this project.
```

You should see:
- The model using file tools more deliberately
- Answers that reflect the actual project structure (because the system prompt now includes the directory tree)
- Tool descriptions that match the actual registered tools

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-7`.

## Core takeaway

The system prompt is not static documentation. It is a runtime-generated contract between the app, the tool layer, and the model. When you add a tool, the prompt updates automatically. When you change the project structure, the tree updates. The model always sees an accurate picture of what it can do.

# Part 9: Skills & AGENTS.md

Skills and AGENTS.md solve related problems: how do you give the agent project-specific context without restating it in every conversation?

- [**AGENTS.md**](https://agents.md/) provides static project-wide instructions that load automatically from your project root. It's like a system prompt that the user can define as a configuration for a project without changing the code of ProtoAgent, and that is compatible with any other coding agent.
- [**Skills**](https://agentskills.io/home) provide on-demand specialized instructions that the agent loads only when needed. These are more specific to tasks and can include specific workflows. But they can also be large, which is why they are not all added to the messages passed to the LLM at once. Instead, they are only loaded when they are needed.

Together they let ProtoAgent adapt to each project's workflow without manual prompting.

## What you are building

Starting from Part 8, you add:

- `src/skills.ts` — skill discovery, validation, activation, and catalog generation
- Updated `src/system-prompt.ts` — includes AGENTS.md content and the skills catalog in the prompt
- Updated `src/utils/path-validation.ts` — adds `allowedRoots` so skill directories are readable

## Install new dependency

```bash
npm install yaml
```

## Step 1: Update path validation — `src/utils/path-validation.ts`

Skills live outside the project directory (e.g., `~/.config/protoagent/skills/`), so path validation needs to support additional allowed roots.

```typescript
// src/utils/path-validation.ts

import fs from 'node:fs/promises';
import path from 'node:path';

const workingDirectory = process.cwd();
let allowedRoots: string[] = [];

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedPath(targetPath: string): boolean {
  return isWithinRoot(targetPath, workingDirectory) || allowedRoots.some((root) => isWithinRoot(targetPath, root));
}

export async function setAllowedPathRoots(roots: string[]): Promise<void> {
  const normalizedRoots = await Promise.all(
    roots.map(async (root) => {
      const resolved = path.resolve(root);
      try {
        const realRoot = await fs.realpath(resolved);
        return [path.normalize(resolved), realRoot];
      } catch {
        return [path.normalize(resolved)];
      }
    })
  );

  allowedRoots = Array.from(new Set(normalizedRoots.flat()));
}

export function getAllowedPathRoots(): string[] {
  return [...allowedRoots];
}

export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  if (!isAllowedPath(normalized)) {
    throw new Error(`Path "${requestedPath}" is outside the working directory.`);
  }

  try {
    const realPath = await fs.realpath(normalized);
    if (!isAllowedPath(realPath)) {
      throw new Error(`Path "${requestedPath}" resolves (via symlink) outside the working directory.`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        if (!isAllowedPath(realParent)) {
          throw new Error(`Parent directory of "${requestedPath}" resolves outside the working directory.`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(`Parent directory of "${requestedPath}" does not exist.`);
      }
    }
    throw err;
  }
}

export function getWorkingDirectory(): string {
  return workingDirectory;
}
```

## Step 2: Create `src/skills.ts`

Create the file:

```bash
touch src/skills.ts
```

Skills use `SKILL.md` files with YAML frontmatter as defined in the [specification for agent skills](https://agentskills.io/home). Each skill lives in its own directory. The system discovers skills from multiple locations (project-level and user-level), validates them, and can activate them on demand.

```typescript
// src/skills.ts

import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  registerDynamicHandler,
  registerDynamicTool,
  unregisterDynamicHandler,
  unregisterDynamicTool,
} from './tools/index.js';
import { setAllowedPathRoots } from './utils/path-validation.js';

export interface Skill {
  name: string;
  description: string;
  source: 'project' | 'user';
  location: string;
  skillDir: string;
  body: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface SkillDiscoveryOptions {
  cwd?: string;
  homeDir?: string;
}

interface SkillRoot {
  dir: string;
  source: 'project' | 'user';
}

const ACTIVATE_SKILL_TOOL_NAME = 'activate_skill';
const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_RESOURCE_FILES = 200;

/**
 * Returns the list of directories to search for skills, ordered by precedence.
 * Necessary for: Defining where skills can be installed (user-global vs project-local)
 * and establishing priority (project skills override user skills with same name).
 */
function getSkillRoots(options: SkillDiscoveryOptions = {}): SkillRoot[] {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  return [
    { dir: path.join(homeDir, '.agents', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.protoagent', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.config', 'protoagent', 'skills'), source: 'user' },
    { dir: path.join(cwd, '.agents', 'skills'), source: 'project' },
    { dir: path.join(cwd, '.protoagent', 'skills'), source: 'project' },
  ];
}

// Parses SKILL.md content to extract YAML frontmatter and markdown body.
function parseFrontmatter(rawContent: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = rawContent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    throw new Error('SKILL.md must begin with YAML frontmatter delimited by --- lines.');
  }

  const document = YAML.parse(match[1]);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Frontmatter must parse to an object.');
  }

  return { frontmatter: document as Record<string, unknown>, body: match[2].trim() };
}

// Validates that a skill name follows the kebab-case naming convention.
function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && VALID_SKILL_NAME.test(name);
}

// Normalizes the metadata field from frontmatter into a clean string record.
function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, v]) => typeof v === 'string');
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

// Validates parsed frontmatter and constructs a complete Skill object.
function validateSkill(parsed: { frontmatter: Record<string, unknown>; body: string }, skillDir: string, source: 'project' | 'user', location: string): Skill {
  const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
  const description = typeof parsed.frontmatter.description === 'string' ? parsed.frontmatter.description.trim() : '';
  const compatibility = typeof parsed.frontmatter.compatibility === 'string' ? parsed.frontmatter.compatibility.trim() : undefined;
  const license = typeof parsed.frontmatter.license === 'string' ? parsed.frontmatter.license.trim() : undefined;
  const allowedToolsValue = typeof parsed.frontmatter['allowed-tools'] === 'string' ? parsed.frontmatter['allowed-tools'].trim() : undefined;

  if (!isValidSkillName(name)) throw new Error(`Skill name "${name}" is invalid.`);
  if (path.basename(skillDir) !== name) throw new Error(`Skill name "${name}" must match directory name "${path.basename(skillDir)}".`);
  if (!description || description.length > 1024) throw new Error('Skill description is required and must be 1-1024 characters.');

  return {
    name, description, source, location, skillDir, body: parsed.body,
    compatibility, license, metadata: normalizeMetadata(parsed.frontmatter.metadata),
    allowedTools: allowedToolsValue ? allowedToolsValue.split(/\s+/).filter(Boolean) : undefined,
  };
}

// Loads a single skill from a directory by reading and parsing its SKILL.md file.
async function loadSkillFromDirectory(skillDir: string, source: 'project' | 'user'): Promise<Skill | null> {
  const location = path.join(skillDir, 'SKILL.md');
  try {
    const rawContent = await fs.readFile(location, 'utf8');
    const parsed = parseFrontmatter(rawContent);
    const skill = validateSkill(parsed, skillDir, source, location);
    return skill;
  } catch (error) {
    return null;
  }
}

// Discovers all valid skills within a single skill root directory.
async function discoverSkillsInRoot(root: SkillRoot): Promise<Skill[]> {
  let entries: Dirent[] = [];
  try {
    entries = await fs.readdir(root.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const loaded = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => loadSkillFromDirectory(path.join(root.dir, entry.name), root.source))
  );

  return loaded.filter((skill): skill is Skill => skill !== null);
}

//Loads all skills from all skill roots, merging duplicates with project taking precedence.
export async function loadSkills(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const roots = getSkillRoots(options);
  const merged = new Map<string, Skill>();

  for (const root of roots) {
    const skills = await discoverSkillsInRoot(root);
    for (const skill of skills) {
      merged.set(skill.name, skill);
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// Escapes special XML characters in a string to prevent injection attacks.
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Builds the XML skills catalog section that appears in the system prompt.
export function buildSkillsCatalogSection(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const catalog = skills
    .map((skill) => [
      '  <skill>',
      `    <name>${escapeXml(skill.name)}</name>`,
      `    <description>${escapeXml(skill.description)}</description>`,
      `    <location>${escapeXml(skill.location)}</location>`,
      '  </skill>',
    ].join('\n'))
    .join('\n');

  return `AVAILABLE SKILLS

The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the ${ACTIVATE_SKILL_TOOL_NAME} tool with the skill's name before proceeding.

<available_skills>
${catalog}
</available_skills>`;
}

// Lists all resource files (scripts, references, assets) within a skill directory.
async function listSkillResources(skillDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    if (files.length >= MAX_RESOURCE_FILES) return;
    const absoluteDir = path.join(skillDir, relativeDir);
    let entries: Dirent[] = [];
    try { entries = await fs.readdir(absoluteDir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (files.length >= MAX_RESOURCE_FILES) return;
      const nextRelative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) { await walk(nextRelative); }
      else { files.push(nextRelative.split(path.sep).join('/')); }
    }
  }

  for (const dir of ['scripts', 'references', 'assets']) {
    await walk(dir);
  }
  return files.sort();
}

// Activates a skill by name, returning its content wrapped in XML for the agent.
export async function activateSkill(skillName: string, options: SkillDiscoveryOptions = {}): Promise<string> {
  const skills = await loadSkills(options);
  const skill = skills.find((entry) => entry.name === skillName);
  if (!skill) return `Error: Unknown skill "${skillName}".`;

  const resources = await listSkillResources(skill.skillDir);
  const resourcesBlock = resources.length > 0
    ? `<skill_resources>\n${resources.map((r) => `  <file>${escapeXml(r)}</file>`).join('\n')}\n</skill_resources>`
    : '<skill_resources />';

  return `<skill_content name="${escapeXml(skill.name)}">\n${skill.body}\n\nSkill directory: ${escapeXml(skill.skillDir)}\nRelative paths in this skill are relative to the skill directory.\n\n${resourcesBlock}\n</skill_content>`;
}

// Initializes the skill system at startup - loads skills, sets up security, registers the tool.
export async function initializeSkillsSupport(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const skills = await loadSkills(options);
  await setAllowedPathRoots(skills.map((skill) => skill.skillDir));

  if (skills.length === 0) {
    unregisterDynamicTool(ACTIVATE_SKILL_TOOL_NAME);
    unregisterDynamicHandler(ACTIVATE_SKILL_TOOL_NAME);
    return [];
  }

  registerDynamicTool({
    type: 'function',
    function: {
      name: ACTIVATE_SKILL_TOOL_NAME,
      description: 'Load the full instructions for a discovered skill so you can follow it for the current task.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: skills.map((skill) => skill.name),
            description: 'The exact skill name to activate.',
          },
        },
        required: ['name'],
      },
    },
  });

  registerDynamicHandler(ACTIVATE_SKILL_TOOL_NAME, async (args) => activateSkill(args.name, options));

  return skills;
}
```

## Step 3: Update `src/tools/index.ts`

Skills are different from AGENTS.md because they are loaded dynamically to avoid taking up space in the LLM's context window. Instead of loading all skill content at startup, we only load a lightweight catalog (name and description). When the agent encounters a task that matches a skill's description, it calls `activate_skill` to load the full skill content on-demand.

This requires a dynamic tool system - the `activate_skill` tool isn't hardcoded in our tools array. Instead, skills.ts registers it at runtime after discovering which skills are available. This way the tool's `enum` parameter always lists the currently installed skills.

Add dynamic tool support to `src/tools/index.ts`:

```typescript
// Add to src/tools/index.ts:
// src/tools/index.ts

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { bashTool, runBash } from './bash.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
}

export type DynamicTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  bashTool,
  todoReadTool,
  todoWriteTool,
  webfetchTool,
];

let dynamicTools: DynamicTool[] = [];

export function registerDynamicTool(tool: DynamicTool): void {
  const toolName = tool.function.name;
  dynamicTools = dynamicTools.filter((existing) => existing.function.name !== toolName);
  dynamicTools.push(tool);
}

export function unregisterDynamicTool(toolName: string): void {
  dynamicTools = dynamicTools.filter((tool) => tool.function.name !== toolName);
}

export function clearDynamicTools(): void {
  dynamicTools = [];
}

export function getAllTools() {
  return [...tools, ...dynamicTools];
}

// Dynamic tool handlers
const dynamicHandlers = new Map<string, (args: any) => Promise<string>>();

export function registerDynamicHandler(name: string, handler: (args: any) => Promise<string>): void {
  dynamicHandlers.set(name, handler);
}

export function unregisterDynamicHandler(name: string): void {
  dynamicHandlers.delete(name);
}

// Dispatch a tool call to the appropriate handler.
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
      case 'write_file':
        return await writeFile(args.file_path, args.content, context.sessionId);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'bash':
        return await runBash(args.command, args.timeout_ms, context.sessionId);
      case 'todo_read':
        return readTodos(context.sessionId);
      case 'todo_write':
        return writeTodos(args.todos, context.sessionId);
      case 'webfetch': {
        const result = await webfetch(args.url, args.format, args.timeout);
        return JSON.stringify(result);
      }
      default: {
        const handler = dynamicHandlers.get(toolName);
        if (handler) return await handler(args);
        return `Error: Unknown tool "${toolName}"`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${toolName}: ${msg}`;
  }
}
```

## Step 4: Update `src/system-prompt.ts`

Add both AGENTS.md loading and the skills catalog to the generated prompt.

Replace your `src/system-prompt.ts` with this updated version:

```typescript
// src/system-prompt.ts

import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllTools } from './tools/index.js';
import { buildSkillsCatalogSection, initializeSkillsSupport } from './skills.js';

/**
 * Load AGENTS.md content from cwd and parent directories.
 *
 * AGENTS.md (https://agents.md/) is a simple, open format for guiding coding agents.
 * It's like a README for agents — a dedicated place to give AI coding tools the
 * context they need to work on a project.
 */
async function loadAgentsMd(): Promise<{ content: string; path: string } | null> {
  let currentDir = path.resolve('.');

  while (true) {
    const agentsPath = path.join(currentDir, 'AGENTS.md');
    try {
      await fs.access(agentsPath);
      const content = await fs.readFile(agentsPath, 'utf-8');
      return { content, path: agentsPath };
    } catch {
      // File doesn't exist here — check parent
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
  }

  return null;
}

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
  const skills = await initializeSkillsSupport();
  const toolDescriptions = generateToolDescriptions();
  const skillsSection = buildSkillsCatalogSection(skills);
  const agentsMd = await loadAgentsMd();

  const agentsMdSection = agentsMd
    ? `\nAGENTS.md INSTRUCTIONS\n\nThe following instructions are from the AGENTS.md file at: ${agentsMd.path}\n\n${agentsMd.content}\n`
    : '';

  return `You are ProtoAgent, a coding assistant with file system and shell command capabilities.
Your job is to help the user complete coding tasks in their project.

PROJECT CONTEXT

Working Directory: ${cwd}
Project Name: ${projectName}

PROJECT STRUCTURE:
${tree}
${agentsMdSection}
AVAILABLE TOOLS

${toolDescriptions}
${skillsSection ? `\n${skillsSection}\n` : ''}
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

## About AGENTS.md

[AGENTS.md](https://agents.md/) is a simple, open format for guiding coding agents. Think of it as a README for agents — a dedicated place to give AI coding tools the context they need to work on your project.

ProtoAgent automatically loads `AGENTS.md` from your working directory and walks up parent directories until it finds one. If found, its contents are injected into the system prompt.

### Example AGENTS.md

```markdown
# Project Instructions

- Say 'BEEP BEEP' before every message

## Build
- Use `npm run build` to compile TypeScript
- Use `npm run dev` for development mode with hot reload

## Testing
- Run `npm test` for unit tests

## Code Style
- Use TypeScript strict mode
- Prefer named exports over default exports
```

### AGENTS.md vs Skills

| AGENTS.md | Skills (SKILL.md) |
|-----------|-------------------|
| Automatically loaded on startup | Loaded on-demand via `activate_skill` |
| Static project context | Specialized, task-specific instructions |
| Lives at project root | Lives in `.agents/skills/` directories |
| Always included in prompt | Only included when explicitly requested |

Use **AGENTS.md** for project-wide conventions that should always be available. Use **Skills** for specialized, reusable instructions that should only be loaded when needed.

## Verification

### Testing AGENTS.md

Create an `AGENTS.md` file in your project root:

```markdown
# Project Instructions

- Say 'BEEP BEEP' before every message

## Build
- Use `npm run build` to compile TypeScript
- Use `npm run dev` for development mode with hot reload

## Testing
- Run `npm test` for unit tests

## Code Style
- Use TypeScript strict mode
- Prefer named exports over default exports
```

Run the app and check that the AGENTS.md content appears in the system prompt. Ask the agent "how do I build this project?" — it should reference the build commands from AGENTS.md.

### Testing Skills

Create a test skill:

```bash
mkdir -p .protoagent/skills/test-conventions
```

Create `.protoagent/skills/test-conventions/SKILL.md`:

```markdown
---
name: test-conventions
description: Project testing conventions and standards
---

When writing tests for this project:
- Use vitest as the test runner
- Place test files next to source files with .test.ts extension
- Use describe/it blocks
```

Run the app and ask about testing conventions. The agent should discover the skill, show it in the available skills catalog, and activate it when relevant to the task.

```

 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> what are you skills?
BEEP BEEP

Here are the skills and capabilities I can use for this project environment:

- 🔍 **Available agent skills**
- ✅ **find-skills** — Helps discover/install agent skills when you ask things like
*“find a skill for X”* or *“is there a skill that can…”* (location:
.agents/skills/find-skills/SKILL.md)
- ✅ **test-conventions** — Provides project testing conventions and standards
(location: .protoagent/skills/test-conventions/SKILL.md)

tokens: 1057↓ 100↑ | ctx: 0% | cost: $0.0005
╭─────────────────────────────────────────────────────╮
│ > Type your message...                              │
╰─────────────────────────────────────────────────────╯
```

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-9`.

## Core takeaway

AGENTS.md and Skills are complementary ways to give the agent project context. AGENTS.md provides static, always-available instructions for the current project. Skills provide dynamic, on-demand instructions that can be shared across projects. Together they let ProtoAgent adapt to each project's workflow without manual prompting.

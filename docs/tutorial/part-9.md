# Part 9: Skills

Skills solve a practical problem: every real project has local conventions (tooling, deploy processes, test patterns) that you'd otherwise restate in every conversation. Skills let you package those conventions once as `SKILL.md` files, and the runtime discovers and exposes them automatically.

## What you are building

Starting from Part 8, you add:

- `src/skills.ts` — skill discovery, validation, activation, and catalog generation
- Updated `src/system-prompt.ts` — includes the skills catalog in the prompt
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

Skills use `SKILL.md` files with YAML frontmatter. Each skill lives in its own directory. The system discovers skills from multiple locations (project-level and user-level), validates them, and can activate them on demand.

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
import { logger } from './utils/logger.js';

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

function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && VALID_SKILL_NAME.test(name);
}

function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const entries = Object.entries(value).filter(([, v]) => typeof v === 'string');
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

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

async function loadSkillFromDirectory(skillDir: string, source: 'project' | 'user'): Promise<Skill | null> {
  const location = path.join(skillDir, 'SKILL.md');
  try {
    const rawContent = await fs.readFile(location, 'utf8');
    const parsed = parseFrontmatter(rawContent);
    const skill = validateSkill(parsed, skillDir, source, location);
    logger.debug(`Loaded skill: ${skill.name} (${source})`, { location });
    return skill;
  } catch (error) {
    logger.warn(`Skipping invalid skill at ${location}`, { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

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

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

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

  await Promise.all(['scripts', 'references', 'assets'].map((dir) => walk(dir)));
  return files.sort();
}

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

Add dynamic tool support so skills can register the `activate_skill` tool at runtime.

```typescript
// Add to src/tools/index.ts:

export type DynamicTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

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

// Update handleToolCall's default case:
// default: {
//   const handler = dynamicHandlers.get(toolName);
//   if (handler) return await handler(args);
//   return `Error: Unknown tool "${toolName}"`;
// }
```

## Step 4: Update `src/system-prompt.ts`

Add the skills catalog to the generated prompt.

```typescript
// At the top of system-prompt.ts, add:
import { buildSkillsCatalogSection, initializeSkillsSupport } from './skills.js';

// In generateSystemPrompt(), add:
const skills = await initializeSkillsSupport();
const skillsSection = buildSkillsCatalogSection(skills);

// Then include ${skillsSection} in the prompt template
```

## Verification

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

Run the app and ask about testing conventions. The agent should discover and activate the skill.

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-9`.

## Core takeaway

Skills are how ProtoAgent stays general-purpose without staying generic. Local conventions are packaged once and discovered automatically, so the agent adapts to each project's workflow without manual prompting.

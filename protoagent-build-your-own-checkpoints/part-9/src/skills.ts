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

// Returns the list of directories to search for skills, ordered by precedence.
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
/**
 * Skills — Load domain-specific instructions from markdown files.
 *
 * Skills are `.md` files in `.protoagent/skills/` (project-level) or
 * `~/.config/protoagent/skills/` (global). They are injected into the
 * system prompt so the agent follows project-specific conventions.
 *
 * Example skill file `.protoagent/skills/code-style.md`:
 *
 *   # Code Style
 *   - Use 2-space indentation
 *   - Always use TypeScript strict mode
 *   - Prefer `const` over `let`
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { logger } from './utils/logger.js';

export interface Skill {
  name: string;     // filename without extension
  source: string;   // 'project' or 'global'
  content: string;  // markdown content
}

const PROJECT_SKILLS_DIR = path.join(process.cwd(), '.protoagent', 'skills');
const GLOBAL_SKILLS_DIR = path.join(os.homedir(), '.config', 'protoagent', 'skills');

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

/**
 * Load all skills from project and global directories.
 * Project skills override global skills with the same name.
 */
export async function loadSkills(): Promise<Skill[]> {
  const globalSkills = await loadSkillsFromDir(GLOBAL_SKILLS_DIR, 'global');
  const projectSkills = await loadSkillsFromDir(PROJECT_SKILLS_DIR, 'project');

  // Project skills override global skills with the same name
  const merged = new Map<string, Skill>();
  for (const skill of globalSkills) merged.set(skill.name, skill);
  for (const skill of projectSkills) merged.set(skill.name, skill);

  return Array.from(merged.values());
}

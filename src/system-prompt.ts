/**
 * System prompt generation.
 *
 * Builds a dynamic system prompt that includes:
 *  - Role and behavioural instructions
 *  - Working directory and project structure
 *  - Tool descriptions (auto-generated from tool schemas)
 *  - Skills (loaded from .protoagent/skills/*.md)
 *  - Guidelines for file operations, TODO tracking, etc.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllTools } from './tools/index.js';
import { loadSkills } from './skills.js';

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
      return `${i + 1}. **${fn.name}** — ${fn.description}\n   Parameters: ${paramList || 'none'}`;
    })
    .join('\n\n');
}

/** Generate the complete system prompt. */
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

1. **Always read files before editing them** to understand the current content.
2. **Prefer edit_file over write_file** for existing files.
3. **Use TODO tracking** (todo_write / todo_read) for any task with more than 2 steps.
4. **Shell commands**: safe commands (ls, grep, git status, etc.) run automatically.
   Other commands require user approval. Some dangerous commands are blocked.
5. **Be concise** in your responses. Show what you're doing and why.
6. **Search first** when you need to find something — use search_files or bash with grep/find.

## File Operation Rules

- ALWAYS use read_file before editing to get exact content
- NEVER write over existing files unless explicitly asked — use edit_file instead
- Create parent directories before creating files in them
- Use bash for package management, git, building, testing, etc.
- When running interactive commands, add flags to avoid prompts (--yes, --template, etc.)`;
}

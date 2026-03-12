# Part 6: Shell Commands & Approvals

A coding agent needs the shell — to run tests, inspect git state, build the project. But giving an agent shell access requires a safety model. This part adds the `bash` tool with a three-tier security system: hard-blocked dangerous commands, auto-approved safe commands, and everything else requiring user approval.

## What you are building

Starting from Part 5, you add:

- `src/tools/bash.ts` — shell execution with security controls
- Updated `src/tools/index.ts` — registers the bash tool
- Updated `src/cli.tsx` — adds `--dangerously-accept-all` flag

## Step 1: Create `src/tools/bash.ts`

The three-tier security model:
1. **Hard-blocked** — dangerous commands that cannot run even with `--dangerously-accept-all`
2. **Auto-approved** — safe read-only commands (git status, pwd, etc.)
3. **Requires approval** — everything else goes through the approval handler

```typescript
// src/tools/bash.ts

import { spawn } from 'node:child_process';
import path from 'node:path';
import { requestApproval } from '../utils/approval.js';
import { getWorkingDirectory, validatePath } from '../utils/path-validation.js';

export const bashTool = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description:
      'Execute a shell command. Safe commands (ls, grep, git status, etc.) run automatically. ' +
      'Other commands require user approval. Some dangerous commands are blocked entirely.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 30000 (30s).' },
      },
      required: ['command'],
    },
  },
};

// Hard-blocked commands — these CANNOT be run, even with --dangerously-accept-all
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'sudo',
  'su ',
  'chmod 777',
  'dd if=',
  'mkfs',
  'fdisk',
  'format c:',
];

// Auto-approved safe commands — read-only / informational
const SAFE_COMMANDS = [
  'pwd', 'whoami', 'date',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'npm list', 'npm ls', 'yarn list',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
];

const SHELL_CONTROL_PATTERN = /(^|[^\\])(?:;|&&|\|\||\||>|<|`|\$\(|\*|\?)/;

function isDangerous(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}

function hasShellControlOperators(command: string): boolean {
  return SHELL_CONTROL_PATTERN.test(command);
}

function tokenizeCommand(command: string): string[] | null {
  const tokens = command.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+/g);
  return tokens && tokens.length > 0 ? tokens : null;
}

function stripOuterQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function looksLikePath(token: string): boolean {
  if (!token) return false;
  if (token === '.' || token === '..') return true;
  if (token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.startsWith('~/')) {
    return true;
  }
  return token.includes(path.sep) || /\.[A-Za-z0-9_-]+$/.test(token);
}

async function validateCommandPaths(tokens: string[]): Promise<boolean> {
  for (let index = 1; index < tokens.length; index++) {
    const token = stripOuterQuotes(tokens[index]);
    if (!looksLikePath(token)) continue;
    if (token.startsWith('~')) return false;

    try {
      await validatePath(token);
    } catch {
      return false;
    }
  }

  return true;
}

async function isSafe(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed || hasShellControlOperators(trimmed)) {
    return false;
  }

  const tokens = tokenizeCommand(trimmed);
  if (!tokens) {
    return false;
  }

  const firstWord = trimmed.split(/\s+/)[0];

  const matchedSafeCommand = SAFE_COMMANDS.some((safe) => {
    if (safe.includes(' ')) {
      return trimmed === safe || trimmed.startsWith(`${safe} `);
    }
    return firstWord === safe;
  });

  if (!matchedSafeCommand) {
    return false;
  }

  return validateCommandPaths(tokens);
}

export async function runBash(command: string, timeoutMs = 30_000, sessionId?: string): Promise<string> {
  // Layer 1: hard block
  if (isDangerous(command)) {
    return `Error: Command blocked for safety. "${command}" contains a dangerous pattern that cannot be executed.`;
  }

  // Layer 2: safe commands skip approval
  if (!(await isSafe(command))) {
    // Layer 3: interactive approval
    const approved = await requestApproval({
      id: `bash-${Date.now()}`,
      type: 'shell_command',
      description: `Run command: ${command}`,
      detail: `Working directory: ${getWorkingDirectory()}\nCommand: ${command}`,
      sessionId,
      sessionScopeKey: `shell:${command}`,
    });

    if (!approved) {
      return `Command cancelled by user: ${command}`;
    }
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, [], {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);

      if (timedOut) {
        resolve(`Command timed out after ${timeoutMs / 1000}s.\nPartial stdout:\n${stdout.slice(0, 5000)}\nPartial stderr:\n${stderr.slice(0, 2000)}`);
        return;
      }

      const maxLen = 50_000;
      const truncatedStdout = stdout.length > maxLen
        ? stdout.slice(0, maxLen) + `\n... (output truncated, ${stdout.length} chars total)`
        : stdout;

      if (code === 0) {
        resolve(truncatedStdout || '(command completed successfully with no output)');
      } else {
        resolve(`Command exited with code ${code}.\nstdout:\n${truncatedStdout}\nstderr:\n${stderr.slice(0, 5000)}`);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve(`Error executing command: ${err.message}`);
    });
  });
}
```

## Step 2: Update `src/tools/index.ts`

Add the bash tool import and registration.

```typescript
// src/tools/index.ts

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { bashTool, runBash } from './bash.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslyAcceptAll, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
}

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
      default:
        return `Error: Unknown tool "${toolName}"`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${toolName}: ${msg}`;
  }
}
```

## Step 3: Update `src/cli.tsx`

Add the `--dangerously-accept-all` flag that bypasses approval prompts.

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
  .action((options) => {
    render(
      <App dangerouslyAcceptAll={options.dangerouslyAcceptAll} />
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

## Verification

```bash
npm run dev
```

Try these prompts:

- `Run git status and summarize it.` — auto-approved (safe command)
- `Run npm install` — requires approval (not in safe list)
- `List files using ls -la` — requires approval (shell operators)
- `Run sudo rm -rf /` — hard-blocked (dangerous pattern)

Then try with the bypass flag:

```bash
npm run dev -- --dangerously-accept-all
```

Now non-blocked commands run without prompts.

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-6`.

## Core takeaway

The shell layer is conservative on purpose. Hard-blocked commands cannot run regardless of flags. Auto-approved commands are narrowly scoped to read-only operations. Everything else requires explicit user consent. This layered approach gives the agent useful power without treating shell access as harmless.

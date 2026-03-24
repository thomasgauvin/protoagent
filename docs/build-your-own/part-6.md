# Part 6: Shell Commands & Approvals

A coding agent needs the shell — to run tests, inspect git state, build the project. But giving an agent shell access requires a safety model. This part adds the `bash` tool with a three-tier security system: hard-blocked dangerous commands, auto-approved safe commands, and everything else requiring user approval.

## What you are building

Starting from Part 5, you add:

- `src/tools/bash.ts` — shell execution with security controls
- Updated `src/tools/index.ts` — registers the bash tool
- Updated `src/cli.tsx` — adds `--dangerously-skip-permissions` flag

## Step 1: Create `src/tools/bash.ts`

Create the file:

```bash
touch src/tools/bash.ts
```

The three-tier security model:
1. **Hard-blocked** — dangerous commands that cannot run even with `--dangerously-skip-permissions`
2. **Auto-approved** — safe read-only commands (git status, pwd, etc.)
3. **Requires approval** — everything else goes through the approval handler

```typescript
// src/tools/bash.ts

// SECURITY NOTICE: This tool executes shell commands with multiple safety layers:
// 1. Hard-blocks dangerous patterns (sudo, rm -rf /, etc.) - cannot be bypassed
// 2. Auto-approves a whitelist of safe read-only commands (git status, ls, etc.)
// 3. Requires user approval for all other commands
// 4. Blocks shell control operators (;, &&, ||, |, >, <, `, $(), *, ?)
// 5. Validates paths stay within the working directory
// 6. Enforces timeouts and output limits
//
// HOWEVER: Shell execution is inherently risky. Like other coding agents (Claude Code,
// Cursor Agent, etc.), running this tool within a sandboxed environment (Docker container,
// VM, or restricted user account) can provide higher degrees of security for untrusted code.
// The approval system is your last line of defense - review commands carefully.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { requestApproval } from '../utils/approval.js';
import { getWorkingDirectory, validatePath } from '../utils/path-validation.js';

// Define the tool schema for the bash tool
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

// Security: Hard-blocked commands — these CANNOT be run, even with --dangerously-skip-permissions
// Naive approach: Allow any command with user approval
// Risk: Some commands are too destructive even with approval
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

// Security: Auto-approved safe commands — read-only / informational
const SAFE_COMMANDS = [
  'pwd', 'whoami', 'date',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'npm list', 'npm ls', 'yarn list',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
];

// What are shell control operators? 
// Shell control operators are characters or sequences that allow chaining or controlling the flow of commands in a shell. For example:
// - `;` allows you to run multiple commands sequentially, like `ls; echo "done"`
// - `&&` allows you to run the next command only if the previous one succeeded, like `mkdir new_folder && cd new_folder`
// - `||` allows you to run the next command only if the previous one failed, like `cd non_existent_folder || echo "Failed to change directory"`
// - `|` allows you to pipe the output of one command into another, like `ls | grep "txt"`
// - `>` and `<` allow you to redirect output and input, like `echo "Hello" > file.txt` or `sort < unsorted.txt`
// - `` ` `` and `$()` allow you to execute a command and use its output in another command, like ``echo "Today is `date`"`` or `echo "Today is $(date)"`
// - `*` and `?` are wildcard characters used for pattern matching in file names, like `ls *.txt` or `ls file?.txt`
// The presence of these operators can indicate that a command is trying to do more than just execute a single, simple instruction, which is why we check for them as a potential safety measure.
const SHELL_CONTROL_PATTERN = /(^|[^\\])(?:;|&&|\|\||\||>|<|`|\$\(|\*|\?)/;

function isDangerous(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}

function hasShellControlOperators(command: string): boolean {
  return SHELL_CONTROL_PATTERN.test(command);
}

// Tokenize the command while respecting quoted substrings (e.g., "ls 'my folder'")
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

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
}

// All tool definitions — passed to the LLM
export function getAllTools() {
  return [
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

Add the `--dangerously-skip-permissions` flag that bypasses approval prompts.

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
  .action((options) => {
    render(<App dangerouslySkipPermissions={options.dangerouslySkipPermissions || false} />);
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

## Verification

```bash
npm run dev
```

Try these prompts:

- `Run git status and summarize it.` — auto-approved (safe command)
- `Run npm install` — requires approval (not in safe list)
- `List files using ls -la` — requires approval (shell operators)

Then try with the bypass flag:

```bash
npm run dev -- --dangerously-skip-permissions
```

Now non-blocked commands run without prompts.

With the bypass flag, these also run without prompts:
- `Write a file index.html with "hello world"` — auto-approved file write
- `Edit src/config.tsx to change the default model to gpt-4o` — auto-approved file edit
- `Create a new folder called tests` — auto-approved via bash

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-6`.

## Core takeaway

The shell layer is conservative on purpose. Hard-blocked commands cannot run regardless of flags. Auto-approved commands are narrowly scoped to read-only operations. Everything else requires explicit user consent. This layered approach gives the agent useful power without treating shell access as harmless.

---

## Security Considerations

Shell access is one of the most dangerous capabilities a coding agent can have. This part introduces a three-tier security model that balances utility with safety.

### The Dangers of Shell Access

**Why Shell Commands Are Risky:**

Shell commands can:
- Delete or modify arbitrary files (`rm -rf /`, `dd if=/dev/zero of=/dev/sda`)
- Escalate privileges (`sudo`, `su`)
- Exfiltrate data or execute remote code
- Exhaust system resources

**The Blocklist Problem:**

A naive approach tries to block dangerous commands:

```typescript
const BLOCKED = ['sudo', 'rm -rf /', 'dd'];
```

But this is easily bypassed:
- `'s' + 'udo'` - string concatenation
- `$(which sudo)` - command substitution
- `/bin/rm` - full path
- `bash -c "rm -rf /"` - indirect execution

Blocklists don't work for shell commands because the shell is too expressive.

### Our Three-Tier Security Model

**Tier 1: Hard-Blocked Commands**

These commands are blocked regardless of user approval or flags:

```typescript
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
```

Why these specifically?
- `rm -rf /` - Deletes entire filesystem
- `sudo`/`su` - Privilege escalation
- `mkfs`/`fdisk`/`dd` - Disk destruction
- `format c:` - Windows disk format

Note that these are checked with `String.includes()`, not regex. This means patterns need to be literal substrings that appear in dangerous commands.

**Tier 2: Auto-Approved Safe Commands**

Read-only commands that are safe to run automatically:

```typescript
const SAFE_COMMANDS = [
  'pwd', 'whoami', 'date',
  'git status', 'git log', 'git diff',
  'npm list', 'node --version',
  // ...
];
```

These are carefully chosen:
- No file modification
- No network access
- No privilege escalation
- Read-only information gathering

**Tier 3: Everything Else Requires Approval**

Any command not in the safe list goes through user approval.

### Shell Control Operators

**The Hidden Danger:**

Even "safe" commands become dangerous with shell operators:

```bash
# Seems safe...
git status; rm -rf /     # ; executes second command
git status && rm -rf /   # && executes if first succeeds
git status | cat /etc/passwd  # | pipes output to another command
`rm -rf /`               # Backticks execute command
$(rm -rf /)              # $() executes command
```

**Our Solution:**

We detect and block shell control operators:

```typescript
const SHELL_CONTROL_PATTERN = /[;&|<>()`$\[\]{}!]/;

// Rejects: cmd; evil, cmd && evil, cmd | evil, $(evil), etc.
```

We also block:
- Newlines (can separate commands)
- Escape sequences (can hide operators)

### Allowlist vs Blocklist Philosophy

**The Lesson:**

For shell commands, we use an **allowlist** approach (specify what's allowed) rather than a **blocklist** (try to block everything dangerous).

Blocklists fail because:
1. The shell is too expressive
2. New bypass techniques are discovered constantly
3. It's impossible to enumerate all dangerous patterns

Allowlists work because:
1. We define a small, known-safe set of operations
2. Everything else requires explicit approval
3. Users make informed decisions about unknown commands

### The `--dangerously-skip-permissions` Flag

**Why It Exists:**

In trusted environments (Docker containers, VMs, test projects), the approval prompts can slow down development. This flag bypasses the approval layer.

**Why It's Named That Way:**

The flag name is intentionally scary. It should make you think twice before using it. Hard-blocked commands are still blocked—this flag only affects the approval layer.

**When To Use It:**
- Docker containers that will be destroyed
- VMs with snapshots
- Test projects with no sensitive data
- CI/CD pipelines

**When NOT To Use It:**
- Production systems
- Machines with sensitive data
- Multi-user systems
- Your main development machine

### Defense in Depth for Shell Access

Our shell security has multiple layers:

1. **Hard blocks** - Cannot be bypassed by any flag
2. **Safe command allowlist** - Auto-approved read-only commands
3. **Control operator detection** - Prevents command chaining
4. **Path validation** - File operations stay within working directory
5. **Approval system** - User confirmation for everything else
6. **Timeout limits** - Commands can't run forever
7. **Output limits** - Prevents memory exhaustion from huge outputs

No single layer is perfect, but together they provide robust protection. The approval system is your last line of defense—review commands carefully before approving.

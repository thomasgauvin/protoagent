/**
 * bash tool — Execute shell commands with security controls.
 *
 * Three-tier security model:
 *  1. Hard-blocked dangerous commands (cannot be overridden)
 *  2. Auto-approved safe commands (read-only / info commands)
 *  3. Everything else requires user approval
 */

import { spawn } from 'node:child_process';
import { requestApproval } from '../utils/approval.js';
import { logger } from '../utils/logger.js';

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
  'ls', 'dir', 'pwd', 'whoami', 'date', 'echo', 'cat', 'head', 'tail',
  'grep', 'rg', 'find', 'wc', 'sort', 'uniq', 'cut', 'awk', 'sed',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'npm list', 'npm ls', 'yarn list',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
  'which', 'type', 'file', 'tree',
];

function isDangerous(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}

function isSafe(command: string): boolean {
  const trimmed = command.trim();
  const firstWord = trimmed.split(/\s+/)[0];

  return SAFE_COMMANDS.some((safe) => {
    if (safe.includes(' ')) {
      // Multi-word safe command: check prefix
      return trimmed.startsWith(safe);
    }
    // Single-word: check first word
    return firstWord === safe;
  });
}

export async function runBash(command: string, timeoutMs = 30_000): Promise<string> {
  // Layer 1: hard block
  if (isDangerous(command)) {
    return `Error: Command blocked for safety. "${command}" contains a dangerous pattern that cannot be executed.`;
  }

  // Layer 2: safe commands skip approval
  if (!isSafe(command)) {
    // Layer 3: interactive approval
    const approved = await requestApproval({
      id: `bash-${Date.now()}`,
      type: 'shell_command',
      description: `Run command: ${command}`,
      detail: `Working directory: ${process.cwd()}`,
    });

    if (!approved) {
      return `Command cancelled by user: ${command}`;
    }
  }

  logger.debug(`Executing: ${command}`);

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

      // Truncate very long output
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

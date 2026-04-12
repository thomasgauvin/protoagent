/**
 * Bash tool implementation with strict timeout handling.
 */
import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { toolRegistry, bashTool } from './tool-registry.js';

const execAsync = promisify(exec);

// Maximum allowed timeout (5 minutes)
const MAX_TIMEOUT_MS = 300000;
// Default timeout (30 seconds)
const DEFAULT_TIMEOUT_MS = 30000;

// Safe commands that auto-run without approval
const SAFE_COMMANDS = new Set([
  'ls', 'cat', 'echo', 'pwd', 'head', 'tail', 'grep', 'find',
  'git status', 'git log', 'git diff', 'git branch',
]);

function isSafeCommand(command: string): boolean {
  const cmd = command.trim().toLowerCase();
  for (const safe of SAFE_COMMANDS) {
    if (cmd.startsWith(safe)) return true;
  }
  return false;
}

// Blocked dangerous patterns
const BLOCKED_PATTERNS = [
  /rm\s+-rf\s+\//,
  />\s*\/dev\/null.*dd\s+if/,
  /:\(\)\s*\{\s*:\|\:/, // Fork bomb
  /mkfs\./,
  /dd\s+if=.*of=\/dev/,
];

function isBlocked(command: string): string | null {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return 'Command blocked for safety reasons';
    }
  }
  return null;
}

toolRegistry.register(bashTool, async (args, context) => {
  const { command, timeout_ms = DEFAULT_TIMEOUT_MS } = args;
  const cmd = command as string;

  // Enforce max timeout
  const effectiveTimeout = Math.min(timeout_ms as number, MAX_TIMEOUT_MS);

  // Check for blocked patterns
  const blocked = isBlocked(cmd);
  if (blocked) {
    throw new Error(blocked);
  }

  try {
    // Use spawn for better control and to handle long-running processes
    const result = await executeWithTimeout(cmd, effectiveTimeout, context.abortSignal);
    return result.slice(0, 10000); // Limit output size
  } catch (err: any) {
    if (err.message?.includes('timed out')) {
      throw new Error(`Command timed out after ${effectiveTimeout}ms. Consider using a more specific command or increasing timeout.`);
    }
    if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
      throw new Error('Command was terminated (timeout or abort)');
    }
    throw new Error(err.message);
  }
});

/**
 * Execute a command with strict timeout control using spawn.
 * This is more reliable than exec for killing processes.
 */
function executeWithTimeout(
  command: string,
  timeoutMs: number,
  abortSignal?: AbortSignal
): Promise<string> {
  return new Promise((resolve, reject) => {
    const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
    const shellFlag = process.platform === 'win32' ? '/c' : '-c';

    const child = spawn(shell, [shellFlag, command], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timeoutId: NodeJS.Timeout;
    let isSettled = false;

    // Collect stdout
    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    // Collect stderr
    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    // Set timeout
    timeoutId = setTimeout(() => {
      if (!isSettled) {
        isSettled = true;
        // Kill the entire process tree
        try {
          if (process.platform !== 'win32') {
            // On Unix, kill the process group
            process.kill(-child.pid!, 'SIGTERM');
          } else {
            child.kill('SIGTERM');
          }
        } catch {
          child.kill('SIGKILL');
        }
        reject(new Error(`Command timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    // Handle abort signal
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        if (!isSettled) {
          isSettled = true;
          clearTimeout(timeoutId);
          child.kill('SIGTERM');
          reject(new Error('Command aborted'));
        }
      });
    }

    // Handle process completion
    child.on('close', (code, signal) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeoutId);

        if (signal) {
          reject(new Error(`Command terminated by signal: ${signal}`));
        } else if (code !== 0) {
          const output = stdout + (stderr ? `\nstderr: ${stderr}` : '');
          reject(new Error(`Command failed with exit code ${code}: ${output.slice(0, 500)}`));
        } else {
          resolve(stdout + (stderr ? `\nstderr: ${stderr}` : ''));
        }
      }
    });

    // Handle process errors
    child.on('error', (err) => {
      if (!isSettled) {
        isSettled = true;
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  });
}

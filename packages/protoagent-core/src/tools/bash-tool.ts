/**
 * Bash tool implementation.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { toolRegistry, bashTool } from './tool-registry.js';

const execAsync = promisify(exec);

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
  const { command, timeout_ms = 30000 } = args;
  const cmd = command as string;
  
  // Check for blocked patterns
  const blocked = isBlocked(cmd);
  if (blocked) {
    throw new Error(blocked);
  }
  
  // Note: In a real implementation, we'd check for approval here
  // For now, we'll run the command
  
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: timeout_ms as number,
      signal: context.abortSignal,
    });
    
    const output = stdout + (stderr ? `\nstderr: ${stderr}` : '');
    return output.slice(0, 10000); // Limit output size
  } catch (err: any) {
    if (err.killed) {
      throw new Error('Command timed out or was aborted');
    }
    throw new Error(err.message);
  }
});

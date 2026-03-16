/**
 * File read-time tracking — staleness guard for edit_file.
 *
 * Ensures the model has read a file before editing it,
 * and that the file hasn't changed on disk since it was last read.
 */

import fs from 'node:fs';

const readTimes = new Map<string, number>(); // key: "sessionId:absolutePath" → epoch ms

/**
 * Record that a file was read at the current time.
 */
export function recordRead(sessionId: string, absolutePath: string): void {
  readTimes.set(`${sessionId}:${absolutePath}`, Date.now());
}

/**
 * Check that a file was previously read and hasn't changed on disk since.
 * Returns an error string if the check fails, or null if all is well.
 * Use this instead of assertReadBefore so staleness errors surface as normal
 * tool return values rather than exceptions that get swallowed into a generic
 * "Error executing edit_file: ..." message.
 */
export function checkReadBefore(sessionId: string, absolutePath: string): string | null {
  const key = `${sessionId}:${absolutePath}`;
  const lastRead = readTimes.get(key);

  if (!lastRead) {
    return `You must read '${absolutePath}' before editing it. Call read_file first.`;
  }

  try {
    const mtime = fs.statSync(absolutePath).mtimeMs;
    if (mtime > lastRead + 100) {
      // Clear stale entry so the error message stays accurate on retry
      readTimes.delete(key);
      return `'${absolutePath}' has changed on disk since you last read it. Re-read it before editing.`;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      readTimes.delete(key);
      return `'${absolutePath}' no longer exists on disk.`;
    }
    // Ignore other stat errors — don't block edits on stat failures
  }

  return null;
}

/**
 * Clear all read-time entries for a session (e.g. on session end).
 */
export function clearSession(sessionId: string): void {
  for (const key of readTimes.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      readTimes.delete(key);
    }
  }
}

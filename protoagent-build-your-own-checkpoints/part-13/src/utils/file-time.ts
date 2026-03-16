// src/utils/file-time.ts

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
 * tool return values rather than exceptions.
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
      readTimes.delete(key);
      return `'${absolutePath}' has changed on disk since you last read it. Re-read it before editing.`;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      readTimes.delete(key);
      return `'${absolutePath}' no longer exists on disk.`;
    }
  }

  return null;
}

/**
 * @deprecated Use checkReadBefore instead — it returns a string rather than
 * throwing, so the error surfaces cleanly as a tool result.
 */
export function assertReadBefore(sessionId: string, absolutePath: string): void {
  const err = checkReadBefore(sessionId, absolutePath);
  if (err) throw new Error(err);
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
/**
 * Atomic file write utility with symlink attack protection.
 *
 * Security: Uses the 'atomically' library for robust atomic writes.
 * The atomically library handles:
 * - O_CREAT|O_EXCL to prevent TOCTOU race conditions
 * - Automatic temp file cleanup on failure
 * - Cross-platform compatibility (Windows, macOS, Linux)
 * - Proper fsync before rename for durability
 */

import { writeFile } from 'atomically';

export interface AtomicWriteResult {
  success: boolean;
  bytesWritten: number;
  error?: string;
}

/**
 * Atomically write content to a file with symlink protection.
 *
 * This function uses the 'atomically' library which provides:
 * 1. Creating a temporary file with O_CREAT|O_EXCL (fails if file exists)
 * 2. Writing content and syncing to disk
 * 3. Renaming atomically to target (atomic on same filesystem)
 *
 * @param targetPath - The final path for the file (must be validated)
 * @param content - The content to write
 * @returns AtomicWriteResult indicating success/failure
 *
 * @example
 * ```typescript
 * const result = await atomicWriteFile('/path/to/file.txt', 'content');
 * if (!result.success) {
 *   console.error('Write failed:', result.error);
 * }
 * ```
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string
): Promise<AtomicWriteResult> {
  try {
    await writeFile(targetPath, content, { encoding: 'utf8' });
    const bytesWritten = Buffer.byteLength(content, 'utf8');
    return { success: true, bytesWritten };
  } catch (err: any) {
    return {
      success: false,
      bytesWritten: 0,
      error: err?.message || String(err),
    };
  }
}

/**
 * Convenience function that throws on error instead of returning result.
 * Use this when you want errors to propagate.
 */
export async function atomicWriteFileOrThrow(
  targetPath: string,
  content: string
): Promise<number> {
  const result = await atomicWriteFile(targetPath, content);
  if (!result.success) {
    throw new Error(result.error || 'Atomic write failed');
  }
  return result.bytesWritten;
}

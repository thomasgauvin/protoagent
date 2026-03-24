/**
 * Path validation utility shared by all file tools.
 *
 * Ensures that every file path the agent operates on is within the
 * working directory (process.cwd()). Prevents directory traversal
 * and symlink escape attacks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import isPathInside from 'is-path-inside';

const workingDirectory = process.cwd();
let allowedRoots: string[] = [];

function isAllowedPath(targetPath: string): boolean {
  return isPathInside(targetPath, workingDirectory) || allowedRoots.some((root) => isPathInside(targetPath, root));
}

export async function setAllowedPathRoots(roots: string[]): Promise<void> {
  const normalizedRoots = await Promise.all(
    roots.map(async (root) => {
      const resolved = path.resolve(root);
      try {
        const realRoot = await fs.realpath(resolved);
        return [path.normalize(resolved), realRoot];
      } catch {
        return [path.normalize(resolved)];
      }
    })
  );

  allowedRoots = Array.from(new Set(normalizedRoots.flat()));
}

export function getAllowedPathRoots(): string[] {
  return [...allowedRoots];
}

/**
 * Resolve and validate a path. Throws if the path is outside cwd.
 * For files that don't exist yet, validates the parent directory.
 */
export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  // First check: is the normalised path within cwd?
  if (!isAllowedPath(normalized)) {
    throw new Error(`Path "${requestedPath}" is outside the working directory.`);
  }

  // Second check: resolve symlinks and re-check
  try {
    const realPath = await fs.realpath(normalized);
    if (!isAllowedPath(realPath)) {
      throw new Error(`Path "${requestedPath}" resolves (via symlink) outside the working directory.`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — validate the parent directory instead
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        if (!isAllowedPath(realParent)) {
          throw new Error(`Parent directory of "${requestedPath}" resolves outside the working directory.`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(`Parent directory of "${requestedPath}" does not exist.`);
      }
    }
    throw err;
  }
}

export function getWorkingDirectory(): string {
  return workingDirectory;
}

/**
 * Path validation utility shared by all file tools.
 *
 * Ensures that every file path the agent operates on is within the
 * working directory (process.cwd()). Prevents directory traversal
 * and symlink escape attacks.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

// Working directory — captured once at process start.
//
// We store BOTH the logical cwd (what the user sees, e.g. "/tmp/foo") AND
// its realpath equivalent (e.g. "/private/tmp/foo"). This matters on macOS
// where "/tmp" is a symlink to "/private/tmp": `fs.realpath()` on a requested
// path returns the /private/... form, while `process.cwd()` returns the
// /tmp/... form, so comparing the two naively would spuriously reject every
// path under /tmp even though it's within cwd.
const logicalWorkingDirectory = process.cwd();
let realWorkingDirectory = logicalWorkingDirectory;
try {
  realWorkingDirectory = fsSync.realpathSync(logicalWorkingDirectory);
} catch {
  // realpath can fail only if cwd was deleted underneath us; fall back to logical
}
const workingDirectory = logicalWorkingDirectory;
const workingDirectoryRoots = Array.from(
  new Set([path.normalize(logicalWorkingDirectory), path.normalize(realWorkingDirectory)])
);

let allowedRoots: string[] = [];

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedPath(targetPath: string): boolean {
  return (
    workingDirectoryRoots.some((root) => isWithinRoot(targetPath, root)) ||
    allowedRoots.some((root) => isWithinRoot(targetPath, root))
  );
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

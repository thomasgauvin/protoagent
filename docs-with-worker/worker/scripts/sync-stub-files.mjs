#!/usr/bin/env node
/**
 * Sync stub-files/ directory into src/stub-files.ts
 * Run this after editing files in stub-files/
 *
 * Usage: node scripts/sync-stub-files.mjs
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const STUB_DIR = join(PROJECT_ROOT, 'stub-files');
const OUTPUT_FILE = join(PROJECT_ROOT, 'src', 'stub-files.ts');

function getAllFiles(dir, base = '') {
  const files = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const relPath = base ? `${base}/${entry}` : entry;

    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...getAllFiles(fullPath, relPath));
    } else {
      files.push({ path: relPath, fullPath });
    }
  }

  return files;
}

function escapeForTS(content) {
  return content
    .replace(/\\/g, '\\\\')      // Escape backslashes
    .replace(/`/g, '\\`')        // Escape backticks
    .replace(/\\\$/g, '\\$')     // Escape existing \$
    .replace(/\$(?!\{)/g, '\\$') // Escape $ not followed by {
    .replace(/\$\{/g, '\\$\\{'); // Escape ${ to prevent template literal interpolation
}

console.log(`Syncing stub files from ${STUB_DIR} to ${OUTPUT_FILE}...`);

const files = getAllFiles(STUB_DIR).sort((a, b) => a.path.localeCompare(b.path));

let output = `/**
 * Stub files loaded from the stub-files/ directory
 * These are embedded at build time and loaded into new sessions
 *
 * TO MODIFY: Edit files in stub-files/ directory, then run:
 *   node scripts/sync-stub-files.mjs
 */

interface StubFile {
  path: string;
  content: string;
}

export const stubFiles: StubFile[] = [
`;

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const content = readFileSync(file.fullPath, 'utf-8');
  const escapedContent = escapeForTS(content);

  output += `  {
    path: "${file.path}",
    content: \`${escapedContent}\`,
  }${i < files.length - 1 ? ',' : ''}\n`;
}

output += `];
`;

writeFileSync(OUTPUT_FILE, output);
console.log(`Synced ${files.length} files to ${OUTPUT_FILE}`);

// List synced files
for (const file of files) {
  console.log(`  - ${file.path}`);
}

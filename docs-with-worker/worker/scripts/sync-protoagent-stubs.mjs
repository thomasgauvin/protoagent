#!/usr/bin/env node
/**
 * Sync protoagent source files into worker stub-files.ts
 * Generates the TypeScript file with embedded file contents
 * 
 * Excludes: node_modules, docs-with-worker, protoagent-following-the-tutorial,
 *           protoagent-build-your-own-checkpoints, tests, dist, .vscode, .claude
 */

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PROJECT_ROOT = process.env.PROTOAGENT_ROOT || join(__dirname, '..', '..', '..');
const OUTPUT_FILE = join(__dirname, '..', 'src', 'stub-files.ts');

const EXCLUDE_DIRS = [
  'node_modules',
  'docs-with-worker',
  'protoagent-following-the-tutorial',
  'protoagent-build-your-own-checkpoints',
  'tests',
  'dist',
  '.vscode',
  '.claude',
  '.git',
  '.DS_Store',
  'cache',
  'deps',
];

const EXCLUDE_FILES = [
  '.gitignore',
  'package-lock.json',
  '*.tgz',
  '*.log',
  '.env',
  '.env.example',
];

function shouldExclude(filePath) {
  const parts = filePath.split('/');
  for (const part of parts) {
    if (EXCLUDE_DIRS.includes(part)) return true;
  }
  const basename = parts[parts.length - 1];
  for (const pattern of EXCLUDE_FILES) {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      if (regex.test(basename)) return true;
    } else if (basename === pattern) {
      return true;
    }
  }
  return false;
}

async function* walkDir(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const relativePath = relative(PROJECT_ROOT, path);
    
    if (shouldExclude(relativePath)) continue;
    
    if (entry.isDirectory()) {
      yield* walkDir(path);
    } else {
      yield { path: relativePath, fullPath: path };
    }
  }
}

async function main() {
  console.log('Generating stub-files.ts from protoagent source...');
  console.log('Source:', PROJECT_ROOT);
  console.log('Output:', OUTPUT_FILE);
  console.log('');

  const files = [];
  
  for await (const { path, fullPath } of walkDir(PROJECT_ROOT)) {
    try {
      const content = await readFile(fullPath, 'utf-8');
      // Escape backticks and ${} for template literal
      const escaped = content
        .replace(/\\/g, '\\\\')
        .replace(/`/g, '\\`')
        .replace(/\$/g, '\\$');
      
      files.push({ path, content: escaped });
      console.log('Added:', path);
    } catch (err) {
      console.log('Skipped (binary?):', path);
    }
  }

  // Generate TypeScript file
  const fileEntries = files.map(f => `  {
    path: "${f.path}",
    content: \`${f.content}\`,
  }`).join(',\n');

  const output = `/**
 * Stub files for the virtual filesystem
 * Auto-generated at deploy time from protoagent source
 * Run: node scripts/sync-protoagent-stubs.mjs
 */

interface StubFile {
  path: string;
  content: string;
}

export const stubFiles: StubFile[] = [
${fileEntries}
];
`;

  await writeFile(OUTPUT_FILE, output);
  console.log('');
  console.log('Generated stub-files.ts with ' + files.length + ' files');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});

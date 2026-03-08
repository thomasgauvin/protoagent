import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { searchFiles } from '../src/tools/search-files.js';

test('searchFiles supports regex patterns', async () => {
  const testDir = path.join(process.cwd(), 'tests', 'tmp-search-files');
  await fs.rm(testDir, { recursive: true, force: true });
  await fs.mkdir(testDir, { recursive: true });
  await fs.writeFile(path.join(testDir, 'sample.txt'), 'alpha\nfoo123\nfooXYZ\n', 'utf8');

  try {
    const result = await searchFiles('foo\\d+', 'tests/tmp-search-files', true, ['.txt']);

    assert.match(result, /sample\.txt:2: foo123/);
    assert.doesNotMatch(result, /fooXYZ/);
  } finally {
    await fs.rm(testDir, { recursive: true, force: true });
  }
});

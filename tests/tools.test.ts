import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { editFile } from '../src/tools/edit-file.js';
import { readFile } from '../src/tools/read-file.js';

test('editFile rejects empty old_string', async () => {
  const result = await editFile('package.json', '', 'replacement');
  assert.match(result, /old_string cannot be empty/i);
});

test('readFile reads only the requested line range', async () => {
  const fixtureDir = path.join(process.cwd(), 'tests', 'tmp-read-file');
  const fixturePath = path.join(fixtureDir, 'fixture.txt');

  await fs.rm(fixtureDir, { recursive: true, force: true });
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(fixturePath, ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n'), 'utf8');

  try {
    const result = await readFile('tests/tmp-read-file/fixture.txt', 2, 2);

    assert.match(result, /5 lines total, showing 3-4/);
    assert.match(result, /3 \| gamma/);
    assert.match(result, /4 \| delta/);
    assert.doesNotMatch(result, /1 \| alpha/);
    assert.doesNotMatch(result, /5 \| epsilon/);
  } finally {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
});

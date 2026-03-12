import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getInitConfigPath, readConfig, resolveApiKey, writeConfig, writeInitConfig } from '../src/config.js';
import { getActiveRuntimeConfigPath, loadRuntimeConfig, resetRuntimeConfigForTests } from '../src/runtime-config.js';

test.afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  delete process.env.PROTOAGENT_API_KEY;
  resetRuntimeConfigForTests();
});

test('resolveApiKey prefers config value over environment fallback', () => {
  process.env.OPENAI_API_KEY = 'env-secret';

  const apiKey = resolveApiKey({ provider: 'openai', apiKey: 'config-secret' });

  assert.equal(apiKey, 'config-secret');
});

test('resolveApiKey falls back to provider environment variable', () => {
  process.env.OPENAI_API_KEY = 'env-secret';

  const apiKey = resolveApiKey({ provider: 'openai', apiKey: undefined });

  assert.equal(apiKey, 'env-secret');
});

test('resolveApiKey falls back to PROTOAGENT_API_KEY when provider env is absent', () => {
  process.env.PROTOAGENT_API_KEY = 'override-secret';

  const apiKey = resolveApiKey({ provider: 'openai', apiKey: undefined });

  assert.equal(apiKey, 'override-secret');
});

test('loadRuntimeConfig tolerates missing config files', async () => {
  const config = await loadRuntimeConfig(true);

  assert.deepEqual(config.mcp?.servers || {}, {});
  assert.deepEqual(config.providers || {}, {});
});

test('getActiveRuntimeConfigPath prefers project config over user config', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'protoagent-active-'));
  const originalCwd = process.cwd();
  const originalHome = process.env.HOME;

  try {
    process.chdir(cwd);
    process.env.HOME = cwd;

    const userPath = path.join(cwd, '.config', 'protoagent', 'protoagent.jsonc');
    const projectPath = path.join(cwd, '.protoagent', 'protoagent.jsonc');
    fs.mkdirSync(path.dirname(userPath), { recursive: true });
    fs.mkdirSync(path.dirname(projectPath), { recursive: true });
    fs.writeFileSync(userPath, '{"providers":{}}\n', 'utf8');
    fs.writeFileSync(projectPath, '{"providers":{}}\n', 'utf8');

    assert.equal(fs.realpathSync(getActiveRuntimeConfigPath()!), fs.realpathSync(projectPath));
  } finally {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('getInitConfigPath returns project-local protoagent.jsonc path', () => {
  const projectPath = getInitConfigPath('project', '/tmp/demo-project');

  assert.equal(projectPath, path.join('/tmp/demo-project', '.protoagent', 'protoagent.jsonc'));
});

test('writeInitConfig creates project runtime config and reports the path', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'protoagent-init-'));

  try {
    const result = writeInitConfig('project', cwd);

    assert.equal(result.status, 'created');
    assert.equal(result.path, path.join(cwd, '.protoagent', 'protoagent.jsonc'));
    assert.ok(fs.existsSync(result.path));

    const content = fs.readFileSync(result.path, 'utf8');
    assert.ok(content.includes('"providers": {}'));
    assert.ok(content.includes('"servers": {}'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeInitConfig does not overwrite an existing file', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'protoagent-init-'));
  const configPath = path.join(cwd, '.protoagent', 'protoagent.jsonc');

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{"existing":true}\n', 'utf8');

    const result = writeInitConfig('project', cwd);

    assert.equal(result.status, 'exists');
    assert.equal(fs.readFileSync(configPath, 'utf8'), '{"existing":true}\n');
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeInitConfig can overwrite an existing file when forced', async () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'protoagent-init-'));
  const configPath = path.join(cwd, '.protoagent', 'protoagent.jsonc');

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, '{"existing":true}\n', 'utf8');

    const result = writeInitConfig('project', cwd, { overwrite: true });

    assert.equal(result.status, 'overwritten');
    const content = fs.readFileSync(configPath, 'utf8');
    assert.ok(content.includes('"providers": {}'));
    assert.ok(content.includes('"servers": {}'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('writeConfig stores the selected provider/model in protoagent.jsonc', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'protoagent-config-'));

  try {
    const configPath = writeConfig({ provider: 'openai', model: 'gpt-5-mini', apiKey: 'secret' }, 'project', cwd);
    const content = fs.readFileSync(configPath, 'utf8');

    assert.ok(content.includes('"openai"'));
    assert.ok(content.includes('"gpt-5-mini"'));
    assert.ok(content.includes('"apiKey": "secret"'));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('readConfig returns the first configured provider/model from protoagent.jsonc', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'protoagent-config-'));
  const configPath = path.join(cwd, '.protoagent', 'protoagent.jsonc');

  try {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, JSON.stringify({
      providers: {
        google: {
          models: {
            'gemini-3-flash-preview': {},
          },
        },
        openai: {
          models: {
            'gpt-5-mini': {},
          },
        },
      },
    }, null, 2));

    assert.deepEqual(readConfig('project', cwd), {
      provider: 'google',
      model: 'gemini-3-flash-preview',
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

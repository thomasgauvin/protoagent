import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiKey } from '../src/config.js';
import { loadRuntimeConfig, resetRuntimeConfigForTests } from '../src/runtime-config.js';

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

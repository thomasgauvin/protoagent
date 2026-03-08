import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveApiKey } from '../src/config.js';

test('resolveApiKey prefers config value over environment fallback', () => {
  process.env.OPENAI_API_KEY = 'env-secret';

  const apiKey = resolveApiKey({ provider: 'openai', apiKey: 'config-secret' });

  assert.equal(apiKey, 'config-secret');
  delete process.env.OPENAI_API_KEY;
});

test('resolveApiKey falls back to provider environment variable', () => {
  process.env.OPENAI_API_KEY = 'env-secret';

  const apiKey = resolveApiKey({ provider: 'openai', apiKey: undefined });

  assert.equal(apiKey, 'env-secret');
  delete process.env.OPENAI_API_KEY;
});

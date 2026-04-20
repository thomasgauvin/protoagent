import { test } from 'node:test';
import assert from 'node:assert';
import { parse } from 'jsonc-parser';
import { RUNTIME_CONFIG_TEMPLATE } from '../src/config-core.js';

test('RUNTIME_CONFIG_TEMPLATE parses to valid JSONC without errors', () => {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const parsed = parse(RUNTIME_CONFIG_TEMPLATE, errors, { allowTrailingComma: true, disallowComments: false });
  
  assert.strictEqual(errors.length, 0, `Template has JSONC parse errors: ${JSON.stringify(errors)}`);
  assert.ok(parsed && typeof parsed === 'object', 'Template parses to an object');
  assert.ok(!Array.isArray(parsed), 'Template parses to a plain object, not an array');
});

test('RUNTIME_CONFIG_TEMPLATE has expected structure', () => {
  const errors: Array<{ error: number; offset: number; length: number }> = [];
  const parsed = parse(RUNTIME_CONFIG_TEMPLATE, errors, { allowTrailingComma: true, disallowComments: false });
  
  // Check top-level structure
  assert.ok('providers' in parsed, 'Template has providers key');
  assert.ok('mcp' in parsed, 'Template has mcp key');
  
  // Check providers is an object
  assert.ok(parsed.providers && typeof parsed.providers === 'object', 'providers is an object');
  
  // Check mcp.servers exists
  assert.ok(parsed.mcp && typeof parsed.mcp === 'object', 'mcp is an object');
  assert.ok('servers' in parsed.mcp, 'mcp has servers key');
  assert.ok(parsed.mcp.servers && typeof parsed.mcp.servers === 'object', 'mcp.servers is an object');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteSession, ensureSystemPromptAtTop, loadSession } from '../src/sessions.js';

test('ensureSystemPromptAtTop prepends a system prompt when missing', () => {
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there' },
  ] as const;

  const result = ensureSystemPromptAtTop([...messages], 'You are ProtoAgent');

  assert.equal(result[0]?.role, 'system');
  assert.equal((result[0] as any).content, 'You are ProtoAgent');
  assert.equal(result[1]?.role, 'user');
  assert.equal(result[2]?.role, 'assistant');
});

test('ensureSystemPromptAtTop moves the first system prompt to the top and refreshes it', () => {
  const result = ensureSystemPromptAtTop(
    [
      { role: 'user', content: 'Earlier user message' },
      { role: 'system', content: 'Old prompt' },
      { role: 'assistant', content: 'Response' },
    ],
    'New prompt'
  );

  assert.equal(result[0]?.role, 'system');
  assert.equal((result[0] as any).content, 'New prompt');
  assert.equal(result[1]?.role, 'user');
  assert.equal(result[2]?.role, 'assistant');
  assert.equal(result.filter((message) => message.role === 'system').length, 1);
});

test('invalid session ids are rejected safely', async () => {
  const loaded = await loadSession('../not-a-session');
  const deleted = await deleteSession('../not-a-session');

  assert.equal(loaded, null);
  assert.equal(deleted, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import type OpenAI from 'openai';
import { compactIfNeeded } from '../src/utils/compactor.js';

test('compactIfNeeded forwards request defaults to compaction request', async () => {
  let captured: Record<string, unknown> | null = null;

  const client = {
    chat: {
      completions: {
        create: async (payload: Record<string, unknown>) => {
          captured = payload;
          return {
            choices: [
              {
                message: {
                  content: '<state_snapshot>summary</state_snapshot>',
                },
              },
            ],
          };
        },
      },
    },
  } as unknown as OpenAI;

  const messages = [
    { role: 'system', content: 'system prompt' },
    { role: 'user', content: 'one' },
    { role: 'assistant', content: 'two' },
    { role: 'user', content: 'three' },
    { role: 'assistant', content: 'four' },
    { role: 'user', content: 'five' },
    { role: 'assistant', content: 'six' },
  ] satisfies OpenAI.Chat.Completions.ChatCompletionMessageParam[];

  await compactIfNeeded(client, 'test-model', messages, 10, 10, { top_p: 0.2, temperature: 0.7 });

  assert.ok(captured);
  const request = captured as Record<string, unknown>;
  assert.equal(request.top_p, 0.2);
  assert.equal(request.temperature, 0.1);
});

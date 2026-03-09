import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { FormattedMessage, DEFERRED_TABLE_PLACEHOLDER } from '../src/components/FormattedMessage.js';

test('FormattedMessage can defer table rendering while streaming', () => {
  const content = [
    '| Name | Value |',
    '| --- | --- |',
    '| Alpha | Beta |',
  ].join('\n');

  const { lastFrame } = render(<FormattedMessage content={content} deferTables={true} />);
  const frame = lastFrame();

  assert.ok(frame?.includes(DEFERRED_TABLE_PLACEHOLDER));
  assert.ok(!frame?.includes('Alpha  Beta'));
});

test('FormattedMessage preserves intentional blank lines in text content', () => {
  const content = '\n\nHello\n\nWorld\n\n\n';

  const { lastFrame } = render(<FormattedMessage content={content} />);
  const frame = lastFrame();

  assert.equal(frame, '\n\nHello\n\nWorld\n\n\n');
});

test('FormattedMessage renders markdown tables as preformatted text', () => {
  const content = [
    '| Name | Value |',
    '| --- | --- |',
    '| Alpha | Beta |',
    '| Longer | Cell |',
  ].join('\n');

  const { lastFrame } = render(<FormattedMessage content={content} />);
  const frame = lastFrame();

  assert.ok(frame?.includes('Name    Value'));
  assert.ok(frame?.includes('------  -----'));
  assert.ok(frame?.includes('Alpha   Beta'));
  assert.ok(frame?.includes('Longer  Cell'));
  assert.ok(!frame?.includes('┌'));
});

test('FormattedMessage aligns emoji in preformatted tables', () => {
  const content = [
    '| Status | Notes |',
    '| --- | --- |',
    '| Ship it 🚀 | Looks good 👍 |',
  ].join('\n');

  const { lastFrame } = render(<FormattedMessage content={content} />);
  const frame = lastFrame();

  assert.ok(frame?.includes('Status      Notes'));
  assert.ok(frame?.includes('Ship it 🚀  Looks good 👍'));
});

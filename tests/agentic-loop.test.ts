import test from 'node:test';
import assert from 'node:assert/strict';
import { appendStreamingFragment } from '../src/agentic-loop.js';

// ─── Normal incremental streaming ───

test('appendStreamingFragment: empty current returns fragment', () => {
  assert.equal(appendStreamingFragment('', 'hello'), 'hello');
});

test('appendStreamingFragment: empty fragment returns current', () => {
  assert.equal(appendStreamingFragment('hello', ''), 'hello');
});

test('appendStreamingFragment: simple concatenation', () => {
  assert.equal(appendStreamingFragment('hello', ' world'), 'hello world');
});

test('appendStreamingFragment: multi-chunk JSON argument accumulation', () => {
  // Simulate streaming {"path": "src/App.tsx"} in small chunks
  let acc = '';
  const chunks = ['{"path"', ': "src', '/App.t', 'sx"}'];
  for (const chunk of chunks) {
    acc = appendStreamingFragment(acc, chunk);
  }
  assert.equal(acc, '{"path": "src/App.tsx"}');
});

// ─── The corruption cases: false-positive overlap on common suffixes ───

test('appendStreamingFragment: does not drop "ll" from "All"', () => {
  // Old code: appendStreamingFragment("Al", "l") found overlap=1 (tail "l" == prefix "l"),
  // stripped it, and returned "Al" — dropping the second "l".
  assert.equal(appendStreamingFragment('Al', 'l'), 'All');
  assert.equal(appendStreamingFragment('All', ' be done'), 'All be done');
});

test('appendStreamingFragment: does not drop "and" from "Command"', () => {
  // Old code: appendStreamingFragment("Comm", "and") — no overlap, this one was fine.
  // But streaming "Comman" then "d" would trigger overlap on "n"+"d" → "Comma" + "d"
  assert.equal(appendStreamingFragment('Comman', 'd'), 'Command');
});

test('appendStreamingFragment: does not corrupt common JSON token suffixes', () => {
  // current ends with ",", fragment starts with ", " — old code stripped ","
  const current = '{"a":1,';
  const fragment = ', "b":2}';
  assert.equal(appendStreamingFragment(current, fragment), '{"a":1,, "b":2}');
});

test('appendStreamingFragment: does not drop "ng" from "running"', () => {
  const current = 'runni';
  const fragment = 'ng the tests';
  assert.equal(appendStreamingFragment(current, fragment), 'running the tests');
});

test('appendStreamingFragment: does not drop "er" from "render"', () => {
  const current = 'rend';
  const fragment = 'er complete';
  assert.equal(appendStreamingFragment(current, fragment), 'render complete');
});

// ─── Provider quirk: whole value resent ───

test('appendStreamingFragment: exact duplicate is a no-op', () => {
  assert.equal(appendStreamingFragment('hello', 'hello'), 'hello');
});

test('appendStreamingFragment: fragment is accumulated-value extended (provider resend)', () => {
  // Some providers resend the full accumulated string extended with new content
  // instead of just the delta. The startsWith guard handles this.
  assert.equal(appendStreamingFragment('hello', 'hello world'), 'hello world');
});

test('appendStreamingFragment: provider resend with JSON args', () => {
  const accumulated = '{"path": "src/';
  const resent = '{"path": "src/App.tsx"}';
  assert.equal(appendStreamingFragment(accumulated, resent), resent);
});

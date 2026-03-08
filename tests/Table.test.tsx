import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { Table } from '../src/components/Table.js';

test('Table wraps long content', () => {
  const data = [
    {
      'Title': 'This is an extremely long title that will certainly exceed the default terminal width of eighty characters and therefore must be wrapped into multiple lines by our new table component implementation',
      'Description': 'Short'
    }
  ];

  const { lastFrame } = render(<Table data={data} />);
  const frame = lastFrame();

  assert.ok(frame?.includes('This is an extremely long title'));
  assert.ok(frame?.includes('implementation'));
  
  // Count lines containing the title parts to ensure it's multi-line
  const titleLines = frame?.split('\n').filter(l => l.includes('│')).length || 0;
  // Header (1) + separator (1) + data (at least 2) = at least 4 lines with │
  assert.ok(titleLines >= 4);
});

test('Table handles multiple columns with wrapping', () => {
  const data = [
    {
      'ID': 1,
      'Project Name': 'ProtoAgent',
      'Status': 'In Progress',
      'Description': 'A modular agentic framework with skill support and multi-agent capabilities',
      'Owner': 'Thomas'
    }
  ];

  const { lastFrame } = render(<Table data={data} />);
  const frame = lastFrame();
  
  assert.ok(frame?.includes('ProtoAgent'));
  assert.ok(frame?.includes('In Progress'));
  assert.ok(frame?.includes('modular agentic'));
  assert.ok(frame?.includes('capabilities'));
});

test('Table preserves inline markdown formatting in cells', () => {
  const data = [
    {
      'Style': '**Bold** *Italic* ***Both***',
      'Value': 'Plain text'
    }
  ];

  const { lastFrame } = render(<Table data={data} />);
  const frame = lastFrame();

  assert.ok(frame?.includes('Bold'));
  assert.ok(frame?.includes('Italic'));
  assert.ok(frame?.includes('Both'));
  assert.ok(!frame?.includes('**Bold**'));
  assert.ok(!frame?.includes('*Italic*'));
  assert.ok(!frame?.includes('***Both***'));
});

test('Table renders emoji content without breaking layout', () => {
  const data = [
    {
      'Status': 'Ship it 🚀',
      'Notes': 'Looks good on desktop and mobile 👍',
    }
  ];

  const { lastFrame } = render(<Table data={data} />);
  const frame = lastFrame();
  const tableLines = frame?.split('\n').filter((line) => line.includes('│')) || [];

  assert.ok(frame?.includes('Ship it 🚀'));
  assert.ok(frame?.includes('mobile 👍'));
  assert.ok(tableLines.every((line) => line.trimStart().startsWith('│') && line.trimEnd().endsWith('│')));
});

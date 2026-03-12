# Part 13: Polish, Rendering & Logging

This is where ProtoAgent goes from "the loop technically works" to "I would actually use this for real work." Part 13 is a convergence step — it brings the staged rebuild to the full final app with richer rendering, grouped tool output, collapsible messages, slash commands, formatted output, and the complete final module layout.

## What you are building

Starting from Part 12, you add:

- `src/utils/format-message.tsx` — markdown-to-ANSI formatting
- `src/utils/file-time.ts` — staleness guard for edit_file
- `src/components/CollapsibleBox.tsx` — expand/collapse for long content
- `src/components/ConsolidatedToolMessage.tsx` — grouped tool call rendering
- `src/components/FormattedMessage.tsx` — markdown tables, code blocks, text formatting
- `src/components/ConfigDialog.tsx` — mid-session config changes
- Updated `src/tools/edit-file.ts` — fuzzy match cascade + unified diff output
- Updated `src/tools/read-file.ts` — similar-path suggestions + file-time tracking
- Updated `src/tools/search-files.ts` — ripgrep support when available
- Updated `src/App.tsx` — final version with all features
- Updated `src/cli.tsx` — final version

## Step 1: Create `src/utils/format-message.tsx`

Converts markdown-style formatting to ANSI escape codes for terminal rendering.

```typescript
// src/utils/format-message.tsx

export function formatMessage(text: string): string {
  const BOLD = '\x1b[1m';
  const ITALIC = '\x1b[3m';
  const RESET = '\x1b[0m';

  let result = text;

  // Strip markdown hashtags (headers)
  result = result.replace(/^#+\s+/gm, '');

  // Replace ***bold italic*** first
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}${ITALIC}$1${RESET}`);

  // Replace **bold**
  result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);

  // Replace *italic*
  result = result.replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`);

  return result;
}
```

## Step 2: Create `src/utils/file-time.ts`

Staleness guard: ensures the model has read a file before editing it, and that the file hasn't changed on disk since.

```typescript
// src/utils/file-time.ts

import fs from 'node:fs';

const readTimes = new Map<string, number>();

export function recordRead(sessionId: string, absolutePath: string): void {
  readTimes.set(`${sessionId}:${absolutePath}`, Date.now());
}

export function assertReadBefore(sessionId: string, absolutePath: string): void {
  const key = `${sessionId}:${absolutePath}`;
  const lastRead = readTimes.get(key);

  if (!lastRead) {
    throw new Error(`You must read '${absolutePath}' before editing it. Call read_file first.`);
  }

  try {
    const mtime = fs.statSync(absolutePath).mtimeMs;
    if (mtime > lastRead + 100) {
      readTimes.delete(key);
      throw new Error(`'${absolutePath}' has changed on disk since you last read it. Re-read it before editing.`);
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      readTimes.delete(key);
      throw new Error(`'${absolutePath}' no longer exists on disk.`);
    }
    if (err.message.includes('has changed on disk') || err.message.includes('must read')) throw err;
  }
}

export function clearSession(sessionId: string): void {
  for (const key of readTimes.keys()) {
    if (key.startsWith(`${sessionId}:`)) readTimes.delete(key);
  }
}
```

## Step 3: Create UI components

### `src/components/CollapsibleBox.tsx`

Hides long content behind expand/collapse. Used for system prompts, tool results, and verbose output.

```typescript
// src/components/CollapsibleBox.tsx

import React from 'react';
import { Box, Text } from 'ink';

export interface CollapsibleBoxProps {
  title: string;
  content: string;
  titleColor?: string;
  dimColor?: boolean;
  maxPreviewLines?: number;
  maxPreviewChars?: number;
  expanded?: boolean;
  marginBottom?: number;
}

export const CollapsibleBox: React.FC<CollapsibleBoxProps> = ({
  title, content, titleColor, dimColor = false,
  maxPreviewLines = 3, maxPreviewChars = 500,
  expanded = false, marginBottom = 0,
}) => {
  const lines = content.split('\n');
  const isLong = lines.length > maxPreviewLines || content.length > maxPreviewChars;

  if (!isLong) {
    return (
      <Box flexDirection="column" marginBottom={marginBottom}>
        <Text color={titleColor} dimColor={dimColor} bold>{title}</Text>
        <Box marginLeft={1}>
          <Text dimColor={dimColor}>{content}</Text>
        </Box>
      </Box>
    );
  }

  let preview: string;
  if (expanded) {
    preview = content;
  } else {
    const linesTruncated = lines.slice(0, maxPreviewLines).join('\n');
    preview = linesTruncated.length > maxPreviewChars
      ? linesTruncated.slice(0, maxPreviewChars)
      : linesTruncated;
  }

  return (
    <Box flexDirection="column" marginBottom={marginBottom}>
      <Text color={titleColor} dimColor={dimColor} bold>
        {expanded ? '▼' : '▶'} {title}
      </Text>
      <Box flexDirection="column" marginLeft={1}>
        <Text dimColor={dimColor}>{preview}</Text>
        {!expanded && <Text dimColor={true}>... (use /expand to see all)</Text>}
      </Box>
    </Box>
  );
};
```

### `src/components/ConsolidatedToolMessage.tsx`

Groups a tool call with its result into a single consolidated view.

```typescript
// src/components/ConsolidatedToolMessage.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { FormattedMessage } from './FormattedMessage.js';

export interface ConsolidatedToolMessageProps {
  toolCalls: Array<{ id: string; name: string }>;
  toolResults: Map<string, { content: string; name: string }>;
  expanded?: boolean;
}

export const ConsolidatedToolMessage: React.FC<ConsolidatedToolMessageProps> = ({
  toolCalls, toolResults, expanded = false,
}) => {
  const toolNames = toolCalls.map((tc) => tc.name);
  const title = `Called: ${toolNames.join(', ')}`;
  const containsTodoTool = toolCalls.some((tc) => tc.name === 'todo_read' || tc.name === 'todo_write');
  const isExpanded = expanded || containsTodoTool;

  if (isExpanded) {
    return (
      <Box flexDirection="column">
        <Text color={containsTodoTool ? 'green' : 'white'} bold>▼ {title}</Text>
        <Box flexDirection="column" marginLeft={1}>
          {toolCalls.map((tc, idx) => {
            const result = toolResults.get(tc.id);
            if (!result) return null;
            return (
              <Box key={idx} flexDirection="column">
                <Text color="cyan" bold>[{result.name}]:</Text>
                <FormattedMessage content={result.content} />
              </Box>
            );
          })}
        </Box>
      </Box>
    );
  }

  const compactLines = toolCalls.flatMap((tc) => {
    const result = toolResults.get(tc.id);
    if (!result) return [];
    return [`[${result.name}] ${result.content.replace(/\s+/g, ' ').trim()}`];
  });

  const compactPreview = compactLines.join(' | ');
  const preview = compactPreview.length > 180
    ? `${compactPreview.slice(0, 180).trimEnd()}... (use /expand)`
    : compactPreview;

  return (
    <Box flexDirection="column">
      <Text color={containsTodoTool ? 'green' : 'white'} dimColor bold>▶ {title}</Text>
      <Box marginLeft={1}><Text dimColor>{preview}</Text></Box>
    </Box>
  );
};
```

### `src/components/FormattedMessage.tsx`

Renders markdown tables as preformatted monospace text, code blocks in bordered boxes, and applies text formatting.

```typescript
// src/components/FormattedMessage.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { formatMessage } from '../utils/format-message.js';

interface FormattedMessageProps {
  content: string;
  deferTables?: boolean;
}

export const DEFERRED_TABLE_PLACEHOLDER = 'table loading';

function getTextWidth(text: string): number {
  // Simplified width calculation
  return Array.from(text).reduce((w, ch) => {
    const code = ch.codePointAt(0) || 0;
    if (code >= 0x1100 && code <= 0xFFFF) return w + 2; // CJK/wide chars
    return w + 1;
  }, 0);
}

function padToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - getTextWidth(text));
  return text + ' '.repeat(padding);
}

function parseMarkdownTableToRows(markdown: string): string[][] | null {
  const lines = markdown.trim().split('\n');
  if (lines.length < 3) return null;

  const parseRow = (row: string) =>
    row.split('|').map((cell) => cell.trim()).filter((cell, i, arr) => {
      if (i === 0 && cell === '') return false;
      if (i === arr.length - 1 && cell === '') return false;
      return true;
    });

  const header = parseRow(lines[0]);
  const separator = parseRow(lines[1]);
  if (header.length === 0 || separator.length === 0) return null;
  if (!separator.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))) return null;

  return [header, ...lines.slice(2).map(parseRow)];
}

function renderPreformattedTable(markdown: string): string {
  const rows = parseMarkdownTableToRows(markdown);
  if (!rows || rows.length === 0) return markdown.trim();

  const colCount = Math.max(...rows.map((r) => r.length));
  const normalized = rows.map((r) => Array.from({ length: colCount }, (_, i) => r[i] ?? ''));
  const widths = Array.from({ length: colCount }, (_, i) =>
    Math.max(...normalized.map((r) => getTextWidth(r[i])))
  );

  const formatRow = (row: string[]) => row.map((cell, i) => padToWidth(cell, widths[i])).join('  ').trimEnd();
  const header = formatRow(normalized[0]);
  const divider = widths.map((w) => '-'.repeat(w)).join('  ');
  return [header, divider, ...normalized.slice(1).map(formatRow)].join('\n');
}

export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content, deferTables = false }) => {
  if (!content) return null;

  const lines = content.split('\n');
  const blocks: Array<{ type: 'text' | 'table' | 'code'; content: string }> = [];
  let currentContent: string[] = [];
  let currentType: 'text' | 'table' | 'code' = 'text';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (currentType === 'code') {
      currentContent.push(line);
      if (trimmed.startsWith('```')) {
        blocks.push({ type: 'code', content: currentContent.join('\n') });
        currentContent = [];
        currentType = 'text';
      }
      continue;
    }

    if (trimmed.startsWith('```')) {
      if (currentContent.length > 0) blocks.push({ type: 'text', content: currentContent.join('\n') });
      currentContent = [line];
      currentType = 'code';
      continue;
    }

    if (currentType === 'table') {
      if (trimmed.startsWith('|')) { currentContent.push(line); continue; }
      blocks.push({ type: 'table', content: currentContent.join('\n') });
      currentContent = [];
      currentType = 'text';
    }

    const nextLine = lines[i + 1];
    if (trimmed.startsWith('|') && nextLine?.trim().startsWith('|') && nextLine.includes('---')) {
      if (currentContent.length > 0) blocks.push({ type: 'text', content: currentContent.join('\n') });
      currentContent = [line];
      currentType = 'table';
      continue;
    }

    currentContent.push(line);
  }

  if (currentContent.length > 0) blocks.push({ type: currentType, content: currentContent.join('\n') });

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        if (block.type === 'table') {
          if (!block.content.trim()) return null;
          if (deferTables) return <Box key={index} marginY={1}><Text dimColor>{DEFERRED_TABLE_PLACEHOLDER}</Text></Box>;
          return (
            <Box key={index} marginY={1} paddingX={1} borderStyle="round" borderColor="gray">
              <Text>{renderPreformattedTable(block.content)}</Text>
            </Box>
          );
        }
        if (block.type === 'code') {
          return (
            <Box key={index} marginY={1} paddingX={1} borderStyle="round" borderColor="gray">
              <Text dimColor>{block.content}</Text>
            </Box>
          );
        }
        if (!block.content.trim()) return null;
        return <Box key={index} marginBottom={0}><Text>{formatMessage(block.content)}</Text></Box>;
      })}
    </Box>
  );
};
```

## Step 4: Upgrade `src/tools/edit-file.ts`

The final version adds a 5-strategy fuzzy match cascade (exact, line-trimmed, indent-flexible, whitespace-normalized, trimmed-boundary) and returns a unified diff on success. It also enforces the read-before-edit staleness guard via `file-time.ts`.

See `src/tools/edit-file.ts` in the source tree for the complete implementation. The key additions over the Part 5 version:

- Import `assertReadBefore` and `recordRead` from `../utils/file-time.js`
- `findWithCascade()` tries 5 match strategies in order
- `computeUnifiedDiff()` generates a diff for the tool result
- Re-reads the file after write and records the read time

## Step 5: Upgrade `src/tools/read-file.ts`

The final version adds:
- `findSimilarPaths()` — suggests similar paths when a file isn't found
- `recordRead()` — tracks reads for the staleness guard

See `src/tools/read-file.ts` in the source tree for the complete implementation.

## Step 6: Upgrade `src/tools/search-files.ts`

The final version adds ripgrep (`rg`) support when available, falling back to the JS implementation. Ripgrep results are sorted by modification time (most recently changed files first).

See `src/tools/search-files.ts` in the source tree for the complete implementation.

## Step 7: Final `src/App.tsx`

The final App brings together everything from Parts 1-12 plus:

- **Archived vs live message rendering** — archived messages use `useMemo` for performance, live messages re-render during streaming
- **Grouped tool rendering** — tool calls and results are consolidated using `ConsolidatedToolMessage`
- **Collapsible output** — system prompts and tool results use `CollapsibleBox`
- **Formatted text** — assistant messages use `FormattedMessage` with markdown/table support
- **Slash commands** — `/clear`, `/collapse`, `/expand`, `/help`, `/quit`
- **Spinner with active tool** — shows which tool is currently executing
- **Debounced text rendering** — 50ms batching for streaming text deltas
- **Terminal resize handling** — re-renders input on window resize
- **Quitting with session save** — displays the resume command before exit

See `src/App.tsx` in the source tree for the complete 1061-line implementation.

## Step 8: Final `src/cli.tsx`

```typescript
// src/cli.tsx

#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent } from './config.js';

const program = new Command();

program
  .name('protoagent')
  .description('A minimal coding agent in your terminal')
  .option('--dangerously-accept-all', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: error, warn, info, debug, trace')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    render(
      <App
        dangerouslyAcceptAll={options.dangerouslyAcceptAll}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });

program
  .command('configure')
  .description('Set up or change your AI provider and model')
  .action(() => {
    render(<ConfigureComponent />);
  });

program.parse();
```

## Verification

```bash
npm run dev -- --log-level debug
```

You should see:
- Richer output rendering: code blocks in bordered boxes, tables as aligned monospace
- Grouped tool activity: tool calls and results shown together
- Collapsible long content: system prompt collapsed by default
- Slash commands: `/help`, `/clear`, `/expand`, `/collapse`, `/quit`
- Debug log file path displayed at startup
- Spinner showing which tool is currently executing
- Session save on quit with resume command

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-13`.

This is the final checkpoint. At this point your staged rebuild matches the complete ProtoAgent application.

## Core takeaway

Polish is not just cosmetics. It is the layer that makes the tool loop readable, debuggable, and survivable over a long session. The separation of archived and live messages, the grouped tool rendering, the formatted output — these are what turn a working agent loop into a tool you actually want to use.

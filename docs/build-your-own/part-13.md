# Part 13: Polish, Rendering & Logging

This last part is pretty involved because it's a series of incremental improvements to individual tools that have been made after using ProtoAgent and refining it. 

It's what makes the full final project have richer rendering, grouped tool output, collapsible messages, slash commands, formatted output, and the complete final module layout.

## What you are building

Starting from Part 12, you add:

- `src/utils/logger.ts` — logging utility with levels and file output
- `src/utils/format-message.tsx` — markdown-to-ANSI formatting
- `src/utils/file-time.ts` — staleness guard for edit_file

There are also new files to create to adjust the UI:
- `src/components/LeftBar.tsx` — left-side bar indicator for callouts (no Box border)
- `src/components/CollapsibleBox.tsx` — expand/collapse for long content
- `src/components/ConsolidatedToolMessage.tsx` — grouped tool call rendering
- `src/components/FormattedMessage.tsx` — markdown tables, code blocks, text formatting
- `src/components/ConfigDialog.tsx` — mid-session config changes

And many existing files are upgraded to be more robust:
- Updated `src/tools/edit-file.ts` — fuzzy match cascade + unified diff output
- Updated `src/tools/read-file.ts` — similar-path suggestions + file-time tracking
- Updated `src/tools/search-files.ts` — ripgrep support when available
- Updated `src/App.tsx` — final version with all features
- Updated `src/cli.tsx` — adds `init` subcommand for creating runtime configs

## Step 1: Create `src/utils/logger.ts`

Create the logging utility that powers all debug output:

```bash
touch src/utils/logger.ts
```

```typescript
// src/utils/logger.ts

/**
 * Logger utility with configurable log levels.
 *
 * Levels (from least to most verbose):
 *   ERROR (0) → WARN (1) → INFO (2) → DEBUG (3) → TRACE (4)
 *
 * Set the level via `setLogLevel()` or the `--log-level` CLI flag.
 * Logs are written to a file to avoid interfering with Ink UI rendering.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

let currentLevel: LogLevel = LogLevel.INFO;
let logFilePath: string | null = null;

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

let logBuffer: LogEntry[] = [];
let logListeners: Array<(entry: LogEntry) => void> = [];

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function onLog(listener: (entry: LogEntry) => void): () => void {
  logListeners.push(listener);
  return () => {
    logListeners = logListeners.filter(l => l !== listener);
  };
}

export function getRecentLogs(count: number = 50): LogEntry[] {
  return logBuffer.slice(-count);
}

export function initLogFile(): string {
  const logsDir = join(homedir(), '.local', 'share', 'protoagent', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFilePath = join(logsDir, `protoagent-${timestamp}.log`);

  writeToFile(`\n${'='.repeat(80)}\nProtoAgent Log - ${new Date().toISOString()}\n${'='.repeat(80)}\n`);

  return logFilePath;
}

function writeToFile(message: string): void {
  if (!logFilePath) {
    initLogFile();
  }
  try {
    appendFileSync(logFilePath!, message);
  } catch (err) {
    // Silently fail if we can't write to log file
  }
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  if (level > currentLevel) return;
  const ts = timestamp();

  const entry: LogEntry = {
    timestamp: ts,
    level,
    message,
    context,
  };

  logBuffer.push(entry);
  if (logBuffer.length > 100) {
    logBuffer.shift();
  }

  logListeners.forEach(listener => listener(entry));

  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  writeToFile(`[${ts}] ${label.padEnd(5)} ${message}${ctx}\n`);
}

export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.ERROR, 'ERROR', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.WARN, 'WARN', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.INFO, 'INFO', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.DEBUG, 'DEBUG', msg, ctx),
  trace: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.TRACE, 'TRACE', msg, ctx),

  startOperation(name: string): { end: () => void } {
    const start = performance.now();
    logger.debug(`${name} started`);
    return {
      end() {
        const ms = (performance.now() - start).toFixed(1);
        logger.debug(`${name} completed`, { durationMs: ms });
      },
    };
  },

  getLogFilePath(): string | null {
    return logFilePath;
  },
};
```

## Step 2: Create `src/utils/format-message.tsx`

Create the file:

```bash
touch src/utils/format-message.tsx
```

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

## Step 3: Create `src/utils/file-time.ts`

Create the file:

```bash
touch src/utils/file-time.ts
```

Staleness guard: ensures the model has read a file before editing it, and that the file hasn't changed on disk since.

```typescript
// src/utils/file-time.ts

import fs from 'node:fs';

const readTimes = new Map<string, number>(); // key: "sessionId:absolutePath" → epoch ms

/**
 * Record that a file was read at the current time.
 */
export function recordRead(sessionId: string, absolutePath: string): void {
  readTimes.set(`${sessionId}:${absolutePath}`, Date.now());
}

/**
 * Check that a file was previously read and hasn't changed on disk since.
 * Returns an error string if the check fails, or null if all is well.
 * Use this instead of assertReadBefore so staleness errors surface as normal
 * tool return values rather than exceptions.
 */
export function checkReadBefore(sessionId: string, absolutePath: string): string | null {
  const key = `${sessionId}:${absolutePath}`;
  const lastRead = readTimes.get(key);

  if (!lastRead) {
    return `You must read '${absolutePath}' before editing it. Call read_file first.`;
  }

  try {
    const mtime = fs.statSync(absolutePath).mtimeMs;
    if (mtime > lastRead + 100) {
      readTimes.delete(key);
      return `'${absolutePath}' has changed on disk since you last read it. Re-read it before editing.`;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      readTimes.delete(key);
      return `'${absolutePath}' no longer exists on disk.`;
    }
  }

  return null;
}

/**
 * @deprecated Use checkReadBefore instead — it returns a string rather than
 * throwing, so the error surfaces cleanly as a tool result.
 */
export function assertReadBefore(sessionId: string, absolutePath: string): void {
  const err = checkReadBefore(sessionId, absolutePath);
  if (err) throw new Error(err);
}

/**
 * Clear all read-time entries for a session (e.g. on session end).
 */
export function clearSession(sessionId: string): void {
  for (const key of readTimes.keys()) {
    if (key.startsWith(`${sessionId}:`)) {
      readTimes.delete(key);
    }
  }
}
```

## Step 4: Create UI components

### `src/components/LeftBar.tsx`

Create the file:

```bash
mkdir -p src/components && touch src/components/LeftBar.tsx
```

A left-side bar indicator used by all callout-style components (tool calls, approvals, errors, code blocks). Renders a bold `│` character that stretches to match the full height of its content.

**Why not `<Box borderStyle>`?** Box borders add lines on all four sides and inflate Ink's managed line count. Ink erases by line count on every re-render, so extra rows increase the chance of resize ghosting — stale lines left on screen when the new frame is shorter than the old one. `LeftBar` uses a plain `<Text>` column instead, so the total line count is exactly equal to the children's line count with no overhead.

The bar height is derived by attaching a `ref` to the content box and calling Ink's built-in `measureElement` after each render to get the actual rendered row count.

```typescript
// src/components/LeftBar.tsx

import React, { useRef, useState, useLayoutEffect } from 'react';
import { Box, Text, measureElement } from 'ink';
import type { DOMElement } from 'ink';

export interface LeftBarProps {
  color?: string;
  children: React.ReactNode;
  marginTop?: number;
  marginBottom?: number;
}

export const LeftBar: React.FC<LeftBarProps> = ({
  color = 'green',
  children,
  marginTop = 0,
  marginBottom = 0,
}) => {
  const contentRef = useRef<DOMElement>(null);
  const [height, setHeight] = useState(1);

  useLayoutEffect(() => {
    if (contentRef.current) {
      try {
        const { height: h } = measureElement(contentRef.current);
        if (h > 0) setHeight(h);
      } catch {
        // measureElement can throw before layout is complete; keep previous height
      }
    }
  });

  const bar = Array.from({ length: height }, () => '│').join('\n');

  return (
    <Box flexDirection="row" marginTop={marginTop} marginBottom={marginBottom}>
      <Box flexDirection="column" marginRight={1}>
        <Text color={color} bold>{bar}</Text>
      </Box>
      <Box ref={contentRef} flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
};
```

### `src/components/CollapsibleBox.tsx`

Create the file:

```bash
mkdir -p src/components && touch src/components/CollapsibleBox.tsx
```

Hides long content behind expand/collapse. Used for system prompts, tool results, and verbose output.

```typescript
// src/components/CollapsibleBox.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { LeftBar } from './LeftBar.js';

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
      <LeftBar color={titleColor ?? 'white'} marginBottom={marginBottom}>
        <Text color={titleColor} dimColor={dimColor} bold>{title}</Text>
        <Text dimColor={dimColor}>{content}</Text>
      </LeftBar>
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
    <LeftBar color={titleColor ?? 'white'} marginBottom={marginBottom}>
      <Text color={titleColor} dimColor={dimColor} bold>
        {expanded ? '▼' : '▶'} {title}
      </Text>
      <Text dimColor={dimColor}>{preview}</Text>
      {!expanded && <Text dimColor={true}>... (use /expand to see all)</Text>}
    </LeftBar>
  );
};
```

### `src/components/ConsolidatedToolMessage.tsx`

Create the file:

```bash
mkdir -p src/components && touch src/components/ConsolidatedToolMessage.tsx
```

Groups a tool call with its result into a single consolidated view.

```typescript
// src/components/ConsolidatedToolMessage.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { FormattedMessage } from './FormattedMessage.js';
import { LeftBar } from './LeftBar.js';

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
  const titleColor = containsTodoTool ? 'green' : 'cyan';
  const isExpanded = expanded || containsTodoTool;

  if (isExpanded) {
    return (
      <LeftBar color={titleColor}>
        <Text color={titleColor} bold>▼ {title}</Text>
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
      </LeftBar>
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
    <LeftBar color="white">
      <Text color={titleColor} dimColor bold>▶ {title}</Text>
      <Text dimColor>{preview}</Text>
    </LeftBar>
  );
};
```

### `src/components/FormattedMessage.tsx`

Create the file:

```bash
mkdir -p src/components && touch src/components/FormattedMessage.tsx
```

Renders markdown tables as preformatted monospace text, code blocks with a left-bar indicator, and applies text formatting. Uses proper grapheme clustering for accurate width calculation with Unicode text.

```typescript
// src/components/FormattedMessage.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { formatMessage } from '../utils/format-message.js';
import { LeftBar } from './LeftBar.js';

interface FormattedMessageProps {
  content: string;
  deferTables?: boolean;
}

export const DEFERRED_TABLE_PLACEHOLDER = 'table loading';

const graphemeSegmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null;

const COMBINING_MARK_PATTERN = /\p{Mark}/u;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFE0E\uFE0F]/u;
const DOUBLE_WIDTH_PATTERN = /[\u1100-\u115F\u2329\u232A\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F1E6}-\u{1F1FF}]/u;

function splitGraphemes(text: string): string[] {
  if (!text) return [];
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(text), (segment) => segment.segment);
  }
  return Array.from(text);
}

function getGraphemeWidth(grapheme: string): number {
  if (!grapheme) return 0;
  if (ZERO_WIDTH_PATTERN.test(grapheme)) return 0;
  if (COMBINING_MARK_PATTERN.test(grapheme)) return 0;
  if (/^[\u0000-\u001F\u007F-\u009F]$/.test(grapheme)) return 0;
  if (DOUBLE_WIDTH_PATTERN.test(grapheme)) return 2;
  return 1;
}

function getTextWidth(text: string): number {
  return splitGraphemes(text).reduce((width, grapheme) => width + getGraphemeWidth(grapheme), 0);
}

function padToWidth(text: string, width: number): string {
  const padding = Math.max(0, width - getTextWidth(text));
  return text + ' '.repeat(padding);
}

function parseMarkdownTableToRows(markdown: string): string[][] | null {
  const lines = markdown.trim().split('\n');
  if (lines.length < 3) return null;

  const parseRow = (row: string) =>
    row.split('|')
      .map((cell) => cell.trim())
      .filter((cell, index, array) => {
        if (index === 0 && cell === '') return false;
        if (index === array.length - 1 && cell === '') return false;
        return true;
      });

  const header = parseRow(lines[0]);
  const separator = parseRow(lines[1]);
  if (header.length === 0 || separator.length === 0) return null;
  if (!separator.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')))) return null;

  const rows = lines.slice(2).map(parseRow);
  return [header, ...rows];
}

function renderPreformattedTable(markdown: string): string {
  const rows = parseMarkdownTableToRows(markdown);
  if (!rows || rows.length === 0) {
    return markdown.trim();
  }

  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) =>
    Array.from({ length: columnCount }, (_, index) => row[index] ?? '')
  );
  const widths = Array.from({ length: columnCount }, (_, index) =>
    Math.max(...normalizedRows.map((row) => getTextWidth(row[index])))
  );

  const formatRow = (row: string[]) => row
    .map((cell, index) => padToWidth(cell, widths[index]))
    .join('  ')
    .trimEnd();

  const header = formatRow(normalizedRows[0]);
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = normalizedRows.slice(1).map(formatRow);

  return [header, divider, ...body].join('\n');
}

export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content, deferTables = false }) => {
  if (!content) return null;

  const lines = content.split('\n');
  const blocks: Array<{ type: 'text' | 'table' | 'code'; content: string }> = [];

  let currentBlockContent: string[] = [];
  let currentBlockType: 'text' | 'table' | 'code' = 'text';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 1. Handle Code Blocks
    if (currentBlockType === 'code') {
      currentBlockContent.push(line);
      if (trimmedLine.startsWith('```')) {
        blocks.push({ type: 'code', content: currentBlockContent.join('\n') });
        currentBlockContent = [];
        currentBlockType = 'text';
      }
      continue;
    }

    // Start Code Block
    if (trimmedLine.startsWith('```')) {
      if (currentBlockContent.length > 0) {
        blocks.push({ type: 'text', content: currentBlockContent.join('\n') });
      }
      currentBlockContent = [line];
      currentBlockType = 'code';
      continue;
    }

    // 2. Handle Tables
    if (currentBlockType === 'table') {
      if (trimmedLine.startsWith('|')) {
        currentBlockContent.push(line);
        continue;
      } else {
        blocks.push({ type: 'table', content: currentBlockContent.join('\n') });
        currentBlockContent = [];
        currentBlockType = 'text';
      }
    }

    // Start Table Block check
    const isTableStart = trimmedLine.startsWith('|');
    const nextLine = lines[i+1];
    const isNextLineSeparator = nextLine && nextLine.trim().startsWith('|') && nextLine.includes('---');

    if (isTableStart && isNextLineSeparator) {
      if (currentBlockContent.length > 0) {
        blocks.push({ type: 'text', content: currentBlockContent.join('\n') });
      }
      currentBlockContent = [line];
      currentBlockType = 'table';
      continue;
    }

    // 3. Handle Text
    currentBlockContent.push(line);
  }

  // Push final block
  if (currentBlockContent.length > 0) {
    blocks.push({ type: currentBlockType, content: currentBlockContent.join('\n') });
  }

  return (
    <Box flexDirection="column">
      {blocks.map((block, index) => {
        if (block.type === 'table') {
          if (!block.content.trim()) return null;
          if (deferTables) {
            return (
              <Box key={index} marginY={1}>
                <Text dimColor>{DEFERRED_TABLE_PLACEHOLDER}</Text>
              </Box>
            );
          }
          return (
            <LeftBar key={index} color="gray" marginTop={1} marginBottom={1}>
              <Text>{renderPreformattedTable(block.content)}</Text>
            </LeftBar>
          );
        }

        if (block.type === 'code') {
           return (
             <LeftBar key={index} color="gray" marginTop={1} marginBottom={1}>
               <Text dimColor>{block.content}</Text>
             </LeftBar>
           );
        }

        // Text Block
        if (!block.content.trim()) return null;
        return (
          <Box key={index} marginBottom={0}>
             <Text>{formatMessage(block.content)}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
```

### `src/components/ConfigDialog.tsx`

Create the file:

```bash
mkdir -p src/components && touch src/components/ConfigDialog.tsx
```

Modal-like dialog for changing config mid-conversation. Allows users to update provider, model, or API key without losing chat history.

```typescript
// src/components/ConfigDialog.tsx

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PasswordInput, Select } from '@inkjs/ui';
import { getAllProviders, getProvider } from '../providers.js';
import { resolveApiKey, type Config } from '../config.js';

export interface ConfigDialogProps {
  currentConfig: Config;
  onComplete: (newConfig: Config) => void;
  onCancel: () => void;
}

export const ConfigDialog: React.FC<ConfigDialogProps> = ({
  currentConfig,
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<'select_provider' | 'enter_api_key'>('select_provider');
  const [selectedProviderId, setSelectedProviderId] = useState(currentConfig.provider);
  const [selectedModelId, setSelectedModelId] = useState(currentConfig.model);

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}:::${model.id}`,
    })),
  );

  const currentProvider = getProvider(currentConfig.provider);

  // Provider selection step
  if (step === 'select_provider') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          Change Configuration
        </Text>
        <Text dimColor>Current: {currentProvider?.name} / {currentConfig.model}</Text>
        <Text dimColor>Select a new provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setStep('enter_api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  // API key entry step
  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green" bold>
        Confirm Configuration
      </Text>
      <Text dimColor>
        Provider: {provider?.name} / {selectedModelId}
      </Text>
      <Text>{hasResolvedAuth ? 'Optional API key (leave empty to keep resolved auth):' : 'Enter your API key:'}</Text>
      <PasswordInput
        placeholder={`Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={(value) => {
          const finalApiKey = value.trim().length > 0 ? value.trim() : currentConfig.apiKey;
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(finalApiKey?.trim() ? { apiKey: finalApiKey.trim() } : {}),
          };
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};
```

## Step 5: Upgrade `src/tools/edit-file.ts`

The final version adds a 5-strategy fuzzy match cascade (exact, line-trimmed, indent-flexible, whitespace-normalized, trimmed-boundary) and returns a unified diff on success. It also enforces the read-before-edit staleness guard via `file-time.ts`.

See `src/tools/edit-file.ts` in the source tree for the complete implementation. The key additions over the Part 5 version:

- Import `assertReadBefore` and `recordRead` from `../utils/file-time.js`
- `findWithCascade()` tries 5 match strategies in order
- `computeUnifiedDiff()` generates a diff for the tool result
- Re-reads the file after write and records the read time

## Step 6: Upgrade `src/tools/read-file.ts`

The final version adds:
- `findSimilarPaths()` — suggests similar paths when a file isn't found
- `recordRead()` — tracks reads for the staleness guard

See `src/tools/read-file.ts` in the source tree for the complete implementation.

## Step 7: Upgrade `src/tools/search-files.ts`

The final version adds ripgrep (`rg`) support when available, falling back to the JS implementation. Ripgrep results are sorted by modification time (most recently changed files first).

See `src/tools/search-files.ts` in the source tree for the complete implementation.

## Step 8: Upgrade `src/agentic-loop.ts`

The final version adds extensive error recovery, logging, and robustness improvements:

**AbortSignal Handling:**
- `setMaxListeners(0, abortSignal)` — Prevents MaxListenersExceededWarning on long runs
- `sleepWithAbort()` — Cancellable delays with proper cleanup
- `emitAbortAndFinish()` — Clean abort handling

**Tool Call Sanitization (Critical for Reliability):**
- `appendStreamingFragment()` — Handles overlapping stream deltas correctly
- `collapseRepeatedString()` — Fixes models that repeat tool names
- `normalizeToolName()` — Matches tool names even when malformed
- `extractFirstCompleteJsonValue()` — Extracts valid JSON from garbage
- `repairInvalidEscapes()` — Fixes invalid JSON escapes like `\|` from grep regex
- `sanitizeToolCall()` / `sanitizeMessagesForRetry()` — Comprehensive repair of malformed tool calls

**Retry & Recovery Logic:**
- `repairRetryCount` — Retries with sanitized messages on 400 errors
- `contextRetryCount` — Forces compaction on context-too-long errors
- `retriggerCount` / `MAX_RETRIGGERS` — Retries when AI stops after tool calls
- `truncateRetryCount` / `MAX_TRUNCATE_RETRIES` — Removes messages on persistent 400s
- Exponential backoff: `Math.min(2 ** iterationCount * 1000, 30_000)`

**Provider-Specific Fixes:**
- Preserves Gemini's `extra_content` field (thought_signature) to prevent 400 errors

**System Prompt Refresh:**
- Refreshes system prompt each iteration to pick up new skills

**Comprehensive Logging:**
- API request/response logging with token counts
- Tool call validation warnings
- Debug logging for message payloads

See `src/agentic-loop.ts` in the source tree for the complete 500+ line implementation.

## Step 9: Upgrade `src/config.tsx`

The final version adds the `InitComponent` for the interactive `protoagent init` wizard, plus helper functions for config path resolution:

- `InitComponent` — Interactive React component for creating runtime configs
- `getInitConfigPath()` — Returns path for project or user config
- `writeInitConfig()` — Creates initial protoagent.jsonc with empty providers/mcp structure
- Helper functions: `getConfigDirectory()`, `getUserRuntimeConfigPath()`, `getProjectRuntimeConfigPath()`
- Enhanced `resolveApiKey()` with better precedence chain and custom headers support

Key additions to the `InitComponent`:
- Two-step wizard: select target (project vs user) → confirm/create config
- Checks if config already exists and prompts for overwrite
- Shows colored success/exists messages after creation

See `src/config.tsx` in the source tree for the complete implementation.

## Step 10: Upgrade `src/mcp.ts`

The final version adds logging integration and stderr handling:

- **JSDoc header** — Comprehensive documentation of MCP configuration format
- **Logger integration** — Imports `logger` from utils
- **Stderr piping** — Stdio server stderr is captured and logged via `logger.debug()` instead of bleeding into the terminal UI
- **Structured sections** — Code organized with `// ─── Section ───` dividers
- **Better type organization** — Explicit `StdioServerConfig` and `HttpServerConfig` type extracts

The stderr handling is particularly important: MCP servers often log to stderr, which would corrupt the Ink UI. By piping it to the logger, the UI stays clean while debug logs capture server output.

See `src/mcp.ts` in the source tree for the complete implementation.

## Step 11: Final `src/App.tsx`

The final App brings together everything from Parts 1-12 plus:

- **Archived vs live message rendering** — archived messages use `useMemo` for performance, live messages re-render during streaming
- **Grouped tool rendering** — tool calls and results are consolidated using `ConsolidatedToolMessage`
- **Collapsible output** — system prompts and tool results use `CollapsibleBox`
- **Left-bar indicators** — `LeftBar` replaces Box borders for callout-style content; the bar stretches to match content height via `measureElement` with no extra line overhead
- **Formatted text** — assistant messages use `FormattedMessage` with markdown/table support
- **Slash commands** — `/clear`, `/collapse`, `/expand`, `/help`, `/quit`
- **Spinner with active tool** — shows which tool is currently executing
- **Debounced text rendering** — 50ms batching for streaming text deltas
- **Terminal resize handling** — re-renders input on window resize
- **Quitting with session save** — displays the resume command before exit

See `src/App.tsx` in the source tree for the complete 1061-line implementation.

## Step 12: Final `src/cli.tsx`

```typescript
// src/cli.tsx

/**
 * CLI entry point for ProtoAgent.
 *
 * Parses command-line flags and launches either the main chat UI
 * or the configuration wizard.
 */

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, InitComponent, readConfig, writeConfig, writeInitConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: TRACE, DEBUG, INFO, WARN, ERROR', 'DEBUG')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    render(
      <App
        dangerouslySkipPermissions={options.dangerouslySkipPermissions || false}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });

program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(`${selected.provider} / ${selected.model}`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program
  .command('init')
  .description('Create a project-local or shared ProtoAgent runtime config')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--force', 'Overwrite an existing target file')
  .action((options) => {
    if (options.project || options.user) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }

      const result = writeInitConfig(options.project ? 'project' : 'user', process.cwd(), {
        overwrite: Boolean(options.force),
      });
      const message = result.status === 'created'
        ? 'Created ProtoAgent config:'
        : result.status === 'overwritten'
          ? 'Overwrote ProtoAgent config:'
          : 'ProtoAgent config already exists:';
      console.log(message);
      console.log(result.path);
      return;
    }

    render(<InitComponent />);
  });

program.parse(process.argv);
```

## Step 13: Logging Throughout the Codebase

With the logger utility in place, all core modules now include observability:

- **agentic-loop.ts** — Logs API requests/responses, tool calls, errors, and retry attempts
- **sessions.ts** — Logs session save operations
- **skills.ts** — Logs skill loading, collisions, and invalid skills
- **sub-agent.ts** — Logs sub-agent lifecycle and tool execution
- **mcp.ts** — Logs MCP server stderr output
- **bash.ts** — Logs command execution

Rather than showing every logging addition (they're repetitive `logger.debug()` and `logger.info()` calls), the key is that the logger provides a consistent way to trace execution across the entire application.

## Verification

```bash
npm run dev -- --log-level debug
```

You should see:
- Richer output rendering: code blocks and tables with a left-bar indicator, no box borders
- Grouped tool activity: tool calls and results shown together with a left-bar
- Collapsible long content: system prompt collapsed by default
- Slash commands: `/help`, `/clear`, `/expand`, `/collapse`, `/quit`
- Debug log file path displayed at startup
- Spinner showing which tool is currently executing
- Session save on quit with resume command

## Differences from Final Source

The part-13 checkpoint is functionally complete, but the live source at `/src` has evolved with additional polish. Here are the differences and why they're not in the tutorial:

### Comment Style Improvements
The live source uses comprehensive JSDoc headers on nearly every file:

```typescript
/**
 * Tool registry — collects all tool definitions and provides a dispatcher.
 *
 * Each tool file exports:
 *  - A tool definition (OpenAI function-calling JSON schema)
 *  - A handler function (args) => Promise<string>
 *
 * This file wires them together into a single `tools` array and
 * a `handleToolCall(name, args)` dispatcher.
 */
```

**Why not in tutorial:** These are repetitive and don't add functionality. The tutorial focuses on code that teaches concepts, not documentation boilerplate.

### Logger Integration
The live source adds `logger` imports and debug calls throughout:
- `tools/bash.ts` — logs command execution
- `tools/index.ts` — logs tool registration
- `utils/approval.ts` — logs approval decisions
- `utils/compactor.ts` — logs compaction events

**Why not in tutorial:** The tutorial covers the logger utility in Step 1 and mentions it in the "Logging Throughout" section. Adding every `logger.debug()` call would be repetitive and clutter the learning material.

### Model Catalog Updates
`providers.ts` in the live source has:
- Updated pricing and context windows (models change frequently)
- New models: gpt-5.4-pro, gpt-5.2, gpt-5-nano
- `pricingPerMillionCached` field for prompt caching
- Runtime config merging via `getRuntimeConfig()`

**Why not in tutorial:** Model specs change frequently. The tutorial provides a working baseline; the live source stays current with actual provider offerings.

### Minor Code Cleanups
- `sub-agent.ts` — interface ordering, JSDoc header
- `system-prompt.ts` — enhanced guidelines section (SUBAGENT STRATEGY), config path display
- `write-file.ts` — records read after write to prevent staleness guard false positives
- `compactor.ts` — protected skill message handling
- `cli.tsx` — shebang, inline comments

**Why not in tutorial:** These are micro-optimizations and stylistic choices that don't change behavior significantly enough to warrant tutorial steps.

### Functional Equivalence
Despite these differences, the part-13 checkpoint is **fully functional**. The live source is essentially the same code with:
1. More documentation comments
2. Additional debug logging
3. Updated model pricing
4. Minor edge-case fixes

You can use the part-13 checkpoint as a working foundation and evolve it independently, or sync with the live source for the latest polish.

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-13`.

This is the final checkpoint. At this point your staged rebuild matches the complete ProtoAgent application.

## Core takeaway

Polish is not just cosmetics. It is the layer that makes the tool loop readable, debuggable, and survivable over a long session. The separation of archived and live messages, the grouped tool rendering, the formatted output — these are what turn a working agent loop into a tool you actually want to use.

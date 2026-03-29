# Part 13: Polish, Rendering & Logging

This last part is pretty involved because it's a series of incremental improvements to individual tools that have been made after using ProtoAgent and refining it.

It's what makes the full final project have richer rendering, grouped tool output, collapsible messages, slash commands, formatted output, and the complete final module layout.

## What you are building

Starting from Part 12, you add:

- `src/utils/logger.ts` — logging utility with levels and file output
- `src/utils/format-message.tsx` — markdown-to-ANSI formatting
- `src/utils/file-time.ts` — staleness guard for edit_file

- `src/agentic-loop/stream.ts` — stream processing extracted from the main loop
- `src/agentic-loop/executor.ts` — tool execution extracted from the main loop
- `src/agentic-loop/errors.ts` — error handling extracted from the main loop

There are also new files to create to adjust the UI:
- `src/components/LeftBar.tsx` — left-side bar indicator for callouts (no Box border)
- `src/components/CollapsibleBox.tsx` — expand/collapse for long content
- `src/components/ConsolidatedToolMessage.tsx` — grouped tool call rendering
- `src/components/FormattedMessage.tsx` — markdown tables, code blocks, text formatting
- `src/components/ConfigDialog.tsx` — mid-session config changes

And many existing files are upgraded to be more robust:
- Updated `src/agentic-loop.ts` — modularized using the new submodules
- Updated `src/tools/edit-file.ts` — fuzzy match cascade + unified diff output
- Updated `src/tools/read-file.ts` — similar-path suggestions + file-time tracking
- Updated `src/tools/search-files.ts` — ripgrep support when available
- Updated `src/App.tsx` — final version with all features
- Updated `src/cli.tsx` — enhances command structure

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

Adds support for markdown-style formatting (**bold**, *italic*, ***bold italic***) using Ink `<Text>` components with proper props.

```typescript
// src/utils/format-message.tsx

import React from 'react';
import { Text } from 'ink';

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const cleaned = text.replace(/^#+\s+/gm, '');
  const pattern = /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^\s*][^*]*?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: cleaned.slice(lastIndex, match.index) });
    }
    const fullMatch = match[0];
    const content = fullMatch.slice(fullMatch.startsWith('***') ? 3 : 2, fullMatch.startsWith('***') ? -3 : -2);
    if (fullMatch.startsWith('***')) {
      segments.push({ text: content, bold: true, italic: true });
    } else if (fullMatch.startsWith('**')) {
      segments.push({ text: content, bold: true });
    } else {
      segments.push({ text: content, italic: true });
    }
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < cleaned.length) {
    segments.push({ text: cleaned.slice(lastIndex) });
  }
  return segments.length > 0 ? segments : [{ text: cleaned }];
}

/** Render formatted text as Ink Text elements. */
export function renderFormattedText(text: string): React.ReactNode {
  const segments = parseSegments(text);
  if (segments.length === 1 && !segments[0].bold && !segments[0].italic) {
    return segments[0].text;
  }
  return segments.map((seg, i) => (
    <Text key={i} bold={seg.bold} italic={seg.italic}>{seg.text}</Text>
  ));
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
import { renderFormattedText } from '../utils/format-message.js';
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
             <Text>{renderFormattedText(block.content)}</Text>
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

## Step 5: Modularize `src/agentic-loop.ts`

By Part 12, the agentic loop has grown to nearly 1000 lines with multiple concerns mixed together: stream processing, tool execution, error recovery, and the main orchestration loop. Before adding polish, let's refactor into focused modules.

This separation makes the code more maintainable and easier to understand:
- `stream.ts` — only handles accumulating streaming chunks
- `executor.ts` — only handles executing tool calls
- `errors.ts` — only handles error recovery strategies
- `agentic-loop.ts` — orchestrates using the modules above

### Create `src/agentic-loop/stream.ts`

Create the file:

```bash
mkdir -p src/agentic-loop && touch src/agentic-loop/stream.ts
```

```typescript
// src/agentic-loop/stream.ts

/**
 * Stream processing module for the agentic loop.
 *
 * Handles accumulation of streaming response chunks into a complete
 * assistant message, including content, tool calls, and usage data.
 */

import type OpenAI from 'openai';
import type { AgentEventHandler } from '../agentic-loop.js';
import { estimateTokens, estimateConversationTokens, createUsageInfo, getContextInfo, type ModelPricing } from '../utils/cost-tracker.js';
import { logger } from '../utils/logger.js';

/**
 * Accumulated result from processing a streaming response.
 */
export interface StreamResult {
  assistantMessage: {
    role: 'assistant';
    content: string;
    tool_calls: any[];
  };
  hasToolCalls: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    contextPercent: number;
  };
}

/**
 * Process a streaming API response, accumulating content and tool calls.
 *
 * Emits text_delta events for immediate UI display and usage info
 * when available. Returns the complete accumulated message.
 */
export async function processStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  messages: any[],
  model: string,
  pricing: ModelPricing | undefined,
  onEvent: AgentEventHandler
): Promise<StreamResult> {
  const assistantMessage = {
    role: 'assistant' as const,
    content: '',
    tool_calls: [] as any[],
  };

  let streamedContent = '';
  let hasToolCalls = false;
  let actualUsage: OpenAI.CompletionUsage | undefined;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (chunk.usage) {
      actualUsage = chunk.usage;
    }

    // Stream text content (and return to UI for immediate display via onEvent)
    if (delta?.content) {
      streamedContent += delta.content;
      assistantMessage.content = streamedContent;
      if (!hasToolCalls) {
        onEvent({ type: 'text_delta', content: delta.content });
      }
    }

    // Accumulate tool calls across stream chunks
    if (delta?.tool_calls) {
      hasToolCalls = true;
      for (const tc of delta.tool_calls) {
        const idx = tc.index || 0;
        if (!assistantMessage.tool_calls[idx]) {
          assistantMessage.tool_calls[idx] = {
            id: '',
            type: 'function',
            function: { name: '', arguments: '' },
          };
        }
        if (tc.id) assistantMessage.tool_calls[idx].id = tc.id;
        if (tc.function?.name) {
          assistantMessage.tool_calls[idx].function.name += tc.function.name;
        }
        if (tc.function?.arguments) {
          assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
        }
        // Gemini 3+ models include an `extra_content` field on tool calls
        // containing a `thought_signature`. This MUST be preserved and sent
        // back in subsequent requests, otherwise Gemini returns a 400.
        // See: https://ai.google.dev/gemini-api/docs/openai
        if ((tc as any).extra_content) {
          assistantMessage.tool_calls[idx].extra_content = (tc as any).extra_content;
        }
      }
    }
  }

  // Calculate usage metrics
  const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(messages);
  const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
  const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
  const cost = pricing
    ? createUsageInfo(inputTokens, outputTokens, pricing, cachedTokens).estimatedCost
    : 0;
  const contextPercent = pricing
    ? getContextInfo(messages, pricing).utilizationPercentage
    : 0;

  // Log API response with usage info at INFO level
  logger.info('Received API response', {
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    cost: cost > 0 ? `$${cost.toFixed(4)}` : 'N/A',
    contextPercent: contextPercent > 0 ? `${contextPercent.toFixed(1)}%` : 'N/A',
    hasToolCalls: assistantMessage.tool_calls.length > 0,
    contentLength: assistantMessage.content?.length || 0,
  });

  onEvent({
    type: 'usage',
    usage: { inputTokens, outputTokens, cost, contextPercent },
  });

  // Log the full assistant message for debugging
  logger.debug('Assistant response details', {
    contentLength: assistantMessage.content?.length || 0,
    contentPreview: assistantMessage.content?.slice(0, 200) || '(empty)',
    toolCallsCount: assistantMessage.tool_calls?.length || 0,
    toolCalls: assistantMessage.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      argsPreview: tc.function?.arguments?.slice(0, 100),
    })),
  });

  return {
    assistantMessage,
    hasToolCalls,
    usage: { inputTokens, outputTokens, cost, contextPercent },
  };
}
```

### Create `src/agentic-loop/executor.ts`

Create the file:

```bash
touch src/agentic-loop/executor.ts
```

```typescript
// src/agentic-loop/executor.ts

/**
 * Tool execution module for the agentic loop.
 *
 * Handles execution of tool calls including special handling for
 * sub-agents and proper abort signal management between tool calls.
 */

import type { AgentEventHandler, ToolCallEvent } from '../agentic-loop.js';
import { handleToolCall } from '../tools/index.js';
import { runSubAgent, type SubAgentProgressHandler, type SubAgentUsage } from '../sub-agent.js';
import { logger } from '../utils/logger.js';

/**
 * Context for tool execution, passed through from the main loop.
 */
export interface ToolExecutionContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
  requestDefaults: Record<string, unknown>;
  client: any;  // OpenAI client
  model: string;
  pricing?: any;  // ModelPricing
}

/**
 * Execute all tool calls from an assistant message.
 *
 * Handles:
 * - Abort checking between tool calls
 * - Sub-agent special case with progress reporting
 * - Error handling and result accumulation
 * - Pending tool call tracking for abort scenarios
 *
 * Returns true if execution completed normally, false if aborted.
 */
export async function executeToolCalls(
  toolCalls: any[],
  messages: any[],
  onEvent: AgentEventHandler,
  context: ToolExecutionContext
): Promise<{ completed: boolean; shouldAbort: boolean }> {
  const { sessionId, abortSignal, requestDefaults, client, model, pricing } = context;

  // Track which tool_call_ids still need a tool result message.
  // This set is used to inject stub responses on abort, preventing
  // orphaned tool_call_ids from permanently bricking the session.
  const pendingToolCallIds = new Set<string>(
    toolCalls.map((tc: any) => tc.id as string)
  );

  const injectStubsForPendingToolCalls = () => {
    for (const id of pendingToolCallIds) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: 'Aborted by user.',
      } as any);
    }
  };

  for (const toolCall of toolCalls) {
    // Check abort between tool calls
    if (abortSignal?.aborted) {
      logger.debug('Agentic loop aborted between tool calls');
      injectStubsForPendingToolCalls();
      return { completed: false, shouldAbort: true };
    }

    const { name, arguments: argsStr } = toolCall.function;

    onEvent({
      type: 'tool_call',
      toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' } as ToolCallEvent,
    });

    try {
      const args = JSON.parse(argsStr);
      let result: string;

      // Handle sub-agent tool specially
      if (name === 'sub_agent') {
        const subProgress: SubAgentProgressHandler = (evt) => {
          onEvent({
            type: 'sub_agent_iteration',
            subAgentTool: { tool: evt.tool, status: evt.status, iteration: evt.iteration, args: evt.args },
          });
        };
        const subResult = await runSubAgent(
          client,
          model,
          args.task,
          args.max_iterations,
          requestDefaults,
          subProgress,
          abortSignal,
          pricing,
        );
        result = subResult.response;
        // Emit sub-agent usage for the UI to add to total cost
        if (subResult.usage.inputTokens > 0 || subResult.usage.outputTokens > 0) {
          onEvent({
            type: 'sub_agent_iteration',
            subAgentUsage: subResult.usage as any,
          });
        }
      } else {
        result = await handleToolCall(name, args, { sessionId, abortSignal });
      }

      logger.info('Tool completed', {
        tool: name,
        resultLength: result.length,
      });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      } as any);
      pendingToolCallIds.delete(toolCall.id);

      onEvent({
        type: 'tool_result',
        toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result } as ToolCallEvent,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: ${errMsg}`,
      } as any);
      pendingToolCallIds.delete(toolCall.id);

      // If the tool was aborted, inject stubs for remaining pending calls and stop
      if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
        logger.debug('Agentic loop aborted during tool execution');
        injectStubsForPendingToolCalls();
        return { completed: false, shouldAbort: true };
      }

      onEvent({
        type: 'tool_result',
        toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg } as ToolCallEvent,
      });
    }
  }

  return { completed: true, shouldAbort: false };
}
```

### Create `src/agentic-loop/errors.ts`

Create the file:

```bash
touch src/agentic-loop/errors.ts
```

```typescript
// src/agentic-loop/errors.ts

/**
 * Error handling module for the agentic loop.
 *
 * Handles API errors with various retry strategies:
 * - 400 errors: JSON repair, orphaned tool cleanup, truncation, "continue" prompts
 * - 429 errors: rate limit backoff
 * - 5xx errors: exponential backoff
 * - Context window exceeded: forced compaction
 */

import type { Message, AgentEventHandler } from '../agentic-loop.js';
import type { ModelPricing } from '../utils/cost-tracker.js';
import { compactIfNeeded } from '../utils/compactor.js';
import { logger } from '../utils/logger.js';

// Retry state tracked across loop iterations.
export interface RetryState {
  repairCount: number;
  contextCount: number;
  truncateCount: number;
  continueCount: number;
  retriggerCount: number;
}

const LIMITS = {
  MAX_REPAIR: 2,
  MAX_CONTEXT: 2,
  MAX_TRUNCATE: 5,
  MAX_CONTINUE: 1,
};

// Sleep with abort signal support.
export async function sleepWithAbort(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  if (abortSignal.aborted) {
    throw new Error('Operation aborted');
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', onAbort);
      reject(new Error('Operation aborted'));
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

// Result of attempting to handle an API error.
export interface ErrorHandlerResult {
  handled: boolean;
  shouldAbort: boolean;
  silentRetry: boolean;
  errorMessage?: string;
  transient?: boolean;
}

// Handle an API error with appropriate retry strategy.
export async function handleApiError(
  apiError: any,
  messages: Message[],
  _validToolNames: Set<string>,
  pricing: ModelPricing | undefined,
  retryState: RetryState,
  iterationCount: number,
  onEvent: AgentEventHandler,
  client?: any,
  model?: string,
  requestDefaults?: Record<string, unknown>,
  sessionId?: string
): Promise<ErrorHandlerResult> {
  const errMsg = apiError?.message || 'Unknown API error';
  const status = apiError?.status;

  logger.error(`API error: ${errMsg}`, { status, code: apiError?.code });

  const retryableStatus = status === 408 || status === 409 || status === 425;
  const retryableCode = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(apiError?.code);

  // Context window exceeded - force compaction
  const isContextTooLong =
    status === 400 &&
    /prompt.*too long|context.*length|maximum.*token|tokens?.*exceed/i.test(errMsg);

  if (isContextTooLong && retryState.contextCount < LIMITS.MAX_CONTEXT) {
    retryState.contextCount++;
    logger.warn(`Prompt too long (attempt ${retryState.contextCount})`);
    onEvent({
      type: 'error',
      error: 'Prompt too long. Compacting conversation...',
      transient: true,
    });

    if (pricing && client && model) {
      try {
        const compacted = await compactIfNeeded(
          client,
          model,
          messages,
          pricing.contextWindow,
          requestDefaults || {},
          sessionId
        );
        messages.length = 0;
        messages.push(...compacted);
      } catch (compactErr) {
        logger.error(`Compaction failed: ${compactErr}`);
      }
    }

    // Truncate oversized tool results as fallback
    const MAX_TOOL_CHARS = 20_000;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as any;
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_CHARS) {
        messages[i] = {
          ...m,
          content: m.content.slice(0, MAX_TOOL_CHARS) + '\n... (truncated)',
        };
      }
    }

    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // Rate limit - backoff
  if (status === 429) {
    const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
    const backoff = Math.min(retryAfter * 1000, 60_000);
    logger.info(`Rate limited, retrying in ${backoff / 1000}s...`);
    onEvent({ type: 'error', error: `Rate limited. Retrying...`, transient: true });
    await sleepWithAbort(backoff);
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // Server error - exponential backoff
  if (status >= 500 || retryableStatus || retryableCode) {
    const backoff = Math.min(2 ** iterationCount * 1000, 30_000);
    logger.info(`Request failed, retrying in ${backoff / 1000}s...`);
    onEvent({ type: 'error', error: `Request failed. Retrying...`, transient: true });
    await sleepWithAbort(backoff);
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // Generic 400 errors - try repair/truncate
  if (status === 400) {
    return await handle400Error(messages, retryState, onEvent);
  }

  // Non-retryable
  return { handled: false, shouldAbort: false, silentRetry: false, errorMessage: errMsg };
}

// Handle 400 errors: repair JSON -> truncate.
async function handle400Error(
  messages: Message[],
  retryState: RetryState,
  onEvent: AgentEventHandler
): Promise<ErrorHandlerResult> {
  // Try JSON repairs on tool arguments
  if (retryState.repairCount < LIMITS.MAX_REPAIR) {
    let repaired = false;

    for (const msg of messages) {
      const msgAny = msg as any;
      if (msg.role === 'assistant' && Array.isArray(msgAny.tool_calls)) {
        for (const tc of msgAny.tool_calls) {
          const args = tc.function?.arguments;
          if (args && typeof args === 'string') {
            const fixed = repairInvalidEscapes(args);
            if (fixed !== args) {
              tc.function.arguments = fixed;
              repaired = true;
            }
          }
        }
      }
    }

    if (repaired) {
      retryState.repairCount++;
      logger.warn('400 response: repaired invalid JSON escapes');
      return { handled: true, shouldAbort: false, silentRetry: true };
    }
  }

  // Truncate messages progressively
  if (retryState.truncateCount < LIMITS.MAX_TRUNCATE && messages.length > 2) {
    retryState.truncateCount++;
    const removed = messages.splice(-1);
    logger.debug('400 error: removed last message', {
      role: removed[0]?.role,
      remaining: messages.length,
    });
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // All strategies exhausted
  return {
    handled: false,
    shouldAbort: false,
    silentRetry: false,
    errorMessage: 'Could not recover from error. Try /clear to start fresh.',
  };
}

/**
 * Repair invalid JSON escape sequences.
 * Models sometimes emit \| \! \- etc. (e.g. grep regex args).
 */
function repairInvalidEscapes(value: string): string {
  return value.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
}
```

### Update `src/agentic-loop.ts`

Now update the main agentic loop to use these modules:

```typescript
// src/agentic-loop.ts

/**
 * The agentic loop — the core of ProtoAgent.
 *
 * This module implements the standard tool-use loop:
 *
 *  1. Send the conversation to the LLM with tool definitions
 *  2. If the response contains tool_calls:
 *     a. Execute each tool
 *     b. Append the results to the conversation
 *     c. Go to step 1
 *  3. If the response is plain text:
 *     a. Return it to the caller (the UI renders it)
 *
 * The loop is a plain TypeScript module — not an Ink component.
 * The UI subscribes to events emitted by the loop and updates
 * React state accordingly. This keeps the core logic testable
 * and UI-independent.
 */

import type OpenAI from 'openai';
import { setMaxListeners } from 'node:events';
import { getAllTools } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { subAgentTool, type SubAgentUsage } from './sub-agent.js';
import {
  getContextInfo,
  type ModelPricing,
} from './utils/cost-tracker.js';
import { compactIfNeeded } from './utils/compactor.js';
import { logger } from './utils/logger.js';
import { processStream } from './agentic-loop/stream.js';
import { executeToolCalls, type ToolExecutionContext } from './agentic-loop/executor.js';
import { handleApiError, type RetryState } from './agentic-loop/errors.js';

// ─── Types ───

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done' | 'sub_agent_iteration';
  content?: string;
  toolCall?: ToolCallEvent;
  /** Emitted while a sub-agent is executing — carries the child tool name and iteration status. */
  subAgentTool?: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> };
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  /** Emitted when a sub-agent completes, carrying its accumulated usage. */
  subAgentUsage?: SubAgentUsage;
  error?: string;
  transient?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

export interface AgenticLoopOptions {
  maxIterations?: number;
  pricing?: ModelPricing;
  abortSignal?: AbortSignal;
  sessionId?: string;
  requestDefaults?: Record<string, unknown>;
}

function emitAbortAndFinish(onEvent: AgentEventHandler): void {
  onEvent({ type: 'done' });
}

function getValidToolNames(): Set<string> {
  return new Set(
    [...getAllTools(), subAgentTool]
      .map((tool: any) => tool.function?.name)
      .filter((name: string | undefined): name is string => Boolean(name))
  );
}

/**
 * Process a single user input through the agentic loop.
 *
 * Takes the full conversation history (including system message),
 * runs the loop, and returns the updated message history.
 *
 * The `onEvent` callback is called for each event (text deltas,
 * tool calls, usage info, etc.) so the UI can render progress.
 */
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const pricing = options.pricing;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;
  const requestDefaults = options.requestDefaults || {};

  // The same AbortSignal is passed into every OpenAI SDK call and every
  // sleep across all loop iterations and sub-agent calls.
  // The SDK attaches an 'abort' listener per request, so on a long run
  // the default limit of 10 listeners is quickly exceeded.
  if (abortSignal) {
    setMaxListeners(0, abortSignal); // 0 = unlimited, scoped to this signal only
  }

  // Note: userInput is passed for context/logging but user message should already be in messages array
  const updatedMessages: Message[] = [...messages];

  // Refresh system prompt to pick up any new skills or project changes
  const newSystemPrompt = await generateSystemPrompt();
  const systemMsgIndex = updatedMessages.findIndex((m) => m.role === 'system');
  if (systemMsgIndex !== -1) {
    updatedMessages[systemMsgIndex] = { role: 'system', content: newSystemPrompt } as Message;
  }

  let iterationCount = 0;
  const retryState: RetryState = {
    repairCount: 0,
    contextCount: 0,
    truncateCount: 0,
    continueCount: 0,
    retriggerCount: 0,
  };
  const MAX_RETRIGGERS = 3;
  const validToolNames = getValidToolNames();

  while (iterationCount < maxIterations) {
    // Check if abort was requested
    if (abortSignal?.aborted) {
      logger.debug('Agentic loop aborted by user');
      emitAbortAndFinish(onEvent);
      return updatedMessages;
    }

    iterationCount++;

    // Check for compaction when we have pricing info (includes context window).
    // Compaction preserves: (1) the system prompt at index 0, (2) any skill_content
    // tool messages, and (3) the 5 most recent messages. Middle messages are
    // summarized into a secondary system message. The length=0 + spread reassigns
    // the array in place with the compacted structure.
    if (pricing) {
      const contextInfo = getContextInfo(updatedMessages, pricing);
      if (contextInfo.needsCompaction) {
        const compacted = await compactIfNeeded(
          client,
          model,
          updatedMessages,
          pricing.contextWindow,
          requestDefaults,
          sessionId
        );
        // Replace messages in-place with compacted version
        updatedMessages.length = 0;
        updatedMessages.push(...compacted);
      }
    }

    // Declare assistantMessage outside try block so it's accessible in catch
    let assistantMessage: any;

    try {
      // Build tools list: core tools + sub-agent tool + dynamic (MCP) tools
      const allTools = [...getAllTools(), subAgentTool];

      logger.info('Making API request', {
        model,
        toolsCount: allTools.length,
        messagesCount: updatedMessages.length,
      });

      // Debug: log message roles and sizes
      logger.trace('Messages', { msgs: updatedMessages.map((m: any) => ({
        role: m.role,
        len: m.content?.length || m.tool_calls?.length || 0,
      })) });

      const stream = await client.chat.completions.create({
        ...requestDefaults,
        model,
        messages: updatedMessages,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
      }, {
        signal: abortSignal,
      });

      // Process the streaming response
      const streamResult = await processStream(stream, updatedMessages, model, pricing, onEvent);
      assistantMessage = streamResult.assistantMessage;

      // Handle tool calls
      if (streamResult.hasToolCalls) {
        // Reset retrigger count on valid tool call response
        retryState.retriggerCount = 0;

        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);

        // Validate that all tool calls have valid JSON arguments
        const invalidToolCalls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return false;
          try {
            JSON.parse(args);
            return false;
          } catch {
            return true;
          }
        });

        if (invalidToolCalls.length > 0) {
          logger.warn('Assistant produced tool calls with invalid JSON, skipping this turn');
          continue;
        }

        logger.info('Model returned tool calls', {
          count: assistantMessage.tool_calls.length,
          tools: assistantMessage.tool_calls.map((tc: any) => tc.function?.name).join(', '),
        });

        updatedMessages.push(assistantMessage);

        // Execute tool calls
        const toolContext: ToolExecutionContext = {
          sessionId,
          abortSignal,
          requestDefaults,
          client,
          model,
          pricing,
        };

        const executionResult = await executeToolCalls(
          assistantMessage.tool_calls,
          updatedMessages,
          onEvent,
          toolContext
        );

        if (executionResult.shouldAbort) {
          emitAbortAndFinish(onEvent);
          return updatedMessages;
        }

        // Signal UI that this iteration's tool calls are all done
        onEvent({ type: 'iteration_done' });

        // Continue loop — let the LLM process tool results
        continue;
      }

      // Plain text response — we're done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
        retryState.retriggerCount = 0;
      }

      // Check if we need to retrigger
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      if (lastMessage?.role === 'tool' && retryState.retriggerCount < MAX_RETRIGGERS) {
        retryState.retriggerCount++;
        logger.warn('AI stopped after tool call without responding; retriggering');
        updatedMessages.push({
          role: 'user',
          content: 'Please continue.',
        } as Message);
        continue;
      }

      // Reset retry counts on successful completion
      retryState.repairCount = 0;
      retryState.retriggerCount = 0;
      onEvent({ type: 'done' });
      return updatedMessages;

    } catch (apiError: any) {
      if (abortSignal?.aborted || apiError?.name === 'AbortError') {
        logger.debug('Agentic loop request aborted');
        // Handle partial assistant message on abort...
        emitAbortAndFinish(onEvent);
        return updatedMessages;
      }

      // Handle API errors with retry strategies
      const errorResult = await handleApiError(
        apiError,
        updatedMessages,
        validToolNames,
        pricing,
        retryState,
        iterationCount,
        onEvent,
        client,
        model,
        requestDefaults,
        sessionId
      );

      if (errorResult.shouldAbort) {
        emitAbortAndFinish(onEvent);
        return updatedMessages;
      }

      if (!errorResult.handled) {
        onEvent({
          type: 'error',
          error: errorResult.errorMessage || 'Unknown error',
          transient: errorResult.transient,
        });
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      if (!errorResult.silentRetry) {
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      // Silent retry - continue the loop
      continue;
    }
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}

/**
 * Initialize the conversation with the system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt } as Message];
}
```

**Why modularize now?** By Part 12, `agentic-loop.ts` has grown to nearly 1000 lines. This makes it hard to understand and maintain. The modularization:
- Keeps each file focused on one responsibility
- Makes the code easier to navigate and modify
- Teaches good software engineering practices
- Prepares the codebase for future enhancements

The refactored `agentic-loop.ts` is now ~400 lines (down from ~1000) and orchestrates the three submodules.

## Step 6: Upgrade `src/tools/edit-file.ts`

The final version adds a 5-strategy fuzzy match cascade (exact, line-trimmed, indent-flexible, whitespace-normalized, trimmed-boundary) and returns a unified diff on success. It also enforces the read-before-edit staleness guard via `file-time.ts`.

See `src/tools/edit-file.ts` in the source tree for the complete implementation. The key additions over the Part 5 version:

- Import `assertReadBefore` and `recordRead` from `../utils/file-time.js`
- `findWithCascade()` tries 5 match strategies in order
- Uses the `diff` library's `createPatch()` for unified diff generation
- Re-reads the file after write and records the read time

## Step 7: Upgrade `src/tools/read-file.ts`

The final version adds:
- `findSimilarPaths()` — suggests similar paths when a file isn't found
- `recordRead()` — tracks reads for the staleness guard

See `src/tools/read-file.ts` in the source tree for the complete implementation.

## Step 8: Upgrade `src/tools/search-files.ts`

The final version adds ripgrep (`rg`) support when available, falling back to the JS implementation. Ripgrep results are sorted by modification time (most recently changed files first).

Note that even with ripgrep, search is not as fast as you might expect for large codebases. Cursor found that ripgrep alone wasn't sufficient for their needs and invested in custom indexing — see [their writeup](https://x.com/cursor_ai/status/2036122609931165985). For a tutorial project, ripgrep is plenty fast; for production, you may want to explore indexed search.

See `src/tools/search-files.ts` in the source tree for the complete implementation.

## Step 9: Upgrade `src/config.tsx`

The final version adds helper functions for config path resolution:

- `getConfigDirectory()` — Returns the base config directory
- `getUserRuntimeConfigPath()` — Returns path to user-wide config
- `getProjectRuntimeConfigPath()` — Returns path to project config
- Enhanced `resolveApiKey()` with better precedence chain and custom headers support

Note: The `InitComponent` and `writeInitConfig()` were added in Part 11, so they're already present in your codebase.

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

## Step 11: Extract Event Handler Hook and UI Sub-components from `src/App.tsx`

Our `App.tsx` has grown to manage many responsibilities — state management, event handling, and several UI sub-components. Let's refactor it to keep the main file focused on orchestration.

### Custom Hook for Event Handling

The `handleSubmit` function contains ~350 lines of event handling logic — a large switch statement processing different `AgentEvent` types. This is a perfect candidate for a **custom React hook**:

- **Separation of concerns**: App.tsx focuses on orchestration, the hook handles event processing
- **Testability**: Event handling logic can be tested independently
- **Reusability**: The pattern could be reused if we had multiple agent interfaces

Create the hook:

```bash
touch src/hooks/useAgentEventHandler.tsx
```

```typescript
// src/hooks/useAgentEventHandler.tsx

import React, { useCallback } from 'react';
import { Text } from 'ink';
import type { AgentEvent, Message } from '../agentic-loop.js';
import { renderFormattedText, normalizeTranscriptText } from '../utils/format-message.js';
import { formatSubAgentActivity, formatToolActivity } from '../utils/tool-display.js';

export interface AssistantMessageRef {
  message: any;
  index: number;
  kind: 'streaming_text' | 'tool_call_assistant';
}

export interface StreamingBuffer {
  unflushedContent: string;
  hasFlushedAnyLine: boolean;
}

export interface InlineThreadError {
  id: string;
  message: string;
  transient?: boolean;
}

interface UseAgentEventHandlerOptions {
  addStatic: (node: React.ReactNode) => void;
  setCompletionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  setActiveTool: React.Dispatch<React.SetStateAction<string | null>>;
  setLastUsage: React.Dispatch<React.SetStateAction<AgentEvent['usage'] | null>>;
  setTotalCost: React.Dispatch<React.SetStateAction<number>>;
  setThreadErrors: React.Dispatch<React.SetStateAction<InlineThreadError[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  assistantMessageRef: React.MutableRefObject<AssistantMessageRef | null>;
  streamingBufferRef: React.MutableRefObject<StreamingBuffer>;
}

export function useAgentEventHandler(options: UseAgentEventHandlerOptions) {
  const {
    addStatic,
    setCompletionMessages,
    setIsStreaming,
    setStreamingText,
    setActiveTool,
    setLastUsage,
    setTotalCost,
    setThreadErrors,
    setError,
    assistantMessageRef,
    streamingBufferRef,
  } = options;

  return useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'text_delta': {
        // Handle streaming text from the model...
        // (full implementation in checkpoint)
        break;
      }
      case 'sub_agent_iteration': {
        // Handle sub-agent progress updates...
        break;
      }
      case 'tool_call': {
        // Handle tool call start...
        break;
      }
      case 'tool_result': {
        // Handle tool completion...
        break;
      }
      case 'usage': {
        // Handle usage/cost updates...
        break;
      }
      case 'error': {
        // Handle errors...
        break;
      }
      case 'iteration_done': {
        // Clean up after iteration...
        break;
      }
      case 'done': {
        // Finalize streaming, flush buffer...
        break;
      }
    }
  }, [/* dependency array */]);
}
```

The hook:
- **Exports shared types** (`AssistantMessageRef`, `StreamingBuffer`, `InlineThreadError`) so they can be used in App.tsx
- **Encapsulates all event handling** — the ~350 line switch statement moves here
- **Uses TypeScript discriminated unions** with type assertions for precise event typing
- **Maintains ref-based state** for performance during high-frequency streaming

In `App.tsx`, replace the inline handler with the hook:

```typescript
// In App.tsx, import the hook and types
import { useAgentEventHandler, type AssistantMessageRef, type StreamingBuffer, type InlineThreadError } from './hooks/useAgentEventHandler.js';

// Remove the local InlineThreadError interface (now imported)

// Use the imported types for refs
const assistantMessageRef = useRef<AssistantMessageRef | null>(null);
const streamingBufferRef = useRef<StreamingBuffer>({
  unflushedContent: '',
  hasFlushedAnyLine: false,
});

// Create the event handler
const handleAgentEvent = useAgentEventHandler({
  addStatic,
  setCompletionMessages,
  setIsStreaming,
  setStreamingText,
  setActiveTool,
  setLastUsage,
  setTotalCost,
  setThreadErrors,
  setError,
  assistantMessageRef,
  streamingBufferRef,
});

// In handleSubmit, pass the handler to runAgenticLoop:
const updatedMessages = await runAgenticLoop(
  clientRef.current,
  config.model,
  [...completionMessages, userMessage],
  trimmed,
  handleAgentEvent,  // <-- use the hook's callback
  { pricing, abortSignal, sessionId, requestDefaults }
);
```

**Why this pattern works:**
- **App.tsx shrinks from ~1080 to ~740 lines** — a 32% reduction
- **The hook is self-contained** — all event handling logic in one place
- **Types are shared** — no duplication between files
- **Refs stay in App.tsx** — component state belongs with the component

### UI Sub-components

Now let's extract the UI components. Create the files:

```bash
touch src/components/CommandFilter.tsx
touch src/components/ApprovalPrompt.tsx
touch src/components/UsageDisplay.tsx
touch src/components/InlineSetup.tsx
```

### `src/components/CommandFilter.tsx`

Shows filtered slash commands when the user types `/`. We export `SLASH_COMMANDS` so `App.tsx` can reuse it for the help text:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

export const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all available commands' },
  { name: '/quit', description: 'Exit ProtoAgent' },
  { name: '/exit', description: 'Alias for /quit' },
];

export interface CommandFilterProps {
  inputText: string;
}

export const CommandFilter: React.FC<CommandFilterProps> = ({ inputText }) => {
  if (!inputText.startsWith('/')) return null;

  const filtered = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(inputText.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {filtered.map((cmd) => (
        <Text key={cmd.name} dimColor>
          <Text color="green">{cmd.name}</Text> — {cmd.description}
        </Text>
      ))}
    </Box>
  );
};
```

### `src/components/ApprovalPrompt.tsx`

Interactive approval prompt rendered inline:

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { Select } from '@inkjs/ui';
import { LeftBar } from './LeftBar.js';
import type { ApprovalRequest, ApprovalResponse } from '../utils/approval.js';

export interface ApprovalPromptProps {
  request: ApprovalRequest;
  onRespond: (response: ApprovalResponse) => void;
}

export const ApprovalPrompt: React.FC<ApprovalPromptProps> = ({ request, onRespond }) => {
  const sessionApprovalLabel = request.sessionScopeKey
    ? 'Approve this operation for session'
    : `Approve all "${request.type}" for session`;

  const items = [
    { label: 'Approve once', value: 'approve_once' as const },
    { label: sessionApprovalLabel, value: 'approve_session' as const },
    { label: 'Reject', value: 'reject' as const },
  ];

  return (
    <LeftBar color="green" marginTop={1} marginBottom={1}>
      <Text color="green" bold>Approval Required</Text>
      <Text>{request.description}</Text>
      {request.detail && (
        <Text dimColor>{request.detail.length > 200 ? request.detail.slice(0, 200) + '...' : request.detail}</Text>
      )}
      <Box marginTop={1}>
        <Select
          options={items.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onRespond(value as ApprovalResponse)}
        />
      </Box>
    </LeftBar>
  );
};
```

### `src/components/UsageDisplay.tsx`

Cost/usage display in the status bar:

```typescript
import React from 'react';
import { Box, Text } from 'ink';

export interface UsageDisplayProps {
  usage: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } | null;
  totalCost: number;
}

export const UsageDisplay: React.FC<UsageDisplayProps> = ({ usage, totalCost }) => {
  if (!usage && totalCost === 0) return null;

  return (
    <Box marginTop={1}>
      {usage && (
        <Box>
          <Box backgroundColor="#064e3b" paddingX={1}>
            <Text color="white">tokens: </Text>
            <Text color="white" bold>{usage.inputTokens}↓ {usage.outputTokens}↑</Text>
          </Box>
          <Box backgroundColor="#065f46" paddingX={1}>
            <Text color="white">ctx: </Text>
            <Text color="white" bold>{usage.contextPercent.toFixed(0)}%</Text>
          </Box>
        </Box>
      )}
      {totalCost > 0 && (
        <Box backgroundColor="#064e3b" paddingX={1}>
          <Text color="black">cost: </Text>
          <Text color="black" bold>${totalCost.toFixed(4)}</Text>
        </Box>
      )}
    </Box>
  );
};
```

### `src/components/InlineSetup.tsx`

Inline setup wizard shown when no config exists:

```typescript
import React, { useState } from 'react';
import { Box } from 'ink';
import {
  writeConfig,
  writeInitConfig,
  type Config,
  type InitConfigTarget,
  TargetSelection,
  ModelSelection,
  ApiKeyInput,
} from '../config.js';

export interface InlineSetupProps {
  onComplete: (config: Config) => void;
}

export const InlineSetup: React.FC<InlineSetupProps> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'target' | 'provider' | 'api_key'>('target');
  const [target, setTarget] = useState<InitConfigTarget>('project');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const handleModelSelect = (providerId: string, modelId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setSetupStep('api_key');
  };

  const handleConfigComplete = (config: Config) => {
    writeInitConfig(target);
    writeConfig(config, target);
    onComplete(config);
  };

  if (setupStep === 'target') {
    return (
      <Box marginTop={1}>
        <TargetSelection
          title="First-time setup"
          subtitle="Create a ProtoAgent runtime config:"
          onSelect={(value) => {
            setTarget(value);
            setSetupStep('provider');
          }}
        />
      </Box>
    );
  }

  if (setupStep === 'provider') {
    return (
      <Box marginTop={1}>
        <ModelSelection
          setSelectedProviderId={setSelectedProviderId}
          setSelectedModelId={setSelectedModelId}
          onSelect={handleModelSelect}
          title="First-time setup"
        />
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <ApiKeyInput
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        target={target}
        title="First-time setup"
        showProviderHeaders={false}
        onComplete={handleConfigComplete}
      />
    </Box>
  );
};
```

### Update `src/App.tsx`

Remove the inline component definitions from `App.tsx` and import the extracted components instead:

```typescript
// Replace this import:
import { readConfig, writeConfig, writeInitConfig, resolveApiKey, type Config, type InitConfigTarget, TargetSelection, ModelSelection, ApiKeyInput } from './config.js';

// With this:
import { readConfig, resolveApiKey, type Config } from './config.js';

// Add these imports:
import { CommandFilter } from './components/CommandFilter.js';
import { ApprovalPrompt } from './components/ApprovalPrompt.js';
import { UsageDisplay } from './components/UsageDisplay.js';
import { InlineSetup } from './components/InlineSetup.js';
```

Then remove the `// ─── Sub-components ───` section entirely — the inline `CommandFilter`, `ApprovalPrompt`, `UsageDisplay`, and `InlineSetup` definitions are no longer needed.

This isn't strictly necessary for functionality, but it demonstrates how to structure a React application as it grows. Each component now has a single responsibility, and `App.tsx` focuses on state management and event coordination.

The final `App.tsx` brings together everything from Parts 1-12 plus:

- **Archived vs live message rendering** — archived messages use `useMemo` for performance, live messages re-render during streaming
- **Static items as React nodes** — `StaticItem` stores `node: React.ReactNode` instead of `text: string`; all `addStatic()` calls use `<Text>` components with Ink props (e.g., `<Text color="green">`, `<Text bold>`) instead of ANSI escape codes
- **Grouped tool rendering** — tool calls and results are consolidated using `ConsolidatedToolMessage`
- **Collapsible output** — system prompts and tool results use `CollapsibleBox`
- **Left-bar indicators** — `LeftBar` replaces Box borders for callout-style content; the bar stretches to match content height via `measureElement` with no extra line overhead
- **Formatted text** — assistant messages use `FormattedMessage` with markdown/table support
- **Slash commands** — `/clear`, `/collapse`, `/expand`, `/help`, `/quit`
- **Spinner with active tool** — shows which tool is currently executing
- **Debounced text rendering** — 50ms batching for streaming text deltas
- **Terminal resize handling** — re-renders input on window resize
- **Quitting with session save** — displays the resume command before exit

See `src/App.tsx` in the source tree for the complete implementation.

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
- `App.tsx` — incremental line-flushing for streaming text: complete lines are flushed to `<Static>` immediately during streaming, leaving only the incomplete final line in the dynamic frame; prevents unbounded growth and enables real-time scrollback copying
- `sub-agent.ts` — interface ordering, JSDoc header
- `system-prompt.ts` — enhanced guidelines section (SUBAGENT STRATEGY), config path display; now encourages tasteful use of **bold** and *italic* instead of prohibiting it
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

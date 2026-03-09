import React from 'react';
import { Box, Text } from 'ink';
import { formatMessage } from '../utils/format-message.js';

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

/**
 * FormattedMessage component
 * 
 * Parses a markdown string and renders:
 * - Standard text with ANSI formatting
 * - Markdown tables as preformatted monospace text
 * - Code blocks (rendered in a box)
 */
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
      // Check for end of code block
      if (trimmedLine.startsWith('```')) {
        blocks.push({ type: 'code', content: currentBlockContent.join('\n') });
        currentBlockContent = [];
        currentBlockType = 'text';
      }
      continue;
    }

    // Start Code Block
    if (trimmedLine.startsWith('```')) {
      // Finish pending text block
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
        // End of table block found (line doesn't start with |)
        blocks.push({ type: 'table', content: currentBlockContent.join('\n') });
        
        // Reset to text and fall through to re-process this line
        currentBlockContent = [];
        currentBlockType = 'text';
      }
    }

    // Start Table Block check
    // A table start requires a pipe AND a subsequent separator line
    const isTableStart = trimmedLine.startsWith('|');
    const nextLine = lines[i+1];
    const isNextLineSeparator = nextLine && nextLine.trim().startsWith('|') && nextLine.includes('---');

    if (isTableStart && isNextLineSeparator) {
      // Finish pending text block
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

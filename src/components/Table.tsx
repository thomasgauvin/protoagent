/**
 * Table — Simple table renderer using basic ink components
 *
 * No external table library needed. Renders data as aligned columns.
 */

import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';

interface TableProps {
  data: any;
  title?: string;
  titleColor?: string;
}

interface TextSegment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

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

function takeByDisplayWidth(text: string, maxWidth: number): { slice: string; remainder: string } {
  if (maxWidth <= 0) {
    return { slice: '', remainder: text };
  }

  const graphemes = splitGraphemes(text);
  let consumed = 0;
  let width = 0;

  while (consumed < graphemes.length) {
    const nextWidth = getGraphemeWidth(graphemes[consumed]);
    if (width + nextWidth > maxWidth) break;
    width += nextWidth;
    consumed++;
  }

  return {
    slice: graphemes.slice(0, consumed).join(''),
    remainder: graphemes.slice(consumed).join(''),
  };
}

function parseInlineMarkdown(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /\*\*\*([\s\S]+?)\*\*\*|\*\*([\s\S]+?)\*\*|\*([\s\S]+?)\*/g;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index) });
    }

    if (match[1] !== undefined) {
      segments.push({ text: match[1], bold: true, italic: true });
    } else if (match[2] !== undefined) {
      segments.push({ text: match[2], bold: true });
    } else if (match[3] !== undefined) {
      segments.push({ text: match[3], italic: true });
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text }];
}

function getDisplayWidth(text: string): number {
  return text
    .split('\n')
    .reduce((maxWidth, line) => {
      const lineWidth = parseInlineMarkdown(line)
        .reduce((width, segment) => width + getTextWidth(segment.text), 0);
      return Math.max(maxWidth, lineWidth);
    }, 0);
}

function wrapStyledText(text: string, width: number): TextSegment[][] {
  if (width <= 0) {
    return [[{ text }]];
  }

  const lines: TextSegment[][] = [];
  const paragraphs = String(text).split('\n');

  for (const paragraph of paragraphs) {
    if (paragraph.trim() === '') {
      lines.push([]);
      continue;
    }

    const words = parseInlineMarkdown(paragraph).flatMap((segment) =>
      segment.text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({
          text: word,
          bold: segment.bold,
          italic: segment.italic,
        }))
    );

    let currentLine: TextSegment[] = [];
    let currentLength = 0;

    const pushCurrentLine = () => {
      lines.push(currentLine);
      currentLine = [];
      currentLength = 0;
    };

    for (const word of words) {
      let remainingWord = word.text;

      while (remainingWord.length > 0) {
        const availableWidth = currentLength === 0 ? width : width - currentLength - 1;
        const remainingWidth = getTextWidth(remainingWord);

        if (remainingWidth <= availableWidth) {
          if (currentLength > 0) {
            currentLine.push({ text: ' ' });
            currentLength++;
          }

          currentLine.push({ ...word, text: remainingWord });
          currentLength += remainingWidth;
          remainingWord = '';
          continue;
        }

        if (currentLength > 0) {
          pushCurrentLine();
          continue;
        }

        const { slice, remainder } = takeByDisplayWidth(remainingWord, width);
        currentLine.push({ ...word, text: slice });
        remainingWord = remainder;
        pushCurrentLine();
      }
    }

    if (currentLine.length > 0) {
      pushCurrentLine();
    }
  }

  return lines.length === 0 ? [[{ text: '' }]] : lines;
}

function getLineWidth(segments: TextSegment[]): number {
  return segments.reduce((width, segment) => width + getTextWidth(segment.text), 0);
}

/**
 * Simple parser for Markdown tables.
 */
function parseMarkdownTable(markdown: string): any[] | null {
  const lines = markdown.trim().split('\n');
  if (lines.length < 3) return null;

  const hasPipes = lines[0].includes('|');
  const hasSeparator = lines[1].includes('|') && lines[1].includes('-');

  if (!hasPipes || !hasSeparator) return null;

  try {
    const parseRow = (row: string) =>
      row.split('|')
        .map(cell => cell.trim())
        .filter((cell, index, array) => {
          if (index === 0 && cell === '') return false;
          if (index === array.length - 1 && cell === '') return false;
          return true;
        });

    const headers = parseRow(lines[0]);
    const rows = lines.slice(2).map(parseRow);

    return rows.map(row => {
      const obj: any = {};
      headers.forEach((header, i) => {
        obj[header || `Column ${i + 1}`] = row[i] || '';
      });
      return obj;
    });
  } catch (e) {
    return null;
  }
}

/**
 * Normalize input data into an array of objects for display.
 */
function normalizeData(data: any): any[] {
  let processedData = data;

  if (typeof data === 'string') {
    try {
      const parsed = JSON.parse(data);
      if (typeof parsed === 'object' && parsed !== null) {
        processedData = parsed;
      }
    } catch (e) {
      const parsedMarkdown = parseMarkdownTable(data);
      if (parsedMarkdown) {
        processedData = parsedMarkdown;
      }
    }
  }

  if (Array.isArray(processedData)) {
    return processedData.map(item =>
      typeof item === 'object' && item !== null ? item : { value: String(item) }
    );
  } else if (typeof processedData === 'object' && processedData !== null) {
    return Object.entries(processedData).map(([key, value]) => ({
      property: key,
      value: typeof value === 'object' ? JSON.stringify(value) : String(value),
    }));
  }

  return [{ value: String(processedData) }];
}

export const Table: React.FC<TableProps> = ({ data, title, titleColor = 'cyan' }) => {
  const { stdout } = useStdout();
  const [terminalWidth, setTerminalWidth] = useState(stdout?.columns ?? 80);

  useEffect(() => {
    if (!stdout) return;

    const updateWidth = () => {
      setTerminalWidth(stdout.columns ?? 80);
    };

    updateWidth();
    stdout.on('resize', updateWidth);

    return () => {
      stdout.off('resize', updateWidth);
    };
  }, [stdout]);

  const displayData = normalizeData(data);

  if (displayData.length === 0) {
    return (
      <Box marginY={1}>
        <Text italic dimColor>No data to display in table.</Text>
      </Box>
    );
  }

  // Get all column keys
  const columns = Array.from(
    new Set(displayData.flatMap(row => Object.keys(row)))
  );

  // Calculate column widths
  const colWidths = columns.map(col => {
    const headerLen = getDisplayWidth(String(col));
    const maxCellLen = Math.max(...displayData.map(row => getDisplayWidth(String(row[col] ?? ''))));
    return Math.max(headerLen, Math.min(maxCellLen, 100)) + 2;
  });

  // Adjust widths to fit terminal
  let currentTotal = colWidths.reduce((a, b) => a + b, 0) + columns.length + 1;
  const targetTotal = Math.max(40, terminalWidth - 2);

  if (currentTotal > targetTotal) {
    while (currentTotal > targetTotal) {
      const widestIdx = colWidths.reduce((best, cur, idx) => cur > colWidths[best] ? idx : best, 0);
      if (colWidths[widestIdx] <= 10) break;
      colWidths[widestIdx]--;
      currentTotal--;
    }
  }

  // Box-drawing lines
  const topBorder    = '┌' + colWidths.map(w => '─'.repeat(w)).join('┬') + '┐';
  const headerSep    = '├' + colWidths.map(w => '─'.repeat(w)).join('┼') + '┤';
  const rowSep       = '├' + colWidths.map(w => '─'.repeat(w)).join('┼') + '┤';
  const bottomBorder = '└' + colWidths.map(w => '─'.repeat(w)).join('┴') + '┘';

  const renderRowLines = (cells: string[], rowKey: string, isHeader = false) => {
    const wrappedCells = cells.map((cell, i) => wrapStyledText(cell, colWidths[i] - 2));
    const maxLines = Math.max(...wrappedCells.map(c => c.length));

    const lines = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      lines.push(
        <Text key={`${rowKey}-${lineIdx}`} bold={isHeader}>
          {'│'}
          {wrappedCells.map((wrappedCell, i) => {
            const segments = wrappedCell[lineIdx] ?? [];
            const padding = Math.max(0, colWidths[i] - 1 - getLineWidth(segments));

            return (
              <React.Fragment key={`${rowKey}-${lineIdx}-${i}`}>
                {' '}
                {segments.map((segment, segmentIdx) => (
                  <Text
                    key={`${rowKey}-${lineIdx}-${i}-${segmentIdx}`}
                    bold={isHeader || segment.bold}
                    italic={segment.italic}
                  >
                    {segment.text}
                  </Text>
                ))}
                {' '.repeat(padding)}
                {'│'}
              </React.Fragment>
            );
          })}
        </Text>
      );
    }
    return lines;
  };

  return (
    <Box flexDirection="column" marginY={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color={titleColor} bold underline>{title}</Text>
        </Box>
      )}
      <Text>{topBorder}</Text>
      {renderRowLines(columns.map(String), 'header', true)}
      <Text>{headerSep}</Text>
      {displayData.map((row, rowIdx) => (
        <React.Fragment key={rowIdx}>
          {rowIdx > 0 && <Text dimColor>{rowSep}</Text>}
          {renderRowLines(columns.map(col => String(row[col] ?? '')), `row-${rowIdx}`)}
        </React.Fragment>
      ))}
      <Text>{bottomBorder}</Text>
    </Box>
  );
};

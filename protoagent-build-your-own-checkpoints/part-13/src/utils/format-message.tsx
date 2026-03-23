import React from 'react';
import { Text } from 'ink';

/**
 * Parse Markdown-style formatting and render as Ink Text elements.
 *
 * Supports:
 * - **bold** → <Text bold>bold</Text>
 * - *italic* → <Text italic>italic</Text>
 * - ***bold italic*** → <Text bold italic>bold italic</Text>
 */

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];

  // Strip markdown header lines (e.g., "# Title" or "## Section")
  const cleaned = text.replace(/^#{1,6}\s+.*$/gm, '');

  // Pattern to match ***bold italic***, **bold**, *italic*
  const pattern = /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^\s*][^*]*?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    // Add plain text before match
    if (match.index > lastIndex) {
      segments.push({ text: cleaned.slice(lastIndex, match.index) });
    }

    const fullMatch = match[0];
    let content: string;
    let bold = false;
    let italic = false;

    if (fullMatch.startsWith('***')) {
      content = fullMatch.slice(3, -3);
      bold = true;
      italic = true;
    } else if (fullMatch.startsWith('**')) {
      content = fullMatch.slice(2, -2);
      bold = true;
    } else {
      content = fullMatch.slice(1, -1);
      italic = true;
    }

    segments.push({ text: content, bold, italic });
    lastIndex = pattern.lastIndex;
  }

  // Add remaining plain text
  if (lastIndex < cleaned.length) {
    segments.push({ text: cleaned.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: cleaned }];
}

/**
 * Render formatted text as Ink Text elements.
 * Returns an array of <Text> components that can be nested inside a parent <Text>.
 */
export function renderFormattedText(text: string): React.ReactNode {
  const segments = parseSegments(text);

  if (segments.length === 1 && !segments[0].bold && !segments[0].italic) {
    return segments[0].text;
  }

  return segments.map((seg, i) => (
    <Text key={i} bold={seg.bold} italic={seg.italic}>
      {seg.text}
    </Text>
  ));
}

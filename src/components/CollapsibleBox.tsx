/**
 * CollapsibleBox — A component that hides long content with expand/collapse controls
 *
 * Used for system prompts, tool results, and other verbose output.
 * Use /expand and /collapse commands to toggle visibility.
 */

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
  title,
  content,
  titleColor,
  dimColor = false,
  maxPreviewLines = 3,
  maxPreviewChars = 500,
  expanded = false,
  marginBottom = 0,
}) => {
  const lines = content.split('\n');
  const isTooManyLines = lines.length > maxPreviewLines;
  const isTooManyChars = content.length > maxPreviewChars;
  const isLong = isTooManyLines || isTooManyChars;

  // If content is short, always show it
  if (!isLong) {
    return (
      <Box flexDirection="column" marginBottom={marginBottom} borderStyle="round" borderColor={titleColor || 'white'}>
        <Box paddingX={1}>
          <Text color={titleColor} dimColor={dimColor} bold>
            {title}
          </Text>
        </Box>
        <Box marginLeft={2} paddingRight={1}>
          <Text dimColor={dimColor}>{content}</Text>
        </Box>
      </Box>
    );
  }

  // For long content, show preview or full content
  let preview: string;
  if (expanded) {
    preview = content;
  } else {
    // Truncate by lines first, then by characters
    const linesTruncated = lines.slice(0, maxPreviewLines).join('\n');
    preview = linesTruncated.length > maxPreviewChars
      ? linesTruncated.slice(0, maxPreviewChars)
      : linesTruncated;
  }
  const hasMore = !expanded;

  return (
    <Box flexDirection="column" marginBottom={marginBottom} borderStyle="round" borderColor={titleColor || 'white'}>
      <Box paddingX={1}>
        <Text color={titleColor} dimColor={dimColor} bold>
          {expanded ? '▼' : '▶'} {title}
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2} paddingRight={1}>
        <Text dimColor={dimColor}>{preview}</Text>
        {hasMore && <Text dimColor={true}>... (use /expand to see all)</Text>}
      </Box>
    </Box>
  );
};

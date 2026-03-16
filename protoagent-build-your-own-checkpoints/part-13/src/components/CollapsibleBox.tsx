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
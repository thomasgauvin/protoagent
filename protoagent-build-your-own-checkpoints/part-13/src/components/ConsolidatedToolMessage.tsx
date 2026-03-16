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
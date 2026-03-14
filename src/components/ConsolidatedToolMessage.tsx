/**
 * ConsolidatedToolMessage — Displays a tool call and its result together
 *
 * Groups a tool call (from assistant message) with its corresponding
 * tool result message into a single consolidated view.
 */

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
  toolCalls,
  toolResults,
  expanded = false,
}) => {
  const toolNames = toolCalls.map((toolCall) => toolCall.name);
  const title = `Called: ${toolNames.join(', ')}`;
  const containsTodoTool = toolCalls.some((toolCall) => toolCall.name === 'todo_read' || toolCall.name === 'todo_write');
  const titleColor = containsTodoTool ? 'green' : 'cyan';
  const isExpanded = expanded || containsTodoTool;

  if (isExpanded) {
    return (
      <LeftBar color={titleColor}>
        <Text color={titleColor} bold>▼ {title}</Text>
        {toolCalls.map((toolCall, idx) => {
          const result = toolResults.get(toolCall.id);
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

  const compactLines = toolCalls.flatMap((toolCall) => {
    const result = toolResults.get(toolCall.id);
    if (!result) return [];

    const compactContent = result.content
      .replace(/\s+/g, ' ')
      .trim();

    return [`[${result.name}] ${compactContent}`];
  });

  const compactPreview = compactLines.join(' | ');
  const previewLimit = 180;
  const preview = compactPreview.length > previewLimit
    ? `${compactPreview.slice(0, previewLimit).trimEnd()}... (use /expand)`
    : compactPreview;

  return (
    <LeftBar color="white">
      <Text color={titleColor} dimColor bold>
        ▶ {title}
      </Text>
      <Text dimColor>{preview}</Text>
    </LeftBar>
  );
};

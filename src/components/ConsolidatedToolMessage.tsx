/**
 * ConsolidatedToolMessage — Displays a tool call and its result together
 *
 * Groups a tool call (from assistant message) with its corresponding
 * tool result message into a single consolidated view.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Table } from './Table.js';
import { FormattedMessage } from './FormattedMessage.js';

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
  const titleColor = containsTodoTool ? 'green' : 'white';
  const isExpanded = expanded || containsTodoTool;
  
  if (isExpanded) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="white">
        <Box paddingX={1}>
          <Text color={titleColor} bold>▼ {title}</Text>
        </Box>
        <Box flexDirection="column" marginLeft={2} paddingRight={1}>
          {toolCalls.map((toolCall, idx) => {
            const result = toolResults.get(toolCall.id);
            if (!result) return null;
            
            // Try to see if it's JSON that could be a table
            let isJsonTable = false;
            try {
              const parsed = JSON.parse(result.content);
              isJsonTable = typeof parsed === 'object' && parsed !== null;
            } catch (e) {}

            return (
              <Box key={idx} flexDirection="column">
                <Text color="cyan" bold>[{result.name}]:</Text>
                {isJsonTable ? (
                  <Table data={result.content} />
                ) : (
                  <FormattedMessage content={result.content} />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>
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
    <Box flexDirection="column" borderStyle="round" borderColor={titleColor || 'white'}>
      <Box paddingX={1}>
        <Text color={titleColor} dimColor bold>
          ▶ {title}
        </Text>
      </Box>
      <Box marginLeft={2} paddingRight={1}>
        <Text dimColor>{preview}</Text>
      </Box>
    </Box>
  );
};

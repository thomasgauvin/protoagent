import React from 'react';
import { Box, Text } from 'ink';
import { Table } from './Table.js';
import { formatMessage } from '../utils/format-message.js';

interface FormattedMessageProps {
  content: string;
}

/**
 * FormattedMessage component
 * 
 * Parses a markdown string and renders:
 * - Standard text with ANSI formatting
 * - Markdown tables using ink-table
 * - Code blocks (rendered in a box)
 */
export const FormattedMessage: React.FC<FormattedMessageProps> = ({ content }) => {
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
          return <Table key={index} data={block.content} />;
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

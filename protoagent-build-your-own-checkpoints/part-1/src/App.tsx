import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';

export interface AppProps {
  options?: Record<string, any>;
}

export const App: React.FC<AppProps> = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, trimmed]);
    setInputText('');
    setInputKey((prev) => prev + 1);
  };

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      <Text dimColor italic>A simple, hackable coding agent CLI.</Text>
      <Text> </Text>

      {/* Message area */}
      <Box flexDirection="column" flexGrow={1}>
        {messages.map((msg, i) => (
          <Text key={i}>
            <Text color="green" bold>{'> '}</Text>
            <Text>{msg}</Text>
          </Text>
        ))}
      </Box>

      {/* Input */}
      <Box borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>{'> '}</Text>
        <TextInput
          key={inputKey}
          defaultValue={inputText}
          onChange={setInputText}
          placeholder="Type your message..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
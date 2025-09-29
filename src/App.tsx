import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import BigText from 'ink-big-text';
import { OptionValues } from 'commander';

export const App = (options: OptionValues) => {
  const [messages, setMessages] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');

  const handleSubmit = (value: string) => {
    if (value.trim() !== '') {
      setMessages((prevMessages) => [...prevMessages, value]);
      setInputText('');
    }
  };

  const introductoryMessage = [
    <BigText key="welcome-1" text="ProtoAgent" font="tiny" colors={["#09A469"]} />, // Using ink-big-text for ProtoAgent
    <Text key="welcome-2" italic dimColor>"The prefix "proto-" comes from the Greek word prōtos and is used to denote the beginning stage or the primitive form of something that will later evolve or develop into a more complex version."</Text>,
    <Text key="padding-above-welcome"> </Text>,
    <Text key="welcome-3">Welcome to ProtoAgent, a simple coding agent CLI. </Text>,
    <Text key="padding-above-welcome-2"> </Text>,
    <Text key="welcome-4">ProtoAgent has the core capabilities of the popular coding agents but stripped down to the core functionality to help you understand how coding agents work. Run with `--log-level TRACE` to see what's happening under the hood. </Text>
  ];

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} >
        {introductoryMessage}
        {messages.map((msg, index) => (
          <React.Fragment key={index}>
            <Text> </Text>
            <Text dimColor>{'> '}{msg}</Text>
            <Text> </Text>
          </React.Fragment>
        ))}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1}>
        <Text color="green"> {`>`} </Text>
        <TextInput
          value={inputText}
          onChange={setInputText}
          placeholder="Type your message here..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
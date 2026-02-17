# ProtoAgent Tutorial Part 2: AI Integration

Now, let's add LLM completions. We're going to be using the OpenAI SDK to get our responses, because most other providers provide OpenAI compatible endpoints which will allow us to swap models. We will also implement streaming to provide a more interactive user experience.

## 1. Setup Environment Variables

To securely use API keys, we'll use environment variables (just for development). Create a `.env` file in your project's root directory:

```
OPENAI_API_KEY="your_openai_api_key_here"
```

## 2. Install OpenAI and UI Library

We need to install the `openai` package for API access and `@inkjs/ui` for beautiful terminal UI components.

```bash
npm install openai dotenv @inkjs/ui
```

## 3. Configure `src/App.tsx` for Streaming Responses

We will modify `src/App.tsx` to call the OpenAI API with streaming enabled. The chat `messages` state will be updated iteratively as chunks of the AI's response are received.

Here's the updated `src/App.tsx`:

```typescript
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OptionValues } from 'commander';
import OpenAI from 'openai';
import 'dotenv/config'; // Load environment variables

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const App = (options: OptionValues) => {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
  ]);
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (value: string) => {
    if (value.trim() !== '') {
      const userMessage: Message = { role: 'user', content: value };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInputKey(prev => prev + 1);
      setLoading(true);

      try {
        const stream = await openai.chat.completions.create({
          messages: updatedMessages,
          model: 'gpt-4o-mini',
          stream: true,
        });

        let assistantResponse = '';
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]); // Add empty message for streaming

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          assistantResponse += content;
          setMessages((prev) => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              return [
                ...prev.slice(0, prev.length - 1),
                { ...lastMessage, content: assistantResponse },
              ];
            }
            return prev;
          });
        }
      } catch (error: any) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${error.message}` },
        ]);
      } finally {
        setLoading(false);
      }
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
        {messages.filter(msg => msg.role !== 'system').map((msg, index) => (
          <React.Fragment key={index}>
            <Text> </Text>
            <Text dimColor={msg.role === 'user'} color={msg.role === 'user' ? 'lightgrey' : 'white'}>
              {msg.role === 'user' ? '> ' : 'Agent: '}{msg.content}
            </Text>
            <Text> </Text>
          </React.Fragment>
        ))}
        {loading && <Text>Agent is thinking...</Text>}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1}>
        <Text color="green">❯ </Text>
        <TextInput
          key={inputKey}
          placeholder="Type your message here..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
```

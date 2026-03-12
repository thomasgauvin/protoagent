# Part 2: AI Integration

This is the part where the CLI stops being a terminal shell and starts talking to a model. By the end, your app will stream responses from OpenAI in real time.

Your target snapshot is `protoagent-tutorial-again-part-2`.

## What you are building

Starting from the Part 1 shell, you are adding:

- The OpenAI SDK for model calls
- Environment-based API key loading via `.env` file and `dotenv` (temporary; Part 3 replaces this with config persistence)
- A typed `Message` structure (`role` + `content`)
- Streaming assistant output in the terminal UI
- Basic error handling around model calls

This is still simple — no provider abstraction, no persisted config. That comes in Part 3.

## Files to change

| File | Change |
|------|--------|
| `package.json` | Add `openai` and `dotenv` dependencies |
| `src/App.tsx` | Replace string messages with typed messages, add OpenAI streaming |

`src/cli.tsx` and `tsconfig.json` stay the same as Part 1.

## Step 1: Update `package.json`

Add `openai` and `dotenv` to dependencies:

```json
{
  "name": "protoagent",
  "version": "0.0.1",
  "description": "A simple coding agent CLI.",
  "bin": "dist/cli.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "build:watch": "tsc --watch"
  },
  "files": [
    "dist"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "commander": "^14.0.1",
    "dotenv": "^16.5.0",
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
    "openai": "^5.23.1",
    "react": "^19.1.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2"
  }
}
```

## Step 2: Create a `.env` file

Create a `.env` file in the project root (and add it to `.gitignore`):

```bash
OPENAI_API_KEY=your_key_here
```

## Step 3: Rewrite `src/App.tsx`

Replace the Part 1 App with a version that talks to OpenAI. The key changes:

1. Import `openai` and `dotenv/config`
2. Replace `string[]` messages with typed `Message[]`
3. Initialize with a system message
4. Stream responses using `openai.chat.completions.create({ stream: true })`
5. Update the assistant message incrementally as chunks arrive

```tsx
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import 'dotenv/config';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface AppProps {
  options?: Record<string, any>;
}

export const App: React.FC<AppProps> = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
  ]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading) return;

    const userMessage: Message = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputText('');
    setInputKey((prev) => prev + 1);
    setLoading(true);

    try {
      const stream = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: updatedMessages,
        stream: true,
      });

      // Create an empty assistant message and stream into it
      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages((prev) => [...prev, assistantMessage]);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        assistantMessage.content += delta;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...assistantMessage };
          return updated;
        });
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  // Filter out system messages for display
  const visibleMessages = messages.filter((msg) => msg.role !== 'system');

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      <Text dimColor italic>A simple, hackable coding agent CLI.</Text>
      <Text> </Text>

      {/* Message area */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} flexDirection="column">
            {msg.role === 'user' ? (
              <Text>
                <Text color="green" bold>{'> '}</Text>
                <Text>{msg.content}</Text>
              </Text>
            ) : (
              <Text>{msg.content}</Text>
            )}
          </Box>
        ))}
        {loading && visibleMessages[visibleMessages.length - 1]?.role === 'user' && (
          <Text dimColor>Agent is thinking...</Text>
        )}
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
```

The streaming loop is the important part. Instead of waiting for the full response, we create an empty assistant message immediately and append each text chunk as it arrives. This makes the UI feel responsive even on long answers.

## Verification

Set your API key and launch:

```bash
npm run dev
```

Ask something simple. You should see:

- Your prompt appears in green
- "Agent is thinking..." shows briefly
- The assistant response streams in character by character
- Errors show inline if the API key is wrong or the call fails

## Snapshot

Your project should match `protoagent-tutorial-again-part-2`.

## Pitfalls

- Forgetting `import 'dotenv/config'` and getting `undefined` API key errors
- Recreating the assistant message on every chunk instead of updating the last one
- Rendering the system message in the transcript (filter it out)
- Using a non-streaming request — you lose the real-time feel

## What comes next

Part 3 replaces the hardcoded OpenAI client with a multi-provider configuration system. You'll be able to switch between OpenAI, Anthropic Claude, Google Gemini, and more — all persisted to disk.

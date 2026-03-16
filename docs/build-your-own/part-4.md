# Part 4: The Agentic Loop

This is where ProtoAgent becomes an agent instead of a chatbot. Up to Part 3, the app could stream text from a model. Now you add the tool-use loop: the model can request tools, the runtime executes them, and the model continues reasoning with the results.

Your target snapshot is `protoagent-tutorial-again-part-4`.

## What you are building

- A reusable `runAgenticLoop()` function that implements the standard tool-use cycle
- A tool registry with definitions and handlers
- Event-based communication from the loop to the UI
- One real built-in tool: `read_file`

## Files to create or change

| File | Action |
|------|--------|
| `src/agentic-loop.ts` | **Create** — the core agentic loop |
| `src/tools/index.ts` | **Create** — tool registry and dispatcher |
| `src/tools/read-file.ts` | **Create** — first tool: read files |
| `src/App.tsx` | **Modify** — switch from direct streaming to the agentic loop |

## Step 1: Create `src/tools/read-file.ts`

Create the file:

```bash
mkdir -p src/tools && touch src/tools/read-file.ts
```

The first tool. It reads files with line numbers, supports offset/limit for large files, and validates that paths stay within the working directory.

```typescript
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';

// Definitions of the read file tool as provided to the LLM
export const readFileTool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Returns the file content with line numbers. Use offset and limit to read specific sections of large files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read (relative to working directory).' },
        offset: { type: 'number', description: 'Line number to start reading from (0-based). Defaults to 0.' },
        limit: { type: 'number', description: 'Maximum number of lines to read. Defaults to 2000.' },
      },
      required: ['file_path'],
    },
  },
};

export async function readFile(filePath: string, offset = 0, limit = 2000): Promise<string> {
  // Resolve path relative to cwd and check it stays within the project
  const cwd = process.cwd();
  const resolved = path.resolve(cwd, filePath);
  if (!resolved.startsWith(cwd)) {
    throw new Error(`Path "${filePath}" is outside the working directory.`);
  }

  // Check file exists
  try {
    await fs.stat(resolved);
  } catch {
    return `File not found: '${filePath}'`;
  }

  const start = Math.max(0, offset);
  const maxLines = Math.max(0, limit);
  const lines: string[] = [];
  let totalLines = 0;

  const stream = createReadStream(resolved, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    for await (const line of lineReader) {
      if (totalLines >= start && lines.length < maxLines) {
        lines.push(line);
      }
      totalLines++;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  const end = Math.min(totalLines, start + lines.length);

  // Add line numbers (1-based) and truncate long lines
  const numbered = lines.map((line, i) => {
    const lineNum = String(start + i + 1).padStart(5, ' ');
    const truncated = line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line;
    return `${lineNum} | ${truncated}`;
  });

  const rangeLabel = lines.length === 0
    ? 'none'
    : `${Math.min(start + 1, totalLines)}-${end}`;
  const header = `File: ${filePath} (${totalLines} lines total, showing ${rangeLabel})`;
  return `${header}\n${numbered.join('\n')}`;
}
```

## Step 2: Create `src/tools/index.ts`

Create the file:

```bash
touch src/tools/index.ts
```

The tool registry collects all tool definitions and provides a dispatcher. At this stage there's only one tool, but the pattern scales to many.

```typescript
import { readFileTool, readFile } from './read-file.js';

export interface ToolCallContext {
  sessionId?: string;
}

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
];

export function getAllTools() {
  return [...tools];
}

/**
 * Dispatch a tool call to the appropriate handler.
 */
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit);
      default:
        return `Error: Unknown tool "${toolName}"`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `Error executing ${toolName}: ${msg}`;
  }
}
```

## Step 3: Create `src/agentic-loop.ts`

Create the file:

```bash
touch src/agentic-loop.ts
```

This is the heart of the agent runtime. The loop:

1. Sends the conversation to the LLM with tool definitions
2. If the response contains `tool_calls`: executes each tool, appends results, loops back to step 1
3. If the response is plain text: returns it to the caller

The loop communicates with the UI through events, never rendering directly.

```typescript
import type OpenAI from 'openai';
import { getAllTools, handleToolCall } from './tools/index.js';

// ─── Types ───
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Type for tool calls included in the model's response, which the agentic loop will execute
// Exported for use in the UI layer to display ongoing tool calls and their results
export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

// Type for events emitted during the agentic loop, such as text deltas, tool calls, and errors
// Exported for use in the UI layer to update the interface in real-time as the agent processes
export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
  transient?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

export interface AgenticLoopOptions {
  maxIterations?: number;
  abortSignal?: AbortSignal;
  sessionId?: string;
}

// Run the agentic loop: send messages to the model, execute any tool calls,
// and continue until the model returns plain text.
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  // The onEvent callback allows the agentic loop to emit events that the UI can listen to for real-time updates (like streaming text or tool call status)
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;

  // The updatedMessages array will accumulate the conversation history, including tool call results, as we loop
  const updatedMessages: Message[] = [...messages];
  let iterationCount = 0;

  // The While loop is the core of the Agentic Loop.
  // We continue to request a new message from the LLM until it indicates it is 'done' with an empty message
  // Or, we continue until the user stops the agent
  // Or, we reach the max amount of iterations to avoid endless loops
  while (iterationCount < maxIterations) {
    // The abort signal allows the user to stop the agent from the UI
    if (abortSignal?.aborted) {
      onEvent({ type: 'done' });
      return updatedMessages;
    }

    iterationCount++;

    try {
      const allTools = getAllTools();

      // This is the API call to the LLM, passing the conversation history and available tools.
      // The model can respond with text, and/or indicate it wants to call a tool by including tool_calls in the response.
      const stream = await client.chat.completions.create({
        model,
        messages: updatedMessages,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
      }, {
        signal: abortSignal,
      });

      // Accumulate the streamed response
      const assistantMessage: any = {
        role: 'assistant',
        content: '',
        tool_calls: [],
      };
      let streamedContent = '';
      let hasToolCalls = false;

      // Iterate through all the chunks of the streamed LLM response
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Stream text content back to the UI
        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
        }

        // Accumulate tool calls by index
        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const idx = tc.index || 0;

            // Create a tool call entry at the correct index if it doesn't exist, then fill in details as they stream in
            if (!assistantMessage.tool_calls[idx]) {
              assistantMessage.tool_calls[idx] = {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) assistantMessage.tool_calls[idx].id = tc.id;
            if (tc.function?.name) {
              assistantMessage.tool_calls[idx].function.name += tc.function.name;
            }
            if (tc.function?.arguments) {
              assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Collapses "sparse" arrays by removing empty slots (undefined) or null values 
        // that can occur if streaming indexes arrive out of order or are skipped.
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        updatedMessages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          if (abortSignal?.aborted) {
            onEvent({ type: 'done' });
            return updatedMessages;
          }

          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' },
          });

          try {
            // This is where the tool is actually executed. 
            // The handleToolCall function looks up the tool by name and runs it with the provided arguments.
            const args = JSON.parse(argsStr);
            const result = await handleToolCall(name, args, { sessionId });

            // We add the tool result back into the conversation history as a
            // new message with role 'tool' so that the LLM can see the result of its 
            // tool call in the next iteration.
            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result },
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: ${errMsg}`,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg },
            });
          }
        }

        // Continue loop — let the model process tool results
        // This is the end of the if block for handling tool calls. 
        // After executing all tool calls and adding their results to the conversation history, 
        // we loop back and call the model again with the updated messages. 
        // The model can then respond with more text, more tool calls, or indicate it is done.
        continue;
      }

      // Plain text response — done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
      }

      onEvent({ type: 'done' });
      return updatedMessages;

    } catch (apiError: any) {
      if (abortSignal?.aborted) {
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      const errMsg = apiError?.message || 'Unknown API error';

      // Retry on rate limit
      if (apiError?.status === 429) {
        onEvent({ type: 'error', error: 'Rate limited. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      // Retry on server errors
      if (apiError?.status >= 500) {
        onEvent({ type: 'error', error: 'Server error. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      // Non-retryable error
      onEvent({ type: 'error', error: errMsg });
      onEvent({ type: 'done' });
      return updatedMessages;
    }
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}

/**
 * Initialize the conversation with a system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  return [{
    role: 'system',
    content: 'You are ProtoAgent, a helpful AI coding assistant. You have access to tools that let you read files in the current project. Use the read_file tool to examine code when the user asks about files.',
  } as Message];
}
```

The key detail in the streaming loop: tool calls arrive as fragments indexed by `tc.index`. You have to accumulate the `id`, `name`, and `arguments` separately for each index position. Only after the stream ends do you have the complete tool call objects.

## Step 4: Rewrite `src/App.tsx`

Replace the direct OpenAI streaming with the agentic loop. The UI now reacts to events from the loop.

```tsx
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getProvider } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? `Missing API key for ${providerName}. Set it in config or export ${envVar}.`
        : `Missing API key for ${providerName}.`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  const baseURL = provider?.baseURL;
  if (baseURL) clientOptions.baseURL = baseURL;
  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
  }

  return new OpenAI(clientOptions);
}

/** Inline setup wizard */
const InlineSetup: React.FC<{ onComplete: (config: Config) => void }> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}:::${model.id}`,
    })),
  );

  if (setupStep === 'provider') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>First-time setup</Text>
        <Text dimColor>Select a provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setSetupStep('api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>Selected: {provider?.name} / {selectedModelId}</Text>
      <Text>{hasResolvedAuth ? 'Optional API key:' : 'Enter your API key:'}</Text>
      <PasswordInput
        placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : `Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={(value) => {
          if (value.trim().length === 0 && !hasResolvedAuth) return;
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
          };
          writeConfig(newConfig);
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

export const App: React.FC = () => {
  const { exit } = useApp();

  // Core state
  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Refs
  const clientRef = useRef<OpenAI | null>(null);
  const assistantMessageRef = useRef<{ message: any; index: number } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);
    clientRef.current = buildClient(loadedConfig);

    const initialMessages = await initializeMessages();
    setCompletionMessages(initialMessages);
    setNeedsSetup(false);
    setInitialized(true);
  }, []);

  useEffect(() => {
    const loadedConfig = readConfig();
    if (!loadedConfig) {
      setNeedsSetup(true);
      return;
    }
    initializeWithConfig(loadedConfig);
  }, [initializeWithConfig]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !clientRef.current || !config) return;

    setInputText('');
    setInputKey((prev) => prev + 1);
    setLoading(true);
    setError(null);

    // Add user message immediately for UI display
    const userMessage: Message = { role: 'user', content: trimmed };
    setCompletionMessages((prev) => [...prev, userMessage]);

    assistantMessageRef.current = null;
    abortControllerRef.current = new AbortController();

    try {
      // This is the main change in this file. When the user submits a message
      // We run the agentic loop. The switch allows us to handle the AgentEvents,
      // and update the UI as needed.
      const updatedMessages = await runAgenticLoop(
        clientRef.current,
        config.model,
        [...completionMessages, userMessage],
        trimmed,
        (event: AgentEvent) => {
          switch (event.type) {
            // Text deltas are streamed as the model generates text, so we append them to the current assistant message in real-time.
            case 'text_delta':
              if (!assistantMessageRef.current) {
                const msg = { role: 'assistant', content: event.content || '' } as Message;
                setCompletionMessages((prev) => {
                  assistantMessageRef.current = { message: msg, index: prev.length };
                  return [...prev, msg];
                });
              } else {
                assistantMessageRef.current.message.content += event.content || '';
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantMessageRef.current!.index] = { ...assistantMessageRef.current!.message };
                  return updated;
                });
              }
              break;
            // When the model indicates it wants to call a tool, we add the tool call info to the current assistant message.
            case 'tool_call':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                const existingRef = assistantMessageRef.current;
                const assistantMsg = existingRef?.message
                  ? { ...existingRef.message, tool_calls: [...(existingRef.message.tool_calls || [])] }
                  : { role: 'assistant', content: '', tool_calls: [] as any[] };

                const tc = {
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.name, arguments: toolCall.args },
                };

                const idx = assistantMsg.tool_calls.findIndex((t: any) => t.id === toolCall.id);
                if (idx === -1) assistantMsg.tool_calls.push(tc);
                else assistantMsg.tool_calls[idx] = tc;

                setCompletionMessages((prev) => {
                  const nextIndex = existingRef?.index ?? prev.length;
                  assistantMessageRef.current = { message: assistantMsg, index: nextIndex };
                  if (existingRef) {
                    const updated = [...prev];
                    updated[existingRef.index] = assistantMsg;
                    return updated;
                  }
                  return [...prev, assistantMsg as Message];
                });
              }
              break;
            // When a tool result is received, we add it as a new message with role 'tool' so it appears in the UI, and also so that the model can see the result in the conversation history for the next iteration of the loop.
            case 'tool_result':
              if (event.toolCall) {
                setCompletionMessages((prev) => [
                  ...prev,
                  {
                    role: 'tool',
                    tool_call_id: event.toolCall!.id,
                    content: event.toolCall!.result || '',
                  } as any,
                ]);
                // Reset for next assistant message
                assistantMessageRef.current = null;
              }
              break;
            case 'error':
              if (event.error) setError(event.error);
              break;
            case 'done':
              break;
          }
        },
        { abortSignal: abortControllerRef.current.signal }
      );

      setCompletionMessages(updatedMessages);
    } catch (err: any) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [loading, config, completionMessages]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') exit();
    if (key.escape && loading && abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  });

  // Render messages
  const visibleMessages = completionMessages.filter((msg) => msg.role !== 'system');
  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>Model: {providerInfo?.name || config.provider} / {config.model}</Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}
      {needsSetup && <InlineSetup onComplete={initializeWithConfig} />}

      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => {
          const msgAny = msg as any;
          const content = typeof msgAny.content === 'string' ? msgAny.content : '';
          const isToolCall = msg.role === 'assistant' && msgAny.tool_calls?.length > 0;

          if (msg.role === 'user') {
            return (
              <Text key={i}>
                <Text color="green" bold>{'> '}</Text>
                <Text>{content}</Text>
              </Text>
            );
          }

          if (isToolCall) {
            return (
              <Box key={i} flexDirection="column">
                {content && <Text>{content}</Text>}
                {msgAny.tool_calls.map((tc: any) => (
                  <Text key={tc.id} dimColor>
                    [tool: {tc.function?.name}]
                  </Text>
                ))}
              </Box>
            );
          }

          if (msg.role === 'tool') {
            const preview = content.length > 100 ? content.slice(0, 100) + '...' : content;
            return (
              <Text key={i} dimColor>
                → {preview}
              </Text>
            );
          }

          return <Text key={i}>{content}</Text>;
        })}
        {loading && completionMessages[completionMessages.length - 1]?.role === 'user' && (
          <Text dimColor>Thinking...</Text>
        )}
      </Box>

      {initialized && (
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
      )}
    </Box>
  );
};
```

## Verification

Run the app and ask it to read a file:

```bash
npm run dev
```

Try:

```
Read tsconfig.json and tell me what it does.
```

You should see:
- A `[tool: read_file]` indicator
- A tool result preview
- The assistant's analysis of the file contents

```

 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
> hi
Hi! How can I help you today? (I can answer questions, help with code, read project files, or anything else you need.)
> whats in tsconfig.json
[tool: read_file]
→ File: tsconfig.json (16 lines total, showing 1-16)
    1 | {
    2 |   "compilerOptions": {
    3 | ...
Here's the contents of tsconfig.json:

{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
╭─────────────────────────────────────────────────────────────╮
│ > Type your message...                                      │
╰─────────────────────────────────────────────────────────────╯
```

## Snapshot

Your project should match `protoagent-tutorial-again-part-4`.

## Pitfalls

- Appending the user message twice (once in the UI, once in the loop) — the loop receives the full history with the user message already included
- Forgetting to append tool results to the message history — the model needs to see them
- Not reassembling streamed tool call fragments by index — they arrive incrementally
- Trying to render from inside the loop — use events instead
- Aborting mid-execution and leaving orphaned `tool_call_id`s — if the user presses Escape after the assistant message with tool calls has been appended but before all tool results are appended, the history will contain unmatched IDs that cause a 400 on the next turn. In the production loop this is solved by injecting stub `role: 'tool'` messages for any unresolved IDs before returning on abort.

## What comes next

Part 5 adds the full file toolkit: write, edit, list, and search. These give the agent real power to inspect and modify code.

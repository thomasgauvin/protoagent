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
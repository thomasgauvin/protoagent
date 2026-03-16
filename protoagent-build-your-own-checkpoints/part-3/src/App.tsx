import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getProvider } from './providers.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

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

// If protoagent isn't already set up with LLM provider/model, guide the user through an interactive setup flow
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
          writeConfig(newConfig, 'user');
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

// Main Protoagent app
export const App: React.FC = () => {
  const { exit } = useApp();
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [client, setClient] = useState<OpenAI | null>(null);

  const initializeWithConfig = useCallback((loadedConfig: Config) => {
    setConfig(loadedConfig);
    try {
      const newClient = buildClient(loadedConfig);
      setClient(newClient);
      setMessages([
        { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
      ]);
      setNeedsSetup(false);
      setInitialized(true);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  // When the app loads, read the configuration file
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
    if (!trimmed || loading || !client || !config) return;

    setInputText('');
    setInputKey((prev) => prev + 1);
    setLoading(true);
    setError(null);

    const userMessage: Message = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: updatedMessages,
        stream: true,
      });

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
  }, [loading, client, config, messages]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') exit();
  });

  const visibleMessages = messages.filter((msg) => msg.role !== 'system');
  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>Model: {providerInfo?.name || config.provider} / {config.model}</Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {needsSetup && (
        <InlineSetup onComplete={initializeWithConfig} />
      )}

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
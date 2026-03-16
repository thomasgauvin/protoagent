// src/App.tsx

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getModelPricing, getProvider, getRequestDefaultParams } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';
import { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from './tools/index.js';
import type { ApprovalRequest, ApprovalResponse } from './utils/approval.js';

export interface AppProps {
  dangerouslySkipPermissions?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
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

  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim();
  const baseURL = baseURLOverride || provider?.baseURL;
  if (baseURL) {
    clientOptions.baseURL = baseURL;
  }

  return new OpenAI(clientOptions);
}

/** Interactive approval prompt rendered inline. */
const ApprovalPrompt: React.FC<{
  request: ApprovalRequest;
  onRespond: (response: ApprovalResponse) => void;
}> = ({ request, onRespond }) => {
  const sessionApprovalLabel = request.sessionScopeKey
    ? 'Approve this operation for session'
    : `Approve all "${request.type}" for session`;

  const items = [
    { label: 'Approve once', value: 'approve_once' as const },
    { label: sessionApprovalLabel, value: 'approve_session' as const },
    { label: 'Reject', value: 'reject' as const },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={1} marginY={1}>
      <Text color="green" bold>Approval Required</Text>
      <Text>{request.description}</Text>
      {request.detail && (
        <Text dimColor>{request.detail.length > 200 ? request.detail.slice(0, 200) + '...' : request.detail}</Text>
      )}
      <Box marginTop={1}>
        <Select
          options={items.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onRespond(value as ApprovalResponse)}
        />
      </Box>
    </Box>
  );
};

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{
  onComplete: (config: Config) => void;
}> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

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
            options={providerItems.map((item) => ({ value: item.value, label: item.label }))}
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
      <Text dimColor>
        Selected: {provider?.name} / {selectedModelId}
      </Text>
      <Text>{hasResolvedAuth ? 'Optional API key:' : 'Enter your API key:'}</Text>
      {apiKeyError && <Text color="red">{apiKeyError}</Text>}
      <PasswordInput
        placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : `Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={(value) => {
          if (value.trim().length === 0 && !hasResolvedAuth) {
            setApiKeyError('API key cannot be empty.');
            return;
          }
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

const UsageDisplay: React.FC<{
  usage: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } | null;
  totalCost: number;
}> = ({ usage, totalCost }) => {
  if (!usage && totalCost === 0) return null;

  return (
    <Box marginTop={1}>
      {usage && (
        <Text dimColor>
          tokens: {usage.inputTokens}↓ {usage.outputTokens}↑ | ctx: {usage.contextPercent.toFixed(0)}%
        </Text>
      )}
      {totalCost > 0 && (
        <Text dimColor> | cost: ${totalCost.toFixed(4)}</Text>
      )}
    </Box>
  );
};

export const App: React.FC<AppProps> = ({ dangerouslySkipPermissions = false, logLevel = 'info' }) => {
  const { exit } = useApp();

  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  const [inputResetKey, setInputResetKey] = useState(0);

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  // Abort controller for cancelling the current completion
  const abortControllerRef = useRef<AbortController | null>(null);

  const clientRef = useRef<OpenAI | null>(null);

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);
    clientRef.current = buildClient(loadedConfig);

    const initialMessages = await initializeMessages();
    setCompletionMessages(initialMessages);
    setNeedsSetup(false);
    setInitialized(true);
  }, []);

  useEffect(() => {
    const init = async () => {
      if (dangerouslySkipPermissions) {
        setDangerouslySkipPermissions(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      const loadedConfig = readConfig();
      if (!loadedConfig) {
        setNeedsSetup(true);
        return;
      }

      await initializeWithConfig(loadedConfig);
    };

    init().catch((err) => {
      setError(`Initialization failed: ${err.message}`);
    });

    return () => {
      clearApprovalHandler();
    };
  }, []);

const handleSubmit = useCallback(async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || loading || !clientRef.current || !config) return;

  setInputText('');
  setInputResetKey((prev) => prev + 1);
  setLoading(true);
  setError(null);

  const userMessage: Message = { role: 'user', content: trimmed };
  setCompletionMessages((prev) => [...prev, userMessage]);

  try {
    const pricing = getModelPricing(config.provider, config.model);
    const requestDefaults = getRequestDefaultParams(config.provider, config.model);

    // Create abort controller for this completion
    abortControllerRef.current = new AbortController();

    const updatedMessages = await runAgenticLoop(
      clientRef.current,
      config.model,
      [...completionMessages, userMessage],
      trimmed,
      (event: AgentEvent) => {
        switch (event.type) {
          case 'text_delta':
            setCompletionMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (event.content || '') }];
              }
              return [...prev, { role: 'assistant', content: event.content || '' }];
            });
            break;
          case 'tool_call':
            if (event.toolCall) {
              setCompletionMessages((prev) => {
                const assistantMsg = {
                  role: 'assistant' as const,
                  content: '',
                  tool_calls: [{
                    id: event.toolCall!.id,
                    type: 'function' as const,
                    function: { name: event.toolCall!.name, arguments: event.toolCall!.args },
                  }],
                };
                return [...prev, assistantMsg as any];
              });
            }
            break;
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
            }
            break;
          case 'usage':
            if (event.usage) {
              setLastUsage(event.usage);
              setTotalCost((prev) => prev + event.usage!.cost);
            }
            break;
          case 'iteration_done':
            // Reset assistant message tracker between iterations
            break;
          case 'error':
            setError(event.error || 'Unknown error');
            break;
          case 'done':
            break;
        }
      },
      {
        pricing: pricing || undefined,
        abortSignal: abortControllerRef.current.signal,
        requestDefaults,
      }
    );

    setCompletionMessages(updatedMessages);
  } catch (err: any) {
    setError(`Error: ${err.message}`);
  } finally {
    setLoading(false);
  }
}, [loading, config, completionMessages]);

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>
          Model: {providerInfo?.name || config.provider} / {config.model}
          {dangerouslySkipPermissions && <Text color="red"> (auto-approve all)</Text>}
        </Text>
      )}

      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {needsSetup && (
        <InlineSetup
          onComplete={(newConfig) => {
            initializeWithConfig(newConfig).catch((err) => {
              setError(`Initialization failed: ${err.message}`);
            });
          }}
        />
      )}

      <Box flexDirection="column" flexGrow={1}>
        {completionMessages.map((msg, index) => {
          const displayContent = 'content' in msg && typeof msg.content === 'string' ? msg.content : null;
          const msgAny = msg as any;
          const isToolCall = msg.role === 'assistant' && msgAny.tool_calls?.length > 0;

          if (msg.role === 'system') {
            return (
              <Box key={index} marginBottom={1}>
                <Text dimColor>[System prompt loaded]</Text>
              </Box>
            );
          }

          if (msg.role === 'user') {
            return (
              <Box key={index} flexDirection="column">
                <Text>
                  <Text color="green" bold>{'> '}</Text>
                  <Text>{displayContent}</Text>
                </Text>
              </Box>
            );
          }

          if (isToolCall) {
            return (
              <Box key={index} flexDirection="column">
                {msgAny.tool_calls.map((tc: any) => (
                  <Text key={tc.id} dimColor>
                    Tool: {tc.function?.name}({tc.function?.arguments?.slice(0, 100)})
                  </Text>
                ))}
              </Box>
            );
          }

          if (msg.role === 'tool') {
            const content = displayContent || '';
            return (
              <Box key={index} flexDirection="column">
                <Text dimColor>
                  {content.length > 200 ? content.slice(0, 200) + '...' : content}
                </Text>
              </Box>
            );
          }

          return (
            <Box key={index} flexDirection="column">
              <Text>{displayContent}</Text>
            </Box>
          );
        })}

        {loading && <Text dimColor>Working...</Text>}

        {/* Approval prompt */}
        {pendingApproval && (
          <ApprovalPrompt
            request={pendingApproval.request}
            onRespond={(response) => {
              pendingApproval.resolve(response);
              setPendingApproval(null);
            }}
          />
        )}
      </Box>

      {initialized && !!lastUsage && (
        <UsageDisplay usage={lastUsage} totalCost={totalCost} />
      )}

      {/* Input */}
      {initialized && !pendingApproval && (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Box width={2} flexShrink={0}>
            <Text color="green" bold>{'>'}</Text>
          </Box>
          <Box flexGrow={1}>
            <TextInput
              key={inputResetKey}
              defaultValue={inputText}
              onChange={setInputText}
              placeholder="Type your message..."
              onSubmit={handleSubmit}
            />
          </Box>
        </Box>
      )}
    </Box>
  );
};
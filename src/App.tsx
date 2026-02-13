/**
 * Main UI component — the heart of ProtoAgent's terminal interface.
 *
 * Renders the chat loop, tool call feedback, approval prompts,
 * and cost/usage info. All heavy logic lives in `agentic-loop.ts`;
 * this file is purely presentation + state wiring.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, type Config } from './config.js';
import { getProvider, getModelPricing, SUPPORTED_MODELS } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
  type ToolCallEvent,
} from './agentic-loop.js';
import { setDangerouslyAcceptAll, setApprovalHandler } from './tools/index.js';
import type { ApprovalRequest, ApprovalResponse } from './utils/approval.js';
import { setLogLevel, LogLevel } from './utils/logger.js';
import {
  createSession,
  saveSession,
  loadSession,
  generateTitle,
  type Session,
} from './sessions.js';
import { initializeMcp, closeMcp } from './mcp.js';

// ─── Props ───

export interface AppProps {
  dangerouslyAcceptAll?: boolean;
  logLevel?: string;
  sessionId?: string;
}

// ─── Sub-components ───

/** Renders a single tool call with status indicator. */
const ToolCallDisplay: React.FC<{ tc: ToolCallEvent }> = ({ tc }) => {
  const icon =
    tc.status === 'running' ? '⟳' :
    tc.status === 'done' ? '✓' :
    '✗';
  const color =
    tc.status === 'running' ? 'yellow' :
    tc.status === 'done' ? 'green' :
    'red';

  // Parse args for a short summary
  let argSummary = '';
  try {
    const parsed = JSON.parse(tc.args);
    // Show the most useful arg for common tools
    if (parsed.file_path) argSummary = parsed.file_path;
    else if (parsed.command) argSummary = parsed.command.slice(0, 60);
    else if (parsed.search_term) argSummary = `"${parsed.search_term}"`;
    else if (parsed.directory_path) argSummary = parsed.directory_path;
    else if (parsed.task) argSummary = parsed.task.slice(0, 60);
  } catch {
    // args might not be valid JSON yet during streaming
  }

  return (
    <Box>
      <Text color={color}>{icon} </Text>
      <Text color={color} bold>{tc.name}</Text>
      {argSummary && <Text dimColor> {argSummary}</Text>}
    </Box>
  );
};

/** Interactive approval prompt rendered inline. */
const ApprovalPrompt: React.FC<{
  request: ApprovalRequest;
  onRespond: (response: ApprovalResponse) => void;
}> = ({ request, onRespond }) => {
  const items = [
    { label: 'Approve once', value: 'approve_once' as const },
    { label: `Approve all "${request.type}" for session`, value: 'approve_session' as const },
    { label: 'Reject', value: 'reject' as const },
  ];

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text color="yellow" bold>Approval Required</Text>
      <Text>{request.description}</Text>
      {request.detail && (
        <Text dimColor>{request.detail.length > 200 ? request.detail.slice(0, 200) + '...' : request.detail}</Text>
      )}
      <Box marginTop={1}>
        <SelectInput
          items={items}
          onSelect={(item) => onRespond(item.value)}
        />
      </Box>
    </Box>
  );
};

/** Cost/usage display in the status bar. */
const UsageDisplay: React.FC<{
  usage: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } | null;
  totalCost: number;
}> = ({ usage, totalCost }) => {
  if (!usage && totalCost === 0) return null;

  return (
    <Box>
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

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{
  onComplete: (config: Config) => void;
}> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyError, setApiKeyError] = useState('');

  const providerItems = SUPPORTED_MODELS.flatMap((provider) =>
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
          <SelectInput
            items={providerItems}
            onSelect={(item) => {
              const [providerId, modelId] = item.value.split(':::');
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

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>
        Selected: {provider?.name} / {selectedModelId}
      </Text>
      <Text>Enter your API key:</Text>
      {apiKeyError && <Text color="red">{apiKeyError}</Text>}
      <TextInput
        value={apiKey}
        onChange={setApiKey}
        placeholder={`Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        mask="*"
        onSubmit={() => {
          if (apiKey.trim().length === 0) {
            setApiKeyError('API key cannot be empty.');
            return;
          }
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            apiKey: apiKey.trim(),
          };
          writeConfig(newConfig);
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

// ─── Main App ───

export const App: React.FC<AppProps> = ({
  dangerouslyAcceptAll = false,
  logLevel,
  sessionId,
}) => {
  const { exit } = useApp();

  // Core state
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Tool call display state
  const [activeToolCalls, setActiveToolCalls] = useState<ToolCallEvent[]>([]);
  const [streamedText, setStreamedText] = useState('');

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);

  // Session state
  const [session, setSession] = useState<Session | null>(null);

  // OpenAI client ref (stable across renders)
  const clientRef = useRef<OpenAI | null>(null);

  // Chat history for display (role + content pairs)
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);

  // ─── Post-config initialization (reused after inline setup) ───

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);

    // Create OpenAI client with provider's baseURL
    const provider = getProvider(loadedConfig.provider);
    const clientOptions: any = {
      apiKey: loadedConfig.apiKey,
    };
    if (provider?.baseURL) {
      clientOptions.baseURL = provider.baseURL;
    }
    clientRef.current = new OpenAI(clientOptions);

    // Initialize MCP servers
    await initializeMcp();

    // Load or create session
    let loadedSession: Session | null = null;
    if (sessionId) {
      loadedSession = await loadSession(sessionId);
      if (loadedSession) {
        setSession(loadedSession);
        setMessages(loadedSession.messages);
        // Rebuild chat history from loaded messages
        const history: { role: string; content: string }[] = [];
        for (const msg of loadedSession.messages) {
          if ((msg.role === 'user' || msg.role === 'assistant') && 'content' in msg && typeof msg.content === 'string') {
            history.push({ role: msg.role, content: msg.content });
          }
        }
        setChatHistory(history);
      } else {
        setError(`Session "${sessionId}" not found. Starting a new session.`);
      }
    }

    if (!loadedSession) {
      // Initialize fresh conversation
      const initialMessages = await initializeMessages();
      setMessages(initialMessages);

      const newSession = createSession(loadedConfig.model, loadedConfig.provider);
      newSession.messages = initialMessages;
      setSession(newSession);
    }

    setNeedsSetup(false);
    setInitialized(true);
  }, [sessionId]);

  // ─── Initialization ───

  useEffect(() => {
    const init = async () => {
      // Set log level
      if (logLevel) {
        const level = LogLevel[logLevel.toUpperCase() as keyof typeof LogLevel];
        if (level !== undefined) {
          setLogLevel(level);
        }
      }

      // Set global approval mode
      if (dangerouslyAcceptAll) {
        setDangerouslyAcceptAll(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      // Load config — if none exists, show inline setup
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

    // Cleanup MCP on unmount
    return () => {
      closeMcp();
    };
  }, []);

  // ─── Slash commands ───

  const handleSlashCommand = useCallback((cmd: string): boolean => {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();

    switch (command) {
      case '/quit':
      case '/exit':
        exit();
        return true;
      case '/clear':
        setChatHistory([]);
        // Re-initialize messages with just the system prompt
        initializeMessages().then((msgs) => {
          setMessages(msgs);
          if (session) {
            const newSession = createSession(config!.model, config!.provider);
            newSession.messages = msgs;
            setSession(newSession);
          }
        });
        return true;
      case '/config':
        setNeedsSetup(true);
        setInitialized(false);
        return true;
      case '/cost':
        setChatHistory((prev) => [
          ...prev,
          { role: 'system', content: `Total session cost: $${totalCost.toFixed(4)}` },
        ]);
        return true;
      case '/help':
        setChatHistory((prev) => [
          ...prev,
          {
            role: 'system',
            content: [
              'Commands:',
              '  /clear   — Clear conversation and start fresh',
              '  /config  — Change provider, model, or API key',
              '  /cost    — Show total session cost',
              '  /help    — Show this help',
              '  /quit    — Exit ProtoAgent',
            ].join('\n'),
          },
        ]);
        return true;
      default:
        return false;
    }
  }, [exit, session, config, totalCost]);

  // ─── Submit handler ───

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !clientRef.current || !config) return;

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const handled = handleSlashCommand(trimmed);
      if (handled) {
        setInputText('');
        return;
      }
    }

    setInputText('');
    setLoading(true);
    setStreamedText('');
    setActiveToolCalls([]);
    setError(null);

    // Add user message to chat history
    setChatHistory((prev) => [...prev, { role: 'user', content: trimmed }]);

    try {
      const pricing = getModelPricing(config.provider, config.model);

      const updatedMessages = await runAgenticLoop(
        clientRef.current,
        config.model,
        messages,
        trimmed,
        (event: AgentEvent) => {
          switch (event.type) {
            case 'text_delta':
              setStreamedText((prev) => prev + (event.content || ''));
              break;
            case 'tool_call':
              if (event.toolCall) {
                setActiveToolCalls((prev) => {
                  const existing = prev.findIndex((tc) => tc.name === event.toolCall!.name && tc.status === 'running');
                  if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = event.toolCall!;
                    return updated;
                  }
                  return [...prev, event.toolCall!];
                });
              }
              break;
            case 'tool_result':
              if (event.toolCall) {
                setActiveToolCalls((prev) =>
                  prev.map((tc) =>
                    tc.name === event.toolCall!.name && tc.status === 'running'
                      ? event.toolCall!
                      : tc
                  )
                );
              }
              break;
            case 'usage':
              if (event.usage) {
                setLastUsage(event.usage);
                setTotalCost((prev) => prev + event.usage!.cost);
              }
              break;
            case 'error':
              setError(event.error || 'Unknown error');
              break;
            case 'done':
              break;
          }
        },
        { pricing: pricing || undefined }
      );

      setMessages(updatedMessages);

      // Extract the final assistant response and add to chat history
      const lastMsg = updatedMessages[updatedMessages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant' && 'content' in lastMsg && typeof lastMsg.content === 'string') {
        setChatHistory((prev) => [...prev, { role: 'assistant', content: lastMsg.content as string }]);
      }

      // Update session
      if (session) {
        session.messages = updatedMessages;
        session.title = generateTitle(updatedMessages);
        await saveSession(session);
      }
    } catch (err: any) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
      setStreamedText('');
      setActiveToolCalls([]);
    }
  }, [loading, config, messages, session, handleSlashCommand]);

  // ─── Keyboard shortcuts ───

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
  });

  // ─── Render ───

  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      <Text italic dimColor>
        "The prefix "proto-" comes from the Greek word prōtos — the beginning stage of something that will later evolve."
      </Text>
      <Text> </Text>
      {config && (
        <Text dimColor>
          Model: {providerInfo?.name || config.provider} / {config.model}
          {dangerouslyAcceptAll && <Text color="red"> (auto-approve all)</Text>}
          {session && <Text dimColor> | Session: {session.id.slice(0, 8)}</Text>}
        </Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {/* Inline setup wizard */}
      {needsSetup && (
        <InlineSetup
          onComplete={(newConfig) => {
            initializeWithConfig(newConfig).catch((err) => {
              setError(`Initialization failed: ${err.message}`);
            });
          }}
        />
      )}

      {/* Chat history */}
      <Box flexDirection="column" flexGrow={1} marginTop={1}>
        {chatHistory.map((msg, index) => (
          <Box key={index} flexDirection="column" marginBottom={1}>
            {msg.role === 'user' ? (
              <Text>
                <Text color="green" bold>{'> '}</Text>
                <Text>{msg.content}</Text>
              </Text>
            ) : msg.role === 'system' ? (
              <Text color="yellow">{msg.content}</Text>
            ) : (
              <Text>{msg.content}</Text>
            )}
          </Box>
        ))}

        {/* Streaming text */}
        {streamedText && (
          <Box marginBottom={1}>
            <Text>{streamedText}</Text>
          </Box>
        )}

        {/* Active tool calls */}
        {activeToolCalls.length > 0 && (
          <Box flexDirection="column" marginBottom={1}>
            {activeToolCalls.map((tc, i) => (
              <ToolCallDisplay key={`${tc.name}-${i}`} tc={tc} />
            ))}
          </Box>
        )}

        {/* Loading indicator */}
        {loading && activeToolCalls.length === 0 && !streamedText && (
          <Text dimColor>Thinking...</Text>
        )}

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

      {/* Usage bar */}
      <UsageDisplay usage={lastUsage ?? null} totalCost={totalCost} />

      {/* Input */}
      {initialized && !pendingApproval && (
        <Box borderStyle="single" borderColor="green" paddingX={1}>
          <Text color="green">{'> '}</Text>
          <TextInput
            value={inputText}
            onChange={setInputText}
            placeholder="Type your message... (/help for commands)"
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  );
};

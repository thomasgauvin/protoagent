/**
 * Main UI component — the heart of ProtoAgent's terminal interface.
 *
 * Renders the chat loop, tool call feedback, approval prompts,
 * and cost/usage info. All heavy logic lives in `agentic-loop.ts`;
 * this file is purely presentation + state wiring.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getProvider, getModelPricing, SUPPORTED_MODELS } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';
import { setDangerouslyAcceptAll, setApprovalHandler, clearApprovalHandler } from './tools/index.js';
import type { ApprovalRequest, ApprovalResponse } from './utils/approval.js';
import { setLogLevel, LogLevel, initLogFile, logger } from './utils/logger.js';
import {
  createSession,
  ensureSystemPromptAtTop,
  saveSession,
  loadSession,
  generateTitle,
  type Session,
} from './sessions.js';
import { clearTodos, getTodosForSession, setTodosForSession } from './tools/todo.js';
import { initializeMcp, closeMcp } from './mcp.js';
import { generateSystemPrompt } from './system-prompt.js';
import { CollapsibleBox } from './components/CollapsibleBox.js';
import { ConsolidatedToolMessage } from './components/ConsolidatedToolMessage.js';
import { ConfigDialog } from './components/ConfigDialog.js';
import { FormattedMessage } from './components/FormattedMessage.js';

interface InlineThreadError {
  id: string;
  message: string;
  transient?: boolean;
}

function renderMessageList(
  messagesToRender: Message[],
  allMessages: Message[],
  expandedMessages: Set<number>,
  startIndex = 0,
): React.ReactNode[] {
  const rendered: React.ReactNode[] = [];
  const skippedIndices = new Set<number>();

  messagesToRender.forEach((msg, localIndex) => {
    if (skippedIndices.has(localIndex)) {
      return;
    }

    const index = startIndex + localIndex;
    const msgAny = msg as any;
    const isToolCall = msg.role === 'assistant' && msgAny.tool_calls && msgAny.tool_calls.length > 0;
    const displayContent = 'content' in msg && typeof msg.content === 'string' ? msg.content : null;
    const isFirstSystemMessage = msg.role === 'system' && !allMessages.slice(0, index).some((message) => message.role === 'system');
    const previousMessage = index > 0 ? allMessages[index - 1] : null;
    const followsToolMessage = previousMessage?.role === 'tool';
    const currentSpeaker = getVisualSpeaker(msg);
    const previousSpeaker = getVisualSpeaker(previousMessage);
    const isConversationTurn = currentSpeaker === 'user' || currentSpeaker === 'assistant';
    const previousWasConversationTurn = previousSpeaker === 'user' || previousSpeaker === 'assistant';
    const speakerChanged = previousSpeaker !== currentSpeaker;

    if (isFirstSystemMessage) {
      rendered.push(<Text key={`spacer-${index}`}> </Text>);
    }

    if (isConversationTurn && previousWasConversationTurn && speakerChanged) {
      rendered.push(<Text key={`turn-spacer-${index}`}> </Text>);
    }

    if (msg.role === 'user') {
      rendered.push(
        <Box key={index} flexDirection="column">
          <Text>
            <Text color="green" bold>
              {'> '}
            </Text>
            <Text>{displayContent}</Text>
          </Text>
        </Box>
      );
      return;
    }

    if (msg.role === 'system') {
      rendered.push(
        <CollapsibleBox
          key={index}
          title="System Prompt"
          content={displayContent || ''}
          titleColor="green"
          dimColor={false}
          maxPreviewLines={3}
          expanded={expandedMessages.has(index)}
        />
      );
      return;
    }

    if (isToolCall) {
      if (displayContent && displayContent.trim().length > 0) {
        rendered.push(
          <Box key={`${index}-text`} flexDirection="column">
            <FormattedMessage content={displayContent.trimEnd()} />
          </Box>
        );
      }

      const toolCalls = msgAny.tool_calls.map((tc: any) => ({
        id: tc.id,
        name: tc.function?.name || 'tool',
      }));
      const toolResults = new Map<string, { content: string; name: string }>();

      let nextLocalIndex = localIndex + 1;
      for (const toolCall of toolCalls) {
        if (nextLocalIndex < messagesToRender.length) {
          const nextMsg = messagesToRender[nextLocalIndex] as any;
          if (nextMsg.role === 'tool' && nextMsg.tool_call_id === toolCall.id) {
            toolResults.set(toolCall.id, {
              content: nextMsg.content || '',
              name: nextMsg.name || toolCall.name,
            });
            skippedIndices.add(nextLocalIndex);
            nextLocalIndex++;
          }
        }
      }

      rendered.push(
        <ConsolidatedToolMessage
          key={index}
          toolCalls={toolCalls}
          toolResults={toolResults}
          expanded={expandedMessages.has(index)}
        />
      );
      return;
    }

    if (msg.role === 'tool') {
      rendered.push(
        <CollapsibleBox
          key={index}
          title={`${msgAny.name || 'tool'} result`}
          content={displayContent || ''}
          dimColor={true}
          maxPreviewLines={3}
          expanded={expandedMessages.has(index)}
        />
      );
      return;
    }

    rendered.push(
      <Box key={index} flexDirection="column">
        <FormattedMessage content={trimAssistantSpacing(displayContent || '', followsToolMessage ? 'start' : 'both')} />
      </Box>
    );
  });

  return rendered;
}

function trimAssistantSpacing(message: string, trimMode: 'start' | 'end' | 'both' = 'both'): string {
  if (trimMode === 'start') return message.trimStart();
  if (trimMode === 'end') return message.trimEnd();
  return message.trim();
}

function getVisualSpeaker(message: Message | null): 'user' | 'assistant' | 'system' | null {
  if (!message) return null;
  if (message.role === 'tool') return 'assistant';
  if (message.role === 'user' || message.role === 'assistant' || message.role === 'system') {
    return message.role;
  }
  return null;
}

// ─── Props ───

export interface AppProps {
  dangerouslyAcceptAll?: boolean;
  logLevel?: string;
  sessionId?: string;
}

// ─── Available slash commands ───

const SLASH_COMMANDS = [
  { name: '/clear', description: 'Clear conversation and start fresh' },
  { name: '/collapse', description: 'Collapse all long messages' },
  { name: '/config', description: 'Change provider, model, or API key' },
  { name: '/expand', description: 'Expand all collapsed messages' },
  { name: '/help', description: 'Show all available commands' },
  { name: '/quit', description: 'Exit ProtoAgent' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HELP_TEXT = [
  'Commands:',
  '  /clear    - Clear conversation and start fresh',
  '  /collapse - Collapse all long messages',
  '  /config   - Change provider, model, or API key',
  '  /expand   - Expand all collapsed messages',
  '  /help     - Show this help',
  '  /quit     - Exit ProtoAgent',
].join('\n');

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

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
  };

  if (provider?.baseURL) {
    clientOptions.baseURL = provider.baseURL;
  }

  return new OpenAI(clientOptions);
}

// ─── Sub-components ───

/** Shows filtered slash commands when user types /. */
const CommandFilter: React.FC<{ inputText: string }> = ({ inputText }) => {
  if (!inputText.startsWith('/')) return null;

  const filtered = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(inputText.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {filtered.map((cmd) => (
        <Text key={cmd.name} dimColor>
          <Text color="green">{cmd.name}</Text> — {cmd.description}
        </Text>
      ))}
    </Box>
  );
};

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
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text color="yellow" bold>Approval Required</Text>
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

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>
        Selected: {provider?.name} / {selectedModelId}
      </Text>
      <Text>Enter your API key:</Text>
      {apiKeyError && <Text color="red">{apiKeyError}</Text>}
      <PasswordInput
        placeholder={`Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={(value) => {
          if (value.trim().length === 0) {
            setApiKeyError('API key cannot be empty.');
            return;
          }
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            apiKey: value.trim(),
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
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpMessage, setHelpMessage] = useState<string | null>(null);
  const [threadErrors, setThreadErrors] = useState<InlineThreadError[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [logFilePath, setLogFilePath] = useState<string | null>(null);

  // Collapsible state — track which message indices are expanded
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

  const expandLatestMessage = useCallback((index: number) => {
    setExpandedMessages((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  // Config dialog state
  const [showConfigDialog, setShowConfigDialog] = useState(false);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Session state
  const [session, setSession] = useState<Session | null>(null);

  // Quitting state — shows the resume command before exiting
  const [quittingSession, setQuittingSession] = useState<Session | null>(null);

  // OpenAI client ref (stable across renders)
  const clientRef = useRef<OpenAI | null>(null);

  // Track current assistant message being built in the event handler
  const assistantMessageRef = useRef<{
    message: any;
    index: number;
    kind: 'streaming_text' | 'tool_call_assistant';
  } | null>(null);

  // Abort controller for cancelling the current completion
  const abortControllerRef = useRef<AbortController | null>(null);

  // ─── Post-config initialization (reused after inline setup) ───

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);

    clientRef.current = buildClient(loadedConfig);

    // Initialize MCP servers
    await initializeMcp();

    // Load or create session
    let loadedSession: Session | null = null;
    if (sessionId) {
      loadedSession = await loadSession(sessionId);
      if (loadedSession) {
        const systemPrompt = await generateSystemPrompt();
        loadedSession.completionMessages = ensureSystemPromptAtTop(
          loadedSession.completionMessages,
          systemPrompt
        );
        setTodosForSession(loadedSession.id, loadedSession.todos);
        setSession(loadedSession);
        setCompletionMessages(loadedSession.completionMessages);
      } else {
        setError(`Session "${sessionId}" not found. Starting a new session.`);
      }
    }

    if (!loadedSession) {
      // Initialize fresh conversation
      const initialCompletionMessages = await initializeMessages();
      setCompletionMessages(initialCompletionMessages);

      const newSession = createSession(loadedConfig.model, loadedConfig.provider);
      clearTodos(newSession.id);
      newSession.completionMessages = initialCompletionMessages;
      setSession(newSession);
    }

    setNeedsSetup(false);
    setInitialized(true);
  }, [sessionId]);

  // ─── Initialization ───

  useEffect(() => {
    if (!loading) {
      setSpinnerFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);

    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    const init = async () => {
      // Set log level and initialize log file
      if (logLevel) {
        const level = LogLevel[logLevel.toUpperCase() as keyof typeof LogLevel];
        if (level !== undefined) {
          setLogLevel(level);
          const logPath = initLogFile();
          setLogFilePath(logPath);

          logger.info(`ProtoAgent started with log level: ${logLevel}`);
          logger.info(`Log file: ${logPath}`);
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

    // Cleanup on unmount
    return () => {
      clearApprovalHandler();
      closeMcp();
    };
  }, []);

  // ─── Slash commands ───

  const handleSlashCommand = useCallback(async (cmd: string): Promise<boolean> => {
    const parts = cmd.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase();

    switch (command) {
        case '/quit':
        case '/exit':
        if (!session) {
          exit();
          return true;
        }

        try {
          const nextSession: Session = {
            ...session,
            completionMessages,
            todos: getTodosForSession(session.id),
            title: generateTitle(completionMessages),
          };

          await saveSession(nextSession);
          setSession(nextSession);
          setQuittingSession(nextSession);
          setError(null);

          // Exit after a short delay to allow render
          setTimeout(() => exit(), 100);
        } catch (err: any) {
          setError(`Failed to save session before exit: ${err.message}`);
        }
        return true;
      case '/clear':
        // Re-initialize messages with just the system prompt
        initializeMessages().then((msgs) => {
          setCompletionMessages(msgs);
          setHelpMessage(null);
          setLastUsage(null);
          setTotalCost(0);
          setThreadErrors([]);
          setExpandedMessages(new Set());
          if (session) {
            const newSession = createSession(config!.model, config!.provider);
            clearTodos(session.id);
            clearTodos(newSession.id);
            newSession.completionMessages = msgs;
            setSession(newSession);
          }
        });
        return true;
       case '/config':
         if (initialized && config) {
          // Mid-conversation: show config dialog
          setShowConfigDialog(true);
        } else {
          // Initial setup: show inline setup
          setNeedsSetup(true);
        }
        return true;
      case '/expand':
        // Expand all collapsed messages
        const allIndices = new Set(completionMessages.map((_, i) => i));
        setExpandedMessages(allIndices);
        return true;
      case '/collapse':
        // Collapse all messages
        setExpandedMessages(new Set());
        return true;
       case '/help':
        setHelpMessage(HELP_TEXT);
        return true;
      default:
        return false;
    }
  }, [exit, session, completionMessages]);

  // ─── Submit handler ───

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
      if (!trimmed || loading || !clientRef.current || !config) return;

      // Handle slash commands
      if (trimmed.startsWith('/')) {
        const handled = await handleSlashCommand(trimmed);
        if (handled) {
          setInputText('');
          return;
      }
    }

    setInputText('');
    setLoading(true);
    setError(null);
    setHelpMessage(null);
    setThreadErrors([]);

    // Add user message to completion messages IMMEDIATELY for real-time UI display
    const userMessage: Message = { role: 'user', content: trimmed };
    setCompletionMessages((prev) => [...prev, userMessage]);

    // Reset assistant message tracker
    assistantMessageRef.current = null;

    try {
      const pricing = getModelPricing(config.provider, config.model);

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
              // Update the current assistant message in completionMessages in real-time
              if (!assistantMessageRef.current || assistantMessageRef.current.kind !== 'streaming_text') {
                // First text delta - create the assistant message
                const assistantMsg = { role: 'assistant', content: event.content || '', tool_calls: [] } as Message;
                setCompletionMessages((prev) => {
                  assistantMessageRef.current = { message: assistantMsg, index: prev.length, kind: 'streaming_text' };
                  return [...prev, assistantMsg];
                });
              } else {
                // Subsequent text delta - update the assistant message
                assistantMessageRef.current.message.content += event.content || '';
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  updated[assistantMessageRef.current!.index] = { ...assistantMessageRef.current!.message };
                  return updated;
                });
              }
              break;
            case 'tool_call':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setCompletionMessages((prev) => {
                  const existingRef = assistantMessageRef.current;
                  const existingMessage = existingRef?.message
                    ? {
                        ...existingRef.message,
                        tool_calls: [...(existingRef.message.tool_calls || [])],
                      }
                    : null;

                  const assistantMsg = existingMessage || {
                    role: 'assistant',
                    content: '',
                    tool_calls: [],
                  };

                  const existingToolCallIndex = assistantMsg.tool_calls.findIndex(
                    (existingToolCall: any) => existingToolCall.id === toolCall.id
                  );

                  const nextToolCall = {
                    id: toolCall.id,
                    type: 'function',
                    function: {
                      name: toolCall.name,
                      arguments: toolCall.args,
                    },
                  };

                  if (existingToolCallIndex === -1) {
                    assistantMsg.tool_calls.push(nextToolCall);
                  } else {
                    assistantMsg.tool_calls[existingToolCallIndex] = nextToolCall;
                  }

                  const nextIndex = existingRef?.index ?? prev.length;
                  assistantMessageRef.current = {
                    message: assistantMsg,
                    index: nextIndex,
                    kind: 'tool_call_assistant',
                  };

                  if (existingRef) {
                    const updated = [...prev];
                    updated[existingRef.index] = assistantMsg;
                    return updated;
                  }

                  return [...prev, assistantMsg as Message];
                });
              }
              break;
            case 'tool_result':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                if (toolCall.name === 'todo_read' || toolCall.name === 'todo_write') {
                  const currentAssistantIndex = assistantMessageRef.current?.index;
                  if (typeof currentAssistantIndex === 'number') {
                    expandLatestMessage(currentAssistantIndex);
                  }
                }
                // Add tool result message to completion messages
                setCompletionMessages((prev) => [
                  ...prev,
                  {
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolCall.result || '',
                    name: toolCall.name,
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
            case 'error':
              if (event.error) {
                const errorMessage = event.error;
                setThreadErrors((prev) => {
                  if (event.transient) {
                    return [
                      ...prev.filter((threadError) => !threadError.transient),
                      {
                        id: `${Date.now()}-${prev.length}`,
                        message: errorMessage,
                        transient: true,
                      },
                    ];
                  }

                  if (prev[prev.length - 1]?.message === errorMessage) {
                    return prev;
                  }

                  return [
                    ...prev,
                    {
                      id: `${Date.now()}-${prev.length}`,
                      message: errorMessage,
                      transient: false,
                    },
                  ];
                });
              } else {
                setError('Unknown error');
              }
              break;
            case 'done':
              setThreadErrors((prev) => prev.filter((threadError) => !threadError.transient));
              break;
          }
        },
        { pricing: pricing || undefined, abortSignal: abortControllerRef.current.signal, sessionId: session?.id }
      );

      // Final update to ensure we have the complete message history
      setCompletionMessages(updatedMessages);

      // Update session
      if (session) {
        session.completionMessages = updatedMessages;
        session.todos = getTodosForSession(session.id);
        session.title = generateTitle(updatedMessages);
        await saveSession(session);
      }
    } catch (err: any) {
      setError(`Error: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [loading, config, completionMessages, session, handleSlashCommand, expandLatestMessage]);

  // ─── Keyboard shortcuts ───

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
    if (key.escape && loading && abortControllerRef.current) {
      // Abort the current completion
      abortControllerRef.current.abort();
    }
  });

  // ─── Render ───

  const providerInfo = config ? getProvider(config.provider) : null;
  const liveStartIndex = loading
    ? (typeof assistantMessageRef.current?.index === 'number'
        ? assistantMessageRef.current.index
        : Math.max(completionMessages.length - 1, 0))
    : completionMessages.length;
  const archivedMessages = completionMessages.slice(0, liveStartIndex);
  const liveMessages = completionMessages.slice(liveStartIndex);
  const archivedMessageNodes = renderMessageList(archivedMessages, completionMessages, expandedMessages);
  const liveMessageNodes = renderMessageList(liveMessages, completionMessages, expandedMessages, liveStartIndex);

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
      {logFilePath && (
        <Text dimColor>
          Debug logs: {logFilePath}
        </Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {helpMessage && (
        <CollapsibleBox
          title="Help"
          content={helpMessage}
          titleColor="green"
          dimColor={false}
          maxPreviewLines={10}
          expanded={true}
        />
      )}
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

        {/* Chat messages area (grows to fill space) */}
       <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {archivedMessageNodes}
        {liveMessageNodes}

        {threadErrors.map((threadError) => (
          <Box key={`thread-error-${threadError.id}`} marginBottom={1} borderStyle="round" borderColor="red" paddingX={1}>
            <Text color="red">Error: {threadError.message}</Text>
          </Box>
        ))}


        {/* Loading indicator - show only if loading and no assistant response yet */}
        {loading && completionMessages.length > 0 && (
          (() => {
            const lastMsg = completionMessages[completionMessages.length - 1];
            // Show "Thinking..." only if the last message is a user message (no assistant response yet)
            return lastMsg.role === 'user' ? <Text dimColor>Thinking...</Text> : null;
          })()
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

       {/* Command filter (show available commands when typing /) */}
      {initialized && !pendingApproval && inputText.startsWith('/') && (
        <CommandFilter inputText={inputText} />
      )}

      {/* Config dialog (mid-conversation) */}
      {showConfigDialog && config && (
        <ConfigDialog
          currentConfig={config}
          onComplete={(newConfig) => {
            try {
              const nextClient = buildClient(newConfig);
              writeConfig(newConfig);
              clientRef.current = nextClient;
              setConfig(newConfig);
              setLastUsage(null);
              setError(null);

              if (session) {
                const nextSession = {
                  ...session,
                  provider: newConfig.provider,
                  model: newConfig.model,
                };
                setSession(nextSession);
                saveSession(nextSession).catch((err) => {
                  setError(`Failed to save updated session config: ${err.message}`);
                });
              }

              setShowConfigDialog(false);
            } catch (err: any) {
              setError(`Failed to update configuration: ${err.message}`);
            }
          }}
          onCancel={() => {
            setShowConfigDialog(false);
          }}
        />
      )}

       {/* Working indicator */}
      {initialized && !pendingApproval && loading && (
        <Box marginBottom={1}>
          <Text color="green" bold>{SPINNER_FRAMES[spinnerFrame]} Working...</Text>
        </Box>
      )}

      {/* Input */}
       {initialized && !pendingApproval && (
        <Box borderStyle="single" borderColor="green" paddingX={1}>
          <Text color="green">{'> '}</Text>
          <TextInput
            key={inputText === '' ? 'reset' : 'active'}
            defaultValue={inputText}
            onChange={setInputText}
            placeholder="Type your message... (/help for commands)"
            onSubmit={handleSubmit}
          />
        </Box>
      )}

       {/* Resume session command (shown when quitting) */}
      {quittingSession && (
        <Box flexDirection="column" marginTop={1} paddingX={1} marginBottom={1}>
          <Text dimColor>Session saved. Resume with:</Text>
          <Text color="green">protoagent --session {quittingSession.id}</Text>
        </Box>
      )}
    </Box>
  );
};

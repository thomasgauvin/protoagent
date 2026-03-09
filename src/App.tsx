/**
 * Main UI component — the heart of ProtoAgent's terminal interface.
 *
 * Renders the chat loop, tool call feedback, approval prompts,
 * and cost/usage info. All heavy logic lives in `agentic-loop.ts`;
 * this file is purely presentation + state wiring.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { loadRuntimeConfig } from './runtime-config.js';
import { getAllProviders, getProvider, getModelPricing, getRequestDefaultParams } from './providers.js';
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
  deferTables = false,
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
    const normalizedContent = normalizeMessageSpacing(displayContent || '', msg.role === 'tool' ? 'tool' : 'assistant');
    const isFirstSystemMessage = msg.role === 'system' && !allMessages.slice(0, index).some((message) => message.role === 'system');
    const previousMessage = index > 0 ? allMessages[index - 1] : null;
    const followsToolMessage = previousMessage?.role === 'tool';
    const currentSpeaker = getVisualSpeaker(msg);
    const previousSpeaker = getVisualSpeaker(previousMessage);
    const isConversationTurn = currentSpeaker === 'user' || currentSpeaker === 'assistant';
    const previousWasConversationTurn = previousSpeaker === 'user' || previousSpeaker === 'assistant';
    const speakerChanged = previousSpeaker !== currentSpeaker;

    // Determine if we need a blank-line spacer above this message.
    // At most one spacer is added per message to avoid doubling.
    const needsSpacer =
      isFirstSystemMessage ||
      (isConversationTurn && previousWasConversationTurn && speakerChanged) ||
      followsToolMessage ||
      (isToolCall && previousMessage != null);

    if (needsSpacer) {
      rendered.push(<Text key={`spacer-${index}`}> </Text>);
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
      if (normalizedContent.length > 0) {
        rendered.push(
          <Box key={`${index}-text`} flexDirection="column">
            <FormattedMessage content={normalizedContent} deferTables={deferTables} />
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
              content: normalizeMessageSpacing(nextMsg.content || '', 'tool'),
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
          content={normalizedContent}
          dimColor={true}
          maxPreviewLines={3}
          expanded={expandedMessages.has(index)}
        />
      );
      return;
    }

    rendered.push(
      <Box key={index} flexDirection="column">
        <FormattedMessage
          content={normalizedContent}
          deferTables={deferTables}
        />
      </Box>
    );
  });

  return rendered;
}

function normalizeMessageSpacing(message: string, _role: 'assistant' | 'tool'): string {
  const normalized = message.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  while (lines.length > 0 && lines[0].trim() === '') {
    lines.shift();
  }

  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  return lines.join('\n');
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
  { name: '/expand', description: 'Expand all collapsed messages' },
  { name: '/help', description: 'Show all available commands' },
  { name: '/quit', description: 'Exit ProtoAgent' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HELP_TEXT = [
  'Commands:',
  '  /clear    - Clear conversation and start fresh',
  '  /collapse - Collapse all long messages',
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

  // baseURL: env var override takes precedence over provider default
  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim();
  const baseURL = baseURLOverride || provider?.baseURL;
  if (baseURL) {
    clientOptions.baseURL = baseURL;
  }

  // Custom headers: env override takes precedence over provider defaults
  const rawHeaders = process.env.PROTOAGENT_CUSTOM_HEADERS?.trim();
  if (rawHeaders) {
    const defaultHeaders: Record<string, string> = {};
    for (const line of rawHeaders.split('\n')) {
      const sep = line.indexOf(': ');
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 2).trim();
      if (key && value) defaultHeaders[key] = value;
    }
    if (Object.keys(defaultHeaders).length > 0) {
      clientOptions.defaultHeaders = defaultHeaders;
    }
  } else if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
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

/** Cost/usage display in the status bar. */
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

// ─── Main App ───

export const App: React.FC<AppProps> = ({
  dangerouslyAcceptAll = false,
  logLevel,
  sessionId,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();

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

  // Static output — completed turns flushed to stdout via <Static>, never re-rendered
  const [staticItems, setStaticItems] = useState<Array<{ key: string; nodes: React.ReactNode[] }>>([]);
  // Track how many messages have already been flushed to static (prevents double-rendering)
  const flushedUpToRef = useRef<number>(0);

  // Input reset key — incremented on submit to force TextInput remount and clear
  const [inputResetKey, setInputResetKey] = useState(0);
  const [inputWidthKey, setInputWidthKey] = useState(stdout?.columns ?? 80);

  // Collapsible state — only applies to live (current turn) messages
  const [expandedMessages, setExpandedMessages] = useState<Set<number>>(new Set());

  const expandLatestMessage = useCallback((index: number) => {
    setExpandedMessages((prev) => {
      if (prev.has(index)) return prev;
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  }, []);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Active tool tracking — shows which tool is currently executing
  const [activeTool, setActiveTool] = useState<string | null>(null);

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

  // Lock the live-start boundary at the beginning of each completion to prevent jumps
  const liveStartRef = useRef<number>(0);

  // Debounce timer for text_delta renders (~50ms batching)
  const textFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track expandedMessages in a ref so async callbacks can read the latest value
  const expandedMessagesRef = useRef(expandedMessages);
  expandedMessagesRef.current = expandedMessages;

  // ─── Header rendering helper (for static flush) ───

  const renderHeader = useCallback((loadedConfig: Config): React.ReactNode[] => {
    const provider = getProvider(loadedConfig.provider);
    return [
      <BigText key="logo" text="ProtoAgent" font="tiny" colors={["#09A469"]} />,
      <Text key="model" dimColor>
        Model: {provider?.name || loadedConfig.provider} / {loadedConfig.model}
        {dangerouslyAcceptAll && <Text color="red"> (auto-approve all)</Text>}
      </Text>,
      <Text key="spacer"> </Text>,
    ];
  }, [dangerouslyAcceptAll]);

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
        // Flush header + restored session messages to static output
        const headerNodes = renderHeader(loadedConfig);
        const msgNodes = renderMessageList(
          loadedSession.completionMessages,
          loadedSession.completionMessages,
          new Set(),
          0,
          false,
        );
        flushedUpToRef.current = loadedSession.completionMessages.length;
        setStaticItems([{ key: 'session-restore', nodes: [...headerNodes, ...msgNodes] }]);
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

      // Flush header + system prompt to static output
      const headerNodes = renderHeader(loadedConfig);
        const msgNodes = renderMessageList(
          initialCompletionMessages,
          initialCompletionMessages,
          new Set(),
          0,
          false,
        );
      flushedUpToRef.current = initialCompletionMessages.length;
      setStaticItems([{ key: 'init', nodes: [...headerNodes, ...msgNodes] }]);
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
    if (!stdout) return;

    const handleResize = () => {
      setInputWidthKey(stdout.columns ?? 80);
    };

    handleResize();
    stdout.on('resize', handleResize);

    return () => {
      stdout.off('resize', handleResize);
    };
  }, [stdout]);

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

      await loadRuntimeConfig();

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
          setStaticItems([]); // Clear static output
          flushedUpToRef.current = 0;
          liveStartRef.current = 0;
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
          setInputResetKey((prev) => prev + 1);
          return;
      }
    }

    setInputText('');
    setInputResetKey((prev) => prev + 1); // Force TextInput to remount and clear
    setLoading(true);
    setError(null);
    setHelpMessage(null);
    setThreadErrors([]);

    // Add user message to completion messages IMMEDIATELY for real-time UI display
    const userMessage: Message = { role: 'user', content: trimmed };
    setCompletionMessages((prev) => {
      // Lock the live-start boundary to where flushed content ends
      liveStartRef.current = flushedUpToRef.current;
      return [...prev, userMessage];
    });

    // Reset assistant message tracker
    assistantMessageRef.current = null;

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
              // Update the current assistant message in completionMessages
              if (!assistantMessageRef.current || assistantMessageRef.current.kind !== 'streaming_text') {
                // First text delta — create the assistant message immediately
                const assistantMsg = { role: 'assistant', content: event.content || '', tool_calls: [] } as Message;
                setCompletionMessages((prev) => {
                  assistantMessageRef.current = { message: assistantMsg, index: prev.length, kind: 'streaming_text' };
                  return [...prev, assistantMsg];
                });
              } else {
                // Subsequent deltas — accumulate in ref, debounce the render (~50ms)
                assistantMessageRef.current.message.content += event.content || '';
                if (!textFlushTimerRef.current) {
                  textFlushTimerRef.current = setTimeout(() => {
                    textFlushTimerRef.current = null;
                    setCompletionMessages((prev) => {
                      if (!assistantMessageRef.current) return prev;
                      const updated = [...prev];
                      updated[assistantMessageRef.current.index] = { ...assistantMessageRef.current.message };
                      return updated;
                    });
                  }, 50);
                }
              }
              break;
            case 'tool_call':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setActiveTool(toolCall.name);

                // Track the tool call in the ref WITHOUT triggering a render.
                // The render will happen when tool_result arrives.
                const existingRef = assistantMessageRef.current;
                const assistantMsg = existingRef?.message
                  ? {
                      ...existingRef.message,
                      tool_calls: [...(existingRef.message.tool_calls || [])],
                    }
                  : { role: 'assistant', content: '', tool_calls: [] as any[] };

                const nextToolCall = {
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.name, arguments: toolCall.args },
                };

                const idx = assistantMsg.tool_calls.findIndex(
                  (tc: any) => tc.id === toolCall.id
                );
                if (idx === -1) {
                  assistantMsg.tool_calls.push(nextToolCall);
                } else {
                  assistantMsg.tool_calls[idx] = nextToolCall;
                }

                if (!existingRef) {
                  // First tool call — we need to add the assistant message to state
                  setCompletionMessages((prev) => {
                    assistantMessageRef.current = {
                      message: assistantMsg,
                      index: prev.length,
                      kind: 'tool_call_assistant',
                    };
                    return [...prev, assistantMsg as Message];
                  });
                } else {
                  // Subsequent tool calls — just update the ref, no render
                  assistantMessageRef.current = {
                    ...existingRef,
                    message: assistantMsg,
                    kind: 'tool_call_assistant',
                  };
                }
              }
              break;
            case 'tool_result':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setActiveTool(null);
                if (toolCall.name === 'todo_read' || toolCall.name === 'todo_write') {
                  const currentAssistantIndex = assistantMessageRef.current?.index;
                  if (typeof currentAssistantIndex === 'number') {
                    expandLatestMessage(currentAssistantIndex);
                  }
                }
                // Flush the assistant message update + tool result in a SINGLE state update
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  // Sync assistant message (may have new tool_calls since last render)
                  if (assistantMessageRef.current) {
                    updated[assistantMessageRef.current.index] = {
                      ...assistantMessageRef.current.message,
                    };
                  }
                  // Append tool result
                  updated.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolCall.result || '',
                    name: toolCall.name,
                  } as any);
                  return updated;
                });
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
            case 'iteration_done':
              // Flush completed iteration to static output so the live area stays small.
              // This is the key optimization: previous tool call groups become static
              // and never re-render when new tool results arrive.
              setCompletionMessages((current) => {
                const unflushed = current.slice(flushedUpToRef.current);
                if (unflushed.length > 0) {
                  const nodes = renderMessageList(
                    unflushed,
                    current,
                    expandedMessagesRef.current,
                    flushedUpToRef.current,
                    false,
                  );
                  if (nodes.length > 0) {
                    setStaticItems((prev) => [...prev, { key: `iter-${Date.now()}`, nodes }]);
                  }
                }
                flushedUpToRef.current = current.length;
                liveStartRef.current = current.length;
                return current;
              });
              // Reset assistant message tracker for next iteration
              assistantMessageRef.current = null;
              break;
            case 'done':
              // Clear any pending text delta timer
              if (textFlushTimerRef.current) {
                clearTimeout(textFlushTimerRef.current);
                textFlushTimerRef.current = null;
              }
              setActiveTool(null);
              setThreadErrors((prev) => prev.filter((threadError) => !threadError.transient));
              break;
          }
        },
        {
          pricing: pricing || undefined,
          abortSignal: abortControllerRef.current.signal,
          sessionId: session?.id,
          requestDefaults,
        }
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
      // Flush only NEW messages (since last flush) to static output
      setCompletionMessages((current) => {
        const unflushed = current.slice(flushedUpToRef.current);
        if (unflushed.length > 0) {
          const nodes = renderMessageList(unflushed, current, new Set(), flushedUpToRef.current, false);
          if (nodes.length > 0) {
            setStaticItems((prev) => [...prev, { key: `turn-${Date.now()}`, nodes }]);
          }
        }
        flushedUpToRef.current = current.length;
        return current;
      });
      liveStartRef.current = Infinity; // nothing is "live" anymore
      setExpandedMessages(new Set());
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

  // Only render messages from the current live turn in the active area.
  // Memoized so spinner ticks (spinnerFrame) don't recompute the message list.
  const liveStartIndex = loading ? liveStartRef.current : completionMessages.length;
  const liveMessageNodes = useMemo(() => {
    const liveMessages = completionMessages.slice(liveStartIndex);
    return renderMessageList(liveMessages, completionMessages, expandedMessages, liveStartIndex, loading);
  }, [completionMessages, expandedMessages, liveStartIndex, loading]);

  return (
    <Box flexDirection="column" height="100%">
      {/* Static output — completed turns, written to stdout once, never re-rendered */}
      <Static items={staticItems}>
        {(item) => (
          <Box key={item.key} flexDirection="column">
            {item.nodes}
          </Box>
        )}
      </Static>

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

        {/* Live messages — only the current streaming turn, re-rendered on updates */}
       <Box flexDirection="column" flexGrow={1}>
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

      {/* Working indicator */}
      {initialized && !pendingApproval && loading && (
        <Box marginBottom={1}>
          <Text color="green" bold>
            {SPINNER_FRAMES[spinnerFrame]}{' '}
            {activeTool ? `Running ${activeTool}...` : 'Working...'}
          </Text>
        </Box>
      )}

      {/* Input */}
       {initialized && !pendingApproval && (
        <Box key={`input-shell-${inputWidthKey}`} borderStyle="round" borderColor="green" paddingX={1} flexDirection="column">
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color="green" bold>{'>'}</Text>
            </Box>
            <Box flexGrow={1} minWidth={10}>
              <TextInput
                key={`${inputResetKey}-${inputWidthKey}`}
                defaultValue={inputText}
                onChange={setInputText}
                placeholder="Type your message... (/help for commands)"
                onSubmit={handleSubmit}
              />
            </Box>
          </Box>
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

/**
Main UI component — the heart of ProtoAgent's terminal interface.

Renders the chat loop, tool call feedback, approval prompts,
and cost/usage info. All heavy logic lives in `agentic-loop.ts`;
this file is purely presentation + state wiring.

Here's how the terminal UI is laid out (showcasing all options at once for demonstration, but in practice many elements are conditional on state):
┌─────────────────────────────────────────┐
│  ProtoAgent  (BigText logo)             │  static, rendered once (printBanner)
│  Model: Anthropic / claude-3-5 | Sess.. │  static header (printRuntimeHeader)
│  Debug logs: /path/to/log               │  static, if --log-level set
├─────────────────────────────────────────┤
│                                         │
│  [System Prompt ▸ collapsed]            │  archived (memoized)
│                                         │
│  > user message                         │  archived (memoized)
│                                         │
│  assistant reply text                   │  archived (memoized)
│                                         │
│  [tool_name ▸ collapsed]                │  archived (memoized)
│                                         │
│  > user message                         │  archived (memoized)
│                                         │
├ ─ ─ ─ ─ ─ ─ ─ live boundary ─ ─ ─ ─ ─ ─ ┤
│                                         │
│  assistant streaming text...            │  live (re-renders, ~50ms debounce)
│                                         │
│  [tool_name ▸ collapsed]                │  live (re-renders on tool_result)
│                                         │
│  Thinking...                            │  live, only if last msg is user
│                                         │
│ ╭─ Approval Required ─────────────────╮ │  live, only when pending approval
│ │  description / detail               │ │
│ │  ○ Approve once                     │ │
│ │  ○ Approve for session              │ │
│ │  ○ Reject                           │ │
│ ╰─────────────────────────────────────╯ │
│                                         │
│  [Error: message]                       │  live, inline thread errors
│                                         │
├─────────────────────────────────────────┤
│  tokens: 1234↓ 56↑ | ctx: 12% | $0.02   │  static-ish, updates after each turn
├─────────────────────────────────────────┤
│  /quit  — Exit ProtoAgent               │  dynamic, shown when typing /
├─────────────────────────────────────────┤
│  ⠹ Running read_file...                 │  dynamic, shown while loading
├─────────────────────────────────────────┤
│ ╭─────────────────────────────────────╮ │
│ │ > [text input cursor              ] │ │  always visible when initialized
│ ╰─────────────────────────────────────╯ │
├─────────────────────────────────────────┤
│  Session saved. Resume with:            │  one-shot, shown on /quit
│  protoagent --session abc12345          │
└─────────────────────────────────────────┘
*/

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import { LeftBar } from './components/LeftBar.js';
import { TextInput, Select } from '@inkjs/ui';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, writeInitConfig, resolveApiKey, type Config, type InitConfigTarget, TargetSelection, ModelSelection, ApiKeyInput } from './config.js';
import { loadRuntimeConfig, getActiveRuntimeConfigPath } from './runtime-config.js';
import { getProvider, getModelPricing, getRequestDefaultParams } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';
import { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from './tools/index.js';
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
import { initializeMcp, closeMcp, getConnectedMcpServers } from './mcp.js';
import { generateSystemPrompt } from './system-prompt.js';
import { renderFormattedText } from './utils/format-message.js';

interface InlineThreadError {
  id: string;
  message: string;
  transient?: boolean;
}

// A single item rendered by <Static>. Each item is appended once and
// permanently flushed to the terminal scrollback by Ink's Static component.
interface StaticItem {
  id: string;
  node: React.ReactNode;
}

type AddStaticFn = (node: React.ReactNode) => void;

// ─── Scrollback helpers ───
// These functions append text to the permanent scrollback buffer via the
// <Static> component. Ink flushes new Static items within its own render
// cycle, so there are no timing issues with write()/log-update.



function printBanner(addStatic: AddStaticFn): void {
  addStatic(
    <Text>
      <Text color="#09A469">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀</Text>
      {'\n'}
      <Text color="#09A469">█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</Text>
      {'\n'}
    </Text>
  );
}

function printRuntimeHeader(addStatic: AddStaticFn, config: Config, session: Session | null, dangerouslySkipPermissions: boolean): void {
  const provider = getProvider(config.provider);
  let line = `Model: ${provider?.name || config.provider} / ${config.model}`;
  if (dangerouslySkipPermissions) line += ' (auto-approve all)';
  if (session) line += ` | Session: ${session.id}`;
  
  const lines: React.ReactNode[] = [<Text key="model" dimColor>{line}</Text>];
  
  const logFilePath = logger.getLogFilePath();
  if (logFilePath) {
    lines.push(<Text key="log" dimColor>Debug logs: {logFilePath}</Text>);
  }
  const configPath = getActiveRuntimeConfigPath();
  if (configPath) {
    lines.push(<Text key="config" dimColor>Config file: {configPath}</Text>);
  }
  const mcpServers = getConnectedMcpServers();
  if (mcpServers.length > 0) {
    lines.push(<Text key="mcp" dimColor>MCPs: {mcpServers.join(', ')}</Text>);
  }
  
  addStatic(
    <Text>
      {lines.map((l, i) => <React.Fragment key={i}>{l}{'\n'}</React.Fragment>)}
      {'\n'}
    </Text>
  );
}

function normalizeTranscriptText(text: string): string {
  const normalized = text.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\n');
}

function printMessageToScrollback(addStatic: AddStaticFn, role: 'user' | 'assistant', text: string): void {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) {
    addStatic(<Text>{'\n'}</Text>);
    return;
  }
  if (role === 'user') {
    addStatic(
      <Text>
        <Text color="green">{'>'}</Text> {normalized}{'\n'}
      </Text>
    );
    return;
  }
  // Apply Markdown formatting (bold, italic) to assistant messages
  addStatic(<Text>{renderFormattedText(normalized)}{'\n'}</Text>);
}

/**
 * Format a sub-agent tool call into a human-readable activity string.
 * Shows what the sub-agent is actually doing, e.g. "Sub-agent reading file package.json"
 */
function formatSubAgentActivity(tool: string, args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') {
    return `Sub-agent running ${tool}...`;
  }

  const argEntries = Object.entries(args);
  if (argEntries.length === 0) {
    return `Sub-agent running ${tool}...`;
  }

  // Extract the most meaningful argument based on the tool
  let detail = '';
  const firstValue = argEntries[0]?.[1];

  switch (tool) {
    case 'read_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'write_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'edit_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'list_directory':
      detail = typeof args.directory_path === 'string' ? args.directory_path : '(current)';
      break;
    case 'search_files':
      detail = typeof args.search_term === 'string' ? `"${args.search_term}"` : '';
      break;
    case 'bash':
      detail = typeof args.command === 'string'
        ? args.command.split(/\s+/).slice(0, 3).join(' ') + (args.command.split(/\s+/).length > 3 ? '...' : '')
        : '';
      break;
    case 'todo_write':
      detail = Array.isArray(args.todos) ? `${args.todos.length} task(s)` : '';
      break;
    case 'webfetch':
      detail = typeof args.url === 'string' ? new URL(args.url).hostname : '';
      break;
    case 'sub_agent':
      // Nested sub-agent
      detail = 'nested task...';
      break;
    default:
      // Use the first argument value as fallback
      detail = typeof firstValue === 'string'
        ? firstValue.length > 30 ? firstValue.slice(0, 30) + '...' : firstValue
        : '';
  }

  if (detail) {
    return `Sub-agent ${tool.replace(/_/g, ' ')}: ${detail}`;
  }

  return `Sub-agent running ${tool}...`;
}

function replayMessagesToScrollback(addStatic: AddStaticFn, messages: Message[]): void {  for (const message of messages) {
    const msgAny = message as any;
    if (message.role === 'system') continue;
    if (message.role === 'user' && typeof message.content === 'string') {
      printMessageToScrollback(addStatic, 'user', message.content);
      continue;
    }
    if (message.role === 'assistant' && typeof message.content === 'string' && message.content.trim().length > 0) {
      printMessageToScrollback(addStatic, 'assistant', message.content);
      continue;
    }
    if (message.role === 'tool') {
      const toolName = msgAny.name || 'tool';
      const compact = String(msgAny.content || '').replace(/\s+/g, ' ').trim().slice(0, 180);
      addStatic(<Text dimColor>{'▶ '}{toolName}{': '}{compact}{'\n'}</Text>);
    }
  }
  if (messages.length > 0) {
    addStatic(<Text>{'\n'}</Text>);
  }
}

// Returns only the last N displayable lines of text so the live streaming box
// never grows taller than the terminal, preventing Ink's clearTerminal wipe.
const STREAMING_RESERVED_ROWS = 3; // usage bar + spinner + input line
function clipToRows(text: string, terminalRows: number): string {
  const maxLines = Math.max(1, terminalRows - STREAMING_RESERVED_ROWS);
  const lines = text.split('\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(lines.length - maxLines).join('\n');
}

// ─── Props ───
export interface AppProps {
  dangerouslySkipPermissions?: boolean;
  logLevel?: string;
  sessionId?: string;
}

// ─── Available slash commands ───
const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all available commands' },
  { name: '/quit', description: 'Exit ProtoAgent' },
  { name: '/exit', description: 'Alias for /quit' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HELP_TEXT = [
  'Commands:',
  '  /help   - Show this help',
  '  /quit   - Exit ProtoAgent',
  '  /exit   - Alias for /quit',
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
    <LeftBar color="green" marginTop={1} marginBottom={1}>
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
    </LeftBar>
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
        <Box>
          <Box backgroundColor="#064e3b" paddingX={1}>
            <Text color="white">tokens: </Text>
            <Text color="white" bold>{usage.inputTokens}↓ {usage.outputTokens}↑</Text>
          </Box>
          <Box backgroundColor="#065f46" paddingX={1}>
            <Text color="white">ctx: </Text>
            <Text color="white" bold>{usage.contextPercent.toFixed(0)}%</Text>
          </Box>
        </Box>
      )}
      {totalCost > 0 && (
        <Box backgroundColor="#064e3b" paddingX={1}>
          <Text color="black">cost: </Text>
          <Text color="black" bold>${totalCost.toFixed(4)}</Text>
        </Box>
      )}
    </Box>
  );
};

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{
  onComplete: (config: Config) => void;
}> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'target' | 'provider' | 'api_key'>('target');
  const [target, setTarget] = useState<InitConfigTarget>('project');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const handleModelSelect = (providerId: string, modelId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setSetupStep('api_key');
  };

  const handleConfigComplete = (config: Config) => {
    writeInitConfig(target);
    writeConfig(config, target);
    onComplete(config);
  };

  if (setupStep === 'target') {
    return (
      <Box marginTop={1}>
        <TargetSelection
          title="First-time setup"
          subtitle="Create a ProtoAgent runtime config:"
          onSelect={(value) => {
            setTarget(value);
            setSetupStep('provider');
          }}
        />
      </Box>
    );
  }

  if (setupStep === 'provider') {
    return (
      <Box marginTop={1}>
        <ModelSelection
          setSelectedProviderId={setSelectedProviderId}
          setSelectedModelId={setSelectedModelId}
          onSelect={handleModelSelect}
          title="First-time setup"
        />
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <ApiKeyInput
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        target={target}
        title="First-time setup"
        showProviderHeaders={false}
        onComplete={handleConfigComplete}
      />
    </Box>
  );
};

// ─── Main App ───
export const App: React.FC<AppProps> = ({
  dangerouslySkipPermissions = false,
  logLevel,
  sessionId,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;

  // ─── Static scrollback state ───
  // Each item appended here is rendered once by <Static> and permanently
  // flushed to the terminal scrollback by Ink, within its own render cycle.
  // Using <Static> items is important to avoid re-rendering issues, which hijack
  // scrollback and copying when new AI message streams are coming in.
  //
  // staticCounterRef keeps ID generation local to this component instance,
  // making it immune to Strict Mode double-invoke, HMR counter drift, and
  // collisions if multiple App instances ever coexist.
  const staticCounterRef = useRef(0);
  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);
  const addStatic = useCallback((node: React.ReactNode) => {
    staticCounterRef.current += 1;
    const id = `s${staticCounterRef.current}`;
    setStaticItems((prev) => [...prev, { id, node }]);
  }, []);

  // Core state
  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  // isStreaming: true while the assistant is producing tokens.
  // streamingText: the live in-progress token buffer shown in the dynamic Ink
  // frame while the response streams. Cleared to '' at done and flushed to
  // <Static> as a permanent scrollback item. Keeping it in React state (not a
  // ref) is safe because the Ink frame height does NOT change as tokens arrive —
  // the streaming box is always 1+ lines tall while loading=true.
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpMessage, setHelpMessage] = useState<string | null>(null);
  const [threadErrors, setThreadErrors] = useState<InlineThreadError[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Input reset key — incremented on submit to force TextInput remount and clear
  const [inputResetKey, setInputResetKey] = useState(0);

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
  const assistantMessageRef = useRef<{
    message: any;
    index: number;
    kind: 'streaming_text' | 'tool_call_assistant';
  } | null>(null);

  // Abort controller for cancelling the current completion
  const abortControllerRef = useRef<AbortController | null>(null);

  // Buffer for streaming text that accumulates content and flushes complete lines to static
  // This prevents the live streaming area from growing unbounded - complete lines are
  // immediately flushed to <Static>, only the incomplete final line stays in the dynamic frame
  const streamingBufferRef = useRef<{ unflushedContent: string; hasFlushedAnyLine: boolean }>({
    unflushedContent: '',
    hasFlushedAnyLine: false,
  });

  const didPrintIntroRef = useRef(false);
  const printedThreadErrorIdsRef = useRef<Set<string>>(new Set());

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
        if (!didPrintIntroRef.current) {
          printBanner(addStatic);
          printRuntimeHeader(addStatic, loadedConfig, loadedSession, dangerouslySkipPermissions);
          replayMessagesToScrollback(addStatic, loadedSession.completionMessages);
          didPrintIntroRef.current = true;
        }
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
      if (!didPrintIntroRef.current) {
        printBanner(addStatic);
        printRuntimeHeader(addStatic, loadedConfig, newSession, dangerouslySkipPermissions);
        didPrintIntroRef.current = true;
      }
    }

    setNeedsSetup(false);
    setInitialized(true);
  }, [dangerouslySkipPermissions, sessionId, addStatic]);

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
    if (error) {
      addStatic(<Text color="red">Error: {error}</Text>);
    }
  }, [error, addStatic]);



  useEffect(() => {
    for (const threadError of threadErrors) {
      if (threadError.transient || printedThreadErrorIdsRef.current.has(threadError.id)) {
        continue;
      }
      printedThreadErrorIdsRef.current.add(threadError.id);
      addStatic(<Text color="red">Error: {threadError.message}</Text>);
    }
  }, [threadErrors, addStatic]);

  useEffect(() => {
    const init = async () => {
      // Set log level and initialize log file
      if (logLevel) {
        const level = LogLevel[logLevel.toUpperCase() as keyof typeof LogLevel];
        if (level !== undefined) {
          setLogLevel(level);
          initLogFile();

          logger.info(`ProtoAgent started with log level: ${logLevel}`);
          logger.info(`Log file: ${logger.getLogFilePath()}`);
        }
      }

      // Set global approval mode
      if (dangerouslySkipPermissions) {
        setDangerouslySkipPermissions(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      await loadRuntimeConfig();

      const loadedConfig = readConfig('active');
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
      case '/expand':
      case '/collapse':
        // expand/collapse removed — transcript lives in scrollback
        return true;
       case '/help':
        setHelpMessage(HELP_TEXT);
        return true;
      default:
        return false;
    }
  }, [config, exit, session, completionMessages]);

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
    setIsStreaming(false);
    setStreamingText('');
    setError(null);
    setHelpMessage(null);
    setThreadErrors([]);

    // Reset turn tracking and streaming buffer
    assistantMessageRef.current = null;
    streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };

    // Print the user message directly to scrollback so it is selectable/copyable.
    // We still push it into completionMessages for session saving.
    const userMessage: Message = { role: 'user', content: trimmed };
    printMessageToScrollback(addStatic, 'user', trimmed);
    setCompletionMessages((prev) => [...prev, userMessage]);

    // Reset assistant message tracker (streamed indices were reset above)
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
            case 'text_delta': {
              const deltaText = event.content || '';

              // First text delta of this turn: initialize ref, show streaming indicator.
              if (!assistantMessageRef.current || assistantMessageRef.current.kind !== 'streaming_text') {
                // Trim leading whitespace from first delta - LLMs often output leading \n or spaces
                const trimmedDelta = deltaText.replace(/^\s+/, '');
                const assistantMsg = { role: 'assistant', content: trimmedDelta, tool_calls: [] } as Message;
                const idx = completionMessages.length + 1;
                assistantMessageRef.current = { message: assistantMsg, index: idx, kind: 'streaming_text' };
                setIsStreaming(true);
                setCompletionMessages((prev) => [...prev, assistantMsg]);

                // Initialize the streaming buffer and process the first chunk
                // through the same split logic as subsequent deltas for consistency
                const buffer = { unflushedContent: trimmedDelta, hasFlushedAnyLine: false };
                streamingBufferRef.current = buffer;

                // Process the first chunk: split on newlines and flush complete lines
                const lines = buffer.unflushedContent.split('\n');
                if (lines.length > 1) {
                  const completeLines = lines.slice(0, -1);
                  const textToFlush = completeLines.join('\n');
                  if (textToFlush) {
                    addStatic(renderFormattedText(textToFlush));
                    buffer.hasFlushedAnyLine = true;
                  }
                  buffer.unflushedContent = lines[lines.length - 1];
                }

                setStreamingText(buffer.unflushedContent);
              } else {
                // Subsequent deltas — append to ref and buffer, then flush complete lines
                assistantMessageRef.current.message.content += deltaText;

                // Accumulate in buffer and flush complete lines to static
                const buffer = streamingBufferRef.current;
                buffer.unflushedContent += deltaText;

                // Split on newlines to find complete lines
                const lines = buffer.unflushedContent.split('\n');

                // If we have more than 1 element, there were newlines
                if (lines.length > 1) {
                  // All lines except the last one are complete (ended with \n)
                  const completeLines = lines.slice(0, -1);

                  // Build the text to flush - each complete line gets a newline added back
                  const textToFlush = completeLines.join('\n');

                  if (textToFlush) {
                    addStatic(renderFormattedText(textToFlush));
                    buffer.hasFlushedAnyLine = true;
                  }

                  // Keep only the last (incomplete) line in the buffer
                  buffer.unflushedContent = lines[lines.length - 1];
                }

                // Show the incomplete line (if any) in the dynamic frame
                setStreamingText(buffer.unflushedContent);
              }
              break;
            }
            case 'sub_agent_iteration':
              if (event.subAgentTool) {
                const { tool, status, args } = event.subAgentTool;
                if (status === 'running') {
                  setActiveTool(formatSubAgentActivity(tool, args));
                } else {
                  setActiveTool(null);
                }
              }
              // Handle sub-agent usage update
              if (event.subAgentUsage) {
                setTotalCost((prev) => prev + event.subAgentUsage!.cost);
              }
              break;
            case 'tool_call':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setActiveTool(toolCall.name);

                // If the model streamed some text before invoking this tool,
                // flush any remaining unflushed content to <Static> now.
                // The streaming buffer contains text that hasn't been flushed yet
                // (the incomplete final line). We need to flush it before the tool call.
                if (assistantMessageRef.current?.kind === 'streaming_text') {
                  const buffer = streamingBufferRef.current;

                  // Flush any remaining unflushed content
                  if (buffer.unflushedContent) {
                    addStatic(renderFormattedText(buffer.unflushedContent));
                  }

                  // Add spacing after the streamed text and before the tool call
                  addStatic(renderFormattedText('\n'));

                  // Reset streaming state and buffer
                  streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
                  setIsStreaming(false);
                  setStreamingText('');
                  assistantMessageRef.current = null;
                }

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

                // Write the tool summary immediately — at this point loading is
                // still true but the frame height is stable (spinner + input box).
                // The next state change (setActiveTool(null)) doesn't affect
                // frame height so write() restores the correct frame.
                const compactResult = (toolCall.result || '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 180);
                addStatic(<Text dimColor>{'▶ '}{toolCall.name}{': '}{compactResult}{'\n'}</Text>);

                // Flush the assistant message + tool result into completionMessages
                // for session saving.
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  // Sync assistant message
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
              if (assistantMessageRef.current?.kind === 'tool_call_assistant') {
                assistantMessageRef.current = null;
              }
              break;
            case 'done':
              if (assistantMessageRef.current?.kind === 'streaming_text') {
                const finalRef = assistantMessageRef.current;
                const buffer = streamingBufferRef.current;

                // Flush any remaining unflushed content from the buffer
                // This is the final incomplete line that was being displayed live
                if (buffer.unflushedContent) {
                  // If we've already flushed some lines, just append the remainder
                  // Otherwise, normalize and flush the full content
                  if (buffer.hasFlushedAnyLine) {
                    addStatic(renderFormattedText(buffer.unflushedContent));
                  } else {
                    // Nothing was flushed yet, normalize the full content
                    const normalized = normalizeTranscriptText(finalRef.message.content || '');
                    if (normalized) {
                      addStatic(renderFormattedText(normalized));
                    }
                  }
                }

                // Add final spacing after the streamed text
                // Always add one newline - the user message adds another for blank line separation
                if (buffer.unflushedContent) {
                  addStatic(renderFormattedText('\n'));
                }

                // Clear streaming state and buffer
                setIsStreaming(false);
                setStreamingText('');
                streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  updated[finalRef.index] = { ...finalRef.message };
                  return updated;
                });
                assistantMessageRef.current = null;
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
      setLoading(false);
    }
  }, [loading, config, completionMessages, session, handleSlashCommand, addStatic]);

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

  return (
    <Box flexDirection="column">
      {/* Permanent scrollback — Ink flushes new items once within its render cycle */}
      <Static items={staticItems}>
        {(item) => (
          <Text key={item.id}>{item.node}</Text>
        )}
      </Static>

      {helpMessage && (
        <LeftBar color="green" marginTop={1} marginBottom={1}>
          <Text>{helpMessage}</Text>
        </LeftBar>
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

      {isStreaming && (
        <Text wrap="wrap">{renderFormattedText(clipToRows(streamingText, terminalRows))}<Text dimColor>▍</Text></Text>
      )}

      {threadErrors.filter((threadError) => threadError.transient).map((threadError) => (
        <LeftBar key={`thread-error-${threadError.id}`} color="gray" marginBottom={1}>
          <Text color="gray">{threadError.message}</Text>
        </LeftBar>
      ))}

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

      {/* Working indicator */}
      {initialized && !pendingApproval && loading && !isStreaming && (
        <Box>
          <Text color="green" bold>
            {SPINNER_FRAMES[spinnerFrame]}{' '}
            {activeTool ? `Running ${activeTool}...` : 'Working...'}
          </Text>
        </Box>
      )}

      {/* Command filter */}
      {initialized && !pendingApproval && inputText.startsWith('/') && (
        <CommandFilter inputText={inputText} />
      )}

      {/* Usage bar */}
      <UsageDisplay usage={lastUsage ?? null} totalCost={totalCost} />

      {/* Input */}
      {initialized && !pendingApproval && (
        <Box>
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color="green" bold>{'>'}</Text>
            </Box>
            <Box flexGrow={1} minWidth={10}>
              <TextInput
                key={inputResetKey}
                defaultValue={inputText}
                onChange={setInputText}
                placeholder="Type your message... (/help for commands)"
                onSubmit={handleSubmit}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Resume session command */}
      {quittingSession && (
        <Box flexDirection="column" marginTop={1} paddingX={1} marginBottom={1}>
          <Text dimColor>Session saved. Resume with:</Text>
          <Text color="green">protoagent --session {quittingSession.id}</Text>
        </Box>
      )}
    </Box>
  );
};

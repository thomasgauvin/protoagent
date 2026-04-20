/**
 * App.ts — ProtoAgent OpenTUI application.
 *
 * Creates and wires up:
 *  - Header / status bar
 *  - MessageHistory (left, scrollable)
 *  - Workflow views (Queue, Cron) - full screen, cycled via Tab
 *  - InputBar (bottom)
 *  - Approval prompt (overlay text when a tool needs approval)
 *
 * Layout:
 * Tab cycles through three views:
 * ┌────────────────────────────────────────┐  BOT VIEW (chat)
 * │  Chat History                          │
 * ├────────────────────────────────────────┤
 * │ ⠙ Thinking…                            │  status row
 * │ ┌──────────────────────────────────┐   │  input bar
 * │ │ > [type here]                    │   │
 * │ └──────────────────────────────────┘   │
 * └────────────────────────────────────────┘
 *
 * ┌────────────────────────────────────────┐  QUEUE VIEW
 * │  Queue Workflow                        │
 * │  ┌─┐ ┌─┐ ┌─┐                          │
 * │  │A│→│B│→│C│                          │
 * │  └─┘ └─┘ └─┘                          │
 * │                                        │
 * │  Queued Messages:                      │
 * │  → Task 1                              │
 * │  → Task 2                              │
 * └────────────────────────────────────────┘
 *
 * ┌────────────────────────────────────────┐  CRON VIEW
 * │  Cron Workflow                         │
 * │  ┌──────┐                              │
 * │  │ ⏰   │                              │
 * │  └──┬───┘                              │
 * │     ↓                                  │
 * │  Next run: 30s                         │
 * │  Prompt: "Check status"                │
 * └────────────────────────────────────────┘
 */

import { type CliRenderer, BoxRenderable, TextRenderable, t, fg, bold, StyledText, CliRenderEvents } from '@opentui/core'
import { parseInputWithImages } from '../utils/image-utils.js'
import { OpenAI } from 'openai'
import { spawnSync } from 'node:child_process'
import { readConfig, resolveApiKey, type Config } from '../config-core.js'
import { loadRuntimeConfig } from '../runtime-config.js'
import { getProvider, getModelPricing, getRequestDefaultParams } from '../providers.js'
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from '../agentic-loop.js'
import { setApprovalHandler } from '../tools/index.js'
import { setDangerouslySkipPermissions } from '../utils/approval-state.js'
import type { ApprovalRequest, ApprovalResponse } from '../utils/approval.js'
import { setLogLevel, LogLevel, initLogFile, logger } from '../utils/logger.js'
import {
  createSession,
  ensureSystemPromptAtTop,
  saveSession,
  loadSession,
  generateTitle,
  generateTitleWithLLM,
  listSessions,
  countSessions,
  searchSessions,
  type Session,
} from '../sessions.js'
import {
  clearTodos,
  getTodosForSession,
  setTodosForSession,
} from '../tools/todo.js'
import { initializeMcp, closeMcp, reconnectAllMcp, getMcpConnectionStatus } from '../mcp.js'
import { generateSystemPrompt } from '../system-prompt.js'
import { formatSubAgentActivity, formatToolActivity } from '../utils/tool-display.js'
import {
  interjectMessage,
  enqueueMessage,
  getNextQueued,
  clearMessageQueue,
  peekPendingMessages,
  removeMessage,
  loadQueueFromSession,
  getQueueForSession,
  hasQueuedMessages,
  type QueuedMessage,
} from '../message-queue.js'
import { ToolRegistry } from '../tools/registry.js'
import { McpManager } from '../mcp/manager.js'
import { ApprovalManager } from '../utils/approval-manager.js'
import { runSdkTurn } from './sdk-run-turn.js'

import { MessageHistory } from './MessageHistory.js'
import { InputBar, type SubmitMode } from './InputBar.js'
import { StatusBar, type McpServerStatus } from './StatusBar.js'
import { WelcomeScreen } from './WelcomeScreen.js'
import { RightSidebar } from './RightSidebar.js'
import { LoopSetupDialog, type LoopSetupConfig } from './LoopSetupDialog.js'
import {
  WorkflowManager,
  LoopWorkflow,
  CronWorkflow,
  type WorkflowType,
  type WorkflowState,
  getNextWorkflowType,
  WORKFLOW_METADATA,
  formatDuration,
  getCompactDiagram,
} from '../workflow/index.js'

// ─── Slash commands ───
const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all available commands' },
  { name: '/new', description: 'Create a new tab' },
  { name: '/manager', description: 'Open (or switch to) the Manager Agent tab' },
  { name: '/session', description: 'List, search, and open previous sessions' },
  { name: '/pop', description: 'Pop next queued message' },
  { name: '/clear', description: 'Clear the queue' },
  { name: '/q', description: 'Queue a message to run after current task' },
  { name: '/rename', description: 'Rename the current tab' },
  { name: '/fork', description: 'Fork this chat into a new tab with the same history' },
  { name: '/reconnect', description: 'Reconnect all MCP servers' },
  { name: '/loop', description: 'Setup and run a loop workflow' },
  { name: '/pin', description: 'Pin the current tab to keep it at the top' },
  { name: '/unpin', description: 'Unpin the current tab' },
  { name: '/quit', description: 'Exit ProtoAgent' },
  { name: '/exit', description: 'Alias for /quit' },
]

const HELP_TEXT = [
  'Commands:',
  ...SLASH_COMMANDS.map((cmd) => `  ${cmd.name} — ${cmd.description}`),
  '',
  'Session management:',
  '  /session                    List saved sessions (first 10)',
  '  /session list --page <n>    List page n of sessions',
  '  /session open <id>          Open a session in a new tab',
  '  /session search <query>     Search sessions by title or message content',
  '',
  'Workflow commands:',
  '  /loop                       Setup and run a loop workflow',
  '',
  'Tab management:',
  '  /pin                        Pin the current tab to keep it at the top',
  '  /unpin                      Unpin the current tab',
  '',
  'Message suffix:',
  '  message /q    Queue this message (runs after current completes)',
  '  message /new  Send this message in a new agent (new tab)',
  '',
  'Keyboard shortcuts:',
  '  Enter           Send message',
  '  Tab             Cycle workflow: Bot → Queue → Loop → Cron → Bot',
  '  Esc             Abort running agent task',
  '  Ctrl+C          Save tabs and exit',
  '  Ctrl+L          Toggle light/dark theme',
  '',
  'Approval prompt shortcuts:',
  '  y               Approve once',
  '  s               Approve for entire session',
  '  n               Reject',
].join('\n')

export interface AppOptions {
  dangerouslySkipPermissions?: boolean
  logLevel?: string
  sessionId?: string
  // Optional per-tab managers for multi-tab support (Phase 2+)
  toolRegistry?: ToolRegistry
  mcpManager?: McpManager
  approvalManager?: ApprovalManager
  // Optional per-tab SDK runtime facade. When provided, the tab can route
  // session-level reads and other SDK-backed operations through this client
  // instead of importing storage modules directly. Does not affect the hot
  // streaming path yet.
  tabRuntime?: import('./tab-runtime.js').TabRuntime
  // Optional container for multi-tab mode (if omitted, uses renderer.root)
  container?: BoxRenderable
  // Optional initial message to send when the tab starts (for /new suffix)
  initialMessage?: string
  // Optional callback to check if this tab is active (for multi-tab input handling)
  isActiveTab?: () => boolean
  // Optional callback to update tab title
  onTitleUpdate?: (title: string) => void
  // Optional callback fired when loading state changes (for tab spinner in sidebar)
  onLoadingChange?: (loading: boolean) => void
  // Optional callback fired when approval state changes (for tab indicator)
  onApprovalChange?: (approvalPending: boolean) => void
  // Optional callback to update session info in sidebar
  onSessionInfo?: (provider: string, model: string, sessionId: string) => void
  // Optional callback to fork current session into a new tab
  onFork?: (sessionId: string, title?: string) => Promise<void>
  // Optional callback to create a new empty tab (optionally with initial message)
  onNewTab?: (initialMessage?: string) => Promise<void>
  // Optional callback to open (or focus) the Manager tab. Used by /manager.
  onOpenManager?: () => Promise<void>
  // Optional callback to save all tabs and exit (for /quit command)
  onSaveAndExit?: () => Promise<void>
  // Registration hook: called with a fn that scrolls to bottom; TabApp stores it and calls when tab becomes visible
  registerScrollToBottom?: (fn: () => void) => void
  // Registration hook: called with a fn that focuses input; TabApp stores it and calls when tab becomes active
  registerFocusInput?: (fn: () => void) => void
  // Registration hook: called with the abort controller when agentic loop starts; allows TabApp to cancel on tab close
  registerAbortController?: (abortController: AbortController) => void
  // Registration hook: called with cleanup callback for UI resources; called when tab closes
  registerCleanupCallback?: (callback: () => void) => void
  // Optional callback for pinning/unpinning the current tab
  onPinTab?: (pin: boolean) => void
  // Optional callback fired when MCP servers are initialized/updated
  onMcpReady?: () => void
  // Registration hook: called with a fn that ensures main view is shown; TabApp stores it and calls when tab becomes visible (for restored tabs)
  registerEnsureMainView?: (fn: () => void) => void
  // Optional extra text appended to the system prompt. Used by the Manager
  // tab to inject role-specific guidance without forking App.ts.
  systemPromptExtra?: string
  // Optional default title for new tabs (Manager uses "★ Manager")
  defaultTitle?: string
}

// ─── Build OpenAI client ───
function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider)
  const apiKey = resolveApiKey(config)
  if (!apiKey) {
    const providerName = provider?.name || config.provider
    const envVar = provider?.apiKeyEnvVar
    throw new Error(
      envVar
        ? `Missing API key for ${providerName}. Set it in config or export ${envVar}.`
        : `Missing API key for ${providerName}.`,
    )
  }
  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey }
  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim()
  const baseURL = baseURLOverride || provider?.baseURL
  if (baseURL) clientOptions.baseURL = baseURL
  const rawHeaders = process.env.PROTOAGENT_CUSTOM_HEADERS?.trim()
  if (rawHeaders) {
    const defaultHeaders: Record<string, string> = {}
    for (const line of rawHeaders.split('\n')) {
      const sep = line.indexOf(': ')
      if (sep === -1) continue
      const k = line.slice(0, sep).trim()
      const v = line.slice(sep + 2).trim()
      if (k && v) defaultHeaders[k] = v
    }
    if (Object.keys(defaultHeaders).length > 0) clientOptions.defaultHeaders = defaultHeaders
  } else if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers
  }
  return new OpenAI(clientOptions)
}

import { COLORS, DARK_COLORS, LIGHT_COLORS, getThemeMode } from './theme.js'

export async function createApp(renderer: CliRenderer, options: AppOptions): Promise<void> {
  logger.debug(`createApp started, sessionId=${options.sessionId || 'none'}`)
  
  // ─── Per-tab managers (inject or use defaults) ───
  // These allow each tab to have isolated tool registries, MCP connections, and approval handling
  const toolRegistry = options.toolRegistry ?? new ToolRegistry()
  const mcpManager = options.mcpManager ?? new McpManager(toolRegistry)
  const approvalManager = options.approvalManager ?? new ApprovalManager()

  // ─── Root container (for multi-tab support) ───
  // If a container is provided (multi-tab mode), use it; otherwise use renderer.root
  const rootContainer = options.container ?? renderer.root

  // ─── State ───
  let config: Config | null = null
  let client: OpenAI | null = null
  let session: Session | null = null
  let completionMessages: Message[] = []
  let isLoading = false
  let isStreaming = false
  let streamingText = ''
  let streamingThinking = ''
  let activeTool: string | null = null
  let totalCost = 0
  let lastUsage: AgentEvent['usage'] | null = null
  let abortController: AbortController | null = null
  let processingQueue = false
  const pendingInterjects: QueuedMessage[] = []
  let queuedCount = 0
  // Sidebar is display-only, no focus state needed
  let pendingApproval: { request: ApprovalRequest; resolve: (r: ApprovalResponse) => void } | null = null
  let inWelcomeView = true
  // Track assistant message with tool calls (built incrementally as tool_call events arrive)
  let assistantWithToolsMsg: any = null
  // Track if streaming text has been flushed into messages (to prevent double-adding on done event)
  let streamingTextFlushed = false
  // Track if we should trim leading whitespace from the next text chunk
  // (first chunk after user message, tool call, or new response start)
  let shouldTrimNextChunk = false
  // Save input buffer content when approval hijacks the input
  let savedInputBuffer = ''
  // Workflow management
  let workflowManager: WorkflowManager | null = null

  // ─── Root layout ───
  // Use theme-aware background color
  const bgColor = getThemeMode() === 'dark' ? DARK_COLORS.bg : LIGHT_COLORS.bg
  renderer.setBackgroundColor(bgColor)

  const rootBox = new BoxRenderable(renderer, {
    id: 'root',
    flexDirection: 'column',
    flexGrow: 1,
    maxHeight: '100%',
    maxWidth: '100%',
    backgroundColor: bgColor,
  })
  rootContainer.add(rootBox)

  // ─── Welcome screen ───
  const welcomeScreen = new WelcomeScreen(renderer, (value) => {
    // First message — transition to main view then submit
    transitionToMainView()
    handleSubmit(value, 'send')
  }, { commands: SLASH_COMMANDS })
  rootBox.add(welcomeScreen.root)

  // ─── Main view (hidden until first message) ───
  const mainView = new BoxRenderable(renderer, {
    id: 'main-view',
    flexDirection: 'column',
    flexGrow: 1,
    maxHeight: '100%',
  })
  // Not added yet — added when transitioning

  // ─── Status bar ───
  const statusBar = new StatusBar(renderer)

  // Helper: set loading on statusBar AND notify the tab sidebar spinner
  function setLoading(loading: boolean, activeTool: string | null = null): void {
    statusBar.setLoading(loading, activeTool)
    options.onLoadingChange?.(loading)
  }

  // ─── View state management ───
  type ViewType = 'bot' | 'queue' | 'cron' | 'loop'
  let currentView: ViewType = 'bot'
  const viewContainers: Map<ViewType, BoxRenderable> = new Map()

  // ─── BOT VIEW: Chat interface with right sidebar ───
  const botView = new BoxRenderable(renderer, {
    id: 'bot-view',
    flexDirection: 'row', // Horizontal: chat left, sidebar right
    flexGrow: 1,
    overflow: 'hidden',
  })
  viewContainers.set('bot', botView)

  // ─── Chat area (left side of bot view) ───
  const chatArea = new BoxRenderable(renderer, {
    id: 'chat-area',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden',
  })
  botView.add(chatArea)

  // ─── Right sidebar (Workflow + TODOs + Queue) ───
  const rightSidebar = new RightSidebar(renderer, {
    onAdd: (content: string) => {
      if (session) {
        const { addTodo } = require('../tools/todo.js')
        addTodo(content, session.id)
        rightSidebar.setTodos(getTodosForSession(session.id))
      }
    },
    onDelete: (id: string) => {
      if (session) {
        const { deleteTodo } = require('../tools/todo.js')
        deleteTodo(id, session.id)
        rightSidebar.setTodos(getTodosForSession(session.id))
      }
    },
    onUpdate: (id: string, updates) => {
      if (session) {
        const { updateTodo } = require('../tools/todo.js')
        updateTodo(id, updates, session.id)
        rightSidebar.setTodos(getTodosForSession(session.id))
      }
    },
  })
  botView.add(rightSidebar.root)

  // ─── QUEUE VIEW: Workflow visualization ───
  const queueView = new BoxRenderable(renderer, {
    id: 'queue-view',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden',
  })
  viewContainers.set('queue', queueView)

  // ─── CRON VIEW: Cron workflow visualization ───
  const cronView = new BoxRenderable(renderer, {
    id: 'cron-view',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden',
  })
  viewContainers.set('cron', cronView)

  // ─── LOOP VIEW: Loop workflow visualization ───
  const loopView = new BoxRenderable(renderer, {
    id: 'loop-view',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden',
  })
  viewContainers.set('loop', loopView)

  // Add all views to mainView (only one visible at a time).
  //
  // Important: set initial visibility explicitly. The default is visible=true,
  // and if we left all four views on, they'd stack inside mainView — that's
  // exactly the "workflow diagrams stacked below the chat" regression we
  // were seeing. `switchView` below only toggles `.visible` on transitions,
  // so without this seed the non-bot views render until the user Tab-cycles.
  mainView.add(botView)
  ;(botView as any).visible = true
  mainView.add(queueView)
  ;(queueView as any).visible = false
  mainView.add(cronView)
  ;(cronView as any).visible = false
  mainView.add(loopView)
  ;(loopView as any).visible = false

  // ─── MessageHistory (fills chat area vertically) ───
  const msgHistory = new MessageHistory({
    renderer,
    onMouseDown: () => inputBar.focus(),
  })
  chatArea.add(msgHistory.root)

  // Register scroll-to-bottom and input focus for tab activation (called by TabApp when switching back to this tab)
  // scrollToBottom is called immediately to prevent visible scroll jump
  options.registerScrollToBottom?.(() => msgHistory.scrollToBottom())
  // focusInput is deferred to ensure render has completed before focusing
  options.registerFocusInput?.(() => inputBar.focus())
  // Register ensureMainView callback so TabApp can ensure the main view is shown when tab becomes visible
  // Only transition if there are actual messages to show (not for brand new tabs)
  options.registerEnsureMainView?.(() => {
    // Only transition to main view if we're in welcome view AND there are messages to display
    // completionMessages always has at least the system prompt, so check for > 1
    if (inWelcomeView && completionMessages.length > 1) {
      transitionToMainView()
    }
  })

  // ─── Status row (spinner/activity) ───
  chatArea.add(statusBar.statusRoot)

  // Clicking the status rows also refocuses input
  statusBar.statusRoot.onMouseDown = () => { inputBar.focus() }

  // ─── View switching function ───
  function switchView(view: ViewType): void {
    if (view === currentView) return

    // Hide all other views, show only the selected one.
    //
    // Previous implementation tried `container.style = { display: 'none' }`,
    // but opentui's BoxRenderable has no `display` CSS-like field; the
    // assignment was silently dropped and every view stayed rendered at
    // once, stacking the Queue/Cron/Loop workflow diagrams underneath the
    // chat view. Renderable exposes a real `.visible` boolean — use that.
    for (const [type, container] of viewContainers) {
      ;(container as any).visible = type === view
    }

    currentView = view

    // Update status bar with current view
    statusBar.setViewIndicator(view)

    // Refresh view content
    if (view === 'queue') {
      updateQueueView()
    } else if (view === 'cron') {
      updateCronView()
    } else if (view === 'loop') {
      updateLoopView()
    }

    renderer.requestRender()
    logger.debug(`Switched to view: ${view}`)
  }

  // ─── Build Queue View Content ───
  const queueViewHeader = new TextRenderable(renderer, {
    id: 'queue-view-header',
    content: t`${bold('Queue Workflow')}`,
  })
  const queueHeaderBox = new BoxRenderable(renderer, {
    id: 'queue-header-box',
    paddingTop: 1,
    paddingLeft: 2,
    paddingBottom: 1,
    flexShrink: 0,
  })
  queueHeaderBox.add(queueViewHeader)
  queueView.add(queueHeaderBox)

  const queueDiagramText = new TextRenderable(renderer, {
    id: 'queue-diagram-text',
    content: t``, // Will be set by updateQueueView
  })
  const queueDiagramBox = new BoxRenderable(renderer, {
    id: 'queue-diagram-box',
    paddingLeft: 2,
    paddingBottom: 2,
    flexShrink: 0,
  })
  queueDiagramBox.add(queueDiagramText)
  queueView.add(queueDiagramBox)

  const queueListHeader = new TextRenderable(renderer, {
    id: 'queue-list-header',
    content: t`${bold('Queued Messages:')}`,
  })
  const queueListHeaderBox = new BoxRenderable(renderer, {
    id: 'queue-list-header-box',
    paddingLeft: 2,
    paddingBottom: 1,
    flexShrink: 0,
  })
  queueListHeaderBox.add(queueListHeader)
  queueView.add(queueListHeaderBox)

  const queueListContent = new TextRenderable(renderer, {
    id: 'queue-list-content',
    content: t``, // Will be set by updateQueueView
  })
  const queueListBox = new BoxRenderable(renderer, {
    id: 'queue-list-box',
    paddingLeft: 2,
    flexGrow: 1,
  })
  queueListBox.add(queueListContent)
  queueView.add(queueListBox)

  // ─── Build Cron View Content ───
  const cronViewHeader = new TextRenderable(renderer, {
    id: 'cron-view-header',
    content: t`${bold('Cron Workflow')}`,
  })
  const cronHeaderBox = new BoxRenderable(renderer, {
    id: 'cron-header-box',
    paddingTop: 1,
    paddingLeft: 2,
    paddingBottom: 1,
    flexShrink: 0,
  })
  cronHeaderBox.add(cronViewHeader)
  cronView.add(cronHeaderBox)

  const cronDiagramText = new TextRenderable(renderer, {
    id: 'cron-diagram-text',
    content: t``, // Will be set by updateCronView
  })
  const cronDiagramBox = new BoxRenderable(renderer, {
    id: 'cron-diagram-box',
    paddingLeft: 2,
    paddingBottom: 2,
    flexShrink: 0,
  })
  cronDiagramBox.add(cronDiagramText)
  cronView.add(cronDiagramBox)

  const cronInfoText = new TextRenderable(renderer, {
    id: 'cron-info-text',
    content: t``, // Will be set by updateCronView
  })
  const cronInfoBox = new BoxRenderable(renderer, {
    id: 'cron-info-box',
    paddingLeft: 2,
    flexGrow: 1,
  })
  cronInfoBox.add(cronInfoText)
  cronView.add(cronInfoBox)

  // ─── Update Queue View ───
  function updateQueueView(): void {
    const diagram = getCompactDiagram('queue')
    queueDiagramText.content = t`${diagram.lines.join('\n')}`

    const allQueued = session?.id ? getQueueForSession(session.id) : []
    const queued = allQueued.filter(m => m.type === 'queued')

    if (queued.length === 0 && pendingInterjects.length === 0) {
      queueListContent.content = t`${fg(COLORS.dim)('No queued messages')}`
    } else {
      const lines: string[] = []

      // Show interjects first
      for (const msg of pendingInterjects) {
        const contentText = typeof msg.content === 'string' ? msg.content : '[complex content]'
        const label = contentText.length > 50 ? contentText.slice(0, 47) + '...' : contentText
        lines.push(`${fg(COLORS.red)('!!')} ${fg(COLORS.yellow)(label)}`)
      }

      // Then queued messages
      for (const msg of queued) {
        const contentText = typeof msg.content === 'string' ? msg.content : '[complex content]'
        const label = contentText.length > 50 ? contentText.slice(0, 47) + '...' : contentText
        lines.push(`${fg(COLORS.blue)('→')} ${label}`)
      }

      queueListContent.content = t`${lines.join('\n')}`
    }

    // Update right sidebar queue
    rightSidebar.setQueue(queued, pendingInterjects)
  }

  // ─── Update Cron View ───
  function updateCronView(): void {
    const diagram = getCompactDiagram('cron')
    cronDiagramText.content = t`${diagram.lines.join('\n')}`

    if (!workflowManager) {
      cronInfoText.content = t`${fg(COLORS.dim)('Cron workflow not initialized')}`
      return
    }

    const cronState = workflowManager.getCronState()
    if (!cronState || !cronState.isConfigured) {
      cronInfoText.content = t`${fg(COLORS.dim)('No cron schedule configured')}\n\nUse the set_cron_schedule tool to configure.'`
      return
    }

    const lines: string[] = []
    lines.push(`${fg(COLORS.primary)('Schedule:')} ${cronState.schedule}`)

    const promptStr = cronState.prompt || 'Not set'
    const truncatedPrompt = promptStr.length > 60 ? promptStr.slice(0, 57) + '...' : promptStr
    lines.push(`${fg(COLORS.primary)('Prompt:')} ${truncatedPrompt}`)

    if (cronState.timeUntilNextMs !== undefined && cronState.timeUntilNextMs > 0) {
      lines.push(`\n${fg(COLORS.yellow)('Next run:')} ${formatDuration(cronState.timeUntilNextMs)}`)
    } else if (cronState.timeUntilNextMs !== undefined && cronState.timeUntilNextMs <= 0) {
      lines.push(`\n${fg(COLORS.green)('Next run: Ready!')}`)
    }

    if (cronState.lastRunAt) {
      const lastRun = new Date(cronState.lastRunAt)
      lines.push(`${fg(COLORS.dim)(`Last run: ${lastRun.toLocaleTimeString()}`)}`)
    }

    cronInfoText.content = t`${lines.join('\n')}`
  }

  // ─── Build Loop View Content ───
  const loopViewHeader = new TextRenderable(renderer, {
    id: 'loop-view-header',
    content: t`${bold('🔁 Loop Workflow')}`,
  })
  const loopHeaderBox = new BoxRenderable(renderer, {
    id: 'loop-header-box',
    paddingTop: 1,
    paddingLeft: 2,
    paddingBottom: 1,
    flexShrink: 0,
  })
  loopHeaderBox.add(loopViewHeader)
  loopView.add(loopHeaderBox)

  const loopDiagramText = new TextRenderable(renderer, {
    id: 'loop-diagram-text',
    content: t``, // Will be set by updateLoopView
  })
  const loopDiagramBox = new BoxRenderable(renderer, {
    id: 'loop-diagram-box',
    paddingLeft: 2,
    paddingBottom: 2,
    flexShrink: 0,
  })
  loopDiagramBox.add(loopDiagramText)
  loopView.add(loopDiagramBox)

  const loopInfoText = new TextRenderable(renderer, {
    id: 'loop-info-text',
    content: t``, // Will be set by updateLoopView
  })
  const loopInfoBox = new BoxRenderable(renderer, {
    id: 'loop-info-box',
    paddingLeft: 2,
    flexGrow: 1,
  })
  loopInfoBox.add(loopInfoText)
  loopView.add(loopInfoBox)

  // ─── Update Loop View ───
  function updateLoopView(): void {
    const diagram = getCompactDiagram('loop')
    loopDiagramText.content = t`${diagram.lines.join('\n')}`

    if (!workflowManager) {
      loopInfoText.content = t`${fg(COLORS.dim)('Loop workflow not initialized')}`
      return
    }

    const state = workflowManager.getState()
    if (state.type !== 'loop') {
      loopInfoText.content = t`${fg(COLORS.dim)('Switch to loop workflow to see details')}`
      return
    }

    const loopWorkflow = workflowManager.getCurrentWorkflow() as LoopWorkflow
    const config = loopWorkflow.getConfig()
    const progress = loopWorkflow.getProgress()

    const lines: string[] = []

    // Configuration
    const workPrompt = config.workPrompt || 'Not configured'
    const truncatedWorkPrompt = workPrompt.length > 60 ? workPrompt.slice(0, 57) + '...' : workPrompt
    lines.push(`${fg(COLORS.primary)('Work Prompt:')} ${truncatedWorkPrompt}`)

    const closingCondition = config.closingConditionPrompt || 'Not configured'
    const truncatedClosing = closingCondition.length > 60 ? closingCondition.slice(0, 57) + '...' : closingCondition
    lines.push(`${fg(COLORS.primary)('Closing Condition:')} ${truncatedClosing}`)

    lines.push(`${fg(COLORS.primary)('Max Iterations:')} ${config.maxIterations || 10}`)

    // Progress
    lines.push('')
    if (state.isActive) {
      const progressBar = '█'.repeat(Math.floor(progress.percentComplete / 10)) + '░'.repeat(10 - Math.floor(progress.percentComplete / 10))
      lines.push(`${fg(COLORS.yellow)('Progress:')} [${progressBar}] ${progress.currentIteration}/${progress.maxIterations}`)
      if (progress.phase === 'evaluating') {
        lines.push(`${fg(COLORS.green)('Status:')} Evaluating closing condition...`)
      } else if (progress.phase === 'working') {
        lines.push(`${fg(COLORS.green)('Status:')} Running iteration ${progress.currentIteration}`)
      } else {
        lines.push(`${fg(COLORS.dim)('Status:')} Ready`)
      }
    } else {
      if (config.workPrompt && config.closingConditionPrompt) {
        lines.push(`${fg(COLORS.dim)('Status:')} Ready to start`)
      } else {
        lines.push(`${fg(COLORS.dim)('Status:')} Use /loop to configure`)
      }
    }

    loopInfoText.content = t`${lines.join('\n')}`
  }

  // Clicking anywhere in the chat area refocuses the input
  chatArea.onMouseDown = () => {
    inputBar.focus()
  }

  // ─── Input bar ───
  const inputBar = new InputBar(renderer, handleSubmit, SLASH_COMMANDS)
  chatArea.add(inputBar.root)

  // ─── Approval prompt (replaces input bar when active) ───
  const approvalRoot = new BoxRenderable(renderer, {
    id: 'approval-root',
    flexDirection: 'column',
    flexShrink: 0,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    marginLeft: 2,
    marginRight: 2,
    marginBottom: 1,
    border: true,
    borderColor: COLORS.primary,
    borderStyle: 'single',
  })
  const approvalText = new TextRenderable(renderer, {
    id: 'approval-text',
    content: t``,
    marginBottom: 1,
  })
  approvalRoot.add(approvalText)

  // Three approval buttons in a row
  const approvalButtonRow = new BoxRenderable(renderer, {
    id: 'approval-button-row',
    flexDirection: 'row',
    gap: 2,
  })

  type ApprovalChoice = 'approve_once' | 'approve_session' | 'reject'
  let approvalSelectedIndex = 0
  const approvalChoices: { label: string; value: ApprovalChoice; color: string }[] = [
    { label: 'Approve once', value: 'approve_once', color: COLORS.primary },
    { label: 'Approve for session', value: 'approve_session', color: COLORS.yellow },
    { label: 'Reject', value: 'reject', color: COLORS.red },
  ]
  const approvalButtons: TextRenderable[] = []

  function renderApprovalButtons(): void {
    approvalChoices.forEach((choice, i) => {
      const isSelected = i === approvalSelectedIndex
      const btn = approvalButtons[i]
      if (!btn) return
      btn.content = isSelected
        ? t`${bold(fg(choice.color)(`[ ${choice.label} ]`))}`
        : t`${fg(COLORS.dim)(`  ${choice.label}  `)}`
    })
    renderer.requestRender()
  }

  approvalChoices.forEach((choice, i) => {
    const btn = new TextRenderable(renderer, {
      id: `approval-btn-${i}`,
      content: t``,
      onMouseDown: () => {
        if (pendingApproval) {
          pendingApproval.resolve(choice.value)
          hideApprovalPrompt()
        }
      },
      onMouseMove: () => {
        if (approvalSelectedIndex !== i) {
          approvalSelectedIndex = i
          renderApprovalButtons()
        }
      },
    })
    approvalButtons.push(btn)
    approvalButtonRow.add(btn)
  })
  approvalRoot.add(approvalButtonRow)

    // ─── Transition: welcome → main ───
  function transitionToMainView(): void {
    logger.debug(`transitionToMainView called, inWelcomeView=${inWelcomeView}`)
    if (!inWelcomeView) return
    inWelcomeView = false
    logger.debug(`Removing welcome screen, adding main view`)
    rootBox.remove(welcomeScreen.root.id)
    rootBox.add(mainView)
    inputBar.focus()
  }

  function updateQueuedMessages(): void {
    // Update interject panel with full text
    const interjectMsgs = pendingInterjects.map(m => ({ id: m.id, content: m.content }))
    msgHistory.setInterjects(interjectMsgs)
    // Update queue view if it's currently visible
    if (currentView === 'queue') {
      updateQueueView()
    }
  }

  /**
   * Persist session state to disk incrementally during a turn.
   * Called after significant state changes (user messages, tool results, etc.)
   * so that quitting mid-turn doesn't lose conversation progress.
   */
  async function persistSession(): Promise<void> {
    if (session && client && config) {
      session.completionMessages = completionMessages
      session.todos = getTodosForSession(session.id)
      session.queuedMessages = getQueueForSession(session.id)
      session.interjectMessages = [...pendingInterjects]
      session.workflowState = workflowManager?.getState()
      session.totalCost = totalCost
      try {
        await saveSession(session)
      } catch (err: any) {
        logger.debug(`Failed to persist session: ${err.message}`)
      }
    }
  }

  /**
   * Update the workflow display based on current view
   */
  function updateWorkflowDisplay(): void {
    if (!workflowManager) return
    const state = workflowManager.getState()

    // Update the appropriate view
    if (state.type === 'cron') {
      updateCronView()
    } else if (state.type === 'loop') {
      updateLoopView()
    } else if (state.type === 'queue') {
      updateQueueView()
    }

    // Update right sidebar workflow type and diagram
    rightSidebar.setWorkflowType(state.type, state.isActive)

    // Update right sidebar contextual content based on workflow type
    if (state.type === 'cron') {
      const cronWorkflow = workflowManager.getCurrentWorkflow() as CronWorkflow
      const cronState = workflowManager.getCronState()
      rightSidebar.setCronInfo({
        schedule: cronState?.schedule,
        prompt: cronState?.prompt,
        nextRunAt: cronState?.cronNextRunAt,
        lastRunAt: cronState?.cronLastRunAt,
        timeUntilNextMs: cronState?.timeUntilNextMs,
      })
    } else if (state.type === 'loop') {
      const loopWorkflow = workflowManager.getCurrentWorkflow() as LoopWorkflow
      const config = loopWorkflow.getConfig()
      const progress = loopWorkflow.getProgress()
      rightSidebar.setLoopInfo({
        workPrompt: config.workPrompt,
        closingCondition: config.closingConditionPrompt,
        maxIterations: config.maxIterations,
        currentIteration: progress.currentIteration,
        isActive: state.isActive,
        phase: progress.phase,
      })
    } else {
      // Queue workflow - show queue
      rightSidebar.setQueue(
        session?.id ? getQueueForSession(session.id).filter(m => m.type === 'queued') : [],
        pendingInterjects
      )
    }

    // Always update todos
    if (session) {
      rightSidebar.setTodos(getTodosForSession(session.id))
    }
  }

  // Cron timer check interval
  let cronCheckInterval: NodeJS.Timeout | null = null

  /**
   * Check if cron should trigger and run if ready
   * Only runs when tab is active (checked via options.isActiveTab)
   */
  function checkCronTrigger(): void {
    if (!workflowManager || !client || !config) return
    if (!options.isActiveTab || !options.isActiveTab()) return
    if (isLoading) return // Don't trigger if already processing

    const cronWorkflow = workflowManager.getCurrentWorkflow() as CronWorkflow
    if (cronWorkflow.type !== 'cron') return

    const shouldTrigger = cronWorkflow.shouldTrigger()
    if (shouldTrigger) {
      const prompt = cronWorkflow.trigger()
      if (prompt) {
        // Fire-and-forget: run the cron prompt
        runAgenticTurn(prompt).catch((err) => {
          logger.error(`Cron execution failed: ${err}`)
        })
      }
    }

    // Update the cron display with current countdown if cron view is active
    if (currentView === 'cron') {
      updateCronView()
    }
  }

  /**
   * Start the cron timer check
   */
  function startCronTimer(): void {
    if (cronCheckInterval) return
    // Check every second for cron triggers
    cronCheckInterval = setInterval(checkCronTrigger, 1000)
  }

  /**
   * Stop the cron timer check
   */
  function stopCronTimer(): void {
    if (cronCheckInterval) {
      clearInterval(cronCheckInterval)
      cronCheckInterval = null
    }
  }

  /**
   * Cycle through views: Bot → Queue → Loop → Cron → Bot
   */
  function cycleViews(): void {
    const views: ViewType[] = ['bot', 'queue', 'loop', 'cron']
    const currentIndex = views.indexOf(currentView)
    const nextIndex = (currentIndex + 1) % views.length
    const nextView = views[nextIndex]

    // Also cycle the workflow type to match the view
    if (workflowManager) {
      const oldType = workflowManager.getCurrentType()
      const newType = workflowManager.cycleWorkflow()

      // Start/stop cron timer based on workflow type
      if (newType === 'cron') {
        startCronTimer()
      } else if (oldType === 'cron') {
        stopCronTimer()
      }

      // Update session
      if (session) {
        session.workflowState = workflowManager.getState()
      }

      logger.debug(`Switched workflow from ${oldType} to ${newType}, view to ${nextView}`)
    }

    // Switch to the next view
    switchView(nextView)
  }

  /**
   * Stop the current workflow (called on Escape key)
   */
  function stopWorkflow(): void {
    if (!workflowManager) return

    const wasActive = workflowManager.isActive()
    workflowManager.stop()

    if (wasActive) {
      statusBar.setError(`Workflow stopped`)
      updateWorkflowDisplay()

      // Update session
      if (session) {
        session.workflowState = workflowManager.getState()
      }
    }
  }

  function showApprovalPrompt(req: ApprovalRequest): void {
    const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + '...' : s

    const desc = truncate(req.description, 80)
    const detail = req.detail ? truncate(req.detail, 120) : ''

    // NOTE: opentui's `t` template tag preserves StyledText fragments, but
    // nesting a plain JS template literal like `` `\n${fg(...)('...')}` ``
    // inside a `t`…`` substitution calls `.toString()` on the StyledText,
    // which yields the literal string "[object Object]". Split the two
    // variants (with/without detail) so the styled fragment stays a direct
    // substitution of the outer `t`…`` tag.
    approvalText.content = detail
      ? t`${bold(fg(COLORS.primary)('Approval Required'))}
${fg('#cccccc')(desc)}
${fg(COLORS.dim)(detail)}`
      : t`${bold(fg(COLORS.primary)('Approval Required'))}
${fg('#cccccc')(desc)}`

    // Reset selection to first option
    approvalSelectedIndex = 0
    renderApprovalButtons()

    // Save the current input buffer content before hiding the input bar
    savedInputBuffer = inputBar.input.editBuffer.getText()

    // Swap: hide input bar, show approval
    chatArea.remove(inputBar.root.id)
    inputBar.input.blur()
    chatArea.add(approvalRoot)
    renderer.requestRender()

    statusBar.setAwaitingApproval(true)
    options.onApprovalChange?.(true)
  }

  function hideApprovalPrompt(): void {
    // Swap: hide approval, restore input bar
    try { chatArea.remove(approvalRoot.id) } catch {}
    chatArea.add(inputBar.root)
    inputBar.focus()
    // Restore the saved input buffer content
    if (savedInputBuffer) {
      inputBar.input.clear()
      inputBar.input.insertText(savedInputBuffer)
      savedInputBuffer = ''
    }
    pendingApproval = null
    statusBar.setAwaitingApproval(false)
    options.onApprovalChange?.(false)
    renderer.requestRender()
  }

  /**
   * Show the loop setup dialog
   */
  function showLoopSetupDialog(): void {
    if (!workflowManager || !client || !config) {
      statusBar.setError('Cannot setup loop: workflow manager not ready')
      return
    }

    // Hide main view and show loop setup
    ;(mainView as any).style = { ...(mainView as any).style, display: 'none' }

    const setupDialog = new LoopSetupDialog(renderer, async (result) => {
      // Remove setup dialog
      rootBox.remove(setupDialog.root.id)

      // Restore main view
      ;(mainView as any).style = { ...(mainView as any).style, display: 'flex' }

      if (result && workflowManager) {
        // Switch to loop workflow
        workflowManager.switchWorkflow('loop')

        // Configure the loop workflow
        const loopWorkflow = workflowManager.getCurrentWorkflow() as LoopWorkflow
        loopWorkflow.updateConfig({
          workPrompt: result.workPrompt,
          closingConditionPrompt: result.closingConditionPrompt,
          maxIterations: result.maxIterations,
        })

        // Switch to loop view
        switchView('loop')

        // Show confirmation message
        completionMessages = [
          ...completionMessages,
          { role: 'user', content: '[loop setup]' },
          {
            role: 'assistant',
            content: `🔁 Loop workflow configured:\n\n**Work Prompt:** ${result.workPrompt}\n\n**Closing Condition:** ${result.closingConditionPrompt}\n\n**Max Iterations:** ${result.maxIterations}\n\nType a message to start the loop.`,
          },
        ]
        msgHistory.setMessages(completionMessages)

        // Update session
        if (session) {
          session.workflowState = workflowManager.getState()
        }

        updateWorkflowDisplay()
      }

      // Refocus input
      inputBar.focus()
      renderer.requestRender()
    })

    rootBox.add(setupDialog.root)
    setupDialog.focus()
    renderer.requestRender()
  }

  // ─── Agent event handler ───
  function handleAgentEvent(event: AgentEvent): void {
    // NOTE: We process events for ALL tabs, not just the active one.
    // This ensures background tabs continue to show updates (messages, tool calls, etc.)
    // when the user switches to another tab. The renderables are still valid even
    // when not visible, so it's safe to update them.

    switch (event.type) {
      case 'text_delta': {
        let delta = event.content || ''
        // Trim leading whitespace from the first chunk after user message/tool call
        if (shouldTrimNextChunk) {
          delta = delta.trimStart()
          shouldTrimNextChunk = false
        }
        streamingText += delta
        isStreaming = true
        streamingTextFlushed = false
        msgHistory.setMessages(completionMessages, streamingText, isStreaming, streamingThinking)
        break
      }
      case 'thinking_delta': {
        streamingThinking += event.thinking?.content || ''
        isStreaming = true
        streamingTextFlushed = false
        msgHistory.setMessages(completionMessages, streamingText, isStreaming, streamingThinking)
        break
      }
      case 'tool_call': {
        if (event.toolCall) {
          activeTool = event.toolCall.name
          setLoading(true, activeTool)
          if (isStreaming) {
            // Flush streaming text and thinking content into messages
            const trimmed = streamingText.trim()
            const thinkingTrimmed = streamingThinking.trim()
            if (trimmed || thinkingTrimmed) {
              const assistantMsg: any = { role: 'assistant', content: trimmed }
              if (thinkingTrimmed) {
                assistantMsg.reasoning_content = thinkingTrimmed
              }
              completionMessages = [...completionMessages, assistantMsg]
            }
            streamingText = ''
            streamingThinking = ''
            isStreaming = false
            streamingTextFlushed = true
          }
          // Create or update assistant message with tool calls
          const toolCallEntry = {
            id: event.toolCall.id,
            type: 'function' as const,
            function: { name: event.toolCall.name, arguments: event.toolCall.args },
          }
          if (!assistantWithToolsMsg) {
            assistantWithToolsMsg = {
              role: 'assistant' as const,
              content: '',
              tool_calls: [toolCallEntry],
            }
            completionMessages = [...completionMessages, assistantWithToolsMsg]
          } else {
            assistantWithToolsMsg.tool_calls.push(toolCallEntry)
          }
          // Show a live tool row
          let display = event.toolCall.name
          try {
            const args = JSON.parse(event.toolCall.args || '{}')
            display = formatToolActivity(event.toolCall.name, args)
          } catch {}
          msgHistory.addLiveToolRow(event.toolCall.id, `▶ ${display}`)
          msgHistory.setMessages(completionMessages, '', false)
        }
        break
      }
      case 'tool_result': {
        if (event.toolCall?.id) {
          msgHistory.removeLiveToolRow(event.toolCall.id)
          // Add tool result message to completionMessages
          const toolResultMsg = {
            role: 'tool' as const,
            tool_call_id: event.toolCall.id,
            name: event.toolCall.name,
            content: event.toolCall.result || '',
          } as any
          completionMessages = [...completionMessages, toolResultMsg]
          msgHistory.setMessages(completionMessages, '', false)
          // Next assistant response chunk should have leading whitespace trimmed
          shouldTrimNextChunk = true

          // Update todo sidebar when agent updates todos
          if (event.toolCall.name === 'todo_write' && session) {
            const todos = getTodosForSession(session.id)
            msgHistory.showTodoList(todos)
            rightSidebar.setTodos(todos)
          }

        }
        activeTool = null
        setLoading(true, null)
        // Persist session after each tool result (incremental save)
        persistSession()
        break
      }
      case 'interject': {
        if (event.interject) {
          // Add interject as a user message to the chat history
          completionMessages = [...completionMessages, { role: 'user', content: event.interject.content }]
          msgHistory.setMessages(completionMessages, '', false)
          // Update pending interjects UI
          updateQueuedMessages()
          // Persist session after interject (incremental save)
          persistSession()
        }
        break
      }
      case 'sub_agent_iteration': {
        if (event.subAgentTool) {
          const { tool, status } = event.subAgentTool
          activeTool = status === 'running' ? formatSubAgentActivity(tool, event.subAgentTool.args) : null
          setLoading(true, activeTool)
        }
        if (event.subAgentUsage) {
          totalCost += event.subAgentUsage.estimatedCost
          statusBar.setUsage(lastUsage, totalCost)
        }
        break
      }
      case 'usage': {
        if (event.usage) {
          lastUsage = event.usage
          totalCost += event.usage.cost
          statusBar.setUsage(lastUsage, totalCost)
          // Update todo sidebar usage
          rightSidebar.setUsage(
            {
              inputTokens: event.usage.inputTokens,
              outputTokens: event.usage.outputTokens,
              contextPercent: event.usage.contextPercent,
            },
            totalCost
          )
        }
        break
      }
      case 'error': {
        if (event.error) statusBar.setError(event.error)
        break
      }
      case 'iteration_done': {
        assistantWithToolsMsg = null
        // Trim leading whitespace from first chunk after all tool results are sent
        shouldTrimNextChunk = true
        break
      }
      case 'done': {
        if (isStreaming && !streamingTextFlushed) {
          const trimmed = streamingText.trim()
          const thinkingTrimmed = streamingThinking.trim()
          if (trimmed || thinkingTrimmed) {
            const assistantMsg: any = { role: 'assistant', content: trimmed }
            if (thinkingTrimmed) {
              assistantMsg.reasoning_content = thinkingTrimmed
            }
            completionMessages = [...completionMessages, assistantMsg]
            msgHistory.setMessages(completionMessages, '', false)
          }
        }
        streamingText = ''
        streamingThinking = ''
        isStreaming = false
        streamingTextFlushed = false
        activeTool = null
        // Note: assistantWithToolsMsg is reset on 'iteration_done', not here.
        // This prevents issues when multiple agentic runs occur in sequence.
        // Clear loading indicator immediately — don't wait for session save in finally
        setLoading(false)
        inputBar.setLoading(false)
        // Persist session after assistant response is complete (incremental save)
        persistSession()
        break
      }
    }
  }

  // ─── Process queue ───
  async function processQueueAfterCompletion(): Promise<void> {
    if (processingQueue) return
    processingQueue = true
    try {
      // Process all queued messages in a loop until queue is empty
      while (hasQueuedMessages(session?.id) && client && config) {
        const queued = getNextQueued(session?.id)
        if (!queued) break
        queuedCount = Math.max(0, queuedCount - 1)
        statusBar.setQueueState(queuedCount, pendingInterjects.length)
        updateQueuedMessages()
        await runAgenticTurn(queued.content)
      }
    } finally {
      processingQueue = false
    }
  }

  // ─── Run agentic turn ───
  async function runAgenticTurn(userContent: string): Promise<void> {
    if (!client || !config || !workflowManager) return
    isLoading = true
    isStreaming = false
    streamingText = ''
    streamingTextFlushed = false
    // Reset abortController so we don't check an old aborted signal from a previous turn
    abortController = null
    setLoading(true, null)
    statusBar.setError(null)
    inputBar.setLoading(true)

    // Parse user input for image references
    // This converts image file paths to base64 data URLs
    const parsedContent = await parseInputWithImages(userContent)

    // Start the workflow if it's not already active (e.g., fresh session or restored inactive session)
    if (!workflowManager.isActive()) {
      workflowManager.start()
    }

    // Process message through workflow manager
    // This allows the workflow to modify messages and control flow
    const workflowResult = workflowManager.processMessage(parsedContent, completionMessages)
    completionMessages = workflowResult.messages

    // Add any pending interjects at the start
    const startingInterjects = pendingInterjects.splice(0)
    const extra: Message[] = startingInterjects.map((q) => ({ role: 'user', content: `[interject] ${q.content}` }))
    completionMessages = [...completionMessages, ...extra]

    msgHistory.setMessages(completionMessages)
    updateQueuedMessages()
    shouldTrimNextChunk = true

    // Persist session after user message is added (incremental save)
    await persistSession()

    // Generate title at the start of the first turn (when title is still default)
    if (session && client && config && session.title === 'New session') {
      const title = generateTitle(completionMessages)
      session.title = title
      if (options.onTitleUpdate) {
        options.onTitleUpdate(title)
      }
    }

    try {
      const pricing = getModelPricing(config.provider, config.model)
      const requestDefaults = getRequestDefaultParams(config.provider, config.model)

      // ─── SDK-driven path (flagged) ─────────────────────────────────
      // When PROTOAGENT_TUI_VIA_SDK=1 is set AND a TabRuntime was provided
      // via options.tabRuntime, route this turn through the SDK client
      // instead of calling runAgenticLoop directly. The runtime owns
      // session state, workflow, approvals, and persistence; the TUI just
      // renders events and reads the final snapshot back.
      const sdkModeEnabled = process.env.PROTOAGENT_TUI_VIA_SDK === '1' && !!options.tabRuntime && !!session
      if (sdkModeEnabled && options.tabRuntime && session) {
        logger.info('TUI turn via SDK (flagged)', { sessionId: session.id })
        // Fresh abort controller (the runtime has its own; this one is only
        // for UI callbacks that read it).
        abortController = new AbortController()
        options.registerAbortController?.(abortController)

        const tabRuntime = options.tabRuntime

        // Ensure the CoreRuntime inside TabRuntime is initialized. This
        // reads real config, opens MCP (idempotent against the global
        // manager), and creates the LLM client.
        await tabRuntime.coreRuntime.initialize()

        // Make sure the session exists in storage so the runtime can load
        // it. The TUI has already constructed and saved a Session, so this
        // is usually a no-op, but be safe.
        await saveSession(session)

        await runSdkTurn({
          client: tabRuntime.client,
          sessionId: session.id,
          userContent,
          onAgentEvent: handleAgentEvent,
          onLifecycleEvent: (event) => {
            // When the runtime announces a fresh snapshot (e.g., after a
            // turn completes) we pull its authoritative messages into the
            // TUI's local state so the next turn builds on the same view.
            if (event.type === 'session_updated' || event.type === 'session_activated' || event.type === 'snapshot') {
              const data = event.data as { session?: { completionMessages?: Message[] } } | undefined
              const inner = data && 'session' in data ? data.session : (event.data as any)
              const msgs = inner?.completionMessages
              if (Array.isArray(msgs) && msgs.length > 0) {
                completionMessages = msgs as Message[]
              }
            }
          },
        })

        // Runtime has persisted the session; don't double-write from the
        // TUI. Just surface any title updates.
        if (options.onTitleUpdate) {
          options.onTitleUpdate(session.title)
        }
      } else {
        // ─── Legacy path: direct runAgenticLoop ─────────────────────
        // Workflow loop - continue while workflow says we should
        let shouldContinueWorkflow = true

        while (shouldContinueWorkflow && workflowManager.isActive()) {
          // Check abort signal
          if (abortController?.signal.aborted) {
            break
          }

          abortController = new AbortController()
          options.registerAbortController?.(abortController)

          const updated = await runAgenticLoop(
            client,
            config.model,
            [...completionMessages],
            userContent,
            handleAgentEvent,
            {
              pricing: pricing || undefined,
              abortSignal: abortController.signal,
              sessionId: session?.id,
              requestDefaults,
              approvalManager,
              toolRegistry,
              systemPromptAddition: workflowResult.systemPromptAddition,
              getInterjects: () => {
                const msgs = pendingInterjects.splice(0).map(
                  (q): Message => ({ role: 'user', content: `[interject] ${q.content}` })
                )
                if (msgs.length > 0) {
                  statusBar.setQueueState(queuedCount, pendingInterjects.length)
                }
                return msgs
              },
            },
          )
          completionMessages = updated
          msgHistory.setMessages(completionMessages, '', false)

          // Get the last assistant message for workflow response handling
          const lastMsg = completionMessages[completionMessages.length - 1]
          if (lastMsg && lastMsg.role === 'assistant') {
            shouldContinueWorkflow = workflowManager.onResponse(lastMsg)
          } else {
            shouldContinueWorkflow = false
          }

          // Check for workflow-specific next iteration message (for loop workflow)
          if (shouldContinueWorkflow && workflowManager.getCurrentType() === 'loop') {
            const loopWorkflow = workflowManager.getCurrentWorkflow() as LoopWorkflow
            const nextMsg = loopWorkflow.getNextMessage()
            if (nextMsg) {
              completionMessages = [...completionMessages, nextMsg]
            }
          }

          // Update workflow display
          updateWorkflowDisplay()
        }

        // Workflow complete - save session
        if (session && client && config) {
          session.completionMessages = completionMessages
          session.todos = getTodosForSession(session.id)
          session.queuedMessages = getQueueForSession(session.id)
          session.interjectMessages = [...pendingInterjects]
          session.workflowState = workflowManager.getState()
          session.totalCost = totalCost
          // Note: Title is generated once at the start of the session, not here
          await saveSession(session)

          if (options.onTitleUpdate) {
            options.onTitleUpdate(session.title)
          }
        }
      }
    } catch (err: any) {
      statusBar.setError(`${err.message}`)
    } finally {
      isLoading = false
      isStreaming = false
      setLoading(false)
      inputBar.setLoading(false)
      updateWorkflowDisplay()
      processQueueAfterCompletion()
    }
  }

  // ─── Handle slash commands ───
  async function handleSlashCommand(cmd: string): Promise<boolean> {
    const parts = cmd.trim().split(/\s+/)
    const command = parts[0]?.toLowerCase()
    switch (command) {
      case '/quit':
      case '/exit': {
        // Abort any running agentic loop first to ensure clean shutdown
        if (abortController) {
          abortController.abort()
          abortController = null
        }
        // Give the loop a moment to process the abort
        await new Promise(resolve => setTimeout(resolve, 100))
        // Save current session state without regenerating title (already done during session)
        if (session && client && config) {
          try {
            session.completionMessages = completionMessages
            session.todos = getTodosForSession(session.id)
            session.queuedMessages = getQueueForSession(session.id)
            session.interjectMessages = [...pendingInterjects]
            session.totalCost = totalCost
            await saveSession(session)
          } catch {}
        }
        // Use the multi-tab save and exit if available
        if (options.onSaveAndExit) {
          await options.onSaveAndExit()
        } else {
          // Single tab mode: just destroy and exit
          renderer.destroy()
          process.exit(0)
        }
        return true
      }
      case '/help':
        statusBar.setError(null)
        // Show help in a temporary message
        completionMessages = [...completionMessages, { role: 'user', content: '[help]' } as any]
        completionMessages = [...completionMessages, { role: 'assistant', content: HELP_TEXT } as any]
        msgHistory.setMessages(completionMessages)
        return true
      case '/loop':
        // Show loop setup dialog
        showLoopSetupDialog()
        return true
      case '/new':
        if (!options.onNewTab) {
          statusBar.setError('/new requires multi-tab mode')
          return true
        }
        try {
          // Extract any text following /new as the initial message
          const initialMsg = cmd.trim().slice(4).trim() || undefined
          await options.onNewTab(initialMsg)
        } catch (err) {
          statusBar.setError(`Failed to create new tab: ${err instanceof Error ? err.message : String(err)}`)
        }
        return true
      case '/manager':
        // Keyboard-accessible alternative to clicking the "★ Manager"
        // button in the sidebar. `createManagerTab` is idempotent: it
        // focuses the existing manager tab if one already exists, or
        // creates a new one otherwise.
        if (!options.onOpenManager) {
          statusBar.setError('/manager requires multi-tab mode')
          return true
        }
        try {
          await options.onOpenManager()
        } catch (err) {
          statusBar.setError(`Failed to open Manager tab: ${err instanceof Error ? err.message : String(err)}`)
        }
        return true
      case '/session': {
        const parts = cmd.trim().split(/\s+/)
        const subCommand = parts[1]?.toLowerCase()
        const sessionArg = parts[2]

        // /session open <id> - open a session in a new tab
        if (subCommand === 'open' && sessionArg) {
          if (!options.onFork) {
            statusBar.setError('/session open requires multi-tab mode')
            return true
          }
          try {
            // Allow opening deleted sessions - they will be restored
            const loadedSession = await loadSession(sessionArg, { includeDeleted: true })
            if (!loadedSession) {
              statusBar.setError(`Session "${sessionArg}" not found`)
              return true
            }
            // Restore the session by clearing the deleted flag
            if (loadedSession.deleted) {
              loadedSession.deleted = false
              await saveSession(loadedSession)
            }
            await options.onFork(loadedSession.id, loadedSession.title)
          } catch (err) {
            statusBar.setError(`Failed to open session: ${err instanceof Error ? err.message : String(err)}`)
          }
          return true
        }

        // /session search <query> - search sessions by title or message content
        if (subCommand === 'search') {
          const query = parts.slice(2).join(' ').trim()
          if (!query) {
            statusBar.setError('Usage: /session search <query>')
            return true
          }
          const results = await searchSessions(query)

          if (results.length === 0) {
            completionMessages = [...completionMessages, { role: 'user', content: `[session search: ${query}]` } as any]
            completionMessages = [...completionMessages, { role: 'assistant', content: `No sessions found matching "${query}".` } as any]
            msgHistory.setMessages(completionMessages)
            return true
          }

          const maxTitleLen = Math.max(...results.map(s => s.title.length), 5)
          const lines = [
            `Sessions matching "${query}" (most recent first):`,
            '',
            `  ${'ID'.padEnd(8)}  ${'Title'.padEnd(maxTitleLen)}  Messages  Match      Last updated`,
            `  ${'-'.repeat(8)}  ${'-'.repeat(maxTitleLen)}  --------  ---------  -------------`,
            ...results.map(s => {
              const dateStr = new Date(s.updatedAt).toLocaleDateString()
              const timeStr = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              const matchType = s.matchType === 'title' ? 'title' : 'message'
              return `  ${s.id.slice(0, 8)}  ${s.title.padEnd(maxTitleLen)}  ${String(s.messageCount).padStart(8)}  ${matchType.padEnd(9)}  ${dateStr} ${timeStr}`
            }),
            '',
            `Found ${results.length} session(s). Use "/session open <id>" to open a session in a new tab.`,
          ]

          completionMessages = [...completionMessages, { role: 'user', content: `[session search: ${query}]` } as any]
          completionMessages = [...completionMessages, { role: 'assistant', content: lines.join('\n') } as any]
          msgHistory.setMessages(completionMessages)
          return true
        }

        // /session or /session list - list sessions (paginated, default first 10)
        // Also supports: /session list --page <n>
        const PAGE_SIZE = 10
        let page = 1
        if (subCommand === 'list' && parts.includes('--page')) {
          const pageIdx = parts.indexOf('--page')
          if (pageIdx !== -1 && parts[pageIdx + 1]) {
            const parsed = parseInt(parts[pageIdx + 1], 10)
            if (!isNaN(parsed) && parsed > 0) {
              page = parsed
            }
          }
        }
        const offset = (page - 1) * PAGE_SIZE
        const sessions = await listSessions({ limit: PAGE_SIZE, offset })
        const totalSessions = await countSessions()

        if (sessions.length === 0) {
          completionMessages = [...completionMessages, { role: 'user', content: '[session list]' } as any]
          completionMessages = [...completionMessages, { role: 'assistant', content: 'No saved sessions found.' } as any]
          msgHistory.setMessages(completionMessages)
          return true
        }

        const maxTitleLen = Math.max(...sessions.map(s => s.title.length), 5)
        const lines = [
          'Saved sessions (most recent first):',
          '',
          `  ${'ID'.padEnd(8)}  ${'Title'.padEnd(maxTitleLen)}  Messages  Last updated`,
          `  ${'-'.repeat(8)}  ${'-'.repeat(maxTitleLen)}  --------  -------------`,
          ...sessions.map(s => {
            const dateStr = new Date(s.updatedAt).toLocaleDateString()
            const timeStr = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            return `  ${s.id.slice(0, 8)}  ${s.title.padEnd(maxTitleLen)}  ${String(s.messageCount).padStart(8)}  ${dateStr} ${timeStr}`
          }),
          '',
          `Showing ${Math.min(sessions.length, totalSessions - offset)} of ${totalSessions} sessions (page ${page} of ${Math.ceil(totalSessions / PAGE_SIZE)}).`,
          totalSessions > PAGE_SIZE
            ? `Use "/session list --page <n>" to see more sessions. Use "/session open <id>" to open a session in a new tab.`
            : `Use "/session open <id>" to open a session in a new tab.`,
        ]

        completionMessages = [...completionMessages, { role: 'user', content: '[session list]' } as any]
        completionMessages = [...completionMessages, { role: 'assistant', content: lines.join('\n') } as any]
        msgHistory.setMessages(completionMessages)
        return true
      }
      case '/pop': {
        const queued = getNextQueued(session?.id)
        if (queued) {
          queuedCount = Math.max(0, queuedCount - 1)
          statusBar.setQueueState(queuedCount, pendingInterjects.length)
          updateQueuedMessages()
          if (!isLoading && client && config) {
            await runAgenticTurn(queued.content)
          }
        }
        return true
      }
      case '/q': {
        // Queue all messages separated by /q
        // Split by /q to allow multiple queued messages in one command
        // e.g., "/q first message /q second /q third" enqueues all three
        const messages = cmd.trim().split('/q').map(m => m.trim()).filter(m => m.length > 0)
        if (messages.length > 0 && client && config) {
          for (const message of messages) {
            enqueueMessage(message, session?.id)
            queuedCount++
          }
          statusBar.setQueueState(queuedCount, pendingInterjects.length)
          updateQueuedMessages()
          // Start processing the first queued message if not already loading
          if (!isLoading) {
            const firstQueued = getNextQueued(session?.id)
            if (firstQueued) {
              queuedCount = Math.max(0, queuedCount - 1)
              statusBar.setQueueState(queuedCount, pendingInterjects.length)
              updateQueuedMessages()
              await runAgenticTurn(firstQueued.content)
            }
          }
        }
        return true
      }
       case '/clear':
        clearMessageQueue(session?.id)
        queuedCount = 0
        statusBar.setQueueState(0, pendingInterjects.length)
        // Update queue view if it's currently visible
        if (currentView === 'queue') {
          updateQueueView()
        }
        return true
      case '/rename': {
        // Extract new title from command: /rename new title
        const parts = cmd.trim().split(/\s+/)
        let newTitle = parts.slice(1).join(' ').trim()
        
        // If no title provided, generate one using LLM based on recent messages
        if (!newTitle) {
          if (!client || !config) {
            statusBar.setError('No active session to generate title')
            return true
          }
          setLoading(true, 'Generating title...')
          try {
            newTitle = await generateTitleWithLLM(completionMessages, client, config.model)
          } catch (err) {
            statusBar.setError(`Failed to generate title: ${err instanceof Error ? err.message : String(err)}`)
            setLoading(false)
            return true
          } finally {
            setLoading(false)
          }
        }
        
        // Update the session title
        if (session) {
          session.title = newTitle
        }
        if (options.onTitleUpdate) {
          options.onTitleUpdate(newTitle)
        }
        completionMessages = [...completionMessages, { role: 'user', content: `[renamed to: ${newTitle}]` } as any]
        completionMessages = [...completionMessages, { role: 'assistant', content: `Tab renamed to: ${newTitle}` } as any]
        msgHistory.setMessages(completionMessages)
        return true
      }
      case '/fork': {
        if (!session || !client || !config) {
          statusBar.setError('No active session to fork')
          return true
        }
        if (!options.onFork) {
          statusBar.setError('/fork requires multi-tab mode')
          return true
        }
        try {
          // Save a new session with a copy of the current messages
          const forkedSession = createSession(config.model, config.provider)
          forkedSession.completionMessages = [...completionMessages]
          forkedSession.todos = getTodosForSession(session.id).map(t => ({ ...t }))
          forkedSession.queuedMessages = getQueueForSession(session.id)
          forkedSession.interjectMessages = [...pendingInterjects]
          forkedSession.totalCost = totalCost
          forkedSession.title = `Fork of ${session.title || 'session'}`
          await saveSession(forkedSession)
          await options.onFork(forkedSession.id, forkedSession.title)
        } catch (err) {
          statusBar.setError(`Fork failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        return true
      }
      case '/reconnect': {
        statusBar.setError(null)
        setLoading(true, 'Reconnecting MCPs...')
        try {
          await reconnectAllMcp()
          // Update MCP status in status bar after reconnection
          const mcpStatus = mcpManager.getConnectionStatusArray()
          statusBar.setMcpStatus(mcpStatus)
          // Notify sidebar that MCP status has changed
          options.onMcpReady?.()
          const status = getMcpConnectionStatus()
          const connected = Object.values(status).filter(s => s.connected).length
          const total = Object.keys(status).length
          completionMessages = [...completionMessages, { role: 'user', content: '[reconnect]' } as any]
          completionMessages = [...completionMessages, { role: 'assistant', content: `Reconnection complete: ${connected}/${total} MCP servers connected` } as any]
          msgHistory.setMessages(completionMessages)
        } catch (err) {
          statusBar.setError(`Reconnection failed: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          setLoading(false)
        }
        return true
      }
      case '/pin': {
        if (!options.onPinTab) {
          statusBar.setError('/pin requires multi-tab mode')
          return true
        }
        try {
          options.onPinTab(true)
          const tabTitle = options.onTitleUpdate ? 'Current tab' : 'Tab'
          completionMessages = [...completionMessages, { role: 'user', content: '[pin]' } as any]
          completionMessages = [...completionMessages, { role: 'assistant', content: `${tabTitle} pinned to top` } as any]
          msgHistory.setMessages(completionMessages)
        } catch (err) {
          statusBar.setError(`Pin failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        return true
      }
      case '/unpin': {
        if (!options.onPinTab) {
          statusBar.setError('/unpin requires multi-tab mode')
          return true
        }
        try {
          options.onPinTab(false)
          const tabTitle = options.onTitleUpdate ? 'Current tab' : 'Tab'
          completionMessages = [...completionMessages, { role: 'user', content: '[unpin]' } as any]
          completionMessages = [...completionMessages, { role: 'assistant', content: `${tabTitle} unpinned` } as any]
          msgHistory.setMessages(completionMessages)
        } catch (err) {
          statusBar.setError(`Unpin failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        return true
      }
      case '/workflow': {
        // `/workflow`           — show current type
        // `/workflow queue|cron|loop` — switch to that type
        // `/workflow cycle`      — advance to next type (same as the key binding)
        if (!workflowManager) {
          statusBar.setError('/workflow: workflow manager not initialized')
          return true
        }
        const arg = (parts[1] || '').trim().toLowerCase()
        const validTypes = ['queue', 'cron', 'loop'] as const
        if (!arg) {
          const current = workflowManager.getCurrentType()
          completionMessages = [
            ...completionMessages,
            { role: 'user', content: '[workflow]' } as any,
            { role: 'assistant', content: `Current workflow: ${current}. Use /workflow <queue|cron|loop> to switch, or /workflow cycle to advance.` } as any,
          ]
          msgHistory.setMessages(completionMessages)
          return true
        }
        if (arg === 'cycle') {
          const newType = workflowManager.cycleWorkflow()
          if (session) session.workflowState = workflowManager.getState()
          completionMessages = [
            ...completionMessages,
            { role: 'user', content: `[workflow cycle]` } as any,
            { role: 'assistant', content: `Workflow switched to: ${newType}` } as any,
          ]
          msgHistory.setMessages(completionMessages)
          return true
        }
        if ((validTypes as readonly string[]).includes(arg)) {
          try {
            workflowManager.switchWorkflow(arg as typeof validTypes[number])
            if (session) session.workflowState = workflowManager.getState()
            completionMessages = [
              ...completionMessages,
              { role: 'user', content: `[workflow ${arg}]` } as any,
              { role: 'assistant', content: `Workflow switched to: ${arg}` } as any,
            ]
            msgHistory.setMessages(completionMessages)
          } catch (err) {
            statusBar.setError(`/workflow failed: ${err instanceof Error ? err.message : String(err)}`)
          }
          return true
        }
        statusBar.setError(`/workflow: unknown type "${arg}". Use queue, cron, loop, or cycle.`)
        return true
      }
      default: {
        // Command starts with "/" but we have no handler. Treat as unknown
        // slash command (rather than silently forwarding the literal text to
        // the LLM, which is confusing and wastes tokens). Only commands we
        // explicitly route should reach the LLM — via mutation of content
        // before submit, not via the fallthrough.
        const cmdName = parts[0] || cmd
        statusBar.setError(`Unknown command: ${cmdName}. Type /help for the list of commands.`)
        return true
      }
    }
  }

  // ─── Handle submit ───
  async function handleSubmit(value: string, mode: SubmitMode = 'send'): Promise<void> {
    // Input bar is hidden during approval — nothing to do here
    if (pendingApproval) return

    // Ensure we're in the main view regardless of submission source
    transitionToMainView()

    const trimmed = value.trim()
    if (!trimmed || !client || !config) return

    // Check for /q suffix at the end of the message (queue command)
    // Check for /new suffix at the end of the message (create new agent/tab command)
    // These must be checked BEFORE slash commands to handle "message /new" properly
    let effectiveMode: SubmitMode | 'new-agent' = mode
    let content = trimmed
    if (trimmed.endsWith(' /q')) {
      effectiveMode = 'queue'
      content = trimmed.slice(0, -3).trim()
    } else if (trimmed.endsWith(' /new')) {
      effectiveMode = 'new-agent'
      content = trimmed.slice(0, -5).trim()
    }

    // Handle slash commands (but only if not already handled by suffix logic above)
    // The "is new-agent" check handles the case where content is empty after stripping /new
    if (effectiveMode !== 'new-agent' && trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed)
      if (handled) return
    }

    if (effectiveMode === 'new-agent') {
      // Create a new tab and send the message there
      if (!options.onNewTab) {
        statusBar.setError('/new requires multi-tab mode')
        return
      }
      // Create new tab - if there's content, pass it to be sent in the new tab
      try {
        await options.onNewTab(content || undefined)
      } catch (err) {
        statusBar.setError(`Failed to create new agent: ${err instanceof Error ? err.message : String(err)}`)
      }
      return
    }

    if (effectiveMode === 'queue') {
      // Enqueue — runs after the current turn completes
      // Split by /q to allow multiple queued messages in one command
      const messages = content.split('/q').map(m => m.trim()).filter(m => m.length > 0)
      let firstMessage: string | null = null
      for (const message of messages) {
        enqueueMessage(message, session?.id)
        queuedCount++
        if (firstMessage === null) {
          firstMessage = message
        }
      }
      statusBar.setQueueState(queuedCount, pendingInterjects.length)
      updateQueuedMessages()
      if (!isLoading && firstMessage) await runAgenticTurn(firstMessage)
    } else {
      // 'send': if agent is running, treat as interject (Enter = urgent); otherwise run immediately
      if (isLoading) {
        pendingInterjects.push(interjectMessage(content, session?.id))
        statusBar.setQueueState(queuedCount, pendingInterjects.length)
        updateQueuedMessages()
      } else {
        await runAgenticTurn(content)
      }
    }
  }

  // ─── Keyboard handling ───
  const keypressHandler = async (key: any) => {
    // In multi-tab mode, ignore input if this tab is not active
    if (options.isActiveTab && !options.isActiveTab()) {
      return
    }

    // Tab → cycle views: Bot → Queue → Cron → Bot (only when not loading and not in approval)
    // This works globally including when input is focused
    if (key.name === 'tab' && !isLoading && !pendingApproval) {
      key.preventDefault?.()
      cycleViews()
      return
    }

    // Escape → abort agent OR stop workflow
    if (key.name === 'escape') {
      // First try to abort running agent
      if (isLoading && abortController) {
        abortController.abort()
        // Also stop the workflow to keep state consistent (allows restart)
        if (workflowManager?.isActive()) {
          workflowManager.stop()
          updateWorkflowDisplay()
          if (session) {
            session.workflowState = workflowManager.getState()
          }
        }
        return
      }
      // Otherwise try to stop active workflow
      if (workflowManager?.isActive()) {
        stopWorkflow()
        return
      }
    }

    // Approval navigation when approval prompt is visible
    if (pendingApproval) {
      if (key.name === 'left' || key.name === 'right') {
        const dir = key.name === 'left' ? -1 : 1
        approvalSelectedIndex = (approvalSelectedIndex + dir + approvalChoices.length) % approvalChoices.length
        renderApprovalButtons()
        return
      }
      if (key.name === 'return' || key.name === 'enter') {
        const choice = approvalChoices[approvalSelectedIndex]
        pendingApproval.resolve(choice.value)
        hideApprovalPrompt()
        return
      }
      if (key.name === 'escape') {
        pendingApproval.resolve('reject')
        hideApprovalPrompt()
        return
      }
      return
    }

  }
  renderer.keyInput.on('keypress', keypressHandler)

  // Register cleanup for keyboard handler
  options.registerCleanupCallback?.(() => {
    renderer.keyInput.off('keypress', keypressHandler)
  })

  // ─── Copy on select (X11-style) ───
  // When the user finishes a mouse drag selection, auto-copy to clipboard.
  // OSC 52 has size limits (~700KB typical), so use system clipboard for large text.
  const selectionHandler = (selection: any) => {
    if (!selection) return
    const text = selection.getSelectedText()
    if (!text) return

    // Use system clipboard for large text (> 100KB) or if OSC 52 fails
    const useSystemCopy = text.length > 100000 || !renderer.isOsc52Supported()
    let copied = false

    const showCopiedNotification = () => {
      if (copied) statusBar.showCopied(text.length)
    }

    if (useSystemCopy) {
      const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip'
      const args = process.platform === 'darwin' ? [] : ['-selection', 'clipboard']
      try {
        const { spawn } = require('child_process')
        const child = spawn(cmd, args)
        child.stdin.write(text)
        child.stdin.end()
        child.on('close', (code: number) => {
          if (code === 0) {
            copied = true
            showCopiedNotification()
          }
        })
      } catch {}
    } else {
      copied = renderer.copyToClipboardOSC52(text)
      // Fallback to system clipboard if OSC 52 fails
      if (!copied) {
        const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip'
        const args = process.platform === 'darwin' ? [] : ['-selection', 'clipboard']
        try {
          const { spawn } = require('child_process')
          const child = spawn(cmd, args)
          child.stdin.write(text)
          child.stdin.end()
          child.on('close', (code: number) => {
            if (code === 0) {
              copied = true
              showCopiedNotification()
            }
          })
        } catch {}
      } else {
        showCopiedNotification()
      }
    }

    // Clear the selection after copying
    renderer.clearSelection()
  }
  renderer.on(CliRenderEvents.SELECTION, selectionHandler)

  // Register cleanup for selection handler
  options.registerCleanupCallback?.(() => {
    renderer.off(CliRenderEvents.SELECTION, selectionHandler)
  })

  // Register cleanup for cron timer
  options.registerCleanupCallback?.(() => {
    stopCronTimer()
  })

  // ─── SIGTERM handler (clean shutdown on kill) ───
  process.on('SIGTERM', async () => {
    // Save workflow state and cost before exit
    if (session && workflowManager) {
      session.workflowState = workflowManager.getState()
      session.totalCost = totalCost
      if (client && config) {
        try {
          await saveSession(session)
        } catch {}
      }
    }
    // Don't call global clearApprovalHandler() - it affects all tabs in multi-tab mode
    // Each tab's approvalManager will be garbage collected naturally
    await mcpManager.close()
    statusBar.destroy()
    renderer.destroy()
    process.exit(0)
  })

  // ─── Initialise ───
  if (options.logLevel) {
    const level = LogLevel[options.logLevel.toUpperCase() as keyof typeof LogLevel]
    if (level !== undefined) { setLogLevel(level); initLogFile(); logger.info(`ProtoAgent started with log level: ${options.logLevel}`) }
  }
  if (options.dangerouslySkipPermissions) {
    setDangerouslySkipPermissions(true)
  }

  // Set up approval handler on the injected approvalManager
  approvalManager.setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
    return new Promise((resolve) => {
      pendingApproval = { request: req, resolve }
      showApprovalPrompt(req)
    })
  })

  // Initial loading indicator
  statusBar.setError(null)

  try {
    await loadRuntimeConfig()
    const loadedConfig = readConfig('active')
    if (!loadedConfig) {
      statusBar.setError('No config found. Run: protoagent configure --provider <id> --model <id> --api-key <key>')
      return
    }

    config = loadedConfig
    client = buildClient(config)

    // Initialize workflow manager
    workflowManager = new WorkflowManager(
      {
        initialWorkflow: 'queue',
        onWorkflowChange: (type) => {
          logger.debug(`Workflow changed to: ${type}`)
          updateWorkflowDisplay()
        },
        onWorkflowComplete: (type, summary) => {
          logger.debug(`Workflow completed: ${type}`)
          if (summary) {
            // Add completion summary to messages
            completionMessages = [
              ...completionMessages,
              { role: 'assistant', content: summary },
            ]
            msgHistory.setMessages(completionMessages)
          }
          updateWorkflowDisplay()
        },
      },
      true // use compact diagrams for sidebar
    )

    // Register tool registry and cron schedule handler
    workflowManager.registerToolRegistry(toolRegistry)
    workflowManager.setCronScheduleHandler(async (args: { schedule: string; prompt: string }) => {
      if (!workflowManager) return 'Error: Workflow manager not initialized'

      const cronWorkflow = workflowManager.getCurrentWorkflow() as CronWorkflow
      cronWorkflow.setSchedule(args.schedule, args.prompt)

      // Update session with new cron state
      if (session) {
        session.workflowState = workflowManager.getState()
      }

      updateWorkflowDisplay()

      return `Cron schedule set: ${args.schedule}. Prompt: "${args.prompt}"`
    })

     const provider = getProvider(config.provider)
     welcomeScreen.setInfo(provider?.name || config.provider, config.model)

     // Initialize MCP servers in the background without blocking UI
     mcpManager.initialize()
       .then(() => {
         // Update MCP status in status bar after initialization
         const mcpStatus = mcpManager.getConnectionStatusArray()
         statusBar.setMcpStatus(mcpStatus)
         // Notify TabManager that MCP is ready so sidebar can update
         options.onMcpReady?.()
       })
       .catch((err) => {
         logger.error(`MCP initialization failed: ${err.message}`)
       })

    let loadedSession: Session | null = null
    if (options.sessionId) {
      logger.debug(`Loading session ${options.sessionId}`)
      loadedSession = await loadSession(options.sessionId)
      logger.debug(`Session load result: ${loadedSession ? 'found' : 'not found'}, messages: ${loadedSession?.completionMessages?.length || 0}`)
      if (loadedSession) {
        // Use per-tab toolRegistry when generating system prompt for loaded session
        // to ensure MCP tools are included in the tool descriptions. Append
        // `systemPromptExtra` (e.g. the Manager's role preamble) if provided.
        let sp = await generateSystemPrompt(toolRegistry)
        if (options.systemPromptExtra && options.systemPromptExtra.trim()) {
          sp = `${sp}\n\n---\n${options.systemPromptExtra.trim()}`
        }
        loadedSession.completionMessages = ensureSystemPromptAtTop(loadedSession.completionMessages, sp)
        setTodosForSession(loadedSession.id, loadedSession.todos)
        loadQueueFromSession(loadedSession.queuedMessages, loadedSession.id)
        // Restore pending interjects from session
        if (loadedSession.interjectMessages?.length > 0) {
          pendingInterjects.push(...loadedSession.interjectMessages)
        }
        // Restore total cost from session
        if (typeof loadedSession.totalCost === 'number') {
          totalCost = loadedSession.totalCost
          statusBar.setUsage(lastUsage, totalCost)
        }
        session = loadedSession
        completionMessages = loadedSession.completionMessages
        // Reset message history to ensure proper rendering/spacing for forked sessions
        msgHistory.resetMessages()
        msgHistory.setMessages(completionMessages)
        welcomeScreen.setInfo(provider?.name || config.provider, config.model, session.id.slice(0, 8))
        options.onSessionInfo?.(provider?.name || config.provider, config.model, session.id)
        updateQueuedMessages()
        // Restore workflow state if present
        if (loadedSession.workflowState && workflowManager) {
          workflowManager.deserialize(loadedSession.workflowState)
          updateWorkflowDisplay()

          // Start cron timer if restoring a cron workflow
          if (loadedSession.workflowState.type === 'cron' && loadedSession.workflowState.isActive) {
            startCronTimer()
          }
        }
        // Transition to main view since we have an existing session with messages
        logger.debug(`Calling transitionToMainView for restored session`)
        transitionToMainView()
        logger.debug(`After transitionToMainView, inWelcomeView=${inWelcomeView}`)
      } else {
        logger.debug(`Session ${options.sessionId} not found, will create new session`)
        statusBar.setError(`Session "${options.sessionId}" not found. Starting new session.`)
      }
    }

    if (!loadedSession) {
      // Pass the per-tab toolRegistry + optional extra preamble so the
      // Manager tab sees its role + manager-tool descriptions.
      const initialMsgs = await initializeMessages(toolRegistry, options.systemPromptExtra)
      completionMessages = initialMsgs
      const newSession = createSession(config.model, config.provider)
      clearTodos(newSession.id)
      clearMessageQueue(newSession.id)
      newSession.completionMessages = initialMsgs
      session = newSession
      welcomeScreen.setInfo(provider?.name || config.provider, config.model, session.id.slice(0, 8))
      options.onSessionInfo?.(provider?.name || config.provider, config.model, session.id)
      updateQueuedMessages()
      // Initialize workflow display
      updateWorkflowDisplay()
    }
  } catch (err: any) {
    statusBar.setError(`Initialization failed: ${err.message}`)
  }

  // Focus the input
  inputBar.focus()

  // ─── Handle initial message (for /new suffix) ───
  if (options.initialMessage) {
    transitionToMainView()
    // Fire-and-forget: don't await so tab switch completes immediately
    // The agentic loop will run in the background on the new tab
    handleSubmit(options.initialMessage, 'send')
  }
}

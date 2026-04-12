/**
 * App.ts — ProtoAgent OpenTUI application.
 *
 * Creates and wires up:
 *  - Header / status bar
 *  - MessageHistory (left, scrollable)
 *  - TodoSidebar (right)
 *  - InputBar (bottom)
 *  - Approval prompt (overlay text when a tool needs approval)
 *
 * Layout:
 * ┌──────────────────────────────────────────────┐  header
 * │  Chat History         │  TODOs               │  } flex grow
 * ├───────────────────────┴──────────────────────┤
 * │ ⠙ Thinking…                                  │  status row
 * │ in:123 out:456  $0.0012                      │  usage row
 * │ ┌────────────────────────────────────────┐   │  input bar
 * │ │ > [type here]                          │   │
 * │ └────────────────────────────────────────┘   │
 * └──────────────────────────────────────────────┘
 */

import { type CliRenderer, BoxRenderable, TextRenderable, t, fg, bold, StyledText, CliRenderEvents } from '@opentui/core'
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
import { setDangerouslySkipPermissions, setApprovalHandler } from '../tools/index.js'
import type { ApprovalRequest, ApprovalResponse } from '../utils/approval.js'
import { setLogLevel, LogLevel, initLogFile, logger } from '../utils/logger.js'
import {
  createSession,
  ensureSystemPromptAtTop,
  saveSession,
  loadSession,
  generateTitle,
  type Session,
} from '../sessions.js'
import {
  clearTodos,
  getTodosForSession,
  setTodosForSession,
  addTodo,
  deleteTodo,
  updateTodo,
  type TodoItem,
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

import { MessageHistory } from './MessageHistory.js'
import { TodoSidebar } from './TodoSidebar.js'
import { InputBar, type SubmitMode } from './InputBar.js'
import { StatusBar } from './StatusBar.js'
import { WelcomeScreen } from './WelcomeScreen.js'

// ─── Slash commands ───
const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all available commands' },
  { name: '/pop', description: 'Pop next queued message' },
  { name: '/clear', description: 'Clear the queue' },
  { name: '/q', description: 'Queue a message to run after current task' },
  { name: '/rename', description: 'Rename the current tab' },
  { name: '/reconnect', description: 'Reconnect all MCP servers' },
  { name: '/quit', description: 'Exit ProtoAgent' },
  { name: '/exit', description: 'Alias for /quit' },
]

const HELP_TEXT = [
  'Commands:',
  ...SLASH_COMMANDS.map((cmd) => `  ${cmd.name} — ${cmd.description}`),
  '',
  'Message prefixes:',
  '  !message   Queue (process after current)',
  '  !!message  Interject (add to next LLM iteration)',
  '',
  'Keyboard shortcuts:',
  '  Esc        Abort running agent task',
  '  Ctrl+C     Exit',
].join('\n')

export interface AppOptions {
  dangerouslySkipPermissions?: boolean
  logLevel?: string
  sessionId?: string
  // Optional per-tab managers for multi-tab support (Phase 2+)
  toolRegistry?: ToolRegistry
  mcpManager?: McpManager
  approvalManager?: ApprovalManager
  // Optional container for multi-tab mode (if omitted, uses renderer.root)
  container?: BoxRenderable
  // Optional callback to check if this tab is active (for multi-tab input handling)
  isActiveTab?: () => boolean
  // Optional callback to update tab title
  onTitleUpdate?: (title: string) => void
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

const GREEN = '#09A469'
const DIM = '#666666'
const RED = '#f7768e'
const YELLOW = '#e0af68'

export async function createApp(renderer: CliRenderer, options: AppOptions): Promise<void> {
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

  // ─── Root layout ───
  renderer.setBackgroundColor('#000000')

  const rootBox = new BoxRenderable(renderer, {
    id: 'root',
    flexDirection: 'column',
    flexGrow: 1,
    maxHeight: '100%',
    maxWidth: '100%',
    backgroundColor: '#000000',
  })
  rootContainer.add(rootBox)

  // ─── Welcome screen ───
  const welcomeScreen = new WelcomeScreen(renderer, (value) => {
    // First message — transition to main view then submit
    transitionToMainView()
    handleSubmit(value, 'send')
  })
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

  // ─── Main content area (left panel + sidebar side by side, full height) ───
  const contentRow = new BoxRenderable(renderer, {
    id: 'content-row',
    flexDirection: 'row',
    flexGrow: 1,
    overflow: 'hidden',
  })
  mainView.add(contentRow)

  // ─── Left panel: chat + status + input (column, fills remaining width) ───
  const leftPanel = new BoxRenderable(renderer, {
    id: 'left-panel',
    flexDirection: 'column',
    flexGrow: 1,
    overflow: 'hidden',
  })
  contentRow.add(leftPanel)

  // ─── MessageHistory (fills left panel vertically) ───
  const msgHistory = new MessageHistory({ renderer })
  leftPanel.add(msgHistory.root)

  // Clicking anywhere in the left panel refocuses the input
  leftPanel.onMouseDown = () => {
    inputBar.focus()
  }

  // ─── Bottom status + input bar (inside leftPanel, so sidebar spans full height) ───
  leftPanel.add(statusBar.statusRoot)

  // Clicking the status rows also refocuses input
  statusBar.statusRoot.onMouseDown = () => { inputBar.focus() }

  // ─── Approval prompt overlay text ───
  const approvalRoot = new BoxRenderable(renderer, {
    id: 'approval-root',
    flexDirection: 'column',
    flexShrink: 0,
    marginLeft: 2,
    marginRight: 2,
    border: true,
    borderColor: GREEN,
    borderStyle: 'single',
  })
  const approvalText = new TextRenderable(renderer, {
    id: 'approval-text',
    content: t``,
  })
  approvalRoot.add(approvalText)

  // ─── Input bar ───
  const inputBar = new InputBar(renderer, handleSubmit)
  leftPanel.add(inputBar.root)

  // ─── Model info row (below input bar) ───
  const modelInfoRow = new BoxRenderable(renderer, {
    id: 'model-info-row',
    flexDirection: 'row',
    flexShrink: 0,
    paddingLeft: 2,
    paddingRight: 2,
  })
  const modelInfoText = new TextRenderable(renderer, {
    id: 'model-info-text',
    content: t`${fg(DIM)('…')}`,
  })
  modelInfoRow.add(modelInfoText)
  leftPanel.add(modelInfoRow)

  // ─── TodoSidebar (right, full terminal height) ───
  const todoSidebar = new TodoSidebar(renderer, {
    onAdd: (content) => {
      addTodo(content, 'medium', session?.id)
      todoSidebar.setTodos(getTodosForSession(session?.id))
      if (session) session.todos = getTodosForSession(session.id)
    },
    onDelete: (id) => {
      deleteTodo(id, session?.id)
      todoSidebar.setTodos(getTodosForSession(session?.id))
      if (session) session.todos = getTodosForSession(session.id)
    },
    onUpdate: (id, updates) => {
      updateTodo(id, updates, session?.id)
      todoSidebar.setTodos(getTodosForSession(session?.id))
      if (session) session.todos = getTodosForSession(session.id)
    },
  })
  contentRow.add(todoSidebar.root)

  // ─── Transition: welcome → main ───
  function transitionToMainView(): void {
    if (!inWelcomeView) return
    inWelcomeView = false
    rootBox.remove(welcomeScreen.root.id)
    rootBox.add(mainView)
    inputBar.focus()
  }

  function updateQueuedMessages(): void {
    // Update interject panel with full text
    const interjectMsgs = pendingInterjects.map(m => ({ id: m.id, content: m.content }))
    msgHistory.setInterjects(interjectMsgs)
  }

  function showApprovalPrompt(req: ApprovalRequest): void {
    const maxWidth = renderer.width - 36 - 10 // sidebar width + margins
    const truncate = (s: string, max: number) => s.length > max ? s.slice(0, max - 3) + '...' : s
    
    const sessionLabel = req.sessionScopeKey
      ? 'Approve this operation for session'
      : `Approve all "${req.type}" for session`
    
    const desc = truncate(req.description, maxWidth - 20)
    const detail = req.detail ? truncate(req.detail, maxWidth - 20) : ''
    
    approvalText.content = t`${bold(fg(GREEN)('Approval Required'))}
${desc}${detail ? `\n${detail}` : ''}

${fg(YELLOW)('[y]')} Approve once   ${fg(YELLOW)('[s]')} ${truncate(sessionLabel, 30)}   ${fg(RED)('[n]')} Reject`
    
    // Add approval to tree
    leftPanel.add(approvalRoot)
     
     // Approval prompts are displayed via the main renderer.keyInput handler
   }

  function hideApprovalPrompt(): void {
    // Remove approval from tree
    try { leftPanel.remove(approvalRoot.id) } catch {}
    pendingApproval = null
  }

  // ─── Agent event handler ───
  function handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta': {
        const delta = event.content || ''
        streamingText += delta
        isStreaming = true
        streamingTextFlushed = false
        msgHistory.setMessages(completionMessages, streamingText, isStreaming)
        break
      }
      case 'tool_call': {
        if (event.toolCall) {
          activeTool = event.toolCall.name
          statusBar.setLoading(true, activeTool)
          if (isStreaming) {
            // Flush streaming text into messages
            const trimmed = streamingText.trim()
            if (trimmed) {
              completionMessages = [...completionMessages, { role: 'assistant', content: trimmed }]
            }
            streamingText = ''
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
          
          // Update sidebar when agent uses todo tools
          if (event.toolCall.name === 'todo_write' && session) {
            todoSidebar.setTodos(getTodosForSession(session.id))
          }
        }
        activeTool = null
        statusBar.setLoading(true, null)
        break
      }
      case 'sub_agent_iteration': {
        if (event.subAgentTool) {
          const { tool, status } = event.subAgentTool
          activeTool = status === 'running' ? formatSubAgentActivity(tool, event.subAgentTool.args) : null
          statusBar.setLoading(true, activeTool)
        }
        if (event.subAgentUsage) {
          totalCost += event.subAgentUsage.estimatedCost
          statusBar.setUsage(lastUsage, totalCost)
          todoSidebar.setUsage(lastUsage ?? null, totalCost)
        }
        break
      }
      case 'usage': {
        if (event.usage) {
          lastUsage = event.usage
          totalCost += event.usage.cost
          statusBar.setUsage(lastUsage, totalCost)
          todoSidebar.setUsage(lastUsage, totalCost)
        }
        break
      }
      case 'error': {
        if (event.error) statusBar.setError(event.error)
        break
      }
      case 'iteration_done': {
        assistantWithToolsMsg = null
        break
      }
      case 'done': {
        if (isStreaming && streamingText.trim() && !streamingTextFlushed) {
          completionMessages = [...completionMessages, { role: 'assistant', content: streamingText.trim() }]
          msgHistory.setMessages(completionMessages, '', false)
        }
        streamingText = ''
        isStreaming = false
        streamingTextFlushed = false
        activeTool = null
        assistantWithToolsMsg = null
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
    if (!client || !config) return
    isLoading = true
    isStreaming = false
    streamingText = ''
    streamingTextFlushed = false
    statusBar.setLoading(true, null)
    statusBar.setError(null)
    inputBar.setLoading(true)

    // Add user message. Splice any already-pending interjects too.
    const userMsg: Message = { role: 'user', content: userContent }
    const startingInterjects = pendingInterjects.splice(0)
    const extra: Message[] = startingInterjects.map((q) => ({ role: 'user', content: `[interject] ${q.content}` }))
    completionMessages = [...completionMessages, userMsg, ...extra]
    msgHistory.setMessages(completionMessages)
    // Update interject panel to show remaining pending interjects
    updateQueuedMessages()

    try {
      const pricing = getModelPricing(config.provider, config.model)
      const requestDefaults = getRequestDefaultParams(config.provider, config.model)
      abortController = new AbortController()
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
          // Between iterations, splice in any interjects the user sent mid-turn
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
      if (session) {
        session.completionMessages = updated
        session.todos = getTodosForSession(session.id)
        session.queuedMessages = getQueueForSession(session.id)
        session.title = generateTitle(updated)
        await saveSession(session)
        
        // Update tab title if this is a multi-tab app
        if (options.onTitleUpdate) {
          options.onTitleUpdate(session.title)
        }
      }
    } catch (err: any) {
      statusBar.setError(`${err.message}`)
    } finally {
      isLoading = false
      isStreaming = false
      statusBar.setLoading(false)
      inputBar.setLoading(false)
      processQueueAfterCompletion()
    }
  }

  // ─── Handle slash commands ───
  async function handleSlashCommand(cmd: string): Promise<boolean> {
    const command = cmd.trim().split(/\s+/)[0]?.toLowerCase()
    switch (command) {
      case '/quit':
      case '/exit': {
        let resumeCmd = ''
        if (session) {
          try {
            const next: Session = {
              ...session,
              completionMessages,
              todos: getTodosForSession(session.id),
              queuedMessages: getQueueForSession(session.id),
              title: generateTitle(completionMessages),
            }
            await saveSession(next)
            resumeCmd = `protoagent --session ${session.id}`
          } catch {}
        } else {
          resumeCmd = 'protoagent'
        }
        // Show resume command before exiting
        console.log(`\nSession saved. Resume with: ${resumeCmd}`)
        renderer.destroy()
        process.exit(0)
        return true
      }
      case '/help':
        statusBar.setError(null)
        // Show help in a temporary message
        completionMessages = [...completionMessages, { role: 'user', content: '[help]' } as any]
        completionMessages = [...completionMessages, { role: 'assistant', content: HELP_TEXT } as any]
        msgHistory.setMessages(completionMessages)
        return true
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
        // Queue the rest of the message after /q
        const parts = cmd.trim().split(/\s+/)
        const content = parts.slice(1).join(' ').trim()
        if (content && client && config) {
          enqueueMessage(content, session?.id)
          queuedCount++
          statusBar.setQueueState(queuedCount, pendingInterjects.length)
          updateQueuedMessages()
          if (!isLoading) await runAgenticTurn(content)
        }
        return true
      }
       case '/clear':
        clearMessageQueue(session?.id)
        queuedCount = 0
        statusBar.setQueueState(0, pendingInterjects.length)
        todoSidebar.clearQueuedMessages()
        return true
      case '/rename': {
        // Extract new title from command: /rename new title
        const parts = cmd.trim().split(/\s+/)
        const newTitle = parts.slice(1).join(' ').trim()
        if (!newTitle) {
          statusBar.setError('Usage: /rename <new title>')
          return true
        }
        if (options.onTitleUpdate) {
          options.onTitleUpdate(newTitle)
        }
        completionMessages = [...completionMessages, { role: 'user', content: `[renamed to: ${newTitle}]` } as any]
        completionMessages = [...completionMessages, { role: 'assistant', content: `Tab renamed to: ${newTitle}` } as any]
        msgHistory.setMessages(completionMessages)
        return true
      }
      case '/reconnect': {
        statusBar.setError(null)
        statusBar.setLoading(true, 'Reconnecting MCPs...')
        try {
          await reconnectAllMcp()
          const status = getMcpConnectionStatus()
          const connected = Object.values(status).filter(s => s.connected).length
          const total = Object.keys(status).length
          completionMessages = [...completionMessages, { role: 'user', content: '[reconnect]' } as any]
          completionMessages = [...completionMessages, { role: 'assistant', content: `Reconnection complete: ${connected}/${total} MCP servers connected` } as any]
          msgHistory.setMessages(completionMessages)
        } catch (err) {
          statusBar.setError(`Reconnection failed: ${err instanceof Error ? err.message : String(err)}`)
        } finally {
          statusBar.setLoading(false)
        }
        return true
      }
      default:
        return false
    }
  }

  // ─── Handle submit ───
  async function handleSubmit(value: string, mode: SubmitMode = 'send'): Promise<void> {
    // Approval mode
    if (pendingApproval) {
      const v = value.toLowerCase().trim()
      if (v === 'y') { pendingApproval.resolve('approve_once'); hideApprovalPrompt(); return }
      if (v === 's') { pendingApproval.resolve('approve_session'); hideApprovalPrompt(); return }
      if (v === 'n') { pendingApproval.resolve('reject'); hideApprovalPrompt(); return }
      return
    }

    const trimmed = value.trim()
    if (!trimmed || !client || !config) return

    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed)
      if (handled) return
    }

    // Check for /q suffix at the end of the message (queue command)
    let effectiveMode = mode
    let content = trimmed
    if (trimmed.endsWith(' /q')) {
      effectiveMode = 'queue'
      content = trimmed.slice(0, -3).trim()
    } else if (trimmed.startsWith('!!')) {
      effectiveMode = 'interject'
      content = trimmed.slice(2).trim()
    } else if (trimmed.startsWith('!')) {
      effectiveMode = 'queue'
      content = trimmed.slice(1).trim()
    }

    if (effectiveMode === 'interject') {
      // Push into pendingInterjects — will be spliced in at the next iteration boundary
      pendingInterjects.push(interjectMessage(content, session?.id))
      statusBar.setQueueState(queuedCount, pendingInterjects.length)
      updateQueuedMessages()
      if (!isLoading) await runAgenticTurn(content)
    } else if (effectiveMode === 'queue') {
      // Enqueue — runs after the current turn completes
      enqueueMessage(content, session?.id)
      queuedCount++
      statusBar.setQueueState(queuedCount, pendingInterjects.length)
      updateQueuedMessages()
      if (!isLoading) await runAgenticTurn(content)
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
  renderer.keyInput.on('keypress', async (key) => {
    // In multi-tab mode, ignore input if this tab is not active
    if (options.isActiveTab && !options.isActiveTab()) {
      return
    }

    // Escape → abort agent
    if (key.name === 'escape' && isLoading && abortController) {
      abortController.abort()
      return
    }

    // Approval key handling when approval prompt is visible
    if (pendingApproval) {
      const seq = key.sequence?.toLowerCase()
      if (seq === 'y') { pendingApproval.resolve('approve_once'); hideApprovalPrompt(); return }
      if (seq === 's') { pendingApproval.resolve('approve_session'); hideApprovalPrompt(); return }
      if (seq === 'n') { pendingApproval.resolve('reject'); hideApprovalPrompt(); return }
      return
    }

  })

  // ─── Copy on select (X11-style) ───
  // When the user finishes a mouse drag selection, auto-copy to clipboard.
  // OSC 52 has size limits (~700KB typical), so use system clipboard for large text.
  renderer.on(CliRenderEvents.SELECTION, (selection) => {
    if (!selection) return
    const text = selection.getSelectedText()
    if (!text) return

    // Use system clipboard for large text (> 100KB) or if OSC 52 fails
    const useSystemCopy = text.length > 100000 || !renderer.isOsc52Supported()
    let copied = false

    if (useSystemCopy) {
      const cmd = process.platform === 'darwin' ? 'pbcopy' : 'xclip'
      const args = process.platform === 'darwin' ? [] : ['-selection', 'clipboard']
      try {
        const { spawn } = require('child_process')
        const child = spawn(cmd, args)
        child.stdin.write(text)
        child.stdin.end()
        child.on('close', (code: number) => { if (code === 0) copied = true })
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
          child.on('close', (code: number) => { if (code === 0) copied = true })
        } catch {}
      }
    }

    // Show copied notification
    if (copied) statusBar.showCopied(text.length)

    // Clear the selection after copying
    renderer.clearSelection()
  })

  // ─── SIGTERM handler (clean shutdown on kill) ───
  process.on('SIGTERM', async () => {
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
   if (options.dangerouslySkipPermissions) setDangerouslySkipPermissions(true)

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

     const provider = getProvider(config.provider)
     welcomeScreen.setInfo(provider?.name || config.provider, config.model)
     modelInfoText.content = t`${fg(DIM)(`… · ${provider?.name || config.provider} · ${config.model}`)}`

     // Initialize MCP servers in the background without blocking UI
     mcpManager.initialize().catch((err) => {
       logger.error(`MCP initialization failed: ${err.message}`)
     })

    let loadedSession: Session | null = null
    if (options.sessionId) {
      loadedSession = await loadSession(options.sessionId)
      if (loadedSession) {
        const sp = await generateSystemPrompt()
        loadedSession.completionMessages = ensureSystemPromptAtTop(loadedSession.completionMessages, sp)
        setTodosForSession(loadedSession.id, loadedSession.todos)
        loadQueueFromSession(loadedSession.queuedMessages, loadedSession.id)
        session = loadedSession
        completionMessages = loadedSession.completionMessages
         msgHistory.setMessages(completionMessages)
         todoSidebar.setTodos(getTodosForSession(session.id))
         welcomeScreen.setInfo(provider?.name || config.provider, config.model, session.id.slice(0, 8))
         modelInfoText.content = t`${fg(DIM)(`${session.id.slice(0, 8)} · ${provider?.name || config.provider} · ${config.model}`)}`
         updateQueuedMessages()
      } else {
        statusBar.setError(`Session "${options.sessionId}" not found. Starting new session.`)
      }
    }

    if (!loadedSession) {
      const initialMsgs = await initializeMessages()
      completionMessages = initialMsgs
      const newSession = createSession(config.model, config.provider)
      clearTodos(newSession.id)
      clearMessageQueue(newSession.id)
       newSession.completionMessages = initialMsgs
       session = newSession
       welcomeScreen.setInfo(provider?.name || config.provider, config.model, session.id.slice(0, 8))
       modelInfoText.content = t`${fg(DIM)(`${session.id.slice(0, 8)} · ${provider?.name || config.provider} · ${config.model}`)}`
       updateQueuedMessages()
    }
  } catch (err: any) {
    statusBar.setError(`Initialization failed: ${err.message}`)
  }

  // Focus the input
  inputBar.focus()
}

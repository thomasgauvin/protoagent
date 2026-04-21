/**
 * ManagerTabApp — the "Manager Agent" tab.
 *
 * Before: this was a bespoke dashboard with its own UI components, its own
 * agentic loop, its own conversation transcript, no approval flow, no real
 * MessageHistory, no StatusBar — all of which made it diverge from regular
 * tabs and miss half the features (scrollback, streaming deltas, approval
 * UX, todos sidebar, interject / queue).
 *
 * After: it's a thin wrapper around TabApp. We get MessageHistory,
 * StatusBar, ApprovalManager, todos, workflow view cycling, slash commands,
 * interject, message queue, session persistence and restore, cost tracker,
 * spinner — for free, and automatically stay in sync as TabApp evolves.
 *
 * The Manager-specific bits that survive here:
 *   - a ToolRegistry pre-populated with manager-control tools
 *     (list/create/fork/close/rename/pin/unpin/switch/queue/send-immediate
 *      tabs, get_tab_todos, get_tab_status, read_tab_conversation,
 *      get_full_status, summarize_all_sessions)
 *   - a role preamble appended to the system prompt so the agent knows it
 *     is the Manager and how to use its tools
 *   - a pinned title ("★ Manager") and a pinned tab button
 *
 * The project-management system has been removed — it wasn't used, and
 * added a lot of tool surface area the model had to reason about.
 */

import { type CliRenderer, BoxRenderable } from '@opentui/core'
import type { TabManager } from './TabManager.js'
import { TabApp } from './TabApp.js'
import type { AppOptions } from './App.js'
import { ToolRegistry } from '../tools/registry.js'
import { McpManager } from '../mcp/manager.js'
import { ApprovalManager } from '../utils/approval-manager.js'
import { TabRuntime } from './tab-runtime.js'
import { loadSession, saveSession, createSession, listSessions, type Session } from '../sessions.js'
import { enqueueMessage, interjectMessage, getQueueForSession } from '../message-queue.js'
import { getTodosForSession } from '../tools/todo.js'
import { logger } from '../utils/logger.js'

export interface ManagerTabAppConfig {
  renderer: CliRenderer
  tabManager: TabManager
  tabId: string
  container?: BoxRenderable
  onClose?: () => void
  /** Extra AppOptions passed through to the inner TabApp (e.g. onNewTab, onOpenManager, etc. from TabManager). */
  options?: Partial<AppOptions>
}

// ──────────────────────────────────────────────────────────────────────────
// Manager tool definitions.
//
// The OpenAI Tool schema format; identical shape to the regular tool
// registry's function definitions so they merge cleanly with the system
// prompt's TOOLS section via `generateSystemPrompt(toolRegistry)`.
// ──────────────────────────────────────────────────────────────────────────

const MANAGER_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_tabs',
      description:
        'List all open tabs with rich status (title, session id, message count, todo counts, queued messages, pinned, active).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_conversations',
      description:
        'List conversations known to this ProtoAgent instance. Default scope is open/live conversations (currently open tabs). Can also show saved inactive conversations or closed/archived ones.',
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['open', 'saved', 'closed', 'all'],
            description: 'Which conversations to include. Default: open.',
          },
          limit: { type: 'number', description: 'Max conversations to return. Default 20.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_tab_conversation',
      description: 'Read the most recent messages from a specific tab. Useful for seeing what another session is doing before acting on it.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab id (e.g. "tab-3") OR the session id of a tab.' },
          limit: { type: 'number', description: 'How many recent messages to return. Default 20.' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_conversation',
      description:
        'Read the most recent messages from a conversation by tab id or session id. Works for open/live conversations and saved or closed ones on disk.',
      parameters: {
        type: 'object',
        properties: {
          conversation_id: { type: 'string', description: 'A tab id or session id.' },
          limit: { type: 'number', description: 'How many recent messages to return. Default 20.' },
        },
        required: ['conversation_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queue_in_tab',
      description:
        'Queue a message in a tab. The tab processes queued messages sequentially after its current turn finishes. Use this when a session is already working and you want it to pick up more work afterwards.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab id or session id.' },
          message: { type: 'string' },
        },
        required: ['tab_id', 'message'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_message_in_tab',
      description:
        'Send a message to a tab. If the tab is currently running, this is an INTERJECT (the running turn sees the message mid-run). If the tab is idle, it starts a new turn immediately. Prefer queue_in_tab unless urgency is required.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string' },
          message: { type: 'string' },
        },
        required: ['tab_id', 'message'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_tab',
      description:
        'Create a new tab (new session). Optionally with an initial user message that will be sent as soon as the tab starts.',
      parameters: {
        type: 'object',
        properties: {
          initial_message: { type: 'string', description: 'Optional: first message to send in the new tab.' },
          switch_to: { type: 'boolean', description: 'Switch focus to the new tab. Default false — Manager usually stays where it is.' },
          title: { type: 'string', description: 'Optional title for the new tab. Otherwise generated from the first message.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fork_tab',
      description:
        'Fork a tab into a new session with the same conversation history up to now. Use this to explore alternative approaches without disturbing the original.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab id or session id to fork.' },
          switch_to: { type: 'boolean', description: 'Default false.' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'close_tab',
      description: 'Close a tab and archive that conversation out of the live tab set.',
      parameters: {
        type: 'object',
        properties: { tab_id: { type: 'string' } },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'switch_to_tab',
      description: 'Move the user\'s focus to a tab.',
      parameters: {
        type: 'object',
        properties: { tab_id: { type: 'string' } },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rename_tab',
      description: 'Rename a tab.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string' },
          new_title: { type: 'string' },
        },
        required: ['tab_id', 'new_title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'pin_tab',
      description: 'Pin a tab to the top of the sidebar.',
      parameters: {
        type: 'object',
        properties: { tab_id: { type: 'string' } },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'unpin_tab',
      description: 'Unpin a tab.',
      parameters: {
        type: 'object',
        properties: { tab_id: { type: 'string' } },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_tab_todos',
      description: 'Get the TODO list from a specific tab.',
      parameters: {
        type: 'object',
        properties: { tab_id: { type: 'string' } },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_tab_status',
      description:
        'Get full status for a tab: session id, model, message count, todos summary, queued message count, active/idle/queued.',
      parameters: {
        type: 'object',
        properties: { tab_id: { type: 'string' } },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_conversation_status',
      description:
        'Get detailed status for a conversation by tab id or session id, including whether it is open/live, saved inactive, or closed/archived.',
      parameters: {
        type: 'object',
        properties: { conversation_id: { type: 'string' } },
        required: ['conversation_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_full_status',
      description:
        'Get a comprehensive status snapshot across all tabs — totals, which are active/idle/queued, blockers (sessions with queued work but not active).',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'summarize_all_sessions',
      description:
        'Produce a short summary of what each session is currently working on (based on pending todos or last user message).',
      parameters: {
        type: 'object',
        properties: {
          include_completed: { type: 'boolean', description: 'Default false.' },
        },
        required: [],
      },
    },
  },
] as const

// ──────────────────────────────────────────────────────────────────────────
// System-prompt preamble appended for the Manager role.
// ──────────────────────────────────────────────────────────────────────────

const MANAGER_PREAMBLE = `You are the **Manager Agent** — a coordinator with oversight over every other tab/session in this protoagent instance.

## Your job
Delegate work to other sessions, monitor their progress, and keep the user's overall plan organized. You have omniscient read access to every tab and full control to spawn, fork, queue-message, rename, and close them.

## Available control tools
**Read / observe:**
- list_conversations — best first tool for “what conversations are current/open/closed?”
- list_tabs — summary of all tabs with counts
- get_tab_status — detailed status of one tab
- get_conversation_status — status by tab id or session id, including saved/closed conversations
- get_tab_todos — that tab's TODO list
- read_tab_conversation — recent messages from any tab
- read_conversation — recent messages from any conversation by tab/session id
- get_full_status — high-level overview + blockers
- summarize_all_sessions — what each tab is working on

**Spawn / control:**
- create_tab — new session (optionally with a first message)
- fork_tab — duplicate a session's history into a new tab to try an alternative
- close_tab, rename_tab, pin_tab, unpin_tab — tab lifecycle
- switch_to_tab — move the user's focus to a tab

**Send work:**
- queue_in_tab — append to a tab's message queue (processed after its current turn)
- send_message_in_tab — interject (if tab is busy) or start a new turn (if idle)

## Guidance
- When the user asks about **current conversations**, **open tabs**, **live sessions**, or **closed conversations**, start with list_conversations or get_conversation_status.
- Do **not** inspect session files with bash/read_file for conversation inventory unless the user explicitly asks about on-disk storage.
- **Prefer queue_in_tab over send_message_in_tab** unless there's a real reason to interrupt.
- **Use create_tab for independent parallel work.** Don't stuff everything into one session.
- **Use fork_tab** when the user says "try another approach" or "what if we did it differently" — fork the relevant tab, then queue the alternative in the new one.
- **read_tab_conversation first** before queueing a new message into a tab you haven't been watching — keep context.
- Your own file/code tools still work here if you need to look at things yourself, but prefer delegating to a spawned session.
- Report back to the user with a crisp summary: what you spawned, what you queued, what's blocked.`

// ──────────────────────────────────────────────────────────────────────────

export class ManagerTabApp {
  private renderer: CliRenderer
  private tabManager: TabManager
  private onClose?: () => void
  private tabId: string = 'manager'
  private title: string = '★ Manager'
  private isClosed: boolean = false
  private tabApp: TabApp | null = null
  private toolRegistry: ToolRegistry
  private mcpManager: McpManager
  private approvalManager: ApprovalManager
  private session: Session | null = null
  private container?: BoxRenderable
  private extraOptions: Partial<AppOptions>

  constructor({ renderer, tabManager, tabId, container, onClose, options }: ManagerTabAppConfig) {
    this.renderer = renderer
    this.tabManager = tabManager
    this.tabId = tabId
    this.onClose = onClose
    this.extraOptions = options ?? {}
    this.container = container

    // Dedicated isolation for the Manager — its own tool registry so manager
    // tools don't leak into regular tabs, its own MCP + approval manager for
    // the same reason.
    this.toolRegistry = new ToolRegistry()
    this.mcpManager = new McpManager(this.toolRegistry)
    this.approvalManager = new ApprovalManager()

    this.registerManagerTools()
  }

  // ──────────────────────────────────────────────────────────────────────
  // Tool registration
  // ──────────────────────────────────────────────────────────────────────

  private registerManagerTools(): void {
    for (const tool of MANAGER_TOOLS) {
      this.toolRegistry.registerDynamicTool(tool as any)
    }

    // Resolve either a tab_id (e.g. "tab-3", "manager-1") or a session id
    // to the TabApp. Accepting both shapes lets the model use whatever
    // handle it most recently saw — we don't force it to remember which.
    const getTabById = (tabId: string): any | null => {
      return (this.tabManager as any).tabs?.get(tabId) ?? null
    }

    const resolveTab = (idOrSession: string): { tabId: string; tab: any } | null => {
      const tabIds = this.tabManager.getAllTabIds()
      if (tabIds.includes(idOrSession)) {
        const tab = getTabById(idOrSession)
        return tab ? { tabId: idOrSession, tab } : null
      }
      // Try by session id
      for (const tid of tabIds) {
        const tab = getTabById(tid)
        const sid = tab?.getSessionId?.()
        if (sid === idOrSession) return { tabId: tid, tab }
      }
      return null
    }

    const getLastUserMessagePreview = (session: Session): string | null => {
      const lastUserMsg = [...(session.completionMessages || [])]
        .reverse()
        .find((m) => m.role === 'user' && typeof m.content === 'string')
      if (!lastUserMsg || typeof lastUserMsg.content !== 'string') return null
      return lastUserMsg.content.slice(0, 200)
    }

    const buildConversationRow = async (
      session: Session,
      resolved?: { tabId: string; tab: any } | null,
    ): Promise<Record<string, unknown>> => {
      const isOpen = Boolean(resolved)
      const todos = isOpen ? getTodosForSession(session.id) : session.todos
      const queue = isOpen ? getQueueForSession(session.id) : session.queuedMessages
      const activeId = this.tabManager.getActiveTabId()
      return {
        session_id: session.id,
        tab_id: resolved?.tabId ?? null,
        title: resolved?.tab?.getTitle?.() ?? session.title ?? 'New session',
        scope: isOpen ? 'open' : session.deleted ? 'closed' : 'saved',
        is_open: isOpen,
        is_active: resolved?.tabId === activeId,
        is_running: Boolean(resolved?.tab?.getIsRunning?.()),
        has_approval_pending: Boolean(resolved?.tab?.getHasApprovalPending?.()),
        is_pinned: resolved?.tabId ? this.tabManager.isTabPinned(resolved.tabId) : false,
        is_manager: resolved?.tabId === this.tabId,
        provider: session.provider,
        model: session.model,
        updated_at: session.updatedAt,
        created_at: session.createdAt,
        message_count: session.completionMessages?.length ?? 0,
        queued_messages: queue?.length ?? 0,
        todos: {
          total: todos?.length ?? 0,
          completed: (todos || []).filter((t) => t.status === 'completed').length,
          in_progress: (todos || []).filter((t) => t.status === 'in_progress').length,
          pending: (todos || []).filter((t) => t.status === 'pending').length,
        },
        last_user_message: getLastUserMessagePreview(session),
      }
    }

    const resolveConversation = async (idOrSession: string): Promise<{
      session: Session
      resolvedTab: { tabId: string; tab: any } | null
      scope: 'open' | 'saved' | 'closed'
    } | null> => {
      const resolvedTab = resolveTab(idOrSession)
      if (resolvedTab) {
        const sessionId = resolvedTab.tab?.getSessionId?.()
        if (!sessionId) return null
        const session = await loadSession(sessionId, { includeDeleted: true })
        if (!session) return null
        return { session, resolvedTab, scope: 'open' }
      }
      const session = await loadSession(idOrSession, { includeDeleted: true })
      if (!session) return null
      return { session, resolvedTab: null, scope: session.deleted ? 'closed' : 'saved' }
    }

    this.toolRegistry.registerDynamicHandler('list_tabs', async () => {
      const tabIds = this.tabManager.getAllTabIds()
      const activeId = this.tabManager.getActiveTabId()
      const rows = await Promise.all(tabIds.map(async (tid) => {
        const tab = getTabById(tid)
        const sessionId: string | undefined = tab?.getSessionId?.()
        const base: Record<string, unknown> = {
          tab_id: tid,
          is_active: tid === activeId,
          is_running: Boolean(tab?.getIsRunning?.()),
          has_approval_pending: Boolean(tab?.getHasApprovalPending?.()),
          is_pinned: this.tabManager.isTabPinned(tid),
          is_manager: tid === this.tabId,
          session_id: sessionId ?? null,
          title: tab?.getTitle?.() ?? null,
        }
        if (sessionId) {
          try {
            const session = await loadSession(sessionId)
            if (session) {
              const todos = getTodosForSession(sessionId)
              const queue = getQueueForSession(sessionId)
              base.message_count = session.completionMessages?.length ?? 0
              base.todos_total = todos.length
              base.todos_completed = todos.filter((t) => t.status === 'completed').length
              base.queued_messages = queue.length
              base.model = session.model
              base.provider = session.provider
            }
          } catch { /* ignore */ }
        }
        return base
      }))
      return JSON.stringify(rows, null, 2)
    })

    this.toolRegistry.registerDynamicHandler('list_conversations', async (args: any) => {
      const scope = args?.scope ?? 'open'
      const limit = Math.max(1, Math.min(200, args?.limit ?? 20))

      if (scope === 'open') {
        const rows = await Promise.all(
          this.tabManager.getAllTabIds().map(async (tabId) => {
            const tab = getTabById(tabId)
            const sessionId: string | undefined = tab?.getSessionId?.()
            if (!sessionId) return null
            const session = await loadSession(sessionId, { includeDeleted: true })
            if (!session) return null
            return buildConversationRow(session, { tabId, tab })
          }),
        )
        const allConversations = rows.filter(Boolean)
        const conversations = allConversations.slice(0, limit)
        return JSON.stringify({ scope: 'open', total: allConversations.length, conversations }, null, 2)
      }

      const summaries = await listSessions()
      const rows: Array<Record<string, unknown>> = []
      for (const summary of summaries) {
        const session = await loadSession(summary.id, { includeDeleted: true })
        if (!session) continue
        const resolvedTab = resolveTab(session.id)
        const row = await buildConversationRow(session, resolvedTab)
        if (scope === 'saved' && row.scope !== 'saved') continue
        if (scope === 'closed' && row.scope !== 'closed') continue
        rows.push(row)
      }

      if (scope === 'all') {
        return JSON.stringify({
          scope: 'all',
          total: rows.length,
          conversations: rows.slice(0, limit),
        }, null, 2)
      }

      return JSON.stringify({ scope, total: rows.length, conversations: rows.slice(0, limit) }, null, 2)
    })

    this.toolRegistry.registerDynamicHandler('read_tab_conversation', async (args: any) => {
      const resolved = await resolveConversation(args.tab_id)
      if (!resolved) return `Error: conversation ${args.tab_id} not found`
      const limit = Math.max(1, Math.min(200, args.limit ?? 20))
      const messages = (resolved.session.completionMessages || []).slice(-limit)
      return JSON.stringify(messages, null, 2)
    })

    this.toolRegistry.registerDynamicHandler('read_conversation', async (args: any) => {
      return this.toolRegistry.handleToolCall('read_tab_conversation', { tab_id: args.conversation_id, limit: args.limit })
    })

    this.toolRegistry.registerDynamicHandler('queue_in_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      const sessionId = resolved.tab?.getSessionId?.()
      if (!sessionId) return `Error: tab ${args.tab_id} has no session`
      enqueueMessage(args.message, sessionId)
      return `Queued message in tab ${resolved.tabId} (session ${sessionId}). It will run after the current turn finishes.`
    })

    this.toolRegistry.registerDynamicHandler('send_message_in_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      const sessionId = resolved.tab?.getSessionId?.()
      if (!sessionId) return `Error: tab ${args.tab_id} has no session`
      // If the tab is running, interject. Otherwise enqueue (TabApp will
      // pick it up on next idle tick).
      const isRunning = Boolean(resolved.tab?.getIsRunning?.())
      if (isRunning) {
        interjectMessage(args.message, sessionId)
        return `Interjected into tab ${resolved.tabId} (session ${sessionId}) — the current turn will see it immediately.`
      }
      enqueueMessage(args.message, sessionId)
      return `Tab ${resolved.tabId} was idle — queued the message (will process on next activation).`
    })

    this.toolRegistry.registerDynamicHandler('create_tab', async (args: any) => {
      const switchTo = args.switch_to ?? false
      const newTab = await this.tabManager.createTab(undefined, switchTo, args.initial_message, args.title)
      const sid = newTab?.getSessionId?.() ?? 'unknown'
      return `Created tab with session ${sid}${args.initial_message ? ` and initial message.` : '.'}`
    })

    this.toolRegistry.registerDynamicHandler('fork_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      const sessionId = resolved.tab?.getSessionId?.()
      if (!sessionId) return `Error: tab ${args.tab_id} has no session`
      const session = await loadSession(sessionId)
      if (!session) return `Error: session ${sessionId} not found`
      const forked = createSession(session.model, session.provider)
      forked.completionMessages = [...session.completionMessages]
      forked.todos = session.todos.map((t) => ({ ...t }))
      forked.queuedMessages = [...session.queuedMessages]
      forked.title = `Fork of ${session.title || 'session'}`
      await saveSession(forked)
      await this.tabManager.createTab(forked.id, args.switch_to ?? false, undefined, forked.title)
      return `Forked tab ${resolved.tabId} into a new tab with session ${forked.id}.`
    })

    this.toolRegistry.registerDynamicHandler('close_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      if (resolved.tabId === this.tabId) {
        return 'Refusing to close the Manager tab via this tool — the user can close it from the sidebar.'
      }
      await this.tabManager.closeTab(resolved.tabId)
      return `Closed tab ${resolved.tabId}.`
    })

    this.toolRegistry.registerDynamicHandler('switch_to_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      await this.tabManager.switchTab(resolved.tabId)
      return `Switched focus to tab ${resolved.tabId}.`
    })

    this.toolRegistry.registerDynamicHandler('rename_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      this.tabManager.updateTabTitle(resolved.tabId, args.new_title)
      return `Renamed tab ${resolved.tabId} to "${args.new_title}".`
    })

    this.toolRegistry.registerDynamicHandler('pin_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      this.tabManager.pinTab(resolved.tabId)
      return `Pinned tab ${resolved.tabId}.`
    })

    this.toolRegistry.registerDynamicHandler('unpin_tab', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      this.tabManager.unpinTab(resolved.tabId)
      return `Unpinned tab ${resolved.tabId}.`
    })

    this.toolRegistry.registerDynamicHandler('get_tab_todos', async (args: any) => {
      const resolved = resolveTab(args.tab_id)
      if (!resolved) return `Error: tab ${args.tab_id} not found`
      const sessionId = resolved.tab?.getSessionId?.()
      if (!sessionId) return `Error: tab ${args.tab_id} has no session`
      return JSON.stringify(getTodosForSession(sessionId), null, 2)
    })

    this.toolRegistry.registerDynamicHandler('get_tab_status', async (args: any) => {
      const resolved = await resolveConversation(args.tab_id)
      if (!resolved) return JSON.stringify({ conversation_id: args.tab_id, exists: false })
      const status = await buildConversationRow(resolved.session, resolved.resolvedTab)
      return JSON.stringify({ exists: true, ...status }, null, 2)
    })

    this.toolRegistry.registerDynamicHandler('get_conversation_status', async (args: any) => {
      return this.toolRegistry.handleToolCall('get_tab_status', { tab_id: args.conversation_id })
    })

    this.toolRegistry.registerDynamicHandler('get_full_status', async () => {
      const tabIds = this.tabManager.getAllTabIds()
      const activeId = this.tabManager.getActiveTabId()
      const sessions = await Promise.all(tabIds.map(async (tid) => {
        const tab = getTabById(tid)
        const sid: string | undefined = tab?.getSessionId?.()
        if (!sid) return null
        try {
          const session = await loadSession(sid)
          if (!session) return null
          const todos = getTodosForSession(sid)
          const queue = getQueueForSession(sid)
          const completed = todos.filter((t) => t.status === 'completed').length
          return {
            tab_id: tid,
            session_id: sid,
            title: session.title || tab?.getTitle?.() || 'New Agent',
            status: Boolean(tab?.getIsRunning?.())
              ? 'running'
              : tid === activeId
                ? 'active'
                : queue.length > 0
                  ? 'queued_work'
                  : 'idle',
            has_approval_pending: Boolean(tab?.getHasApprovalPending?.()),
            is_pinned: this.tabManager.isTabPinned(tid),
            todos: { total: todos.length, completed },
            queued_messages: queue.length,
          }
        } catch {
          return null
        }
      }))
      const filtered = sessions.filter(Boolean) as Array<Record<string, any>>
      const blockers = filtered
        .filter((s) => s.queued_messages > 0 && s.tab_id !== activeId)
        .map((s) => ({
          kind: 'session',
          tab_id: s.tab_id,
          title: s.title,
          reason: 'has queued work but is not the active tab',
          suggestion: `Use switch_to_tab("${s.tab_id}") or the session will only run its queue when the user next activates it.`,
        }))
      return JSON.stringify({
        summary: {
          total: filtered.length,
          active: filtered.filter((s) => s.status === 'active').length,
          queued: filtered.filter((s) => s.status === 'queued_work').length,
          idle: filtered.filter((s) => s.status === 'idle').length,
        },
        sessions: filtered,
        blockers: blockers.length > 0 ? blockers : null,
      }, null, 2)
    })

    this.toolRegistry.registerDynamicHandler('summarize_all_sessions', async (args: any) => {
      const includeCompleted = args?.include_completed ?? false
      const tabIds = this.tabManager.getAllTabIds()
      const activeId = this.tabManager.getActiveTabId()
      const rows = await Promise.all(tabIds.map(async (tid) => {
        const tab = getTabById(tid)
        const sid: string | undefined = tab?.getSessionId?.()
        if (!sid) return null
        try {
          const session = await loadSession(sid)
          if (!session) return null
          const todos = getTodosForSession(sid)
          const pending = todos.filter((t) => t.status !== 'completed')
          const completed = todos.filter((t) => t.status === 'completed')
          if (!includeCompleted && pending.length === 0 && tid !== activeId) return null
          const lastUserMsg = [...(session.completionMessages || [])]
            .reverse()
            .find((m) => m.role === 'user')
          const lastUserText = typeof lastUserMsg?.content === 'string'
            ? (lastUserMsg.content as string).slice(0, 200)
            : '(no recent user message)'
          return {
            tab_id: tid,
            session_id: sid,
            title: session.title || tab?.getTitle?.() || 'New Agent',
            status: Boolean(tab?.getIsRunning?.())
              ? 'running'
              : tid === activeId
                ? 'active'
                : pending.length > 0
                  ? 'working'
                  : 'idle',
            current_todo: pending[0]?.content ?? null,
            pending_todos: pending.length,
            completed_todos: completed.length,
            last_user_message: lastUserText,
          }
        } catch {
          return null
        }
      }))
      return JSON.stringify(rows.filter(Boolean), null, 2)
    })
  }

  // ──────────────────────────────────────────────────────────────────────
  // TabApp wiring. Everything below mirrors TabApp's surface so TabManager
  // can treat us uniformly.
  // ──────────────────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.tabApp) return

    // Reuse a previously-saved Manager session if there is one; otherwise
    // create a fresh one. This means the Manager's own conversation survives
    // across app restarts, same as any other tab.
    const config = (await import('../config-core.js')).readConfig('active')
    if (!config) throw new Error('ManagerTabApp: no active config')

    this.session = createSession(config.model, config.provider)
    this.session.title = this.title

    // Build AppOptions. Pass our pre-populated toolRegistry and the role
    // preamble — TabApp will plumb them through createApp -> system prompt.
    const options: AppOptions = {
      ...this.extraOptions,
      sessionId: this.session.id,
      toolRegistry: this.toolRegistry,
      mcpManager: this.mcpManager,
      approvalManager: this.approvalManager,
      systemPromptExtra: MANAGER_PREAMBLE,
      defaultTitle: this.title,
      hideWorkflowSidebar: true,
      // Title updates come from TabApp's auto-title generator — that's fine
      // for normal tabs but the Manager's title should stay pinned. Suppress.
      onTitleUpdate: () => { /* keep "★ Manager" pinned */ },
    }

    this.tabApp = new TabApp({
      renderer: this.renderer,
      options,
      container: this.container,
      title: this.title,
    })
    // Force TabApp to use our pre-populated managers so manager tools are
    // registered before the system prompt is generated. (TabApp creates
    // its own by default; we overwrite to share state with us.)
    ;(this.tabApp as any).toolRegistry = this.toolRegistry
    ;(this.tabApp as any).mcpManager = this.mcpManager
    ;(this.tabApp as any).approvalManager = this.approvalManager

    // Rebuild the per-tab SDK runtime facade so it picks up our
    // manager-specific toolRegistry. The one TabApp constructed in its
    // constructor closed over an empty registry, which would mean the SDK
    // hot path can't see manager tools. Dispose the old runtime first.
    const originalRuntime = (this.tabApp as any).tabRuntime as TabRuntime | undefined
    if (originalRuntime) {
      await originalRuntime.close().catch(() => {})
    }
    ;(this.tabApp as any).tabRuntime = new TabRuntime({
      toolRegistry: this.toolRegistry,
      dangerouslySkipPermissions: this.extraOptions?.dangerouslySkipPermissions,
    })

    await this.tabApp.initialize()
    logger.info('Manager tab initialized (TabApp parity mode)')
  }

  getTabId(): string {
    return this.tabId
  }

  getSessionId(): string | undefined {
    return this.tabApp?.getSessionId() ?? this.session?.id
  }

  getTitle(): string {
    return this.title
  }

  setTitle(_title: string): void {
    // Manager title is pinned — ignore external updates.
  }

  setActive(active: boolean): void {
    this.tabApp?.setActive(active)
  }

  getIsActive(): boolean {
    return this.tabApp?.getIsActive() ?? false
  }

  getIsClosed(): boolean {
    return this.isClosed || (this.tabApp?.getIsClosed() ?? false)
  }

  scrollToBottom(): void {
    this.tabApp?.scrollToBottom()
  }

  focusInput(): void {
    this.tabApp?.focusInput()
  }

  ensureMainView(): void {
    this.tabApp?.ensureMainView()
  }

  getMcpManager(): McpManager {
    return this.mcpManager
  }

  getApprovalManager(): ApprovalManager {
    return this.approvalManager
  }

  registerAbortController(ac: AbortController): void {
    this.tabApp?.registerAbortController(ac)
  }

  abort(): void {
    this.tabApp?.abort()
  }

  async close(): Promise<void> {
    if (this.isClosed) return
    this.isClosed = true
    try {
      await this.tabApp?.close()
    } catch (err: any) {
      logger.warn(`ManagerTabApp close error: ${err?.message || err}`)
    }
    this.onClose?.()
    logger.info('Manager tab closed')
  }
}

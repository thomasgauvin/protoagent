/**
 * ManagerTabApp — A special tab that manages other tabs.
 *
 * The manager tab has no UI of its own (no chat history, input bar, etc.).
 * Instead, it runs an agentic loop with special tools that can:
 * - List all tabs and their status
 * - Read conversations from any tab
 * - Queue messages in tabs
 * - Fork, create, close tabs
 * - Switch between tabs
 * - Manage tab TODOs
 *
 * The manager tab is created via /manager command and appears as a special
 * tab in the sidebar (shown with a 🎛️ icon).
 */

import { type CliRenderer, BoxRenderable, TextRenderable, t, fg, bold } from '@opentui/core'
import { OpenAI } from 'openai'
import type { Config } from '../config-core.js'
import type { TabManager } from './TabManager.js'
import type { TabApp } from './TabApp.js'
import { ToolRegistry } from '../tools/registry.js'
import { McpManager } from '../mcp/manager.js'
import { ApprovalManager } from '../utils/approval-manager.js'
import { generateSystemPrompt } from '../system-prompt.js'
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from '../agentic-loop.js'
import { getProvider, getModelPricing, getRequestDefaultParams } from '../providers.js'
import { resolveApiKey, readConfig } from '../config-core.js'
import { createSession, saveSession, loadSession, type Session } from '../sessions.js'
import { clearTodos, getTodosForSession, setTodosForSession } from '../tools/todo.js'
import { clearMessageQueue, getQueueForSession, enqueueMessage } from '../message-queue.js'
import { logger } from '../utils/logger.js'
import { COLORS } from './theme.js'
import { InputBar } from './InputBar.js'
import { 
  createProject, 
  listProjects, 
  loadProject, 
  deleteProject,
  addMilestone,
  updateMilestoneStatus,
  assignSessionToProject,
  removeSessionFromProject,
  getProjectStatus,
  generateProjectReport,
  type Project,
} from '../projects.js'

export interface ManagerTabAppConfig {
  renderer: CliRenderer
  tabManager: TabManager
  container?: BoxRenderable
  onClose?: () => void
}

// Manager-specific tool definitions
const MANAGER_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'list_tabs',
      description: 'List all open tabs with their status, title, and session ID.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'read_tab_conversation',
      description: 'Read the conversation history from a specific tab.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID (e.g., "tab-0", "tab-1")' },
          limit: { type: 'number', description: 'Maximum number of recent messages to return (default: 50)' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'queue_in_tab',
      description: 'Queue a message to be processed in a specific tab.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID to queue the message in' },
          message: { type: 'string', description: 'The message to queue' },
        },
        required: ['tab_id', 'message'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'create_tab',
      description: 'Create a new tab with an optional initial message.',
      parameters: {
        type: 'object',
        properties: {
          initial_message: { type: 'string', description: 'Optional message to send in the new tab' },
          switch_to: { type: 'boolean', description: 'Whether to switch to the new tab immediately (default: false)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'close_tab',
      description: 'Close a specific tab.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID to close' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'switch_to_tab',
      description: 'Switch focus to a specific tab.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID to switch to' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'fork_tab',
      description: 'Fork a tab into a new tab with the same conversation history.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID to fork' },
          switch_to: { type: 'boolean', description: 'Whether to switch to the new tab immediately (default: false)' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'rename_tab',
      description: 'Rename a specific tab.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID to rename' },
          new_title: { type: 'string', description: 'The new title for the tab' },
        },
        required: ['tab_id', 'new_title'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'pin_tab',
      description: 'Pin a tab to keep it at the top of the sidebar.',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID to pin' },
        },
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
        properties: {
          tab_id: { type: 'string', description: 'The tab ID to unpin' },
        },
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
        properties: {
          tab_id: { type: 'string', description: 'The tab ID' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_tab_status',
      description: 'Get detailed status of a tab (loading, approval pending, etc.).',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID' },
        },
        required: ['tab_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'send_message_in_tab',
      description: 'Send a message in a tab immediately (as an interject if running, or as new message if idle).',
      parameters: {
        type: 'object',
        properties: {
          tab_id: { type: 'string', description: 'The tab ID' },
          message: { type: 'string', description: 'The message to send' },
        },
        required: ['tab_id', 'message'],
      },
    },
  },
  // Project management tools
  {
    type: 'function' as const,
    function: {
      name: 'create_project',
      description: 'Create a new project to organize related sessions.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Project name' },
          description: { type: 'string', description: 'Optional project description' },
          goals: { type: 'array', items: { type: 'string' }, description: 'List of project goals' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'list_projects',
      description: 'List all projects with their status.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_project',
      description: 'Get detailed information about a specific project.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project ID' },
        },
        required: ['project_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'delete_project',
      description: 'Delete a project and its associated data.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project ID to delete' },
        },
        required: ['project_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'add_milestone',
      description: 'Add a milestone to a project.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project ID' },
          name: { type: 'string', description: 'Milestone name' },
          description: { type: 'string', description: 'Optional milestone description' },
          depends_on: { type: 'array', items: { type: 'string' }, description: 'IDs of milestones this depends on' },
        },
        required: ['project_id', 'name'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'update_milestone',
      description: 'Update milestone status.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project ID' },
          milestone_id: { type: 'string', description: 'The milestone ID' },
          status: { type: 'string', enum: ['pending', 'in_progress', 'complete', 'blocked'], description: 'New status' },
        },
        required: ['project_id', 'milestone_id', 'status'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'assign_session_to_project',
      description: 'Assign a session to a project (and optionally a milestone).',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The session ID to assign' },
          project_id: { type: 'string', description: 'The project ID' },
          milestone_id: { type: 'string', description: 'Optional milestone ID within the project' },
        },
        required: ['session_id', 'project_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'remove_session_from_project',
      description: 'Remove a session from a project.',
      parameters: {
        type: 'object',
        properties: {
          session_id: { type: 'string', description: 'The session ID to remove' },
          project_id: { type: 'string', description: 'The project ID' },
        },
        required: ['session_id', 'project_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'generate_project_report',
      description: 'Generate a detailed markdown report for a project.',
      parameters: {
        type: 'object',
        properties: {
          project_id: { type: 'string', description: 'The project ID' },
        },
        required: ['project_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_full_status',
      description: 'Get comprehensive status of all sessions and projects with blocker detection.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'summarize_all_sessions',
      description: 'Generate a summary of what each session is working on.',
      parameters: {
        type: 'object',
        properties: {
          include_completed: { type: 'boolean', description: 'Include completed sessions (default: false)' },
        },
        required: [],
      },
    },
  },
]

/**
 * ManagerTabApp — The manager agent that controls other tabs.
 */
export class ManagerTabApp {
  private renderer: CliRenderer
  private tabManager: TabManager
  private container?: BoxRenderable
  private onClose?: () => void
  private toolRegistry: ToolRegistry
  private mcpManager: McpManager
  private approvalManager: ApprovalManager
  private isActive: boolean = false
  private isClosed: boolean = false
  private title: string = '🎛️ Manager'
  private tabId: string = 'manager'
  private config: Config | null = null
  private client: OpenAI | null = null
  private session: Session | null = null
  private completionMessages: Message[] = []
  private isLoading: boolean = false
  private abortController: AbortController | null = null
  
  // Dashboard UI elements
  private dashboardContainer?: BoxRenderable
  private sessionsListBox?: BoxRenderable
  private projectsListBox?: BoxRenderable
  private statusBox?: BoxRenderable
  private statusText?: TextRenderable
  private dashboardText?: TextRenderable
  private inputBar?: InputBar
  private refreshInterval?: ReturnType<typeof setInterval>
  private lastDashboardUpdate: number = 0
  private sessionRowIds: string[] = []
  private projectRowIds: string[] = []

  constructor({ renderer, tabManager, container, onClose }: ManagerTabAppConfig) {
    this.renderer = renderer
    this.tabManager = tabManager
    this.container = container
    this.onClose = onClose

    // Create isolated managers for the manager tab
    this.toolRegistry = new ToolRegistry()
    this.mcpManager = new McpManager(this.toolRegistry)
    this.approvalManager = new ApprovalManager()

    // Register manager-specific tools
    this.registerManagerTools()
  }

  /**
   * Register manager-specific tools in the tool registry
   */
  private registerManagerTools(): void {
    // Register tool definitions
    for (const tool of MANAGER_TOOLS) {
      this.toolRegistry.registerDynamicTool(tool)
    }

    // Register handlers
    this.toolRegistry.registerDynamicHandler('list_tabs', async () => {
      const tabIds = this.tabManager.getAllTabIds()
      const activeTabId = this.tabManager.getActiveTabId()
      const tabs = await Promise.all(tabIds.map(async (id) => {
        const isActive = id === activeTabId
        const isPinned = this.tabManager.isTabPinned(id)
        const sessionId = this.getTabSessionId(id)
        
        // Get rich session info if available
        let sessionInfo: any = { session_id: sessionId }
        if (sessionId) {
          try {
            const session = await loadSession(sessionId)
            if (session) {
              const todos = getTodosForSession(sessionId)
              const queue = getQueueForSession(sessionId)
              const completedTodos = todos.filter(t => t.status === 'completed').length
              
              sessionInfo = {
                session_id: sessionId,
                title: session.title || 'New Agent',
                message_count: session.completionMessages?.length || 0,
                todo_summary: `${completedTodos}/${todos.length}`,
                queued_messages: queue.length,
                created_at: session.createdAt,
              }
            }
          } catch (err) {
            // Session not found or error loading
          }
        }
        
        return { 
          tab_id: id, 
          is_active: isActive, 
          is_pinned: isPinned,
          ...sessionInfo,
        }
      }))
      return JSON.stringify(tabs)
    })

    this.toolRegistry.registerDynamicHandler('read_tab_conversation', async (args) => {
      // This requires exposing session data from TabManager
      // For now, return a placeholder
      const sessionId = this.getTabSessionId(args.tab_id)
      if (!sessionId) {
        return `Error: Tab ${args.tab_id} not found or has no session`
      }
      const session = await loadSession(sessionId)
      if (!session) {
        return `Error: Session ${sessionId} not found`
      }
      const limit = args.limit ?? 50
      const messages = session.completionMessages.slice(-limit)
      return JSON.stringify(messages)
    })

    this.toolRegistry.registerDynamicHandler('queue_in_tab', async (args) => {
      const sessionId = this.getTabSessionId(args.tab_id)
      if (!sessionId) {
        return `Error: Tab ${args.tab_id} not found or has no session`
      }
      enqueueMessage(args.message, sessionId)
      return `Message queued in tab ${args.tab_id}`
    })

    this.toolRegistry.registerDynamicHandler('create_tab', async (args) => {
      const newTab = await this.tabManager.createTab(undefined, args.switch_to ?? false, args.initial_message)
      return `Created new tab: ${newTab.getSessionId?.() || 'unknown'}`
    })

    this.toolRegistry.registerDynamicHandler('close_tab', async (args) => {
      if (args.tab_id === this.tabId) {
        return 'Error: Cannot close the manager tab using this tool. Use /exit or close manually.'
      }
      await this.tabManager.closeTab(args.tab_id)
      return `Closed tab ${args.tab_id}`
    })

    this.toolRegistry.registerDynamicHandler('switch_to_tab', async (args) => {
      await this.tabManager.switchTab(args.tab_id)
      return `Switched to tab ${args.tab_id}`
    })

    this.toolRegistry.registerDynamicHandler('fork_tab', async (args) => {
      const sessionId = this.getTabSessionId(args.tab_id)
      if (!sessionId) {
        return `Error: Tab ${args.tab_id} not found or has no session`
      }
      const session = await loadSession(sessionId)
      if (!session) {
        return `Error: Session ${sessionId} not found`
      }
      // Create forked session
      const { createSession } = await import('../sessions.js')
      const forkedSession = createSession(session.model, session.provider)
      forkedSession.completionMessages = [...session.completionMessages]
      forkedSession.todos = session.todos.map(t => ({ ...t }))
      forkedSession.queuedMessages = [...session.queuedMessages]
      forkedSession.title = `Fork of ${session.title || 'session'}`
      await saveSession(forkedSession)
      await this.tabManager.createTab(forkedSession.id, args.switch_to ?? false, undefined, forkedSession.title)
      return `Forked tab ${args.tab_id} into new tab with session ${forkedSession.id}`
    })

    this.toolRegistry.registerDynamicHandler('rename_tab', async (args) => {
      this.tabManager.updateTabTitle(args.tab_id, args.new_title)
      return `Renamed tab ${args.tab_id} to "${args.new_title}"`
    })

    this.toolRegistry.registerDynamicHandler('pin_tab', async (args) => {
      this.tabManager.pinTab(args.tab_id)
      return `Pinned tab ${args.tab_id}`
    })

    this.toolRegistry.registerDynamicHandler('unpin_tab', async (args) => {
      this.tabManager.unpinTab(args.tab_id)
      return `Unpinned tab ${args.tab_id}`
    })

    this.toolRegistry.registerDynamicHandler('get_tab_todos', async (args) => {
      const sessionId = this.getTabSessionId(args.tab_id)
      if (!sessionId) {
        return `Error: Tab ${args.tab_id} not found or has no session`
      }
      const todos = getTodosForSession(sessionId)
      return JSON.stringify(todos)
    })

    this.toolRegistry.registerDynamicHandler('get_tab_status', async (args) => {
      const tabIds = this.tabManager.getAllTabIds()
      const exists = tabIds.includes(args.tab_id)
      
      if (!exists) {
        return JSON.stringify({
          tab_id: args.tab_id,
          exists: false,
          error: 'Tab not found'
        })
      }
      
      const isActive = args.tab_id === this.tabManager.getActiveTabId()
      const isPinned = this.tabManager.isTabPinned(args.tab_id)
      const sessionId = this.getTabSessionId(args.tab_id)
      
      // Gather rich session status
      let status: any = {
        tab_id: args.tab_id,
        exists: true,
        is_active: isActive,
        is_pinned: isPinned,
        session_id: sessionId,
      }
      
      if (sessionId) {
        try {
          const session = await loadSession(sessionId)
          if (session) {
            const todos = getTodosForSession(sessionId)
            const queue = getQueueForSession(sessionId)
            const completedTodos = todos.filter(t => t.status === 'completed').length
            
            // Determine session status
            let sessionStatus: string
            if (queue.length > 0 && !isActive) {
              sessionStatus = 'queued_work'
            } else if (isActive) {
              sessionStatus = 'active'
            } else if (todos.length > 0 && completedTodos < todos.length) {
              sessionStatus = 'in_progress'
            } else if (todos.length > 0 && completedTodos === todos.length) {
              sessionStatus = 'completed'
            } else {
              sessionStatus = 'idle'
            }
            
            status = {
              ...status,
              session_status: sessionStatus,
              title: session.title || 'New Agent',
              model: session.model,
              provider: session.provider,
              message_count: session.completionMessages?.length || 0,
              todos: {
                total: todos.length,
                completed: completedTodos,
                pending: todos.length - completedTodos,
                items: todos.map(t => ({ id: t.id, content: t.content, status: t.status }))
              },
              queued_messages: queue.length,
              created_at: session.createdAt,
            }
          }
        } catch (err) {
          status.error = 'Failed to load session details'
        }
      }
      
      return JSON.stringify(status)
    })

    this.toolRegistry.registerDynamicHandler('send_message_in_tab', async (args) => {
      // This would require access to the TabApp's input handling
      // For now, just queue it
      const sessionId = this.getTabSessionId(args.tab_id)
      if (!sessionId) {
        return `Error: Tab ${args.tab_id} not found or has no session`
      }
      enqueueMessage(args.message, sessionId)
      return `Message queued in tab ${args.tab_id} (will run after current task completes)`
    })

    // Project management handlers
    this.toolRegistry.registerDynamicHandler('create_project', async (args) => {
      const project = await createProject(
        args.name,
        args.description || '',
        args.goals || []
      )
      return JSON.stringify({
        success: true,
        project_id: project.id,
        name: project.name,
        message: `Created project "${project.name}" (${project.id})`
      })
    })

    this.toolRegistry.registerDynamicHandler('list_projects', async () => {
      const projects = await listProjects()
      return JSON.stringify(projects.map(p => ({
        id: p.id,
        name: p.name,
        status: p.status,
        milestones_count: p.milestones.length,
        sessions_count: p.sessionIds.length,
        updated_at: p.updatedAt,
      })))
    })

    this.toolRegistry.registerDynamicHandler('get_project', async (args) => {
      const status = await getProjectStatus(args.project_id)
      if (!status) {
        return JSON.stringify({ error: 'Project not found' })
      }
      return JSON.stringify({
        project: status.project,
        summary: status.summary,
      })
    })

    this.toolRegistry.registerDynamicHandler('delete_project', async (args) => {
      const success = await deleteProject(args.project_id)
      return JSON.stringify({
        success,
        message: success ? 'Project deleted' : 'Project not found'
      })
    })

    this.toolRegistry.registerDynamicHandler('add_milestone', async (args) => {
      const milestone = await addMilestone(
        args.project_id,
        args.name,
        args.description || '',
        args.depends_on || []
      )
      if (!milestone) {
        return JSON.stringify({ error: 'Failed to add milestone - project not found' })
      }
      return JSON.stringify({
        success: true,
        milestone_id: milestone.id,
        message: `Added milestone "${milestone.name}" to project`
      })
    })

    this.toolRegistry.registerDynamicHandler('update_milestone', async (args) => {
      const success = await updateMilestoneStatus(
        args.project_id,
        args.milestone_id,
        args.status
      )
      return JSON.stringify({
        success,
        message: success ? `Milestone updated to ${args.status}` : 'Failed to update milestone'
      })
    })

    this.toolRegistry.registerDynamicHandler('assign_session_to_project', async (args) => {
      const success = await assignSessionToProject(
        args.session_id,
        args.project_id,
        args.milestone_id
      )
      return JSON.stringify({
        success,
        message: success 
          ? `Assigned session ${args.session_id} to project` + (args.milestone_id ? ` (milestone: ${args.milestone_id})` : '')
          : 'Failed to assign session - project not found'
      })
    })

    this.toolRegistry.registerDynamicHandler('remove_session_from_project', async (args) => {
      const success = await removeSessionFromProject(args.session_id, args.project_id)
      return JSON.stringify({
        success,
        message: success ? 'Session removed from project' : 'Failed to remove session'
      })
    })

    this.toolRegistry.registerDynamicHandler('generate_project_report', async (args) => {
      const report = await generateProjectReport(args.project_id)
      if (!report) {
        return JSON.stringify({ error: 'Project not found' })
      }
      return JSON.stringify({
        project_id: args.project_id,
        report,
      })
    })

    this.toolRegistry.registerDynamicHandler('get_full_status', async () => {
      const status = await this.generateFullStatus()
      return JSON.stringify(status)
    })

    this.toolRegistry.registerDynamicHandler('summarize_all_sessions', async (args) => {
      const summary = await this.summarizeAllSessions(args.include_completed ?? false)
      return JSON.stringify(summary)
    })
  }

  /**
   * Generate comprehensive status with blocker detection
   */
  private async generateFullStatus(): Promise<any> {
    const tabIds = this.tabManager.getAllTabIds()
    const activeTabId = this.tabManager.getActiveTabId()
    
    // Analyze sessions
    const sessions = await Promise.all(tabIds.map(async (id) => {
      const sessionId = this.getTabSessionId(id)
      if (!sessionId) return null
      
      try {
        const session = await loadSession(sessionId)
        if (!session) return null
        
        const todos = getTodosForSession(sessionId)
        const queue = getQueueForSession(sessionId)
        const completedTodos = todos.filter(t => t.status === 'completed').length
        
        // Detect blockers
        let blockerReason: string | null = null
        if (queue.length > 0 && id !== activeTabId) {
          blockerReason = 'has_queued_work'
        } else if (todos.length > 0 && completedTodos === todos.length && id !== activeTabId) {
          blockerReason = 'may_be_complete'
        }
        
        return {
          tab_id: id,
          session_id: sessionId,
          title: session.title || 'New Agent',
          status: id === activeTabId ? 'active' : queue.length > 0 ? 'queued' : 'idle',
          todos: { total: todos.length, completed: completedTodos },
          queued_messages: queue.length,
          is_pinned: this.tabManager.isTabPinned(id),
          blocker: blockerReason,
        }
      } catch (err) {
        return null
      }
    }))

    // Analyze projects
    const projects = await listProjects()
    const projectStatuses = await Promise.all(projects.map(async (p) => {
      const status = await getProjectStatus(p.id)
      return {
        id: p.id,
        name: p.name,
        status: p.status,
        progress: status?.summary.completionPercentage ?? 0,
        blockedMilestones: p.milestones.filter(m => m.status === 'blocked').length,
      }
    }))

    // Identify blockers
    const blockers = []
    for (const s of sessions) {
      if (s?.blocker === 'has_queued_work') {
        blockers.push({
          type: 'session',
          id: s.tab_id,
          title: s.title,
          reason: 'Has queued work but is not active',
          suggestion: `Switch to tab ${s.tab_id} or queue message to activate`,
        })
      }
    }
    for (const p of projectStatuses) {
      if (p.blockedMilestones > 0) {
        blockers.push({
          type: 'project',
          id: p.id,
          name: p.name,
          reason: `${p.blockedMilestones} blocked milestone(s)`,
          suggestion: 'Check milestone dependencies and resolve blockers',
        })
      }
    }

    return {
      summary: {
        total_sessions: sessions.filter(Boolean).length,
        active_sessions: sessions.filter(s => s?.status === 'active').length,
        total_projects: projects.length,
        completed_projects: projects.filter(p => p.status === 'complete').length,
        blockers_count: blockers.length,
      },
      sessions: sessions.filter(Boolean),
      projects: projectStatuses,
      blockers: blockers.length > 0 ? blockers : null,
    }
  }

  /**
   * Summarize what each session is working on
   */
  private async summarizeAllSessions(includeCompleted: boolean): Promise<any[]> {
    const tabIds = this.tabManager.getAllTabIds()
    const activeTabId = this.tabManager.getActiveTabId()
    
    const summaries = await Promise.all(tabIds.map(async (id) => {
      const sessionId = this.getTabSessionId(id)
      if (!sessionId) return null
      
      try {
        const session = await loadSession(sessionId)
        if (!session) return null
        
        const todos = getTodosForSession(sessionId)
        const pendingTodos = todos.filter(t => t.status !== 'completed')
        const completedTodos = todos.filter(t => t.status === 'completed')
        
        // Skip if completed and not including completed
        if (!includeCompleted && pendingTodos.length === 0 && id !== activeTabId) {
          return null
        }
        
        // Get last few messages for context
        const recentMessages = session.completionMessages
          ?.filter(m => m.role === 'user')
          .slice(-3)
          .map(m => typeof m.content === 'string' ? m.content : '[complex content]')
          || []
        
        return {
          tab_id: id,
          title: session.title || 'New Agent',
          status: id === activeTabId ? 'active' : pendingTodos.length > 0 ? 'working' : 'idle',
          current_work: pendingTodos.length > 0 
            ? pendingTodos[0].content 
            : completedTodos.length > 0 
              ? 'Recently completed: ' + completedTodos[completedTodos.length - 1].content
              : 'No active work',
          pending_tasks: pendingTodos.length,
          completed_tasks: completedTodos.length,
          recent_context: recentMessages,
          is_pinned: this.tabManager.isTabPinned(id),
        }
      } catch (err) {
        return null
      }
    }))

    return summaries.filter(Boolean)
  }

  /**
   * Get session ID for a tab
   */
  private getTabSessionId(tabId: string): string | null {
    // Access the tab's session ID through TabManager
    // We need to expose this method in TabManager
    const tab = (this.tabManager as any).tabs?.get(tabId)
    return tab?.getSessionId?.() ?? null
  }

  /**
   * Get the manager tab ID
   */
  getTabId(): string {
    return this.tabId
  }

  /**
   * Get the manager tab session ID
   */
  getSessionId(): string | null {
    return this.session?.id ?? null
  }

  /**
   * Get the manager tab title
   */
  getTitle(): string {
    return this.title
  }

  /**
   * Set the manager tab title
   */
  setTitle(title: string): void {
    this.title = title
  }

  /**
   * Set whether this tab is active
   */
  setActive(active: boolean): void {
    const wasActive = this.isActive
    this.isActive = active
    
    // Refresh dashboard when becoming active
    if (active && !wasActive) {
      this.updateDashboard()
    }
  }

  /**
   * Check if this tab is active
   */
  getIsActive(): boolean {
    return this.isActive
  }

  /**
   * Check if this tab has been closed
   */
  getIsClosed(): boolean {
    return this.isClosed
  }

  /**
   * Scroll to bottom (no-op for manager tab - no message history to scroll)
   */
  scrollToBottom(): void {
    // Manager tab has no scrollable message history
    // Dashboard auto-refreshes and handles its own layout
  }

  /**
   * Focus the input bar
   */
  focusInput(): void {
    this.inputBar?.chatInput?.focus()
  }

  /**
   * Ensure main view is shown (no-op for manager tab - always shows dashboard)
   */
  ensureMainView(): void {
    // Manager tab has no welcome screen - always shows main dashboard
  }

  /**
   * Get the MCP manager for this tab
   */
  getMcpManager(): McpManager {
    return this.mcpManager
  }

  /**
   * Get the approval manager for this tab
   */
  getApprovalManager(): ApprovalManager {
    return this.approvalManager
  }

  /**
   * Register the abort controller from the agentic loop
   */
  registerAbortController(abortController: AbortController): void {
    this.abortController = abortController
  }

  /**
   * Create the dashboard UI
   */
  private createDashboardUI(): void {
    if (!this.container) return

    // Main dashboard container
    this.dashboardContainer = new BoxRenderable(this.renderer, {
      id: 'manager-dashboard',
      flexDirection: 'column',
      flexGrow: 1,
      paddingTop: 1,
      paddingLeft: 2,
      paddingRight: 2,
      paddingBottom: 1,
    })
    this.container.add(this.dashboardContainer)

    // Header
    const headerBox = new BoxRenderable(this.renderer, {
      id: 'manager-header',
      paddingBottom: 1,
      flexShrink: 0,
    })
    const headerText = new TextRenderable(this.renderer, {
      id: 'manager-header-text',
      content: t`${bold(fg(COLORS.yellow)('★ Manager Agent'))}  ${fg(COLORS.dim)('Type a message to delegate work or ask for status')}`,
    })
    headerBox.add(headerText)
    this.dashboardContainer.add(headerBox)

    // Sessions section
    const sessionsHeader = new BoxRenderable(this.renderer, {
      id: 'sessions-header',
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
    })
    const sessionsHeaderText = new TextRenderable(this.renderer, {
      id: 'sessions-header-text',
      content: t`${bold('Active Sessions')}`,
    })
    sessionsHeader.add(sessionsHeaderText)
    this.dashboardContainer.add(sessionsHeader)

    this.sessionsListBox = new BoxRenderable(this.renderer, {
      id: 'sessions-list',
      flexDirection: 'column',
      flexShrink: 0,
      paddingLeft: 2,
    })
    this.dashboardContainer.add(this.sessionsListBox)

    // Projects section
    const projectsHeader = new BoxRenderable(this.renderer, {
      id: 'projects-header',
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
    })
    const projectsHeaderText = new TextRenderable(this.renderer, {
      id: 'projects-header-text',
      content: t`${bold('Active Projects')}`,
    })
    projectsHeader.add(projectsHeaderText)
    this.dashboardContainer.add(projectsHeader)

    this.projectsListBox = new BoxRenderable(this.renderer, {
      id: 'projects-list',
      flexDirection: 'column',
      flexShrink: 0,
      paddingLeft: 2,
    })
    this.dashboardContainer.add(this.projectsListBox)

    // Status/Footer section
    this.statusBox = new BoxRenderable(this.renderer, {
      id: 'manager-status',
      paddingTop: 1,
      flexShrink: 0,
    })
    this.statusText = new TextRenderable(this.renderer, {
      id: 'manager-status-text',
      content: t`${fg(COLORS.dim)('Initializing...')}`,
    })
    this.statusBox.add(this.statusText)
    this.dashboardContainer.add(this.statusBox)

    // Input bar at the bottom for user commands
    this.inputBar = new InputBar(this.renderer, async (value) => {
      if (value.trim()) {
        await this.handleMessage(value.trim())
      }
    })
    this.container.add(this.inputBar.root)

    // Start auto-refresh
    this.startDashboardRefresh()
  }

  /**
   * Update the dashboard with current data
   */
  private async updateDashboard(): Promise<void> {
    if (!this.isActive || !this.sessionsListBox || !this.projectsListBox) return

    this.lastDashboardUpdate = Date.now()

    // Update sessions list
    await this.updateSessionsList()

    // Update projects list
    await this.updateProjectsList()

    // Update status
    if (this.statusText) {
      const activeTabId = this.tabManager.getActiveTabId()
      const totalTabs = this.tabManager.getAllTabIds().length
      this.statusText.content = t`${fg(COLORS.dim)(`Total: ${totalTabs} sessions | Active: ${activeTabId || 'none'}`)}`
    }
  }

  /**
   * Update the sessions list in the dashboard
   */
  private async updateSessionsList(): Promise<void> {
    if (!this.sessionsListBox) return

    // Clear existing content
    for (const rowId of this.sessionRowIds) {
      this.sessionsListBox.remove(rowId)
    }
    this.sessionRowIds = []

    const tabIds = this.tabManager.getAllTabIds()
    const activeTabId = this.tabManager.getActiveTabId()

    if (tabIds.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'sessions-empty',
        content: t`${fg(COLORS.dim)('No active sessions')}`,
      })
      this.sessionsListBox.add(emptyText)
      return
    }

    for (const tabId of tabIds) {
      const isActive = tabId === activeTabId
      const isPinned = this.tabManager.isTabPinned(tabId)
      const sessionId = this.getTabSessionId(tabId)
      
      let statusIcon = '○'
      let statusColor = COLORS.dim
      let title = 'New Agent'
      let details = ''

      if (sessionId) {
        try {
          const session = await loadSession(sessionId)
          if (session) {
            title = session.title || 'New Agent'
            const todos = getTodosForSession(sessionId)
            const queue = getQueueForSession(sessionId)
            const completedTodos = todos.filter(t => t.status === 'completed').length

            if (isActive) {
              statusIcon = '●'
              statusColor = COLORS.green as any
            } else if (queue.length > 0) {
              statusIcon = '⏳'
              statusColor = COLORS.yellow as any
            } else if (todos.length > 0) {
              statusIcon = '⏸'
              statusColor = COLORS.blue as any
            }

            details = `  ${fg(COLORS.dim)(`${completedTodos}/${todos.length} todos`)}${queue.length > 0 ? fg(COLORS.yellow)(` • ${queue.length} queued`) : ''}`
          }
        } catch (err) {
          // Session not found
        }
      }

      const pinIcon = isPinned ? '📌 ' : ''
      const rowId = `session-row-${tabId}`
      const row = new BoxRenderable(this.renderer, {
        id: rowId,
        flexDirection: 'row',
        paddingBottom: 1,
      })
      this.sessionRowIds.push(rowId)
      
      const rowText = new TextRenderable(this.renderer, {
        id: `session-text-${tabId}`,
        content: t`${fg(statusColor)(statusIcon)} ${pinIcon}${title}${details}`,
      })
      row.add(rowText)
      this.sessionsListBox.add(row)
    }
  }

  /**
   * Update the projects list in the dashboard
   */
  private async updateProjectsList(): Promise<void> {
    if (!this.projectsListBox) return

    // Clear existing content
    for (const rowId of this.projectRowIds) {
      this.projectsListBox.remove(rowId)
    }
    this.projectRowIds = []

    const projects = await listProjects()

    if (projects.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'projects-empty',
        content: t`${fg(COLORS.dim)('No active projects. Create one with: create_project')}`,
      })
      this.projectsListBox.add(emptyText)
      return
    }

    for (const project of projects) {
      const totalMs = project.milestones.length
      const completedMs = project.milestones.filter(m => m.status === 'complete').length
      const progress = totalMs > 0 ? Math.round((completedMs / totalMs) * 100) : 0
      
      // Progress bar
      const barWidth = 20
      const filled = Math.round((progress / 100) * barWidth)
      const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled)

      const statusIcon = project.status === 'complete' ? '✅' :
                         project.status === 'in_progress' ? '🔥' :
                         project.status === 'review' ? '👀' : '📋'

      const rowId = `project-row-${project.id}`
      const row = new BoxRenderable(this.renderer, {
        id: rowId,
        flexDirection: 'column',
        paddingBottom: 1,
      })
      this.projectRowIds.push(rowId)
      
      const titleRow = new TextRenderable(this.renderer, {
        id: `project-title-${project.id}`,
        content: t`${statusIcon} ${bold(project.name)}  ${fg(COLORS.dim)(`${progress}%`)}`,
      })
      row.add(titleRow)

      const barRow = new TextRenderable(this.renderer, {
        id: `project-bar-${project.id}`,
        content: t`  ${fg(COLORS.green as any)(bar)}  ${completedMs}/${totalMs} milestones`,
      })
      row.add(barRow)

      this.projectsListBox.add(row)
    }
  }

  /**
   * Start auto-refreshing the dashboard
   */
  private startDashboardRefresh(): void {
    // Update immediately
    this.updateDashboard()

    // Then refresh every 5 seconds while active
    this.refreshInterval = setInterval(() => {
      if (this.isActive && Date.now() - this.lastDashboardUpdate > 5000) {
        this.updateDashboard()
      }
    }, 5000)
  }

  /**
   * Stop dashboard refresh
   */
  private stopDashboardRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = undefined
    }
  }

  /**
   * Initialize and run the manager agent
   */
  async initialize(): Promise<void> {
    // Load config and create OpenAI client
    this.config = readConfig('active')
    if (!this.config) {
      logger.error('No config found for manager tab')
      return
    }

    this.client = this.buildClient(this.config)

    // Create a session for the manager
    this.session = createSession(this.config.model, this.config.provider)
    this.session.title = 'Manager Session'
    clearTodos(this.session.id)
    clearMessageQueue(this.session.id)

    // Initialize messages with system prompt
    const systemPrompt = await this.generateManagerSystemPrompt()
    this.completionMessages = [{ role: 'system', content: systemPrompt }]
    this.session.completionMessages = this.completionMessages

    // Create dashboard UI
    this.createDashboardUI()

    logger.info('Manager tab initialized')

    // Start the agentic loop with an initial greeting
    await this.runAgenticTurn('You are the manager. Review all open tabs and provide a summary. Then wait for instructions.')
  }

  /**
   * Handle a new message from the user
   */
  async handleMessage(message: string): Promise<void> {
    if (!this.client || !this.config) return
    await this.runAgenticTurn(message)
  }

  /**
   * Run a single agentic turn
   */
  private async runAgenticTurn(userContent: string): Promise<void> {
    if (!this.client || !this.config) return

    this.isLoading = true
    this.abortController = new AbortController()

    // Add user message
    this.completionMessages.push({ role: 'user', content: userContent })

    try {
      const pricing = getModelPricing(this.config.provider, this.config.model)
      const requestDefaults = getRequestDefaultParams(this.config.provider, this.config.model)

      const updated = await runAgenticLoop(
        this.client,
        this.config.model,
        [...this.completionMessages],
        userContent,
        (event) => this.handleAgentEvent(event),
        {
          pricing: pricing || undefined,
          abortSignal: this.abortController.signal,
          sessionId: this.session?.id,
          requestDefaults,
          approvalManager: this.approvalManager,
          toolRegistry: this.toolRegistry,
        },
      )

      this.completionMessages = updated

      // Save session
      if (this.session) {
        this.session.completionMessages = this.completionMessages
        await saveSession(this.session)
      }
    } catch (err: any) {
      logger.error(`Manager tab error: ${err.message}`)
    } finally {
      this.isLoading = false
      this.abortController = null
    }
  }

  /**
   * Handle agent events
   */
  private handleAgentEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'text_delta':
        // Could show streaming output in a simple UI
        break
      case 'tool_call':
        logger.debug(`Manager tool call: ${event.toolCall?.name}`)
        break
      case 'tool_result':
        logger.debug(`Manager tool result: ${event.toolCall?.result?.slice(0, 100)}`)
        break
      case 'error':
        logger.error(`Manager error: ${event.error}`)
        break
      case 'done':
        logger.debug('Manager turn complete')
        break
    }
  }

  /**
   * Build OpenAI client
   */
  private buildClient(config: Config): OpenAI {
    const provider = getProvider(config.provider)
    const apiKey = resolveApiKey(config)
    if (!apiKey) {
      throw new Error(`Missing API key for ${provider?.name || config.provider}`)
    }
    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey }
    const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim()
    const baseURL = baseURLOverride || provider?.baseURL
    if (baseURL) clientOptions.baseURL = baseURL
    return new OpenAI(clientOptions)
  }

  /**
   * Generate system prompt for the manager
   */
  private async generateManagerSystemPrompt(): Promise<string> {
    // Pass the manager's toolRegistry so MCP tools are included in system prompt
    const basePrompt = await generateSystemPrompt(this.toolRegistry)
    const managerPrompt = `You are the Manager Agent — a hybrid Developer + Product Manager with omniscient access to all sessions.

## Session Management Capabilities

**Visibility:**
- list_tabs: See all open tabs with rich status (todos, messages, activity)
- read_tab_conversation: Read full conversation history from any tab
- get_tab_todos: View TODO list from any session
- get_tab_status: Check detailed status (idle/active/queued/completed)

**Control:**
- create_tab: Spawn new coding sessions
- fork_tab: Duplicate sessions to explore alternatives
- close_tab: Clean up completed sessions
- queue_in_tab: Queue work for later processing
- send_message_in_tab: Send messages to sessions
- switch_to_tab: Focus a specific tab
- rename_tab, pin_tab, unpin_tab: Organize tabs

## Project Management Capabilities

**Projects:**
- create_project: Create projects to organize related work
- list_projects: See all active projects
- get_project: View project details, milestones, progress
- delete_project: Remove completed/archived projects
- generate_project_report: Create detailed progress reports

**Milestones:**
- add_milestone: Define project milestones with dependencies
- update_milestone: Mark progress (pending → in_progress → complete)

**Session Assignment:**
- assign_session_to_project: Link sessions to projects/milestones
- remove_session_from_project: Unlink sessions

## Workflow Patterns

**Requirements Gathering:**
1. Create research sessions to explore the problem
2. Read findings and synthesize
3. Present options with trade-offs

**Parallel Implementation:**
1. Analyze scope, identify independent work units
2. Create sessions for each unit
3. Assign to a project for tracking
4. Monitor progress, coordinate dependencies
5. Review and consolidate results

**Iterative Development:**
1. Create analysis session
2. Create implementation session
3. Create verification session
4. Chain results through queue system

## Guidelines

- Always provide clear summaries of actions taken
- Surface blockers proactively
- Suggest next steps
- Use projects to organize multi-session work
- Queue messages rather than interrupting active sessions
- Fork when exploring alternatives

Always respond with what you observed and what actions you took.`

    return `${basePrompt}\n\n---\n${managerPrompt}`
  }

  /**
   * Close the manager tab
   */
  async close(): Promise<void> {
    if (this.isClosed) return
    this.isClosed = true

    // Stop dashboard refresh
    this.stopDashboardRefresh()

    if (this.abortController) {
      this.abortController.abort()
    }

    if (this.session) {
      clearMessageQueue(this.session.id)
      clearTodos(this.session.id)
    }

    await this.mcpManager.close()
    this.toolRegistry.clearDynamicTools()

    this.onClose?.()
    logger.info('Manager tab closed')
  }
}

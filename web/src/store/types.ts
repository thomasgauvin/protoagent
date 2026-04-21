/**
 * Internal store types shared between app-store.ts and event-handler.ts.
 */
import type {
  ApprovalRequest,
  ChatMessage,
  CronInfo,
  LoopConfig,
  LoopProgress,
  MainView,
  McpServerStatus,
  QueuedMessage,
  SessionSnapshot,
  SessionSummary,
  SkillSummary,
  TodoItem,
  ToolCallEvent,
  WorkflowInfo,
  WorkflowState,
  WorkflowType,
} from '@/types'

export interface AppStateSlice {
  // Sessions
  sessions: SessionSummary[]
  activeSessionId: string | null
  session: SessionSnapshot | null
  running: boolean

  // Message stream
  messages: ChatMessage[]
  isStreaming: boolean
  isLoading: boolean
  streamingText: string
  streamingThinking: string
  runningToolCalls: Record<string, ToolCallEvent>
  error: string | null

  // Todos / queue / workflow
  todos: TodoItem[]
  queued: QueuedMessage[]
  interjects: QueuedMessage[]
  workflow: WorkflowState
  workflowInfo: WorkflowInfo | null
  loopInfo: { config: LoopConfig; progress: LoopProgress } | undefined
  cronInfo: CronInfo | undefined

  // Services
  mcp: McpServerStatus[]
  skills: SkillSummary[]
  activeSkills: Set<string>
  approvals: ApprovalRequest[]

  // Usage
  usage: {
    inputTokens: number
    outputTokens: number
    contextPercent: number
  }
  totalCost: number

  // UI-only
  view: MainView
  theme: 'dark' | 'light'
  copiedNotice: string | null

  // Internal — not exposed to components
  _closeStream: (() => void) | null
}

export interface AppActions {
  init: () => Promise<void>
  refreshSessions: () => Promise<void>
  openSession: (id: string) => Promise<void>
  createSession: () => Promise<void>
  deleteSession: (id: string) => Promise<void>

  sendMessage: (content: string, mode?: 'send' | 'queue') => Promise<void>
  abort: () => Promise<void>

  setView: (view: MainView) => void
  cycleView: () => void
  toggleTheme: () => void

  setWorkflowType: (type: WorkflowType) => Promise<void>
  startLoop: (config: LoopConfig) => Promise<void>
  startCron: (schedule: string, prompt: string) => Promise<void>
  stopWorkflow: () => Promise<void>

  resolveApproval: (
    id: string,
    decision: import('@/types').ApprovalDecision,
  ) => Promise<void>

  updateTodos: (todos: TodoItem[]) => Promise<void>
  cycleTodoStatus: (id: string) => Promise<void>

  reconnectMcp: () => Promise<void>
  activateSkill: (name: string) => Promise<void>

  setCopiedNotice: (msg: string | null) => void
  clearError: () => void
}

export type AppStore = AppStateSlice & AppActions

export type SetFn = (
  partial:
    | Partial<AppStateSlice>
    | ((state: AppStateSlice) => Partial<AppStateSlice>),
) => void

export type GetFn = () => AppStateSlice

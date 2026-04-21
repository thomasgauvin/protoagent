export type Role = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export type UserMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | {
          type: 'image_url'
          image_url: { url: string; detail?: 'low' | 'high' | 'auto' }
        }
    >

export interface UserMessage {
  role: 'user'
  content: UserMessageContent
}

export interface AssistantMessage {
  role: 'assistant'
  content: string
  tool_calls?: ToolCall[]
  reasoning_content?: string
}

export interface ToolMessage {
  role: 'tool'
  tool_call_id: string
  name?: string
  content: string
}

export interface SystemMessage {
  role: 'system'
  content: string
}

export type ChatMessage = UserMessage | AssistantMessage | ToolMessage | SystemMessage

export interface ToolCallEvent {
  id: string
  name: string
  args: string
  status: 'running' | 'done' | 'error'
  result?: string
}

export type AgentEventType =
  | 'text_delta'
  | 'thinking_delta'
  | 'tool_call'
  | 'tool_result'
  | 'usage'
  | 'sub_agent_iteration'
  | 'interject'
  | 'iteration_done'
  | 'error'
  | 'done'

export interface AgentEvent {
  type: AgentEventType
  content?: string
  toolCall?: ToolCallEvent
  thinking?: { content: string }
  interject?: { content: string }
  subAgentTool?: {
    tool: string
    status: 'running' | 'done' | 'error'
    iteration: number
    args?: Record<string, unknown>
  }
  subAgentUsage?: {
    inputTokens: number
    outputTokens: number
    estimatedCost: number
  }
  usage?: {
    inputTokens: number
    outputTokens: number
    cost: number
    contextPercent: number
  }
  error?: string
  transient?: boolean
}

export type WorkflowType = 'queue' | 'loop' | 'cron'

export interface WorkflowState {
  type: WorkflowType
  isActive: boolean
  iterationCount: number
  endCondition?: string
  loopInstructions?: string
  loopResults?: string[]
  maxIterations?: number
  phase?: 'idle' | 'working' | 'evaluating'
  cronSchedule?: string
  cronPrompt?: string
  cronNextRunAt?: string
  cronLastRunAt?: string
}

export interface WorkflowInfo {
  type: WorkflowType
  name: string
  description: string
}

export interface LoopConfig {
  workPrompt: string
  closingConditionPrompt: string
  maxIterations: number
}

export interface LoopProgress {
  currentIteration: number
  maxIterations: number
  phase: 'idle' | 'working' | 'evaluating'
  percentComplete: number
}

export interface CronInfo {
  isConfigured: boolean
  schedule?: string
  prompt?: string
  nextRunAt?: string
  lastRunAt?: string
  timeUntilNextMs?: number
}

export interface WorkflowResponse {
  state: WorkflowState
  info: WorkflowInfo
  activeSessionId: string | null
  loop?: { config: LoopConfig; progress: LoopProgress }
  cron?: CronInfo | null
}

export type TodoStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'
export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  id: string
  content: string
  status: TodoStatus
  priority: TodoPriority
}

export type QueuedMessageType = 'interject' | 'queued'

export interface QueuedMessage {
  id: string
  content: string
  type: QueuedMessageType
  timestamp: number
}

export interface SessionSummary {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

export interface Session {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  provider: string
  model: string
  todos: TodoItem[]
  completionMessages: ChatMessage[]
  queuedMessages: QueuedMessage[]
  interjectMessages: QueuedMessage[]
  workflowState?: WorkflowState
  totalCost?: number
  deleted?: boolean
}

export interface SessionSnapshot extends Session {
  active: boolean
  running: boolean
}

export interface SessionsResponse {
  sessions: SessionSummary[]
  activeSessionId: string | null
  running: boolean
}

export interface ApprovalRequest {
  id: string
  type: 'file_write' | 'file_edit' | 'shell_command'
  description: string
  detail?: string
  sessionId?: string
  createdAt: string
}

export type ApprovalDecision = 'approve_once' | 'approve_session' | 'reject'
export type ApprovalResponse = ApprovalDecision

export interface SkillSummary {
  name: string
  description: string
  source: 'project' | 'user'
  location: string
  active: boolean
}

export type Skill = SkillSummary

export interface McpConnectionStatus {
  connected: boolean
  error?: string
}

export type McpStatusMap = Record<string, McpConnectionStatus>

export interface McpServerStatus {
  name: string
  connected: boolean
  error?: string
}

export type ServerEventType =
  | AgentEventType
  | 'snapshot'
  | 'session_activated'
  | 'session_updated'
  | 'message_queued'
  | 'approval_required'
  | 'approval_resolved'
  | 'todos_updated'
  | 'workflow_updated'
  | 'skills_updated'

export interface ApiEventEnvelope<T = unknown> {
  type: ServerEventType | string
  sessionId: string
  timestamp: string
  data: T
}

export interface SnapshotEventData {
  session: SessionSnapshot
  approvals: ApprovalRequest[]
}

export interface MessageQueuedEventData {
  mode: 'queue' | 'interject'
  content: string
}

export interface ApprovalResolvedEventData {
  id: string
  decision: ApprovalDecision
}

export interface TodosUpdatedEventData {
  todos: TodoItem[]
}

export interface SkillsUpdatedEventData {
  activeSkills: string[]
}

export interface HealthResponse {
  ok: true
}

export interface DeleteSessionResponse {
  deleted: true
}

export interface SendMessageResponse {
  status: 'started' | 'queued' | 'interjected'
  session: SessionSnapshot
}

export interface AbortResponse {
  aborted: boolean
}

export interface ApprovalsResponse {
  approvals: ApprovalRequest[]
}

export interface ApprovalResolutionResponse {
  approval: ApprovalRequest
  decision: ApprovalDecision
}

export interface TodosResponse {
  todos: TodoItem[]
}

export interface SkillsResponse {
  skills: SkillSummary[]
}

export interface SkillActivationResponse {
  name: string
  content: string
  activeSkills: string[]
}

export interface McpStatusResponse {
  status: McpStatusMap
}

export interface ApiErrorPayload {
  error: string
  details?: Array<{ path: string; message: string }>
}

// ─── UI-only state (web frontend) ──────────────────────────────────────

export type MainView = 'bot' | 'queue' | 'loop' | 'cron'
export type SubmitMode = 'send' | 'interject' | 'queue'


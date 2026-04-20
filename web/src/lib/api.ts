import type {
  AbortResponse,
  ApiErrorPayload,
  ApiEventEnvelope,
  ApprovalDecision,
  ApprovalResolutionResponse,
  ApprovalsResponse,
  DeleteSessionResponse,
  HealthResponse,
  LoopConfig,
  McpStatusResponse,
  SendMessageResponse,
  SessionSnapshot,
  SessionsResponse,
  SkillActivationResponse,
  SkillsResponse,
  TodoItem,
  TodosResponse,
  WorkflowResponse,
  WorkflowType,
} from '@/types'

export interface ProtoAgentApiClientOptions {
  baseUrl?: string
  fetch?: typeof fetch
  eventSource?: typeof EventSource
}

export class ProtoAgentApiError extends Error {
  readonly status: number
  readonly details?: ApiErrorPayload['details']

  constructor(status: number, message: string, details?: ApiErrorPayload['details']) {
    super(message)
    this.name = 'ProtoAgentApiError'
    this.status = status
    this.details = details
  }
}

function joinUrl(baseUrl: string, path: string): string {
  if (!baseUrl) return path
  return `${baseUrl.replace(/\/$/, '')}${path}`
}

function createHeaders(initHeaders?: HeadersInit, hasJsonBody?: boolean): Headers {
  const headers = new Headers(initHeaders)
  if (hasJsonBody && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  return headers
}

export class ProtoAgentApiClient {
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly eventSourceImpl: typeof EventSource

  constructor(options: ProtoAgentApiClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? ''
    // `fetch` (and `EventSource`) must be bound to `globalThis` — browsers
    // throw `TypeError: Illegal invocation` if `fetch` is invoked with a
    // receiver other than `window`.
    this.fetchImpl = options.fetch ?? fetch.bind(globalThis)
    this.eventSourceImpl = options.eventSource ?? EventSource
  }

  private async request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
    const { json, headers, ...rest } = init ?? {}
    const response = await this.fetchImpl(joinUrl(this.baseUrl, path), {
      ...rest,
      headers: createHeaders(headers, json !== undefined),
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    })

    if (!response.ok) {
      let payload: ApiErrorPayload | null = null
      try {
        payload = (await response.json()) as ApiErrorPayload
      } catch {
        payload = null
      }

      throw new ProtoAgentApiError(
        response.status,
        payload?.error ?? `${response.status} ${response.statusText}`,
        payload?.details,
      )
    }

    if (response.status === 204) {
      return undefined as T
    }

    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      return (await response.json()) as T
    }

    return (await response.text()) as T
  }

  health() {
    return this.request<HealthResponse>('/health')
  }

  listSessions() {
    return this.request<SessionsResponse>('/sessions')
  }

  createSession() {
    return this.request<SessionSnapshot>('/sessions', { method: 'POST', json: {} })
  }

  getSession(id: string) {
    return this.request<SessionSnapshot>(`/sessions/${encodeURIComponent(id)}`)
  }

  deleteSession(id: string) {
    return this.request<DeleteSessionResponse>(`/sessions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
  }

  sendMessage(sessionId: string, content: string, mode: 'send' | 'queue' = 'send') {
    return this.request<SendMessageResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      {
        method: 'POST',
        json: { content, mode },
      },
    )
  }

  abort(sessionId?: string) {
    if (sessionId) {
      return this.request<AbortResponse>(
        `/sessions/${encodeURIComponent(sessionId)}/abort`,
        { method: 'POST' },
      )
    }
    return this.request<AbortResponse>('/abort', { method: 'POST' })
  }

  listApprovals() {
    return this.request<ApprovalsResponse>('/approvals')
  }

  resolveApproval(id: string, decision: ApprovalDecision) {
    return this.request<ApprovalResolutionResponse>(
      `/approvals/${encodeURIComponent(id)}`,
      {
        method: 'POST',
        json: { decision },
      },
    )
  }

  getWorkflow(sessionId: string) {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow`,
    )
  }

  setWorkflow(sessionId: string, type: WorkflowType) {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow`,
      { method: 'POST', json: { type } },
    )
  }

  startWorkflow(
    sessionId: string,
    input: {
      type?: WorkflowType
      loopInstructions?: string
      endCondition?: string
      maxIterations?: number
      cronSchedule?: string
      cronPrompt?: string
    },
  ) {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow/start`,
      { method: 'POST', json: input },
    )
  }

  startLoop(sessionId: string, config: LoopConfig) {
    return this.startWorkflow(sessionId, {
      type: 'loop',
      loopInstructions: config.workPrompt,
      endCondition: config.closingConditionPrompt,
      maxIterations: config.maxIterations,
    })
  }

  startCron(sessionId: string, cronSchedule: string, cronPrompt: string) {
    return this.startWorkflow(sessionId, { type: 'cron', cronSchedule, cronPrompt })
  }

  stopWorkflow(sessionId: string) {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow/stop`,
      { method: 'POST' },
    )
  }

  getTodos(sessionId: string) {
    return this.request<TodosResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/todos`,
    )
  }

  updateTodos(sessionId: string, todos: TodoItem[]) {
    return this.request<TodosResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/todos`,
      { method: 'PUT', json: { todos } },
    )
  }

  listSkills() {
    return this.request<SkillsResponse>('/skills')
  }

  activateSkill(name: string) {
    return this.request<SkillActivationResponse>(
      `/skills/${encodeURIComponent(name)}/activate`,
      { method: 'POST' },
    )
  }

  getMcpStatus() {
    return this.request<McpStatusResponse>('/mcp/status')
  }

  reconnectMcp() {
    return this.request<McpStatusResponse>('/mcp/reconnect', { method: 'POST' })
  }

  openSessionEvents(
    sessionId: string,
    callbacks: {
      onEvent: (event: ApiEventEnvelope) => void
      onError?: (event: Event) => void
    },
  ): () => void {
    const source = new this.eventSourceImpl(
      joinUrl(this.baseUrl, `/sessions/${encodeURIComponent(sessionId)}/events`),
      { withCredentials: false },
    )

    const handle = (message: MessageEvent<string>) => {
      if (!message.data) return
      try {
        callbacks.onEvent(JSON.parse(message.data) as ApiEventEnvelope)
      } catch {
        // Ignore malformed keep-alive frames.
      }
    }

    const eventNames = [
      'snapshot',
      'session_activated',
      'session_updated',
      'message_queued',
      'approval_required',
      'approval_resolved',
      'todos_updated',
      'workflow_updated',
      'skills_updated',
      'text_delta',
      'thinking_delta',
      'tool_call',
      'tool_result',
      'usage',
      'sub_agent_iteration',
      'interject',
      'iteration_done',
      'error',
      'done',
    ] as const

    for (const eventName of eventNames) {
      source.addEventListener(eventName, handle as EventListener)
    }
    source.addEventListener('message', handle as EventListener)
    if (callbacks.onError) {
      source.addEventListener('error', callbacks.onError)
    }

    return () => {
      for (const eventName of eventNames) {
        source.removeEventListener(eventName, handle as EventListener)
      }
      source.removeEventListener('message', handle as EventListener)
      if (callbacks.onError) {
        source.removeEventListener('error', callbacks.onError)
      }
      source.close()
    }
  }
}

export function createProtoAgentApiClient(options: ProtoAgentApiClientOptions = {}) {
  return new ProtoAgentApiClient(options)
}

export const api = createProtoAgentApiClient()

export function openEventStream(
  sessionId: string,
  onEvent: (event: ApiEventEnvelope) => void,
  onError?: (event: Event) => void,
) {
  return api.openSessionEvents(sessionId, { onEvent, onError })
}

/**
 * Handles incoming ApiEventEnvelope messages from the SSE stream and
 * mutates the Zustand store. Separated from app-store.ts to keep each
 * file focused.
 *
 * The server wraps every event as `{type, sessionId, timestamp, data}`.
 *   - For passthrough AgentEvents (text_delta, tool_call, etc.) the `data`
 *     field IS the AgentEvent payload (it has its own `type`, `content`, etc.).
 *   - For lifecycle events (snapshot, session_activated, session_updated,
 *     message_queued, approval_required, approval_resolved, todos_updated,
 *     workflow_updated, skills_updated) `data` is the corresponding
 *     domain object.
 */

import type {
  AgentEvent,
  ApiEventEnvelope,
  ApprovalRequest,
  AssistantMessage,
  ChatMessage,
  QueuedMessage,
  SessionSnapshot,
  TodoItem,
  WorkflowResponse,
} from '@/types'
import type { AppStateSlice, SetFn, GetFn } from './types'

function lastAssistantTextMessage(
  messages: ChatMessage[],
): { index: number; message: AssistantMessage } | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && !m.tool_calls?.length) {
      return { index: i, message: m as AssistantMessage }
    }
  }
  return null
}

function splitQueue(messages: QueuedMessage[] | undefined): {
  queued: QueuedMessage[]
  interjects: QueuedMessage[]
} {
  const list = messages ?? []
  return {
    queued: list.filter((m) => m.type === 'queued'),
    interjects: list.filter((m) => m.type === 'interject'),
  }
}

/**
 * Apply a full SessionSnapshot to the store (used on `snapshot`,
 * `session_activated`, `session_updated`).
 *
 * Messages are replaced if:
 *   - The active session ID changed (user switched sessions), OR
 *   - The server snapshot has MORE non-system messages than what we have
 *     locally (the server has caught up and we're no longer ahead).
 *
 * Otherwise we keep the local messages array so in-flight streaming
 * deltas / tool calls aren't clobbered.
 */
export function applySessionSnapshot(
  set: SetFn,
  snapshot: SessionSnapshot,
): void {
  const { queued: qQueued, interjects: qInterjects } = splitQueue(
    snapshot.queuedMessages,
  )
  const ijFromSnapshot = snapshot.interjectMessages ?? []

  set((s) => {
    const isNewSession = s.activeSessionId !== snapshot.id
    const snapshotMessages = snapshot.completionMessages ?? []

    // Count non-system messages on both sides so the system prompt
    // (present on the server but filtered out of the UI) doesn't skew
    // the comparison.
    const serverCount = snapshotMessages.filter((m) => m.role !== 'system').length
    const localCount = s.messages.filter((m) => m.role !== 'system').length

    const shouldReplace = isNewSession || serverCount > localCount

    // If the server reports the run is finished, drop any stale streaming
    // state so "Thinking…" doesn't hang in the status bar after a silent
    // error or an abort initiated elsewhere.
    const runStopped = snapshot.running === false
    const streamingPatch = runStopped
      ? {
          isStreaming: false,
          isLoading: false,
          streamingText: '',
          streamingThinking: '',
          runningToolCalls: {},
        }
      : {}

    return {
      session: snapshot,
      messages: shouldReplace
        ? snapshotMessages.map((m) => ({ ...m }))
        : s.messages,
      todos: snapshot.todos ?? s.todos,
      queued: qQueued,
      interjects: ijFromSnapshot.length ? ijFromSnapshot : qInterjects,
      workflow: snapshot.workflowState ?? s.workflow,
      totalCost: snapshot.totalCost ?? s.totalCost,
      running: snapshot.running ?? s.running,
      ...streamingPatch,
    }
  })
}

export function applyWorkflowResponse(
  set: SetFn,
  response: WorkflowResponse,
): void {
  set({
    workflow: response.state,
    workflowInfo: response.info,
    loopInfo: response.loop,
    cronInfo: response.cron ?? undefined,
  })
}

export function handleAgentEvent(
  event: AgentEvent,
  set: SetFn,
  get: GetFn,
): void {
  switch (event.type) {
    case 'text_delta': {
      const chunk = event.content ?? ''
      if (!chunk) return
      set((s) => ({
        isStreaming: true,
        isLoading: true,
        streamingText: s.streamingText + chunk,
      }))
      return
    }

    case 'thinking_delta': {
      const chunk = event.thinking?.content ?? event.content ?? ''
      if (!chunk) return
      set((s) => ({
        isStreaming: true,
        isLoading: true,
        streamingThinking: s.streamingThinking + chunk,
      }))
      return
    }

    case 'tool_call': {
      const tc = event.toolCall
      if (!tc) return
      flushStreamingText(set, get)
      set((s) => ({
        runningToolCalls: { ...s.runningToolCalls, [tc.id]: tc },
        messages: [
          ...s.messages,
          {
            role: 'assistant',
            content: '',
            tool_calls: [
              {
                id: tc.id,
                type: 'function',
                function: { name: tc.name, arguments: tc.args },
              },
            ],
          },
        ],
        isLoading: true,
      }))
      return
    }

    case 'tool_result': {
      const tc = event.toolCall
      if (!tc) return
      set((s) => {
        const next = { ...s.runningToolCalls }
        delete next[tc.id]
        return {
          runningToolCalls: next,
          messages: [
            ...s.messages,
            {
              role: 'tool',
              tool_call_id: tc.id,
              name: tc.name,
              content: tc.result ?? '',
            },
          ],
        }
      })
      return
    }

    case 'iteration_done': {
      flushStreamingText(set, get)
      return
    }

    case 'usage': {
      const u = event.usage
      if (!u) return
      set((s) => ({
        usage: {
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          contextPercent: u.contextPercent,
        },
        totalCost: s.totalCost + (u.cost ?? 0),
      }))
      return
    }

    case 'interject': {
      // The server persists interjects directly into completionMessages and
      // emits session_updated right after, so we don't need to append a
      // synthetic user message here (doing so would duplicate it).
      return
    }

    case 'error': {
      set({ error: event.error ?? 'Unknown error' })
      return
    }

    case 'done': {
      flushStreamingText(set, get)
      set({
        isStreaming: false,
        isLoading: false,
        streamingText: '',
        streamingThinking: '',
        runningToolCalls: {},
      })
      return
    }

    case 'sub_agent_iteration':
      // Not surfaced in the UI currently.
      return
  }
}

export function handleEnvelope(
  envelope: ApiEventEnvelope,
  set: SetFn,
  get: GetFn,
): void {
  // If the envelope's sessionId doesn't match the active one, ignore it —
  // the user has switched sessions since the event fired.
  const { activeSessionId } = get()
  if (envelope.sessionId && activeSessionId && envelope.sessionId !== activeSessionId) {
    return
  }

  switch (envelope.type) {
    case 'snapshot': {
      const data = envelope.data as {
        session: SessionSnapshot
        approvals: ApprovalRequest[]
      }
      if (data?.session) applySessionSnapshot(set, data.session)
      if (Array.isArray(data?.approvals)) {
        set({ approvals: data.approvals })
      }
      return
    }

    case 'session_activated':
    case 'session_updated': {
      applySessionSnapshot(set, envelope.data as SessionSnapshot)
      return
    }

    case 'message_queued': {
      // The server will also emit session_updated with the fresh queue.
      // Nothing to do beyond a toast in the future.
      return
    }

    case 'approval_required': {
      const approval = envelope.data as ApprovalRequest
      set((s) => ({
        approvals: [
          ...s.approvals.filter((a) => a.id !== approval.id),
          approval,
        ],
      }))
      return
    }

    case 'approval_resolved': {
      const data = envelope.data as { id: string }
      if (!data?.id) return
      set((s) => ({ approvals: s.approvals.filter((a) => a.id !== data.id) }))
      return
    }

    case 'todos_updated': {
      const data = envelope.data as { todos: TodoItem[] }
      if (Array.isArray(data?.todos)) set({ todos: data.todos })
      return
    }

    case 'workflow_updated': {
      applyWorkflowResponse(set, envelope.data as WorkflowResponse)
      return
    }

    case 'skills_updated': {
      const data = envelope.data as { activeSkills: string[] }
      if (Array.isArray(data?.activeSkills))
        set({ activeSkills: new Set(data.activeSkills) })
      return
    }

    // All remaining types are raw AgentEvents whose `data` field is the
    // AgentEvent itself (with its own `type` discriminator). Some server
    // lifecycle events (notably `error` from `runSequence`) use a simpler
    // `{message}` payload — handle that specially so we don't miss the
    // error.
    default: {
      if (envelope.type === 'error') {
        const data = envelope.data as { message?: string } | AgentEvent
        const message =
          (data as { message?: string }).message ??
          (data as AgentEvent).error ??
          'Unknown error'
        set({
          error: message,
          isStreaming: false,
          isLoading: false,
          streamingText: '',
          streamingThinking: '',
          runningToolCalls: {},
        })
        return
      }
      const agent = envelope.data as AgentEvent
      if (agent && typeof agent === 'object' && 'type' in agent) {
        handleAgentEvent(agent, set, get)
      }
      return
    }
  }
}

function flushStreamingText(set: SetFn, get: GetFn): void {
  const { streamingText, streamingThinking } = get()
  if (!streamingText && !streamingThinking) return

  set((s) => {
    const last = lastAssistantTextMessage(s.messages)
    if (last && s.isStreaming) {
      const merged = [...s.messages]
      merged[last.index] = {
        ...last.message,
        content: (last.message.content ?? '') + streamingText,
        reasoning_content:
          (last.message.reasoning_content ?? '') + streamingThinking,
      }
      return {
        messages: merged,
        streamingText: '',
        streamingThinking: '',
      }
    }
    return {
      messages: [
        ...s.messages,
        {
          role: 'assistant',
          content: streamingText,
          reasoning_content: streamingThinking || undefined,
        } satisfies AssistantMessage,
      ],
      streamingText: '',
      streamingThinking: '',
    }
  })
}

export type { AppStateSlice }

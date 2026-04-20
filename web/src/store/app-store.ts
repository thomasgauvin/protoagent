/**
 * Global app store (Zustand). One active session at a time — mirrors the
 * single-user-per-container design from refactor.md.
 *
 * The store keeps two things in sync:
 *   1. Canonical server state (SessionSnapshot, workflow, todos, approvals)
 *      which is pushed via the SSE stream and overlaid on top of what we
 *      load from the REST endpoints.
 *   2. Ephemeral streaming state for the in-flight assistant response
 *      (streamingText, streamingThinking, runningToolCalls).
 */

import { create } from 'zustand'
import { api, openEventStream } from '@/lib/api'
import type {
  ApprovalDecision,
  LoopConfig,
  MainView,
  McpServerStatus,
  McpStatusMap,
  TodoItem,
  WorkflowType,
} from '@/types'
import {
  applySessionSnapshot,
  applyWorkflowResponse,
  handleEnvelope,
} from './event-handler'
import type { AppStateSlice, AppStore } from './types'

function mcpMapToList(map: McpStatusMap): McpServerStatus[] {
  return Object.entries(map).map(([name, status]) => ({
    name,
    connected: status.connected,
    error: status.error,
  }))
}

const VIEW_ORDER: MainView[] = ['bot', 'queue', 'loop', 'cron']

const initialState: AppStateSlice = {
  sessions: [],
  activeSessionId: null,
  session: null,
  running: false,
  messages: [],
  isStreaming: false,
  isLoading: false,
  streamingText: '',
  streamingThinking: '',
  runningToolCalls: {},
  error: null,
  todos: [],
  queued: [],
  interjects: [],
  workflow: { type: 'queue', isActive: false, iterationCount: 0 },
  workflowInfo: null,
  loopInfo: undefined,
  cronInfo: undefined,
  mcp: [],
  skills: [],
  activeSkills: new Set<string>(),
  approvals: [],
  usage: { inputTokens: 0, outputTokens: 0, contextPercent: 0 },
  totalCost: 0,
  view: 'bot',
  theme:
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  copiedNotice: null,
  _closeStream: null,
}

function applyTheme(theme: 'dark' | 'light') {
  if (typeof document === 'undefined') return
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

/**
 * Guards against the backend silently stopping a run (e.g. a provider
 * 401 that gets swallowed without emitting `done` / `session_updated`
 * with running=false). If the loading state persists for 20s without
 * any streaming activity, we poll `/sessions` and clear local loading
 * state if the server says the run is over.
 */
let watchdogTimer: ReturnType<typeof setTimeout> | null = null
function scheduleRunWatchdog(
  set: (partial: Partial<AppStore>) => void,
  get: () => AppStore,
) {
  if (watchdogTimer) clearTimeout(watchdogTimer)
  const check = async () => {
    const { isLoading, isStreaming, activeSessionId, streamingText } = get()
    if (!isLoading && !isStreaming) return
    try {
      const r = await api.listSessions()
      const current = get()
      // Run really stopped: clear the spinner so "Thinking…" disappears.
      if (!r.running && activeSessionId === current.activeSessionId) {
        // But only if nothing has arrived in the meantime
        if (current.streamingText === streamingText) {
          set({
            running: false,
            isLoading: false,
            isStreaming: false,
            streamingText: '',
            streamingThinking: '',
            runningToolCalls: {},
          })
          return
        }
      }
    } catch {
      /* ignore — transient network issue */
    }
    // Still running / uncertain — re-arm the watchdog.
    watchdogTimer = setTimeout(check, 15000)
  }
  watchdogTimer = setTimeout(check, 20000)
}

export const useAppStore = create<AppStore>((set, get) => ({
  ...initialState,

  async init() {
    applyTheme(get().theme)

    // Kick off non-critical metadata fetches in parallel.
    void api
      .getMcpStatus()
      .then((r) => set({ mcp: mcpMapToList(r.status) }))
      .catch(() => {})
    void api
      .listSkills()
      .then((r) => set({ skills: r.skills }))
      .catch(() => {})

    await get().refreshSessions()

    const { sessions, activeSessionId } = get()
    // Prefer the session the server reports as active; fall back to the
    // most recent saved session; create a fresh one if none exists.
    if (activeSessionId) {
      await get().openSession(activeSessionId)
    } else if (sessions[0]) {
      await get().openSession(sessions[0].id)
    } else {
      await get().createSession()
    }

    // Prime workflow state (also updated via SSE later).
    const activeId = get().activeSessionId
    if (activeId) {
      try {
        const workflow = await api.getWorkflow(activeId)
        applyWorkflowResponse(set, workflow)
      } catch {
        /* ignore — server may not have an active session yet */
      }
    }
  },

  async refreshSessions() {
    try {
      const r = await api.listSessions()
      set({
        sessions: r.sessions,
        activeSessionId: r.activeSessionId,
        running: r.running,
      })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async openSession(id: string) {
    get()._closeStream?.()

    try {
      const snapshot = await api.getSession(id)
      set({
        activeSessionId: id,
        running: snapshot.running,
        isStreaming: false,
        isLoading: false,
        streamingText: '',
        streamingThinking: '',
        runningToolCalls: {},
        error: null,
        approvals: [],
        // Wipe messages first — applySessionSnapshot will fill them from the
        // snapshot below. This prevents stale messages leaking between
        // sessions.
        messages: [],
      })
      applySessionSnapshot(set, snapshot)
    } catch (e) {
      set({ error: (e as Error).message })
      return
    }

    // Refresh approvals (active ones may predate the SSE snapshot event).
    try {
      const r = await api.listApprovals()
      set({ approvals: r.approvals })
    } catch {
      /* ignore */
    }

    const close = openEventStream(id, (envelope) =>
      handleEnvelope(envelope, set, get),
    )
    set({ _closeStream: close })
  },

  async createSession() {
    try {
      const snapshot = await api.createSession()
      set({ activeSessionId: snapshot.id })
      await get().refreshSessions()
      await get().openSession(snapshot.id)
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async deleteSession(id: string) {
    try {
      await api.deleteSession(id)
      await get().refreshSessions()
      const { activeSessionId, sessions } = get()
      if (activeSessionId === id || !activeSessionId) {
        if (sessions[0]) await get().openSession(sessions[0].id)
        else await get().createSession()
      }
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async sendMessage(content: string, mode?: 'send' | 'queue') {
    const { activeSessionId, isLoading, running } = get()
    if (!activeSessionId) return
    const trimmed = content.trim()
    if (!trimmed) return

    // Suffix shortcuts (mirror TUI ChatInput behaviour).
    if (trimmed.endsWith(' /q')) {
      return get().sendMessage(trimmed.slice(0, -3).trim(), 'queue')
    }
    if (trimmed.endsWith(' /new')) {
      const rest = trimmed.slice(0, -5).trim()
      const s = await api.createSession()
      await get().refreshSessions()
      await get().openSession(s.id)
      if (rest) await get().sendMessage(rest)
      return
    }

    // Optimistic echo for the 'send' mode so the user sees their message
    // immediately. The server will later confirm via session_updated.
    if (!running && (!mode || mode === 'send') && !isLoading) {
      set((s) => ({
        messages: [...s.messages, { role: 'user', content }],
        isLoading: true,
        isStreaming: false,
        error: null,
      }))
    }

    // Safety net: if the backend silently finishes without emitting a `done`
    // or `session_updated` with running=false (e.g. a 401 during an API call
    // that gets swallowed), poll the /sessions endpoint once the run has
    // been in-flight for too long to detect completion and clear the
    // "Thinking…" state.
    scheduleRunWatchdog(set, get)

    try {
      await api.sendMessage(activeSessionId, content, mode)
    } catch (e) {
      set({ isLoading: false, error: (e as Error).message })
    }
  },

  async abort() {
    try {
      await api.abort()
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  setView(view) {
    set({ view })
  },

  cycleView() {
    set((s) => {
      const idx = VIEW_ORDER.indexOf(s.view)
      return { view: VIEW_ORDER[(idx + 1) % VIEW_ORDER.length] }
    })
  },

  toggleTheme() {
    const next = get().theme === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    set({ theme: next })
  },

  async setWorkflowType(type: WorkflowType) {
    const sid = get().activeSessionId
    if (!sid) return
    try {
      const res = await api.setWorkflow(sid, type)
      applyWorkflowResponse(set, res)
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async startLoop(config: LoopConfig) {
    const sid = get().activeSessionId
    if (!sid) return
    try {
      const res = await api.startLoop(sid, config)
      applyWorkflowResponse(set, res)
      set({ view: 'loop' })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async startCron(schedule: string, prompt: string) {
    const sid = get().activeSessionId
    if (!sid) return
    try {
      const res = await api.startCron(sid, schedule, prompt)
      applyWorkflowResponse(set, res)
      set({ view: 'cron' })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async stopWorkflow() {
    const sid = get().activeSessionId
    if (!sid) return
    try {
      const res = await api.stopWorkflow(sid)
      applyWorkflowResponse(set, res)
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async resolveApproval(id: string, decision: ApprovalDecision) {
    try {
      await api.resolveApproval(id, decision)
      set((s) => ({ approvals: s.approvals.filter((a) => a.id !== id) }))
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async updateTodos(todos: TodoItem[]) {
    const sid = get().activeSessionId
    if (!sid) return
    try {
      const r = await api.updateTodos(sid, todos)
      set({ todos: r.todos })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async cycleTodoStatus(id: string) {
    const order: TodoItem['status'][] = [
      'pending',
      'in_progress',
      'completed',
      'cancelled',
    ]
    const next = get().todos.map((t) =>
      t.id === id
        ? {
            ...t,
            status: order[(order.indexOf(t.status) + 1) % order.length],
          }
        : t,
    )
    await get().updateTodos(next)
  },

  async reconnectMcp() {
    try {
      const r = await api.reconnectMcp()
      set({ mcp: mcpMapToList(r.status) })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  async activateSkill(name: string) {
    try {
      const r = await api.activateSkill(name)
      set({ activeSkills: new Set(r.activeSkills) })
    } catch (e) {
      set({ error: (e as Error).message })
    }
  },

  setCopiedNotice(msg) {
    set({ copiedNotice: msg })
    if (msg) {
      setTimeout(() => {
        if (get().copiedNotice === msg) set({ copiedNotice: null })
      }, 1500)
    }
  },

  clearError() {
    set({ error: null })
  },
}))

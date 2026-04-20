/**
 * Shared SDK types.
 *
 * These are the payload shapes exposed across all transports. They are
 * deliberately re-exported from the core runtime so that the SDK is always
 * in sync with the API.
 */

import type {
  ApiApproval,
  ApiEvent,
  SessionSnapshot,
} from '../api/state.js';
import type { AgentEvent, Message as CoreMessage } from '../agentic-loop.js';
import type { SessionSummary } from '../sessions.js';
import type { QueuedMessage } from '../message-queue.js';
import type { TodoItem } from '../tools/todo.js';
import type { WorkflowState, WorkflowType } from '../workflow/types.js';

export type Approval = ApiApproval;
export type ApprovalDecision = 'approve_once' | 'approve_session' | 'reject';

export type ChatMessage = CoreMessage;

export type {
  ApiEvent,
  QueuedMessage,
  SessionSnapshot,
  SessionSummary,
  TodoItem,
  WorkflowState,
  WorkflowType,
};

export interface SessionsResponse {
  sessions: SessionSummary[];
  /** IDs of all sessions currently activated in the runtime. */
  activeSessionIds: string[];
  /** Most recently activated session id; null if none. Kept for convenience. */
  activeSessionId: string | null;
  running: boolean;
}

export interface SendMessageResponse {
  status: 'started' | 'queued' | 'interjected';
  session: SessionSnapshot;
}

export interface WorkflowInfo {
  type: WorkflowType;
  name: string;
  description: string;
}

export interface LoopConfig {
  workPrompt: string;
  closingConditionPrompt: string;
  maxIterations: number;
}

export interface LoopProgress {
  currentIteration: number;
  maxIterations: number;
  phase: 'idle' | 'working' | 'evaluating';
  percentComplete: number;
}

export interface CronInfo {
  isConfigured: boolean;
  schedule?: string;
  prompt?: string;
  nextRunAt?: string;
  lastRunAt?: string;
  timeUntilNextMs?: number;
}

export interface WorkflowResponse {
  state: WorkflowState;
  info: WorkflowInfo;
  activeSessionId: string | null;
  loop?: { config: LoopConfig; progress: LoopProgress };
  cron?: CronInfo | null;
}

export interface WorkflowStartInput {
  type?: WorkflowType;
  loopInstructions?: string;
  endCondition?: string;
  maxIterations?: number;
  cronSchedule?: string;
  cronPrompt?: string;
}

export interface SkillSummary {
  name: string;
  description: string;
  source: 'project' | 'user';
  location: string;
  active: boolean;
}

export interface SkillActivationResponse {
  name: string;
  content: string;
  activeSkills: string[];
}

export type McpStatusMap = Record<string, { connected: boolean; error?: string }>;

export interface ApiErrorPayload {
  error: string;
  details?: Array<{ path: string; message: string }>;
}

// ─── Discriminated ApiEvent union ─────────────────────────────────────────
//
// The runtime emits two families of events per session:
//
//  1. Lifecycle envelopes — session_activated, session_updated,
//     message_queued, approval_required, approval_resolved,
//     todos_updated, workflow_updated, skills_updated. These carry
//     structured payloads.
//
//  2. Agent events — text_delta, thinking_delta, tool_call, tool_result,
//     usage, sub_agent_iteration, interject, iteration_done, error, done.
//     These carry the AgentEvent shape produced by runAgenticLoop.
//
// `ApiEvent<unknown>` is kept for unknown/custom types. The discriminated
// `SdkEvent` union gives callers `switch (event.type)` with full
// type narrowing on `event.data`.

export interface SessionActivatedEvent extends ApiEvent<SessionSnapshot> {
  type: 'session_activated';
}

export interface SessionUpdatedEvent extends ApiEvent<SessionSnapshot> {
  type: 'session_updated';
}

export interface MessageQueuedEvent
  extends ApiEvent<{ mode: 'queue' | 'interject'; content: string }> {
  type: 'message_queued';
}

export interface ApprovalRequiredEvent extends ApiEvent<Approval> {
  type: 'approval_required';
}

export interface ApprovalResolvedEvent
  extends ApiEvent<{ id: string; decision: ApprovalDecision }> {
  type: 'approval_resolved';
}

export interface TodosUpdatedEvent extends ApiEvent<{ todos: TodoItem[] }> {
  type: 'todos_updated';
}

export interface WorkflowUpdatedEvent extends ApiEvent<WorkflowResponse> {
  type: 'workflow_updated';
}

export interface SkillsUpdatedEvent
  extends ApiEvent<{ activeSkills: string[] }> {
  type: 'skills_updated';
}

/**
 * Agent events wrap an AgentEvent payload. The envelope `type` mirrors the
 * AgentEvent.type, and `data` is the full AgentEvent for convenience.
 */
export interface AgentApiEvent extends ApiEvent<AgentEvent> {
  type:
    | 'text_delta'
    | 'thinking_delta'
    | 'tool_call'
    | 'tool_result'
    | 'usage'
    | 'sub_agent_iteration'
    | 'interject'
    | 'iteration_done'
    | 'error'
    | 'done';
}

/** Discriminated union of every event the runtime is known to emit. */
export type SdkEvent =
  | SessionActivatedEvent
  | SessionUpdatedEvent
  | MessageQueuedEvent
  | ApprovalRequiredEvent
  | ApprovalResolvedEvent
  | TodosUpdatedEvent
  | WorkflowUpdatedEvent
  | SkillsUpdatedEvent
  | AgentApiEvent;

export type { AgentEvent };

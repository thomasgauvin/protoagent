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
import type { Message as CoreMessage } from '../agentic-loop.js';
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

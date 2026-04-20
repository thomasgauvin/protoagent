/**
 * Transport interface for the ProtoAgent SDK.
 *
 * A transport is responsible for moving SDK method calls to a runtime and
 * returning responses + an event stream. The SDK itself is transport
 * agnostic: the same method surface is available whether the runtime
 * lives in the same process (InMemoryTransport) or on a remote server
 * (HttpTransport).
 *
 * All session-scoped operations take an explicit `sessionId`. There is no
 * implicit "active session" on the runtime.
 */

import type {
  ApiEvent,
  Approval,
  ApprovalDecision,
  McpStatusMap,
  SendMessageResponse,
  SessionSnapshot,
  SessionsResponse,
  SkillActivationResponse,
  SkillSummary,
  TodoItem,
  WorkflowResponse,
  WorkflowStartInput,
  WorkflowType,
} from './types.js';

export interface SessionEventSubscription {
  close(): void;
}

export interface SessionEventHandlers {
  onEvent: (event: ApiEvent) => void;
  onError?: (error: Error) => void;
}

export interface Transport {
  /** Close transport-level resources (e.g. background server, http agent). */
  close(): Promise<void>;

  listSessions(options?: { limit?: number; offset?: number }): Promise<SessionsResponse>;
  createSession(): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  deleteSession(sessionId: string): Promise<boolean>;

  sendMessage(
    sessionId: string,
    content: string,
    mode?: 'send' | 'queue',
  ): Promise<SendMessageResponse>;

  /**
   * Abort an in-flight run for a single session. When `sessionId` is omitted,
   * the runtime aborts every running session (convenience used by `exec` and
   * the API's global `/abort`).
   */
  abort(sessionId?: string): Promise<{ aborted: boolean }>;

  listApprovals(): Promise<Approval[]>;
  resolveApproval(id: string, decision: ApprovalDecision): Promise<Approval | null>;

  getWorkflow(sessionId: string): Promise<WorkflowResponse>;
  setWorkflow(sessionId: string, type: WorkflowType): Promise<WorkflowResponse>;
  startWorkflow(sessionId: string, input: WorkflowStartInput): Promise<WorkflowResponse>;
  stopWorkflow(sessionId: string): Promise<WorkflowResponse>;

  getTodos(sessionId: string): Promise<TodoItem[]>;
  updateTodos(sessionId: string, todos: TodoItem[]): Promise<TodoItem[]>;

  listSkills(): Promise<SkillSummary[]>;
  activateSkill(name: string): Promise<SkillActivationResponse>;

  getMcpStatus(): Promise<McpStatusMap>;
  reconnectMcp(): Promise<McpStatusMap>;

  subscribeToSession(
    sessionId: string,
    handlers: SessionEventHandlers,
  ): SessionEventSubscription;
}

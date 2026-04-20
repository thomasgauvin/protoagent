/**
 * Transport interface for the ProtoAgent SDK.
 *
 * A transport is responsible for moving SDK method calls to a runtime and
 * returning responses + an event stream. The SDK itself is transport
 * agnostic: the same method surface is available whether the runtime
 * lives in the same process (InMemoryTransport) or on a remote server
 * (HttpTransport).
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

  listSessions(): Promise<SessionsResponse>;
  createSession(): Promise<SessionSnapshot>;
  getSession(sessionId: string): Promise<SessionSnapshot>;
  deleteSession(sessionId: string): Promise<boolean>;

  sendMessage(
    sessionId: string,
    content: string,
    mode?: 'send' | 'queue',
  ): Promise<SendMessageResponse>;
  abort(): Promise<{ aborted: boolean }>;

  listApprovals(): Promise<Approval[]>;
  resolveApproval(id: string, decision: ApprovalDecision): Promise<Approval | null>;

  getWorkflow(): Promise<WorkflowResponse>;
  setWorkflow(type: WorkflowType): Promise<WorkflowResponse>;
  startWorkflow(input: WorkflowStartInput): Promise<WorkflowResponse>;
  stopWorkflow(): Promise<WorkflowResponse>;

  getTodos(): Promise<TodoItem[]>;
  updateTodos(todos: TodoItem[]): Promise<TodoItem[]>;

  listSkills(): Promise<SkillSummary[]>;
  activateSkill(name: string): Promise<SkillActivationResponse>;

  getMcpStatus(): Promise<McpStatusMap>;
  reconnectMcp(): Promise<McpStatusMap>;

  subscribeToSession(
    sessionId: string,
    handlers: SessionEventHandlers,
  ): SessionEventSubscription;
}

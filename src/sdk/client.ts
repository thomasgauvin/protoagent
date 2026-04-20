/**
 * Unified ProtoAgent SDK client.
 *
 * The client is a thin wrapper over a Transport. The exact same method
 * surface is available whether the transport is InMemoryTransport
 * (in-process CoreRuntime) or HttpTransport (remote protoagent-api).
 */

import type {
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
import type {
  SessionEventHandlers,
  SessionEventSubscription,
  Transport,
} from './transport.js';
import { InMemoryTransport, type InMemoryTransportOptions } from './in-memory-transport.js';
import { HttpTransport, type HttpTransportOptions } from './http-transport.js';

export interface ClientOptions {
  transport: Transport;
}

export class ProtoAgentClient {
  readonly transport: Transport;

  constructor(options: ClientOptions) {
    this.transport = options.transport;
  }

  close(): Promise<void> {
    return this.transport.close();
  }

  listSessions(options?: { limit?: number; offset?: number }): Promise<SessionsResponse> {
    return this.transport.listSessions(options);
  }

  createSession(): Promise<SessionSnapshot> {
    return this.transport.createSession();
  }

  getSession(sessionId: string): Promise<SessionSnapshot> {
    return this.transport.getSession(sessionId);
  }

  deleteSession(sessionId: string): Promise<boolean> {
    return this.transport.deleteSession(sessionId);
  }

  sendMessage(
    sessionId: string,
    content: string,
    mode: 'send' | 'queue' = 'send',
  ): Promise<SendMessageResponse> {
    return this.transport.sendMessage(sessionId, content, mode);
  }

  abort(sessionId?: string): Promise<{ aborted: boolean }> {
    return this.transport.abort(sessionId);
  }

  listApprovals(): Promise<Approval[]> {
    return this.transport.listApprovals();
  }

  resolveApproval(id: string, decision: ApprovalDecision): Promise<Approval | null> {
    return this.transport.resolveApproval(id, decision);
  }

  getWorkflow(sessionId: string): Promise<WorkflowResponse> {
    return this.transport.getWorkflow(sessionId);
  }

  setWorkflow(sessionId: string, type: WorkflowType): Promise<WorkflowResponse> {
    return this.transport.setWorkflow(sessionId, type);
  }

  startWorkflow(sessionId: string, input: WorkflowStartInput): Promise<WorkflowResponse> {
    return this.transport.startWorkflow(sessionId, input);
  }

  stopWorkflow(sessionId: string): Promise<WorkflowResponse> {
    return this.transport.stopWorkflow(sessionId);
  }

  getTodos(sessionId: string): Promise<TodoItem[]> {
    return this.transport.getTodos(sessionId);
  }

  updateTodos(sessionId: string, todos: TodoItem[]): Promise<TodoItem[]> {
    return this.transport.updateTodos(sessionId, todos);
  }

  listSkills(): Promise<SkillSummary[]> {
    return this.transport.listSkills();
  }

  activateSkill(name: string): Promise<SkillActivationResponse> {
    return this.transport.activateSkill(name);
  }

  getMcpStatus(): Promise<McpStatusMap> {
    return this.transport.getMcpStatus();
  }

  reconnectMcp(): Promise<McpStatusMap> {
    return this.transport.reconnectMcp();
  }

  subscribeToSession(
    sessionId: string,
    handlers: SessionEventHandlers,
  ): SessionEventSubscription {
    return this.transport.subscribeToSession(sessionId, handlers);
  }
}

export function createProtoAgentClient(options: ClientOptions): ProtoAgentClient {
  return new ProtoAgentClient(options);
}

export function createInMemoryClient(options: InMemoryTransportOptions = {}): ProtoAgentClient {
  return new ProtoAgentClient({ transport: new InMemoryTransport(options) });
}

export function createHttpClient(options: HttpTransportOptions): ProtoAgentClient {
  return new ProtoAgentClient({ transport: new HttpTransport(options) });
}

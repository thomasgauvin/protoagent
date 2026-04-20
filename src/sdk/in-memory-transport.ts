/**
 * InMemoryTransport — drives SDK calls directly against a CoreRuntime
 * instance in the same process.
 */

import { CoreRuntime, type CoreRuntimeDependencies, type CoreRuntimeOptions } from '../core/runtime.js';
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
import type {
  SessionEventHandlers,
  SessionEventSubscription,
  Transport,
} from './transport.js';

export interface InMemoryTransportOptions {
  runtime?: CoreRuntime;
  runtimeOptions?: CoreRuntimeOptions;
  dependencies?: Partial<CoreRuntimeDependencies>;
}

export class InMemoryTransport implements Transport {
  readonly runtime: CoreRuntime;
  private readonly ownsRuntime: boolean;

  constructor(options: InMemoryTransportOptions = {}) {
    if (options.runtime) {
      this.runtime = options.runtime;
      this.ownsRuntime = false;
    } else {
      this.runtime = new CoreRuntime(options.runtimeOptions ?? {}, options.dependencies);
      this.ownsRuntime = true;
    }
  }

  async close(): Promise<void> {
    if (this.ownsRuntime) {
      await this.runtime.close();
    }
  }

  async listSessions(): Promise<SessionsResponse> {
    const result = await this.runtime.listSessions();
    return result as SessionsResponse;
  }

  async createSession(): Promise<SessionSnapshot> {
    return this.runtime.createAndActivateSession();
  }

  async getSession(sessionId: string): Promise<SessionSnapshot> {
    return this.runtime.getSession(sessionId);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    return this.runtime.deleteSession(sessionId);
  }

  async sendMessage(
    sessionId: string,
    content: string,
    mode: 'send' | 'queue' = 'send',
  ): Promise<SendMessageResponse> {
    return this.runtime.sendMessage(sessionId, content, mode);
  }

  async abort(sessionId?: string): Promise<{ aborted: boolean }> {
    return this.runtime.abortCurrentLoop(sessionId);
  }

  async listApprovals(): Promise<Approval[]> {
    return this.runtime.listApprovals();
  }

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<Approval | null> {
    return this.runtime.resolveApproval(id, decision);
  }

  async getWorkflow(sessionId: string): Promise<WorkflowResponse> {
    return this.runtime.getWorkflow(sessionId) as WorkflowResponse;
  }

  async setWorkflow(sessionId: string, type: WorkflowType): Promise<WorkflowResponse> {
    return (await this.runtime.switchWorkflow(sessionId, type)) as WorkflowResponse;
  }

  async startWorkflow(sessionId: string, input: WorkflowStartInput): Promise<WorkflowResponse> {
    return (await this.runtime.startWorkflow(sessionId, input)) as WorkflowResponse;
  }

  async stopWorkflow(sessionId: string): Promise<WorkflowResponse> {
    return (await this.runtime.stopWorkflow(sessionId)) as WorkflowResponse;
  }

  async getTodos(sessionId: string): Promise<TodoItem[]> {
    return this.runtime.getTodos(sessionId);
  }

  async updateTodos(sessionId: string, todos: TodoItem[]): Promise<TodoItem[]> {
    return this.runtime.updateTodos(sessionId, todos);
  }

  async listSkills(): Promise<SkillSummary[]> {
    return this.runtime.listSkills();
  }

  async activateSkill(name: string): Promise<SkillActivationResponse> {
    return this.runtime.activateSkillByName(name);
  }

  async getMcpStatus(): Promise<McpStatusMap> {
    return this.runtime.getMcpStatus() as McpStatusMap;
  }

  async reconnectMcp(): Promise<McpStatusMap> {
    return (await this.runtime.reconnectMcp()) as McpStatusMap;
  }

  subscribeToSession(
    sessionId: string,
    handlers: SessionEventHandlers,
  ): SessionEventSubscription {
    const unsubscribe = this.runtime.subscribe(sessionId, (event: ApiEvent) => {
      handlers.onEvent(event);
    });

    // Emit an initial snapshot event to match HttpTransport (which receives
    // one from the server on connect).
    queueMicrotask(async () => {
      try {
        const session = await this.runtime.getSessionSnapshot(sessionId);
        handlers.onEvent({
          type: 'snapshot',
          sessionId,
          timestamp: new Date().toISOString(),
          data: {
            session,
            approvals: this.runtime
              .listApprovals()
              .filter((approval) => approval.sessionId === sessionId),
          },
        });
      } catch (error) {
        handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    });

    return {
      close() {
        unsubscribe();
      },
    };
  }
}

export function createInMemoryTransport(options: InMemoryTransportOptions = {}): InMemoryTransport {
  return new InMemoryTransport(options);
}

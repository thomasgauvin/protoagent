/**
 * InMemoryTransport — drives SDK calls directly against a CoreRuntime
 * instance in the same process.
 *
 * This is the transport used by the CLI (stage 2) so that the TUI can run
 * against the exact same runtime surface the HTTP server uses, without a
 * network hop.
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

  async abort(): Promise<{ aborted: boolean }> {
    return this.runtime.abortCurrentLoop();
  }

  async listApprovals(): Promise<Approval[]> {
    return this.runtime.listApprovals();
  }

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<Approval | null> {
    return this.runtime.resolveApproval(id, decision);
  }

  async getWorkflow(): Promise<WorkflowResponse> {
    return this.runtime.getWorkflow() as WorkflowResponse;
  }

  async setWorkflow(type: WorkflowType): Promise<WorkflowResponse> {
    return (await this.runtime.switchWorkflow(type)) as WorkflowResponse;
  }

  async startWorkflow(input: WorkflowStartInput): Promise<WorkflowResponse> {
    return (await this.runtime.startWorkflow(input)) as WorkflowResponse;
  }

  async stopWorkflow(): Promise<WorkflowResponse> {
    return (await this.runtime.stopWorkflow()) as WorkflowResponse;
  }

  async getTodos(): Promise<TodoItem[]> {
    return this.runtime.getTodos();
  }

  async updateTodos(todos: TodoItem[]): Promise<TodoItem[]> {
    return this.runtime.updateTodos(todos);
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
    // one from the server on connect). We do this asynchronously so the
    // caller has a chance to wire up state before the snapshot arrives.
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

/**
 * HttpTransport — drives SDK calls against a running protoagent-api HTTP
 * server, using fetch for requests and a native SSE parser for the event
 * stream.
 *
 * The SSE parser is implemented on top of the fetch response body so this
 * works identically in Node/Bun, Deno, and the browser.
 */

import type {
  ApiErrorPayload,
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

export interface HttpTransportOptions {
  baseUrl: string;
  fetch?: typeof fetch;
  defaultHeaders?: Record<string, string>;
}

export class HttpTransportError extends Error {
  readonly status: number;
  readonly details?: ApiErrorPayload['details'];

  constructor(status: number, message: string, details?: ApiErrorPayload['details']) {
    super(message);
    this.name = 'HttpTransportError';
    this.status = status;
    this.details = details;
  }
}

interface RequestOptions {
  method?: string;
  json?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export class HttpTransport implements Transport {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly defaultHeaders: Record<string, string>;

  constructor(options: HttpTransportOptions) {
    if (!options.baseUrl) {
      throw new Error('HttpTransport requires a baseUrl.');
    }
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? fetch;
    this.defaultHeaders = options.defaultHeaders ?? {};
  }

  async close(): Promise<void> {
    // Nothing transport-level to close; active subscriptions own their own
    // abort controllers.
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const headers = new Headers(this.defaultHeaders);
    for (const [key, value] of Object.entries(options.headers ?? {})) {
      headers.set(key, value);
    }

    let body: string | undefined;
    if (options.json !== undefined) {
      headers.set('content-type', 'application/json');
      body = JSON.stringify(options.json);
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body,
      signal: options.signal,
    });

    if (!response.ok) {
      let payload: ApiErrorPayload | null = null;
      try {
        payload = (await response.json()) as ApiErrorPayload;
      } catch {
        payload = null;
      }
      throw new HttpTransportError(
        response.status,
        payload?.error ?? `${response.status} ${response.statusText}`,
        payload?.details,
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }

  async listSessions(options?: { limit?: number; offset?: number }): Promise<SessionsResponse> {
    const params = new URLSearchParams();
    if (options?.limit !== undefined) params.set('limit', String(options.limit));
    if (options?.offset !== undefined) params.set('offset', String(options.offset));
    const qs = params.toString();
    return this.request<SessionsResponse>(qs ? `/sessions?${qs}` : '/sessions');
  }

  async createSession(): Promise<SessionSnapshot> {
    return this.request<SessionSnapshot>('/sessions', { method: 'POST', json: {} });
  }

  async getSession(sessionId: string): Promise<SessionSnapshot> {
    return this.request<SessionSnapshot>(`/sessions/${encodeURIComponent(sessionId)}`);
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const result = await this.request<{ deleted: boolean }>(
        `/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      return Boolean(result.deleted);
    } catch (error) {
      if (error instanceof HttpTransportError && error.status === 404) return false;
      throw error;
    }
  }

  async sendMessage(
    sessionId: string,
    content: string,
    mode: 'send' | 'queue' = 'send',
  ): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/messages`,
      { method: 'POST', json: { content, mode } },
    );
  }

  async abort(sessionId?: string): Promise<{ aborted: boolean }> {
    if (sessionId) {
      return this.request<{ aborted: boolean }>(
        `/sessions/${encodeURIComponent(sessionId)}/abort`,
        { method: 'POST' },
      );
    }
    return this.request<{ aborted: boolean }>('/abort', { method: 'POST' });
  }

  async listApprovals(): Promise<Approval[]> {
    const response = await this.request<{ approvals: Approval[] }>('/approvals');
    return response.approvals;
  }

  async resolveApproval(id: string, decision: ApprovalDecision): Promise<Approval | null> {
    try {
      const response = await this.request<{ approval: Approval }>(
        `/approvals/${encodeURIComponent(id)}`,
        { method: 'POST', json: { decision } },
      );
      return response.approval;
    } catch (error) {
      if (error instanceof HttpTransportError && error.status === 404) return null;
      throw error;
    }
  }

  async getWorkflow(sessionId: string): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow`,
    );
  }

  async setWorkflow(sessionId: string, type: WorkflowType): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow`,
      { method: 'POST', json: { type } },
    );
  }

  async startWorkflow(sessionId: string, input: WorkflowStartInput): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow/start`,
      { method: 'POST', json: input },
    );
  }

  async stopWorkflow(sessionId: string): Promise<WorkflowResponse> {
    return this.request<WorkflowResponse>(
      `/sessions/${encodeURIComponent(sessionId)}/workflow/stop`,
      { method: 'POST' },
    );
  }

  async getTodos(sessionId: string): Promise<TodoItem[]> {
    const response = await this.request<{ todos: TodoItem[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/todos`,
    );
    return response.todos;
  }

  async updateTodos(sessionId: string, todos: TodoItem[]): Promise<TodoItem[]> {
    const response = await this.request<{ todos: TodoItem[] }>(
      `/sessions/${encodeURIComponent(sessionId)}/todos`,
      { method: 'PUT', json: { todos } },
    );
    return response.todos;
  }

  async listSkills(): Promise<SkillSummary[]> {
    const response = await this.request<{ skills: SkillSummary[] }>('/skills');
    return response.skills;
  }

  async activateSkill(name: string): Promise<SkillActivationResponse> {
    return this.request<SkillActivationResponse>(
      `/skills/${encodeURIComponent(name)}/activate`,
      { method: 'POST' },
    );
  }

  async getMcpStatus(): Promise<McpStatusMap> {
    const response = await this.request<{ status: McpStatusMap }>('/mcp/status');
    return response.status;
  }

  async reconnectMcp(): Promise<McpStatusMap> {
    const response = await this.request<{ status: McpStatusMap }>('/mcp/reconnect', {
      method: 'POST',
    });
    return response.status;
  }

  subscribeToSession(
    sessionId: string,
    handlers: SessionEventHandlers,
  ): SessionEventSubscription {
    const controller = new AbortController();
    const url = `${this.baseUrl}/sessions/${encodeURIComponent(sessionId)}/events`;

    (async () => {
      try {
        const response = await this.fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'text/event-stream', ...this.defaultHeaders },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          throw new HttpTransportError(
            response.status,
            `SSE stream failed: ${response.status} ${response.statusText}`,
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!controller.signal.aborted) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          let separatorIndex = buffer.indexOf('\n\n');
          while (separatorIndex !== -1) {
            const frame = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);

            const parsed = parseSseFrame(frame);
            if (parsed) {
              try {
                handlers.onEvent(parsed as ApiEvent);
              } catch (error) {
                handlers.onError?.(toError(error));
              }
            }

            separatorIndex = buffer.indexOf('\n\n');
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        handlers.onError?.(toError(error));
      }
    })();

    return {
      close() {
        controller.abort();
      },
    };
  }
}

export function createHttpTransport(options: HttpTransportOptions): HttpTransport {
  return new HttpTransport(options);
}

function parseSseFrame(frame: string): unknown | null {
  const dataLines: string[] = [];
  for (const rawLine of frame.split('\n')) {
    const line = rawLine.replace(/\r$/, '');
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  const payload = dataLines.join('\n');
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

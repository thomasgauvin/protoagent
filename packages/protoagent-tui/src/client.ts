/**
 * ProtoAgent TUI Client — Communicates with the core server.
 */
import type { EventEnvelope } from '../protoagent-core/src/bus/bus-event.js';

export interface ClientConfig {
  serverUrl: string;
  apiKey?: string;
}

export type EventHandler = (event: EventEnvelope) => void;

export class ProtoAgentClient {
  private config: ClientConfig;
  private eventSource: EventSource | null = null;
  private handlers: EventHandler[] = [];

  constructor(config: ClientConfig) {
    this.config = {
      serverUrl: config.serverUrl || 'http://localhost:3001',
      ...config,
    };
  }

  connect(sessionId?: string): void {
    const url = sessionId
      ? `${this.config.serverUrl}/events?sessionId=${sessionId}`
      : `${this.config.serverUrl}/events`;

    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handlers.forEach((h) => h(data));
      } catch (err) {
        console.error('Failed to parse event:', err);
      }
    };

    this.eventSource.onerror = (err) => {
      console.error('EventSource error:', err);
    };
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async sendMessage(sessionId: string, message: string, config: Record<string, unknown>): Promise<void> {
    const response = await fetch(`${this.config.serverUrl}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message, config }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
  }

  async abort(sessionId: string): Promise<void> {
    await fetch(`${this.config.serverUrl}/agent/abort/${sessionId}`, {
      method: 'POST',
    });
  }

  async createSession(data: Record<string, unknown>): Promise<{ id: string }> {
    const response = await fetch(`${this.config.serverUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }

    return response.json();
  }

  async listSessions(): Promise<Array<{ id: string; title: string }>> {
    const response = await fetch(`${this.config.serverUrl}/sessions`);
    return response.json();
  }
}

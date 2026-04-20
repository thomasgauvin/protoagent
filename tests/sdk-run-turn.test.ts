/**
 * Tests for the TUI's SDK-driven turn runner.
 *
 * Verifies runSdkTurn correctly:
 *   - forwards AgentEvents to the provided handler
 *   - skips lifecycle envelopes (snapshot, session_updated, …)
 *   - resolves after a 'done' event
 *   - rejects when the runtime emits an error via onError
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentEvent } from '../src/agentic-loop.js';
import type {
  ApiEvent,
  ProtoAgentClient,
  SendMessageResponse,
  SessionEventHandlers,
  SessionEventSubscription,
} from '../src/sdk/index.js';
import { runSdkTurn } from '../src/tui/sdk-run-turn.js';

function buildFakeClient(opts: {
  scriptedEvents: ApiEvent[];
  onSend?: (sessionId: string, content: string) => SendMessageResponse;
  onSubscribeError?: Error;
}): ProtoAgentClient {
  const client = {
    close: async () => {},
    listSessions: async () => ({ sessions: [], activeSessionIds: [], activeSessionId: null, running: false }),
    createSession: async () => ({}) as any,
    getSession: async () => ({}) as any,
    deleteSession: async () => true,
    sendMessage: async (sessionId: string, content: string): Promise<SendMessageResponse> => {
      return opts.onSend ? opts.onSend(sessionId, content) : ({ status: 'started', session: {} as any });
    },
    abort: async () => ({ aborted: false }),
    listApprovals: async () => [],
    resolveApproval: async () => null,
    getWorkflow: async () => ({}) as any,
    setWorkflow: async () => ({}) as any,
    startWorkflow: async () => ({}) as any,
    stopWorkflow: async () => ({}) as any,
    getTodos: async () => [],
    updateTodos: async () => [],
    listSkills: async () => [],
    activateSkill: async () => ({ name: '', content: '', activeSkills: [] }),
    getMcpStatus: async () => ({}),
    reconnectMcp: async () => ({}),
    subscribeToSession(_sessionId: string, handlers: SessionEventHandlers): SessionEventSubscription {
      queueMicrotask(() => {
        if (opts.onSubscribeError) {
          handlers.onError?.(opts.onSubscribeError);
          return;
        }
        for (const event of opts.scriptedEvents) {
          handlers.onEvent(event);
        }
      });
      return { close() {} };
    },
  } as unknown as ProtoAgentClient;
  return client;
}

function apiEvent<T>(type: string, data: T, sessionId = 's1'): ApiEvent<T> {
  return { type, sessionId, timestamp: new Date().toISOString(), data };
}

test('runSdkTurn forwards AgentEvents to the handler and resolves on done', async () => {
  const agentEvents: AgentEvent[] = [];
  const lifecycleTypes: string[] = [];

  const client = buildFakeClient({
    scriptedEvents: [
      apiEvent('snapshot', { session: {}, approvals: [] }),
      apiEvent<AgentEvent>('text_delta', { type: 'text_delta', content: 'Hello' }),
      apiEvent('session_updated', {}),
      apiEvent<AgentEvent>('text_delta', { type: 'text_delta', content: ' world' }),
      apiEvent<AgentEvent>('done', { type: 'done' }),
    ],
  });

  await runSdkTurn({
    client,
    sessionId: 's1',
    userContent: 'hi',
    onAgentEvent: (event) => agentEvents.push(event),
    onLifecycleEvent: (envelope) => lifecycleTypes.push(envelope.type),
  });

  assert.deepEqual(
    agentEvents.map((e) => e.type),
    ['text_delta', 'text_delta', 'done'],
  );
  assert.deepEqual(lifecycleTypes, ['snapshot', 'session_updated']);
});

test('runSdkTurn rejects when the subscription errors', async () => {
  const client = buildFakeClient({
    scriptedEvents: [],
    onSubscribeError: new Error('boom'),
  });

  await assert.rejects(
    runSdkTurn({
      client,
      sessionId: 's1',
      userContent: 'hi',
      onAgentEvent: () => {},
    }),
    /boom/,
  );
});

test('runSdkTurn rejects when sendMessage throws', async () => {
  const client = buildFakeClient({
    scriptedEvents: [],
    onSend: () => {
      throw new Error('send failed');
    },
  });

  await assert.rejects(
    runSdkTurn({
      client,
      sessionId: 's1',
      userContent: 'hi',
      onAgentEvent: () => {},
    }),
    /send failed/,
  );
});

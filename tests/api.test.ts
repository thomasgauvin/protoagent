import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type OpenAI from 'openai';
import { Hono } from 'hono';
import { handleApiError, ApiError } from '../src/api/errors.js';
import { createApiRoutes } from '../src/api/routes.js';
import {
  ApiRuntime,
  type ApiRuntimeDependencies,
  type ApiEvent,
  definedProps,
} from '../src/api/state.js';
import { createApiApp } from '../src/api/server.js';
import type { AgentEvent, Message } from '../src/agentic-loop.js';
import { createSession, generateTitle, type Session, type SessionSummary } from '../src/sessions.js';
import { ToolRegistry } from '../src/tools/registry.js';

function createRouteTestApp(runtime: Record<string, unknown>) {
  const app = new Hono();
  app.route('/', createApiRoutes(runtime as any));
  app.onError((error, c) => handleApiError(error, c));
  return app;
}

function createJsonResponse(data: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

async function readJson(response: Response) {
  return response.json() as Promise<any>;
}

async function requestJson(app: Hono, path: string, init?: RequestInit & { json?: unknown }) {
  const { json, headers, ...rest } = init ?? {};
  const response = await app.request(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(headers ?? {}),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  return response;
}

async function waitFor<T>(callback: () => T | Promise<T>, predicate: (value: T) => boolean, timeoutMs = 1500): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await callback();
    if (predicate(value)) return value;
    await delay(10);
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

class SseReader {
  private readonly decoder = new TextDecoder();
  private buffer = '';

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async next(timeoutMs = 1500): Promise<{ event: string; data: any }> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const event = this.tryParseEvent();
      if (event) return event;

      const remaining = Math.max(1, deadline - Date.now());
      const result = await Promise.race([
        this.reader.read(),
        delay(remaining).then(() => ({ done: true, value: undefined as Uint8Array | undefined })),
      ]);

      if (result.done) {
        const finalEvent = this.tryParseEvent();
        if (finalEvent) return finalEvent;
        throw new Error('SSE stream closed before expected event');
      }

      this.buffer += this.decoder.decode(result.value, { stream: true });
    }

    throw new Error(`Timed out waiting for SSE event after ${timeoutMs}ms`);
  }

  private tryParseEvent(): { event: string; data: any } | null {
    const separator = this.buffer.indexOf('\n\n');
    if (separator === -1) return null;

    const frame = this.buffer.slice(0, separator);
    this.buffer = this.buffer.slice(separator + 2);

    let eventName = 'message';
    const dataLines: string[] = [];
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }

    const payload = dataLines.join('\n');
    return {
      event: eventName,
      data: payload ? JSON.parse(payload) : null,
    };
  }
}

async function openSse(app: Hono, path: string) {
  const controller = new AbortController();
  const response = await app.request(new Request(`http://localhost${path}`, {
    signal: controller.signal,
    headers: { accept: 'text/event-stream' },
  }));
  assert.equal(response.status, 200);
  assert.ok(response.body);
  return {
    controller,
    reader: new SseReader(response.body!.getReader()),
  };
}

type LoopRunner = ApiRuntimeDependencies['runAgenticLoop'];

function createRuntimeHarness(loopRunner: LoopRunner) {
  const sessions = new Map<string, Session>();
  let mcpReconnectCount = 0;
  const mcpStatus = {
    primary: { connected: true },
  };

  const dependencies: Partial<ApiRuntimeDependencies> = {
    loadRuntimeConfig: async () => ({ providers: {}, mcp: { servers: {} } } as any),
    readConfig: () => ({ provider: 'openai', model: 'gpt-test', apiKey: 'test-key' }),
    createClient: () => ({}) as OpenAI,
    initializeMcp: async () => {},
    closeMcp: async () => {},
    reconnectAllMcp: async () => {
      mcpReconnectCount += 1;
    },
    getMcpConnectionStatus: () => mcpStatus,
    createSession: (model: string, provider: string) => createSession(model, provider),
    deleteStoredSession: async (id: string) => sessions.delete(id),
    listStoredSessions: async () => {
      const summaries: SessionSummary[] = Array.from(sessions.values()).map((session) => ({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.completionMessages.length,
      }));
      summaries.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      return summaries;
    },
    loadSession: async (id: string) => {
      const session = sessions.get(id);
      return session ? structuredClone(session) : null;
    },
    saveSession: async (session: Session) => {
      sessions.set(session.id, structuredClone(session));
    },
    loadSkills: async () => [
      {
        name: 'demo-skill',
        description: 'Demo skill',
        source: 'project' as const,
        location: '/tmp/demo-skill/SKILL.md',
        skillDir: '/tmp/demo-skill',
        body: 'Demo skill body',
        compatibility: undefined,
      },
    ],
    activateSkill: async (name: string) => name === 'demo-skill'
      ? '<skill_content name="demo-skill">Demo skill body</skill_content>'
      : `Error: Unknown skill "${name}".`,
    parseInputWithImages: async (input) => input,
    generateSystemPrompt: async () => 'SYSTEM PROMPT',
    runAgenticLoop: loopRunner,
    getModelPricing: () => undefined,
    getRequestDefaultParams: () => ({}),
    generateTitle,
    toolRegistry: new ToolRegistry(),
  };

  const runtime = new ApiRuntime({}, dependencies);
  const app = createApiApp(runtime);

  return {
    app,
    runtime,
    sessions,
    getMcpReconnectCount: () => mcpReconnectCount,
  };
}

test('definedProps omits undefined entries', () => {
  assert.deepEqual(
    definedProps({
      loopInstructions: 'Investigate bug',
      endCondition: undefined,
      maxIterations: 3,
    }),
    {
      loopInstructions: 'Investigate bug',
      maxIterations: 3,
    },
  );
});

test('message route returns 400 for invalid request body', async () => {
  const app = createRouteTestApp({
    sendMessage: async () => {
      throw new Error('sendMessage should not be called for invalid bodies');
    },
  });

  const response = await app.request('/sessions/demo/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'invalid-mode' }),
  });

  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.equal(payload.error, 'Invalid request body.');
});

test('workflow route returns ApiError status codes', async () => {
  const app = createRouteTestApp({
    getWorkflow: () => {
      throw new ApiError(400, 'Session "unknown" is not active. Load or create it first.');
    },
  });

  const response = await app.request('/sessions/unknown/workflow');

  assert.equal(response.status, 400);
  const payload = await readJson(response);
  assert.equal(payload.error, 'Session "unknown" is not active. Load or create it first.');
});

test('session route returns 404 for missing sessions', async () => {
  const app = createRouteTestApp({
    getSession: async () => {
      throw new ApiError(404, 'Session "missing" not found.');
    },
  });

  const response = await app.request('/sessions/missing');

  assert.equal(response.status, 404);
  const payload = await readJson(response);
  assert.equal(payload.error, 'Session "missing" not found.');
});

test('full integration: sessions, workflow, todos, skills, and mcp routes operate through ApiRuntime', async () => {
  const harness = createRuntimeHarness(async (_client, _model, messages, userInput, onEvent) => {
    onEvent({ type: 'text_delta', content: `echo:${userInput}` });
    onEvent({ type: 'usage', usage: { inputTokens: 1, outputTokens: 2, cost: 0.25, contextPercent: 1 } });
    onEvent({ type: 'done' });
    return [...messages, { role: 'assistant', content: `echo:${userInput}` } as Message];
  });

  const createResponse = await requestJson(harness.app, '/sessions', { method: 'POST', json: {} });
  assert.equal(createResponse.status, 201);
  const created = await readJson(createResponse);
  const sessionId = created.id as string;

  const listResponse = await requestJson(harness.app, '/sessions');
  const listPayload = await readJson(listResponse);
  assert.deepEqual(listPayload.activeSessionIds, [sessionId]);
  assert.equal(listPayload.activeSessionId, sessionId);
  assert.equal(listPayload.sessions.length, 1);

  const workflowResponse = await requestJson(harness.app, `/sessions/${sessionId}/workflow`);
  const workflow = await readJson(workflowResponse);
  assert.equal(workflow.activeSessionId, sessionId);
  assert.equal(workflow.state.type, 'queue');

  const todo = { id: 'todo-1', content: 'Ship API SDK', status: 'pending', priority: 'high' };
  const putTodosResponse = await requestJson(harness.app, `/sessions/${sessionId}/todos`, {
    method: 'PUT',
    json: { todos: [todo] },
  });
  assert.equal(putTodosResponse.status, 200);
  assert.deepEqual((await readJson(putTodosResponse)).todos, [todo]);

  const getTodosResponse = await requestJson(harness.app, `/sessions/${sessionId}/todos`);
  assert.deepEqual((await readJson(getTodosResponse)).todos, [todo]);

  const skillsResponse = await requestJson(harness.app, '/skills');
  const skillsPayload = await readJson(skillsResponse);
  assert.equal(skillsPayload.skills[0].name, 'demo-skill');
  assert.equal(skillsPayload.skills[0].active, false);

  const activateSkillResponse = await requestJson(harness.app, '/skills/demo-skill/activate', { method: 'POST' });
  const activatedSkill = await readJson(activateSkillResponse);
  assert.deepEqual(activatedSkill.activeSkills, ['demo-skill']);

  const activeSessionResponse = await requestJson(harness.app, `/sessions/${sessionId}`);
  const activeSession = await readJson(activeSessionResponse);
  assert.match(activeSession.completionMessages[0].content, /Demo skill body/);

  const mcpStatusResponse = await requestJson(harness.app, '/mcp/status');
  assert.deepEqual((await readJson(mcpStatusResponse)).status, { primary: { connected: true } });

  const mcpReconnectResponse = await requestJson(harness.app, '/mcp/reconnect', { method: 'POST' });
  assert.deepEqual((await readJson(mcpReconnectResponse)).status, { primary: { connected: true } });
  assert.equal(harness.getMcpReconnectCount(), 1);

  await harness.runtime.close();
});

test('full integration: SSE streaming delivers snapshot and message lifecycle events', async () => {
  const harness = createRuntimeHarness(async (_client, _model, messages, userInput, onEvent) => {
    onEvent({ type: 'text_delta', content: `echo:${userInput}` });
    onEvent({ type: 'usage', usage: { inputTokens: 3, outputTokens: 4, cost: 0.5, contextPercent: 2 } });
    onEvent({ type: 'done' });
    return [...messages, { role: 'assistant', content: `echo:${userInput}` } as Message];
  });

  const created = await readJson(await requestJson(harness.app, '/sessions', { method: 'POST', json: {} }));
  const sessionId = created.id as string;
  const stream = await openSse(harness.app, `/sessions/${sessionId}/events`);

  const snapshot = await stream.reader.next();
  assert.equal(snapshot.event, 'snapshot');
  assert.equal(snapshot.data.data.session.id, sessionId);

  const sendResponse = await requestJson(harness.app, `/sessions/${sessionId}/messages`, {
    method: 'POST',
    json: { content: 'hello from api' },
  });
  assert.equal(sendResponse.status, 202);
  assert.equal((await readJson(sendResponse)).status, 'started');

  const seenEvents: string[] = [];
  while (!seenEvents.includes('done')) {
    const next = await stream.reader.next();
    seenEvents.push(next.event);
  }

  assert.ok(seenEvents.includes('session_updated'));
  assert.ok(seenEvents.includes('text_delta'));
  assert.ok(seenEvents.includes('usage'));

  const sessionResponse = await requestJson(harness.app, `/sessions/${sessionId}`);
  const session = await readJson(sessionResponse);
  const lastMessage = session.completionMessages[session.completionMessages.length - 1];
  assert.equal(lastMessage.role, 'assistant');
  assert.equal(lastMessage.content, 'echo:hello from api');
  assert.equal(session.totalCost, 0.5);

  stream.controller.abort();
  await harness.runtime.close();
});

test('full integration: approvals are exposed over HTTP and unblock the active run', async () => {
  const harness = createRuntimeHarness(async (_client, _model, messages, userInput, onEvent, options) => {
    assert.ok(options?.approvalManager);
    assert.ok(options?.sessionId);

    if (userInput !== 'needs approval') {
      onEvent({ type: 'done' });
      return messages;
    }

    const approved = await options.approvalManager.requestApproval({
      id: 'approval-shell',
      type: 'shell_command',
      description: 'Run deployment command',
      sessionId: options.sessionId,
    });

    onEvent({
      type: 'tool_result',
      toolCall: {
        id: 'approval-shell',
        name: 'bash',
        args: '{"command":"deploy"}',
        status: approved ? 'done' : 'error',
        result: approved ? 'approved' : 'rejected',
      },
    });
    onEvent({ type: 'done' });

    return [
      ...messages,
      { role: 'assistant', content: approved ? 'approved' : 'rejected' } as Message,
    ];
  });

  const created = await readJson(await requestJson(harness.app, '/sessions', { method: 'POST', json: {} }));
  const sessionId = created.id as string;
  const stream = await openSse(harness.app, `/sessions/${sessionId}/events`);
  await stream.reader.next();

  const sendResponse = await requestJson(harness.app, `/sessions/${sessionId}/messages`, {
    method: 'POST',
    json: { content: 'needs approval' },
  });
  assert.equal(sendResponse.status, 202);

  const approvalEvent = await waitFor(
    async () => {
      const event = await stream.reader.next();
      return event.event === 'approval_required' ? event : null;
    },
    (value) => value !== null,
  );

  assert.ok(approvalEvent);
  const approvalId = approvalEvent.data.data.id as string;
  const approvalsResponse = await requestJson(harness.app, '/approvals');
  const approvalsPayload = await readJson(approvalsResponse);
  assert.equal(approvalsPayload.approvals.length, 1);
  assert.equal(approvalsPayload.approvals[0].id, approvalId);

  const resolveResponse = await requestJson(harness.app, `/approvals/${approvalId}`, {
    method: 'POST',
    json: { decision: 'approve_once' },
  });
  assert.equal(resolveResponse.status, 200);

  const resolvedEvents: string[] = [];
  while (!resolvedEvents.includes('done')) {
    const next = await stream.reader.next();
    resolvedEvents.push(next.event);
  }

  assert.ok(resolvedEvents.includes('approval_resolved'));
  const approvalsAfterResponse = await requestJson(harness.app, '/approvals');
  assert.deepEqual((await readJson(approvalsAfterResponse)).approvals, []);

  stream.controller.abort();
  await harness.runtime.close();
});

test('full integration: abort stops the active run and clears running state', async () => {
  const harness = createRuntimeHarness(async (_client, _model, messages, _userInput, onEvent, options) => {
    const abortSignal = options?.abortSignal;
    assert.ok(abortSignal);

    await new Promise<void>((resolve) => {
      abortSignal.addEventListener('abort', () => resolve(), { once: true });
    });
    onEvent({ type: 'done' });
    return messages;
  });

  const created = await readJson(await requestJson(harness.app, '/sessions', { method: 'POST', json: {} }));
  const sessionId = created.id as string;
  const stream = await openSse(harness.app, `/sessions/${sessionId}/events`);
  await stream.reader.next();

  const sendResponse = await requestJson(harness.app, `/sessions/${sessionId}/messages`, {
    method: 'POST',
    json: { content: 'hang until abort' },
  });
  assert.equal(sendResponse.status, 202);

  const abortResponse = await requestJson(harness.app, '/abort', { method: 'POST' });
  const abortPayload = await readJson(abortResponse);
  assert.equal(abortPayload.aborted, true);

  await waitFor(
    async () => readJson(await requestJson(harness.app, `/sessions/${sessionId}`)),
    (session) => session.running === false,
  );

  const doneEvent = await waitFor(
    async () => {
      const event = await stream.reader.next();
      return event.event === 'done' ? event : null;
    },
    (value) => value !== null,
  );
  assert.ok(doneEvent);
  assert.equal(doneEvent.event, 'done');

  stream.controller.abort();
  await harness.runtime.close();
});

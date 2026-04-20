/**
 * SDK parity tests.
 *
 * Runs the same end-to-end scenario through:
 *   - InMemoryTransport (CoreRuntime in-process)
 *   - HttpTransport     (running Bun HTTP server over loopback)
 *
 * Both are wired to the same fake dependencies so we can prove that the
 * SDK client surface behaves identically regardless of transport.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { AddressInfo } from 'node:net';
import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import type OpenAI from 'openai';
import type { Message } from '../src/agentic-loop.js';
import { ApiRuntime, type ApiRuntimeDependencies } from '../src/api/state.js';
import { createApiApp } from '../src/api/server.js';
import {
  createSession,
  generateTitle,
  type Session,
  type SessionSummary,
} from '../src/sessions.js';
import { ToolRegistry } from '../src/tools/registry.js';
import {
  createHttpClient,
  createInMemoryClient,
  ProtoAgentClient,
  type ApiEvent,
} from '../src/sdk/index.js';

type LoopRunner = ApiRuntimeDependencies['runAgenticLoop'];

function buildDependencies(loopRunner: LoopRunner) {
  const sessions = new Map<string, Session>();
  const mcpStatus = { primary: { connected: true } };
  let mcpReconnectCount = 0;

  const dependencies: Partial<ApiRuntimeDependencies> = {
    loadRuntimeConfig: async () => ({ providers: {}, mcp: { servers: {} } }) as any,
    readConfig: () => ({ provider: 'openai', model: 'gpt-test', apiKey: 'test-key' }),
    createClient: () => ({}) as OpenAI,
    initializeMcp: async () => {},
    closeMcp: async () => {},
    reconnectAllMcp: async () => {
      mcpReconnectCount += 1;
    },
    getMcpConnectionStatus: () => mcpStatus,
    createSession: (model, provider) => createSession(model, provider),
    deleteStoredSession: async (id) => sessions.delete(id),
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
    loadSession: async (id) => {
      const session = sessions.get(id);
      return session ? structuredClone(session) : null;
    },
    saveSession: async (session) => {
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
    activateSkill: async (name: string) =>
      name === 'demo-skill'
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

  return {
    dependencies,
    getMcpReconnectCount: () => mcpReconnectCount,
  };
}

async function startHttpServer(runtime: ApiRuntime): Promise<{ url: string; close: () => Promise<void>; server: Server }> {
  const app = createApiApp(runtime);

  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const host = req.headers.host ?? 'localhost';
      const url = `http://${host}${req.url ?? '/'}`;

      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value) continue;
        if (Array.isArray(value)) {
          for (const entry of value) headers.append(key, entry);
        } else {
          headers.set(key, value);
        }
      }

      let body: BodyInit | undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        if (chunks.length > 0) body = Buffer.concat(chunks);
      }

      const response = await app.fetch(new Request(url, { method, headers, body }));

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (!response.body) {
        res.end();
        return;
      }

      const stream = Readable.fromWeb(response.body as any);
      stream.pipe(res);
      req.on('close', () => {
        stream.destroy();
      });
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

type ClientFactory = (loopRunner: LoopRunner) => Promise<{
  client: ProtoAgentClient;
  cleanup: () => Promise<void>;
  getMcpReconnectCount: () => number;
}>;

const transports: Array<{ name: string; factory: ClientFactory }> = [
  {
    name: 'in-memory',
    factory: async (loopRunner) => {
      const { dependencies, getMcpReconnectCount } = buildDependencies(loopRunner);
      const client = createInMemoryClient({ dependencies });
      return {
        client,
        cleanup: () => client.close(),
        getMcpReconnectCount,
      };
    },
  },
  {
    name: 'http',
    factory: async (loopRunner) => {
      const { dependencies, getMcpReconnectCount } = buildDependencies(loopRunner);
      const runtime = new ApiRuntime({}, dependencies);
      await runtime.initialize();
      const { url, close } = await startHttpServer(runtime);
      const client = createHttpClient({ baseUrl: url });
      return {
        client,
        cleanup: async () => {
          await client.close();
          await close();
          await runtime.close();
        },
        getMcpReconnectCount,
      };
    },
  },
];

for (const transport of transports) {
  test(`parity/${transport.name}: CRUD + workflow + todos + skills + mcp round-trip`, async () => {
    const loopRunner: LoopRunner = async (_client, _model, messages, userInput, onEvent) => {
      onEvent({ type: 'text_delta', content: `echo:${userInput}` });
      onEvent({ type: 'done' });
      return [...messages, { role: 'assistant', content: `echo:${userInput}` } as Message];
    };

    const { client, cleanup, getMcpReconnectCount } = await transport.factory(loopRunner);

    try {
      const created = await client.createSession();
      assert.equal(created.active, true);
      assert.equal(created.running, false);
      assert.equal(created.completionMessages.length, 1);

      const list = await client.listSessions();
      assert.equal(list.activeSessionId, created.id);
      assert.equal(list.sessions.length, 1);

      const workflow = await client.getWorkflow(created.id);
      assert.equal(workflow.activeSessionId, created.id);
      assert.equal(workflow.state.type, 'queue');

      const todo = {
        id: 'todo-1',
        content: 'Parity check',
        status: 'pending' as const,
        priority: 'high' as const,
      };
      const writtenTodos = await client.updateTodos(created.id, [todo]);
      assert.deepEqual(writtenTodos, [todo]);
      assert.deepEqual(await client.getTodos(created.id), [todo]);

      const skills = await client.listSkills();
      assert.equal(skills[0].name, 'demo-skill');

      const activation = await client.activateSkill('demo-skill');
      assert.deepEqual(activation.activeSkills, ['demo-skill']);

      const mcpStatus = await client.getMcpStatus();
      assert.deepEqual(mcpStatus, { primary: { connected: true } });

      const reconnected = await client.reconnectMcp();
      assert.deepEqual(reconnected, { primary: { connected: true } });
      assert.equal(getMcpReconnectCount(), 1);
    } finally {
      await cleanup();
    }
  });

  test(`parity/${transport.name}: sendMessage + SSE round-trip delivers snapshot, deltas, and done`, async () => {
    const loopRunner: LoopRunner = async (_client, _model, messages, userInput, onEvent) => {
      onEvent({ type: 'text_delta', content: `echo:${userInput}` });
      onEvent({ type: 'done' });
      return [...messages, { role: 'assistant', content: `echo:${userInput}` } as Message];
    };

    const { client, cleanup } = await transport.factory(loopRunner);

    try {
      const session = await client.createSession();

      const seen: ApiEvent[] = [];
      const doneSignal = new Promise<void>((resolve) => {
        const subscription = client.subscribeToSession(session.id, {
          onEvent: (event) => {
            seen.push(event);
            if (event.type === 'done') {
              subscription.close();
              resolve();
            }
          },
        });
      });

      // Give the subscription a chance to receive the initial snapshot before
      // we kick off a run (the in-memory transport emits synchronously but the
      // HTTP transport flushes through the server).
      await delay(10);

      const send = await client.sendMessage(session.id, 'hello parity');
      assert.equal(send.status, 'started');

      await doneSignal;

      const eventTypes = seen.map((event) => event.type);
      assert.ok(eventTypes.includes('snapshot'));
      assert.ok(eventTypes.includes('text_delta'));
      assert.ok(eventTypes.includes('done'));

      const refreshed = await client.getSession(session.id);
      const last = refreshed.completionMessages[refreshed.completionMessages.length - 1];
      assert.equal(last.role, 'assistant');
      assert.equal((last as { content: string }).content, 'echo:hello parity');
    } finally {
      await cleanup();
    }
  });

  test(`parity/${transport.name}: approvals flow through SDK + event stream`, async () => {
    const loopRunner: LoopRunner = async (_client, _model, messages, userInput, onEvent, options) => {
      if (userInput !== 'needs approval') {
        onEvent({ type: 'done' });
        return messages;
      }

      const approved = await options!.approvalManager!.requestApproval({
        id: 'approval-shell',
        type: 'shell_command',
        description: 'Run deployment command',
        sessionId: options!.sessionId,
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
    };

    const { client, cleanup } = await transport.factory(loopRunner);

    try {
      const session = await client.createSession();

      let approvalId: string | null = null;
      let sawResolved = false;

      const done = new Promise<void>((resolve) => {
        const subscription = client.subscribeToSession(session.id, {
          onEvent: (event) => {
            if (event.type === 'approval_required') {
              approvalId = (event.data as { id: string }).id;
            }
            if (event.type === 'approval_resolved') {
              sawResolved = true;
            }
            if (event.type === 'done') {
              subscription.close();
              resolve();
            }
          },
        });
      });

      await delay(10);
      await client.sendMessage(session.id, 'needs approval');

      await waitFor(() => approvalId !== null, 2000);
      assert.ok(approvalId);

      const pending = await client.listApprovals();
      assert.equal(pending.length, 1);
      assert.equal(pending[0].id, approvalId);

      const resolved = await client.resolveApproval(approvalId!, 'approve_once');
      assert.ok(resolved);

      await done;
      assert.equal(sawResolved, true);

      const remaining = await client.listApprovals();
      assert.deepEqual(remaining, []);
    } finally {
      await cleanup();
    }
  });

  test(`parity/${transport.name}: two concurrent sessions keep independent state`, async () => {
    const loopRunner: LoopRunner = async (_client, _model, messages, userInput, onEvent) => {
      onEvent({ type: 'text_delta', content: `echo:${userInput}` });
      onEvent({ type: 'done' });
      return [...messages, { role: 'assistant', content: `echo:${userInput}` } as Message];
    };

    const { client, cleanup } = await transport.factory(loopRunner);

    try {
      const sessionA = await client.createSession();
      const sessionB = await client.createSession();
      assert.notEqual(sessionA.id, sessionB.id);

      const listAfterBoth = await client.listSessions();
      assert.ok(listAfterBoth.activeSessionIds.includes(sessionA.id));
      assert.ok(listAfterBoth.activeSessionIds.includes(sessionB.id));

      // Independent todos.
      await client.updateTodos(sessionA.id, [
        { id: 'a1', content: 'A task', status: 'pending', priority: 'high' },
      ]);
      await client.updateTodos(sessionB.id, [
        { id: 'b1', content: 'B task', status: 'in_progress', priority: 'low' },
      ]);
      assert.deepEqual(await client.getTodos(sessionA.id), [
        { id: 'a1', content: 'A task', status: 'pending', priority: 'high' },
      ]);
      assert.deepEqual(await client.getTodos(sessionB.id), [
        { id: 'b1', content: 'B task', status: 'in_progress', priority: 'low' },
      ]);

      // Independent workflow types (keep both queue so downstream message
      // assertions aren't affected by workflow-specific preamble wrapping).
      const workflowA = await client.getWorkflow(sessionA.id);
      const workflowB = await client.getWorkflow(sessionB.id);
      assert.equal(workflowA.state.type, 'queue');
      assert.equal(workflowB.state.type, 'queue');
      assert.equal(workflowA.activeSessionId, sessionA.id);
      assert.equal(workflowB.activeSessionId, sessionB.id);

      // Independent message streams.
      const sendA = await client.sendMessage(sessionA.id, 'hello A');
      const sendB = await client.sendMessage(sessionB.id, 'hello B');
      assert.equal(sendA.status, 'started');
      assert.equal(sendB.status, 'started');

      await waitFor(async () => {
        const [a, b] = await Promise.all([
          client.getSession(sessionA.id),
          client.getSession(sessionB.id),
        ]);
        return a.running === false && b.running === false;
      }, 3000);

      const refreshedA = await client.getSession(sessionA.id);
      const refreshedB = await client.getSession(sessionB.id);
      const lastA = refreshedA.completionMessages[refreshedA.completionMessages.length - 1];
      const lastB = refreshedB.completionMessages[refreshedB.completionMessages.length - 1];
      assert.equal((lastA as { content: string }).content, 'echo:hello A');
      assert.equal((lastB as { content: string }).content, 'echo:hello B');
    } finally {
      await cleanup();
    }
  });
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error(`Timed out waiting for predicate after ${timeoutMs}ms`);
}

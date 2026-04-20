import test from 'node:test';
import assert from 'node:assert/strict';
import { TabRuntime } from '../src/tui/tab-runtime.js';
import { ToolRegistry } from '../src/tools/registry.js';
import { createSession, type Session } from '../src/sessions.js';
import type { CoreRuntimeDependencies } from '../src/core/runtime.js';

function buildFakeDeps(sessions: Map<string, Session>): Partial<CoreRuntimeDependencies> {
  return {
    loadRuntimeConfig: async () => ({ providers: {}, mcp: { servers: {} } }) as any,
    readConfig: () => ({ provider: 'openai', model: 'gpt-test', apiKey: 'test' }),
    createClient: () => ({}) as any,
    initializeMcp: async () => {},
    closeMcp: async () => {},
    getMcpConnectionStatus: () => ({}),
    reconnectAllMcp: async () => {},
    listStoredSessions: async () =>
      Array.from(sessions.values()).map((s) => ({
        id: s.id,
        title: s.title,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        messageCount: s.completionMessages.length,
      })),
    loadSession: async (id: string) => sessions.get(id) ?? null,
    saveSession: async (session: Session) => {
      sessions.set(session.id, session);
    },
    deleteStoredSession: async (id: string) => sessions.delete(id),
  };
}

test('TabRuntime exposes a client backed by a per-tab CoreRuntime', async () => {
  const sessions = new Map<string, Session>();
  const seeded = createSession('gpt-test', 'openai');
  seeded.title = 'seeded';
  sessions.set(seeded.id, seeded);

  const tabRuntime = new TabRuntime({
    toolRegistry: new ToolRegistry(),
    dependencies: buildFakeDeps(sessions),
  });

  try {
    const response = await tabRuntime.client.listSessions();
    assert.equal(response.sessions.length, 1);
    assert.equal(response.sessions[0].id, seeded.id);
    assert.equal(response.activeSessionId, null);
    assert.equal(response.running, false);
  } finally {
    await tabRuntime.close();
  }
});

test('TabRuntime.close() is idempotent and safe before initialization', async () => {
  const tabRuntime = new TabRuntime({
    toolRegistry: new ToolRegistry(),
    dependencies: buildFakeDeps(new Map()),
  });

  await tabRuntime.close();
  await tabRuntime.close(); // must not throw
});

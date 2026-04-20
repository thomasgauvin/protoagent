import { Hono } from 'hono';
import { z } from 'zod';
import type { TodoItem } from '../tools/todo.js';
import type { ApiRuntime } from './state.js';
import { streamSessionEvents } from './sse.js';

const messageBodySchema = z.object({
  content: z.string().min(1),
  mode: z.enum(['send', 'queue']).optional(),
});

const approvalBodySchema = z.object({
  decision: z.enum(['approve_once', 'approve_session', 'reject']),
});

const workflowBodySchema = z.object({
  type: z.enum(['queue', 'loop', 'cron']),
});

const workflowStartBodySchema = z.object({
  type: z.enum(['queue', 'loop', 'cron']).optional(),
  loopInstructions: z.string().optional(),
  endCondition: z.string().optional(),
  maxIterations: z.number().int().positive().optional(),
  cronSchedule: z.string().optional(),
  cronPrompt: z.string().optional(),
});

const todoItemSchema: z.ZodType<TodoItem> = z.object({
  id: z.string(),
  content: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
  priority: z.enum(['high', 'medium', 'low']),
});

const todosBodySchema = z.object({
  todos: z.array(todoItemSchema),
});

async function parseJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  return schema.parse(await request.json());
}

export function createApiRoutes(runtime: ApiRuntime) {
  const app = new Hono();

  app.get('/health', (c) => {
    return c.json({ ok: true });
  });

  // ─── Sessions ───────────────────────────────────────────────────────
  app.get('/sessions', async (c) => {
    return c.json(await runtime.listSessions());
  });

  app.post('/sessions', async (c) => {
    return c.json(await runtime.createAndActivateSession(), 201);
  });

  app.get('/sessions/:id', async (c) => {
    return c.json(await runtime.getSession(c.req.param('id')));
  });

  app.delete('/sessions/:id', async (c) => {
    const deleted = await runtime.deleteSession(c.req.param('id'));
    if (!deleted) {
      return c.json({ error: 'Session not found.' }, 404);
    }
    return c.json({ deleted: true });
  });

  app.post('/sessions/:id/messages', async (c) => {
    const body = await parseJson(c.req.raw, messageBodySchema);
    const result = await runtime.sendMessage(c.req.param('id'), body.content, body.mode);
    return c.json(result, 202);
  });

  app.get('/sessions/:id/events', async (c) => {
    return streamSessionEvents(c, runtime, c.req.param('id'));
  });

  app.post('/sessions/:id/abort', async (c) => {
    return c.json(await runtime.abortCurrentLoop(c.req.param('id')));
  });

  // ─── Per-session workflow + todos ────────────────────────────────────
  app.get('/sessions/:id/workflow', (c) => {
    return c.json(runtime.getWorkflow(c.req.param('id')));
  });

  app.post('/sessions/:id/workflow', async (c) => {
    const body = await parseJson(c.req.raw, workflowBodySchema);
    return c.json(await runtime.switchWorkflow(c.req.param('id'), body.type));
  });

  app.post('/sessions/:id/workflow/start', async (c) => {
    const body = await parseJson(c.req.raw, workflowStartBodySchema);
    return c.json(await runtime.startWorkflow(c.req.param('id'), body));
  });

  app.post('/sessions/:id/workflow/stop', async (c) => {
    return c.json(await runtime.stopWorkflow(c.req.param('id')));
  });

  app.get('/sessions/:id/todos', (c) => {
    return c.json({ todos: runtime.getTodos(c.req.param('id')) });
  });

  app.put('/sessions/:id/todos', async (c) => {
    const body = await parseJson(c.req.raw, todosBodySchema);
    return c.json({ todos: await runtime.updateTodos(c.req.param('id'), body.todos) });
  });

  // ─── Global abort (all running sessions) ─────────────────────────────
  app.post('/abort', async (c) => {
    return c.json(await runtime.abortCurrentLoop());
  });

  // ─── Approvals ──────────────────────────────────────────────────────
  app.get('/approvals', (c) => {
    return c.json({ approvals: runtime.listApprovals() });
  });

  app.post('/approvals/:id', async (c) => {
    const body = await parseJson(c.req.raw, approvalBodySchema);
    const approval = await runtime.resolveApproval(c.req.param('id'), body.decision);
    if (!approval) {
      return c.json({ error: 'Approval not found.' }, 404);
    }
    return c.json({ approval, decision: body.decision });
  });

  // ─── Skills + MCP (global) ───────────────────────────────────────────
  app.get('/skills', async (c) => {
    return c.json({ skills: await runtime.listSkills() });
  });

  app.post('/skills/:name/activate', async (c) => {
    return c.json(await runtime.activateSkillByName(c.req.param('name')));
  });

  app.get('/mcp/status', (c) => {
    return c.json({ status: runtime.getMcpStatus() });
  });

  app.post('/mcp/reconnect', async (c) => {
    return c.json({ status: await runtime.reconnectMcp() });
  });

  return app;
}

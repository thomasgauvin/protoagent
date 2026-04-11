/**
 * ProtoAgent Core Server
 *
 * HTTP API with Server-Sent Events (SSE) for real-time streaming.
 * Built with Hono for lightweight, fast HTTP handling.
 */
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger as honoLogger } from 'hono/logger';
import { serve } from '@hono/node-server';
import { eventBus } from '../bus/event-bus.js';
import type { EventEnvelope } from '../bus/bus-event.js';
import { AgentService } from '../agent/agent-service.js';
import { SessionService } from '../agent/session-service.js';
import { initializeMcp, closeMcp } from '../mcp/mcp-client.js';

const app = new Hono();
const agentService = new AgentService();
const sessionService = new SessionService();

// Middleware
app.use('*', cors({ origin: '*' }));
app.use('*', honoLogger());

// Health check
app.get('/health', (c) => c.json({ status: 'ok', version: '0.2.0' }));

// SSE endpoint for events
app.get('/events', (c) => {
  const sessionId = c.req.query('sessionId');

  return new Response(
    new ReadableStream({
      start(controller) {
        // Send initial connection message
        controller.enqueue(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

        // Subscribe to events
        const unsubscribe = eventBus.subscribeAll((event: EventEnvelope) => {
          // Filter by sessionId if provided
          if (sessionId && (event.payload as any)?.sessionId !== sessionId) {
            return;
          }

          try {
            controller.enqueue(`data: ${JSON.stringify(event)}\n\n`);
          } catch {
            // Client disconnected
            unsubscribe();
          }
        });

        // Heartbeat every 10s to keep connection alive
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(`:heartbeat\n\n`);
          } catch {
            clearInterval(heartbeat);
            unsubscribe();
          }
        }, 10000);

        // Cleanup on close
        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
      },
    }),
    {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    }
  );
});

// Session management
app.post('/sessions', async (c) => {
  const body = await c.req.json();
  const session = await sessionService.create(body);
  return c.json(session, 201);
});

app.get('/sessions', async (c) => {
  const sessions = await sessionService.list();
  return c.json(sessions);
});

app.get('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  const session = await sessionService.get(id);
  if (!session) return c.json({ error: 'Session not found' }, 404);
  return c.json(session);
});

app.delete('/sessions/:id', async (c) => {
  const id = c.req.param('id');
  await sessionService.delete(id);
  return c.json({ success: true });
});

// Agent execution
app.post('/agent/run', async (c) => {
  const body = await c.req.json();
  const { sessionId, message, config } = body;

  if (!sessionId || !message) {
    return c.json({ error: 'sessionId and message required' }, 400);
  }

  // Start agent loop (runs asynchronously, emits events)
  agentService.run(sessionId, message, config).catch((err) => {
    console.error('Agent execution error:', err);
  });

  return c.json({ success: true, sessionId });
});

// Abort running agent
app.post('/agent/abort/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId');
  await agentService.abort(sessionId);
  return c.json({ success: true });
});

// Queue management
app.get('/queue/:sessionId', (c) => {
  const sessionId = c.req.param('sessionId');
  const status = agentService.getQueueStatus(sessionId);

  if (!status) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({
    sessionId,
    queueLength: status.queueLength,
    isProcessing: status.isProcessing,
  });
});

app.post('/queue/:sessionId/clear', (c) => {
  const sessionId = c.req.param('sessionId');
  const success = agentService.clearQueue(sessionId);

  if (!success) {
    return c.json({ error: 'Session not found' }, 404);
  }

  return c.json({ success: true, message: 'Queue cleared' });
});

// Tool execution (direct)
app.post('/tools/:toolName', async (c) => {
  const toolName = c.req.param('toolName');
  const args = await c.req.json();

  try {
    const result = await agentService.executeTool(toolName, args);
    return c.json({ success: true, result });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// MCP initialization endpoint
app.post('/mcp/init', async (c) => {
  const body = await c.req.json();
  const { servers } = body;

  try {
    await initializeMcp(servers || {});
    return c.json({ success: true, servers: Object.keys(servers || {}) });
  } catch (err: any) {
    return c.json({ success: false, error: err.message }, 500);
  }
});

// Server startup
const port = parseInt(process.env.PROTOAGENT_PORT || '3001');

// Initialize MCP on startup if config exists
async function initMcpFromEnv(): Promise<void> {
  try {
    // Check for MCP config in environment or default config file
    const mcpConfig = process.env.PROTOAGENT_MCP_CONFIG;
    if (mcpConfig) {
      const servers = JSON.parse(mcpConfig);
      await initializeMcp(servers);
    }
  } catch (err) {
    console.error('Failed to initialize MCP from environment:', err);
  }
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await closeMcp();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await closeMcp();
  process.exit(0);
});

// Start server
console.log(`🚀 ProtoAgent Core Server starting on port ${port}...`);

serve({
  fetch: app.fetch,
  port,
});

// Initialize MCP after server starts
void initMcpFromEnv();

export { app };

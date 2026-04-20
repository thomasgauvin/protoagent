import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { ApiEvent, ApiRuntime } from './state.js';

export async function streamSessionEvents(c: Context, runtime: ApiRuntime, sessionId: string) {
  return streamSSE(c, async (stream) => {
    const snapshot = await runtime.getSessionSnapshot(sessionId);

    const writeEvent = async (event: ApiEvent) => {
      await stream.writeSSE({
        event: event.type,
        data: JSON.stringify(event),
      });
    };

    await stream.writeSSE({
      event: 'snapshot',
      data: JSON.stringify({
        type: 'snapshot',
        sessionId,
        timestamp: new Date().toISOString(),
        data: {
          session: snapshot,
          approvals: runtime.listApprovals().filter((approval) => approval.sessionId === sessionId),
        },
      }),
    });

    const unsubscribe = runtime.subscribe(sessionId, (event) => {
      void writeEvent(event);
    });

    const signal = c.req.raw.signal;
    await new Promise<void>((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          unsubscribe();
          resolve();
        },
        { once: true },
      );
    });
  });
}

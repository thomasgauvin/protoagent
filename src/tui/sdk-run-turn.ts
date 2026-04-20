/**
 * SDK-driven agentic turn for the TUI.
 *
 * This is the replacement for the in-TUI `runAgenticTurn` function that
 * calls `runAgenticLoop` directly. When `PROTOAGENT_TUI_VIA_SDK=1` is set,
 * App.ts uses this function instead: it calls `tabRuntime.client.sendMessage`,
 * subscribes to `ApiEvent`s, and feeds each unwrapped `AgentEvent` back to
 * the existing `handleAgentEvent` UI handler.
 *
 * The upshot is that the TUI's event-processing code is reused as-is: the
 * only thing that changes is the source of events (runtime event bus
 * instead of an in-process callback from runAgenticLoop).
 */

import type { AgentEvent } from '../agentic-loop.js';
import type { ProtoAgentClient, ApiEvent } from '../sdk/index.js';

export interface SdkRunTurnOptions {
  client: ProtoAgentClient;
  sessionId: string;
  userContent: string;
  /** Existing TUI event handler. We forward every AgentEvent to it. */
  onAgentEvent: (event: AgentEvent) => void;
  /** Called once when the turn is finished or errored. Idempotent. */
  onFinished?: () => void;
  /** Called when a non-agent lifecycle event arrives (e.g. approval_required). */
  onLifecycleEvent?: (event: ApiEvent) => void;
  /**
   * Non-AgentEvent types emitted by the runtime. Useful for the TUI to
   * distinguish lifecycle concerns (snapshot, session_updated, etc.) from
   * agent output.
   */
}

const LIFECYCLE_EVENT_TYPES = new Set<string>([
  'snapshot',
  'session_activated',
  'session_updated',
  'message_queued',
  'approval_required',
  'approval_resolved',
  'todos_updated',
  'workflow_updated',
  'skills_updated',
]);

/**
 * Drive a single user turn through the SDK. Resolves when the runtime
 * emits a `done` event for this session. The caller is expected to be
 * in charge of the UI state machine; we just forward events.
 */
export async function runSdkTurn(options: SdkRunTurnOptions): Promise<void> {
  const { client, sessionId, userContent, onAgentEvent, onFinished, onLifecycleEvent } = options;

  let finished = false;
  let finishResolve: (() => void) | null = null;
  let finishError: ((error: Error) => void) | null = null;

  const finishPromise = new Promise<void>((resolve, reject) => {
    finishResolve = resolve;
    finishError = reject;
  });

  const settle = (error?: Error): void => {
    if (finished) return;
    finished = true;
    if (onFinished) {
      try { onFinished(); } catch { /* no-op */ }
    }
    if (error) {
      finishError?.(error);
    } else {
      finishResolve?.();
    }
  };

  const subscription = client.subscribeToSession(sessionId, {
    onEvent: (envelope: ApiEvent) => {
      if (LIFECYCLE_EVENT_TYPES.has(envelope.type)) {
        onLifecycleEvent?.(envelope);
        return;
      }

      // Every non-lifecycle event carries an AgentEvent payload in `data`.
      const agentEvent = envelope.data as AgentEvent | undefined;
      if (agentEvent && typeof agentEvent === 'object' && 'type' in agentEvent) {
        try {
          onAgentEvent(agentEvent);
        } catch (err) {
          settle(err instanceof Error ? err : new Error(String(err)));
          subscription.close();
          return;
        }

        if (agentEvent.type === 'done') {
          subscription.close();
          settle();
        } else if (agentEvent.type === 'error') {
          // Don't close the stream on a transient error event; only on done.
          // The runtime emits error and then done when the run truly ends.
        }
      }
    },
    onError: (error) => {
      subscription.close();
      settle(error);
    },
  });

  try {
    const response = await client.sendMessage(sessionId, userContent, 'send');
    if (response.status === 'queued') {
      // Message was queued because a run is already in flight. The stream
      // will still emit a `done` event when the runtime drains.
    }
  } catch (error) {
    subscription.close();
    settle(error instanceof Error ? error : new Error(String(error)));
  }

  return finishPromise;
}

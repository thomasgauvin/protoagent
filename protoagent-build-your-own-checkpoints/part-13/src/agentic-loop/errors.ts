// Error handling module for the agentic loop.
// Handles API errors with various retry strategies:
// - 400 errors: JSON repair, orphaned tool cleanup, truncation, "continue" prompts
// - 429 errors: rate limit backoff
// - 5xx errors: exponential backoff
// - Context window exceeded: forced compaction

import type { Message, AgentEventHandler } from '../agentic-loop.js';
import type { ModelPricing } from '../utils/cost-tracker.js';
import { compactIfNeeded } from '../utils/compactor.js';
import { logger } from '../utils/logger.js';

// Retry state tracked across loop iterations.
export interface RetryState {
  repairCount: number;
  contextCount: number;
  truncateCount: number;
  continueCount: number;
  retriggerCount: number; // For AI stopping after tool call
}

const LIMITS = {
  MAX_REPAIR: 2,
  MAX_CONTEXT: 2,
  MAX_TRUNCATE: 5,
  MAX_CONTINUE: 1,
};

// Sleep with abort signal support.
export async function sleepWithAbort(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  if (abortSignal.aborted) {
    throw new Error('Operation aborted');
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', onAbort);
      reject(new Error('Operation aborted'));
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

// Result of attempting to handle an API error.
export interface ErrorHandlerResult {
  handled: boolean;
  shouldAbort: boolean;
  silentRetry: boolean;
  errorMessage?: string;
  transient?: boolean;
}

// Handle an API error with appropriate retry strategy.
export async function handleApiError(
  apiError: any,
  messages: Message[],
  _validToolNames: Set<string>,
  pricing: ModelPricing | undefined,
  retryState: RetryState,
  iterationCount: number,
  onEvent: AgentEventHandler,
  client?: any,
  model?: string,
  requestDefaults?: Record<string, unknown>,
  sessionId?: string
): Promise<ErrorHandlerResult> {
  const errMsg = apiError?.message || 'Unknown API error';
  const status = apiError?.status;

  logger.error(`API error: ${errMsg}`, { status, code: apiError?.code });

  const retryableStatus = status === 408 || status === 409 || status === 425;
  const retryableCode = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(apiError?.code);

  // Context window exceeded - force compaction (check before generic 400 handling)
  const isContextTooLong =
    status === 400 &&
    /prompt.*too long|context.*length|maximum.*token|tokens?.*exceed/i.test(errMsg);

  if (isContextTooLong && retryState.contextCount < LIMITS.MAX_CONTEXT) {
    retryState.contextCount++;
    logger.warn(`Prompt too long (attempt ${retryState.contextCount})`);
    onEvent({
      type: 'error',
      error: 'Prompt too long. Compacting conversation...',
      transient: true,
    });

    if (pricing && client && model) {
      try {
        const compacted = await compactIfNeeded(
          client,
          model,
          messages,
          pricing.contextWindow,
          requestDefaults || {},
          sessionId
        );
        messages.length = 0;
        messages.push(...compacted);
      } catch (compactErr) {
        logger.error(`Compaction failed: ${compactErr}`);
      }
    }

    // Truncate oversized tool results as fallback
    const MAX_TOOL_CHARS = 20_000;
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i] as any;
      if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_CHARS) {
        messages[i] = {
          ...m,
          content: m.content.slice(0, MAX_TOOL_CHARS) + '\n... (truncated)',
        };
      }
    }

    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // Rate limit - backoff
  if (status === 429) {
    const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
    const backoff = Math.min(retryAfter * 1000, 60_000);
    logger.info(`Rate limited, retrying in ${backoff / 1000}s...`);
    onEvent({ type: 'error', error: `Rate limited. Retrying...`, transient: true });
    await sleepWithAbort(backoff);
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // Server error - exponential backoff
  if (status >= 500 || retryableStatus || retryableCode) {
    const backoff = Math.min(2 ** iterationCount * 1000, 30_000);
    logger.info(`Request failed, retrying in ${backoff / 1000}s...`);
    onEvent({ type: 'error', error: `Request failed. Retrying...`, transient: true });
    await sleepWithAbort(backoff);
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // Generic 400 errors - try repair/truncate/continue
  if (status === 400) {
    return await handle400Error(messages, retryState, onEvent);
  }

  // Non-retryable
  return { handled: false, shouldAbort: false, silentRetry: false, errorMessage: errMsg };
}

// Handle 400 errors: repair JSON → remove orphaned → truncate → continue.
async function handle400Error(
  messages: Message[],
  retryState: RetryState,
  onEvent: AgentEventHandler
): Promise<ErrorHandlerResult> {
  // 1. Try JSON repairs on tool arguments
  // Models sometimes emit invalid escape sequences in tool args (e.g., \| from grep regex)
  // which cause JSON.parse to fail. These persist across requests unless repaired.
  if (retryState.repairCount < LIMITS.MAX_REPAIR) {
    let repaired = false;

    for (const msg of messages) {
      const msgAny = msg as any;
      if (msg.role === 'assistant' && Array.isArray(msgAny.tool_calls)) {
        for (const tc of msgAny.tool_calls) {
          const args = tc.function?.arguments;
          if (args && typeof args === 'string') {
            const fixed = repairInvalidEscapes(args);
            if (fixed !== args) {
              tc.function.arguments = fixed;
              repaired = true;
            }
          }
        }
      }
    }

    if (repaired) {
      retryState.repairCount++;
      logger.warn('400 response: repaired invalid JSON escapes');
      return { handled: true, shouldAbort: false, silentRetry: true };
    }
  }

  // 2. Remove orphaned tool results
  // This happens when messages are truncated and the assistant's tool_calls are
  // removed but the tool results remain. The API rejects orphaned tool results.
  const cleaned = removeOrphanedToolResults(messages);
  if (cleaned.changed) {
    messages.length = 0;
    messages.push(...cleaned.messages);
    logger.warn('400 response: removed orphaned tool results');
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // 3. Truncate messages progressively
  // If repairs didn't work, remove the last message (usually the problematic one)
  // and retry. We keep at least system + 1 user message.
  if (retryState.truncateCount < LIMITS.MAX_TRUNCATE && messages.length > 2) {
    retryState.truncateCount++;
    const removed = messages.splice(-1);
    logger.debug('400 error: removed last message', {
      role: removed[0]?.role,
      remaining: messages.length,
    });
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // 4. Try "continue" prompt
  // Sometimes the model just needs a nudge to continue after getting stuck.
  if (retryState.continueCount < LIMITS.MAX_CONTINUE) {
    retryState.continueCount++;
    messages.push({ role: 'user', content: 'continue' } as Message);
    logger.warn('400 error: adding "continue" message');
    onEvent({ type: 'error', error: 'Retrying with "continue"...', transient: true });
    return { handled: true, shouldAbort: false, silentRetry: true };
  }

  // All strategies exhausted
  return {
    handled: false,
    shouldAbort: false,
    silentRetry: false,
    errorMessage: 'Could not recover from error. Try /clear to start fresh.',
  };
}

// Repair invalid JSON escape sequences.
// Models sometimes emit \| \! \- etc. (e.g. grep regex args).
function repairInvalidEscapes(value: string): string {
  return value.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
}

// Remove orphaned tool result messages that don't have a matching tool_call_id.
function removeOrphanedToolResults(messages: Message[]): { messages: Message[]; changed: boolean } {
  const validToolCallIds = new Set<string>();

  for (const msg of messages) {
    const msgAny = msg as any;
    if (msg.role === 'assistant' && Array.isArray(msgAny.tool_calls)) {
      for (const tc of msgAny.tool_calls) {
        if (tc.id) validToolCallIds.add(tc.id);
      }
    }
  }

  const filtered = messages.filter((msg) => {
    const msgAny = msg as any;
    if (msg.role === 'tool' && msgAny.tool_call_id) {
      const isOrphaned = !validToolCallIds.has(msgAny.tool_call_id);
      if (isOrphaned) {
        logger.warn('Removing orphaned tool result', { id: msgAny.tool_call_id });
      }
      return !isOrphaned;
    }
    return true;
  });

  return { messages: filtered, changed: filtered.length !== messages.length };
}

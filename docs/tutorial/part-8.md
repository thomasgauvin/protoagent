# Part 8: Compaction & Cost Tracking

Once an agent runs longer sessions, context pressure becomes real. Every message, tool result, and file read adds tokens. This part adds token estimation, cost tracking, context-window utilization monitoring, and automatic compaction when the context gets too full.

## What you are building

Starting from Part 7, you add:

- `src/utils/logger.ts` — file-based logger (needed by compactor)
- `src/utils/cost-tracker.ts` — token estimation and cost calculation
- `src/utils/compactor.ts` — conversation compaction when context exceeds 90%
- Updated `src/agentic-loop.ts` — compaction check, usage emission, abort support
- Updated `src/App.tsx` — usage display, cost tracking, spinner

## Step 1: Create `src/utils/logger.ts`

Logs go to a file to avoid interfering with Ink UI rendering.

```typescript
// src/utils/logger.ts

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

let currentLevel: LogLevel = LogLevel.INFO;
let logFilePath: string | null = null;

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function initLogFile(): string {
  const logsDir = join(homedir(), '.local', 'share', 'protoagent', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFilePath = join(logsDir, `protoagent-${timestamp}.log`);
  writeToFile(`\n${'='.repeat(80)}\nProtoAgent Log - ${new Date().toISOString()}\n${'='.repeat(80)}\n`);

  return logFilePath;
}

function writeToFile(message: string): void {
  if (!logFilePath) {
    initLogFile();
  }
  try {
    appendFileSync(logFilePath!, message);
  } catch {
    // Silently fail if we can't write to log file
  }
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${ms}`;
}

function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  if (level > currentLevel) return;
  const ts = timestamp();
  const ctx = context ? ` ${JSON.stringify(context)}` : '';
  writeToFile(`[${ts}] ${label.padEnd(5)} ${message}${ctx}\n`);
}

export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.ERROR, 'ERROR', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.WARN, 'WARN', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.INFO, 'INFO', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.DEBUG, 'DEBUG', msg, ctx),
  trace: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.TRACE, 'TRACE', msg, ctx),

  startOperation(name: string): { end: () => void } {
    const start = performance.now();
    logger.debug(`${name} started`);
    return {
      end() {
        const ms = (performance.now() - start).toFixed(1);
        logger.debug(`${name} completed`, { durationMs: ms });
      },
    };
  },

  getLogFilePath(): string | null {
    return logFilePath;
  },
};
```

## Step 2: Create `src/utils/cost-tracker.ts`

Token estimation uses a rough heuristic (~4 chars per token). When actual usage data is available from the API, it's preferred.

```typescript
// src/utils/cost-tracker.ts

import type OpenAI from 'openai';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ContextInfo {
  currentTokens: number;
  maxTokens: number;
  utilizationPercentage: number;
  needsCompaction: boolean;
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  contextWindow: number;
}

/** Rough token estimation: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens for a single message including overhead. */
export function estimateMessageTokens(msg: OpenAI.Chat.Completions.ChatCompletionMessageParam): number {
  let tokens = 4; // per-message overhead
  if ('content' in msg && typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content);
  }
  if ('tool_calls' in msg && Array.isArray((msg as any).tool_calls)) {
    for (const tc of (msg as any).tool_calls) {
      tokens += estimateTokens(tc.function?.name || '') + estimateTokens(tc.function?.arguments || '') + 10;
    }
  }
  return tokens;
}

/** Estimate total tokens for a conversation. */
export function estimateConversationTokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0) + 10;
}

/** Calculate dollar cost for a given number of tokens. */
export function calculateCost(inputTokens: number, outputTokens: number, pricing: ModelPricing): number {
  return inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken;
}

/** Get context window utilisation info. */
export function getContextInfo(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  pricing: ModelPricing
): ContextInfo {
  const currentTokens = estimateConversationTokens(messages);
  const maxTokens = pricing.contextWindow;
  const utilizationPercentage = (currentTokens / maxTokens) * 100;
  return {
    currentTokens,
    maxTokens,
    utilizationPercentage,
    needsCompaction: utilizationPercentage >= 90,
  };
}

/** Build a UsageInfo from actual or estimated token counts. */
export function createUsageInfo(inputTokens: number, outputTokens: number, pricing: ModelPricing): UsageInfo {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: calculateCost(inputTokens, outputTokens, pricing),
  };
}
```

## Step 3: Create `src/utils/compactor.ts`

When the conversation exceeds 90% of the context window, the compactor summarizes older messages using the LLM. The most recent messages are kept verbatim so the agent doesn't lose immediate context.

```typescript
// src/utils/compactor.ts

import type OpenAI from 'openai';
import { estimateConversationTokens } from './cost-tracker.js';
import { logger } from './logger.js';
import { getTodosForSession, type TodoItem } from '../tools/todo.js';

const RECENT_MESSAGES_TO_KEEP = 5;

const COMPRESSION_PROMPT = `You are a conversation state manager. Your job is to compress a conversation history into a compact summary that preserves all important context.

Produce a structured summary in this format:

<state_snapshot>
<overall_goal>What the user is trying to accomplish</overall_goal>
<key_knowledge>Important facts, conventions, constraints discovered</key_knowledge>
<file_system_state>Files created, read, modified, or deleted (with paths)</file_system_state>
<recent_actions>Last significant actions and their outcomes</recent_actions>
<current_plan>Current step-by-step plan with status: [DONE], [IN PROGRESS], [TODO]</current_plan>
</state_snapshot>

Be thorough but concise. Do not lose any information that would be needed to continue the conversation.`;

export async function compactIfNeeded(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  contextWindow: number,
  currentTokens: number,
  requestDefaults: Record<string, unknown> = {},
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const utilisation = (currentTokens / contextWindow) * 100;
  if (utilisation < 90) return messages;

  logger.info(`Compacting conversation (${utilisation.toFixed(1)}% of context window used)`);

  try {
    return await compactConversation(client, model, messages, requestDefaults, sessionId);
  } catch (err) {
    logger.error(`Compaction failed, continuing with original messages: ${err}`);
    return messages;
  }
}

async function compactConversation(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  requestDefaults: Record<string, unknown>,
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const systemMessage = messages[0];
  const recentMessages = messages.slice(-RECENT_MESSAGES_TO_KEEP);
  const historyToCompress = messages.slice(1, messages.length - RECENT_MESSAGES_TO_KEEP);

  if (historyToCompress.length === 0) {
    logger.debug('Nothing to compact — conversation too short');
    return messages;
  }

  const activeTodos = getTodosForSession(sessionId);
  const todoReminder = activeTodos.length > 0
    ? `\n\nActive TODOs:\n${activeTodos.map((todo: TodoItem) => `- [${todo.status}] ${todo.content}`).join('\n')}\n\nThe agent must not stop until the TODO list is fully complete.`
    : '';

  const compressionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPRESSION_PROMPT },
    {
      role: 'user',
      content: `Here is the conversation history to compress:\n\n${historyToCompress
        .map((m) => `[${(m as any).role}]: ${(m as any).content || JSON.stringify((m as any).tool_calls || '')}`)
        .join('\n\n')}${todoReminder}`,
    },
  ];

  const response = await client.chat.completions.create({
    ...requestDefaults,
    model,
    messages: compressionMessages,
    max_tokens: 2000,
    temperature: 0.1,
  });

  const summary = response.choices[0]?.message?.content;
  if (!summary) {
    throw new Error('Compression returned empty response');
  }

  const compacted: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    systemMessage,
    { role: 'system', content: `Previous conversation summary:\n\n${summary}` },
    ...recentMessages,
  ];

  const oldTokens = estimateConversationTokens(messages);
  const newTokens = estimateConversationTokens(compacted);
  logger.info(`Compacted ${oldTokens} → ${newTokens} tokens (${((1 - newTokens / oldTokens) * 100).toFixed(0)}% reduction)`);

  return compacted;
}
```

## Step 4: Update `src/providers.ts`

Add pricing information to the provider catalog so the cost tracker can calculate costs.

```typescript
// Add to each model definition in BUILTIN_PROVIDERS:
// contextWindow, inputPricePerMillion, outputPricePerMillion

// Then add this helper function:
export function getModelPricing(providerId: string, modelId: string) {
  const provider = getProvider(providerId);
  if (!provider) return null;
  const model = provider.models.find(m => m.id === modelId);
  if (!model) return null;
  return {
    inputPerToken: (model.inputPricePerMillion ?? 0) / 1_000_000,
    outputPerToken: (model.outputPricePerMillion ?? 0) / 1_000_000,
    contextWindow: model.contextWindow ?? 128_000,
  };
}
```

## Step 5: Update `src/agentic-loop.ts`

The agentic loop now checks context utilization before each API call and compacts if needed. It also emits `usage` events after each iteration.

Key changes to your existing loop:

1. Accept a `pricing` option and `abortSignal`
2. Before each API call, check context and compact if needed
3. After each API response, emit a `usage` event with token counts and cost
4. Add an `iteration_done` event between loop iterations

Add to the `AgentEvent` type:

```typescript
export type AgentEvent =
  | { type: 'text_delta'; content?: string }
  | { type: 'tool_call'; toolCall?: { id: string; name: string; args: string } }
  | { type: 'tool_result'; toolCall?: { id: string; name: string; result: string } }
  | { type: 'usage'; usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } }
  | { type: 'error'; error?: string; transient?: boolean }
  | { type: 'iteration_done' }
  | { type: 'done' };
```

Add compaction check before the API call in the main loop:

```typescript
import { compactIfNeeded } from './utils/compactor.js';
import { estimateConversationTokens } from './utils/cost-tracker.js';

// Inside the loop, before calling client.chat.completions.create:
if (pricing) {
  const currentTokens = estimateConversationTokens(messages);
  messages = await compactIfNeeded(
    client, model, messages, pricing.contextWindow,
    currentTokens, requestDefaults, sessionId
  );
}
```

## Step 6: Update `src/App.tsx`

Add usage tracking state and a `UsageDisplay` component. Wire the `usage` event from the agentic loop.

Add to the event handler in `handleSubmit`:

```typescript
case 'usage':
  if (event.usage) {
    setLastUsage(event.usage);
    setTotalCost((prev) => prev + event.usage!.cost);
  }
  break;
case 'iteration_done':
  // Reset assistant message tracker between iterations
  break;
```

Add the `UsageDisplay` component:

```typescript
const UsageDisplay: React.FC<{
  usage: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } | null;
  totalCost: number;
}> = ({ usage, totalCost }) => {
  if (!usage && totalCost === 0) return null;

  return (
    <Box marginTop={1}>
      {usage && (
        <Text dimColor>
          tokens: {usage.inputTokens}↓ {usage.outputTokens}↑ | ctx: {usage.contextPercent.toFixed(0)}%
        </Text>
      )}
      {totalCost > 0 && (
        <Text dimColor> | cost: ${totalCost.toFixed(4)}</Text>
      )}
    </Box>
  );
};
```

Also update `src/cli.tsx` to accept `--log-level`:

```typescript
.option('--log-level <level>', 'Log level: error, warn, info, debug, trace')
```

And pass it to `<App logLevel={options.logLevel} />`.

## Verification

```bash
npm run dev
```

After a few exchanges, you should see token and cost information displayed at the bottom of the UI. For long sessions that approach the context window limit, compaction will automatically kick in.

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-8`.

## Core takeaway

Compaction is what keeps a long coding session usable instead of quietly degrading once the context window fills up. The cost tracker makes context pressure visible so you (and the agent) can make informed decisions.

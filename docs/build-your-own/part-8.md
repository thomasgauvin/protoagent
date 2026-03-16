# Part 8: Compaction & Cost Tracking

Once an agent runs longer sessions, context pressure becomes real. Every message, tool result, and file read adds tokens. This part adds token estimation, cost tracking, context-window utilization monitoring, and automatic compaction when the context gets too full.

## What you are building

Starting from Part 7, you add:

- `src/utils/cost-tracker.ts` — token estimation and cost calculation
- `src/utils/compactor.ts` — conversation compaction when context exceeds 90%
- Updated `src/agentic-loop.ts` — compaction check, usage emission, abort support
- Updated `src/App.tsx` — usage display, cost tracking, abort controller
- Updated `src/cli.tsx` — log level option

## Step 1: Create `src/utils/cost-tracker.ts`

Create the file:

```bash
touch src/utils/cost-tracker.ts
```

We're going to rely on simple token estimation (~4 characters per token) as a fallback for when we can't receive the usage from the API. The cost tracker also handles cached token pricing for providers that support prompt caching.

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
  cachedPerToken?: number;
  contextWindow: number;
}

// Rough token estimation: ~4 characters per token.
// Only used as a fallback when the model doesn't return actual token counts, so it's better to overestimate than underestimate to avoid surprises.
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
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): number {
  if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
    const uncachedTokens = inputTokens - cachedTokens;
    return (
      uncachedTokens * pricing.inputPerToken +
      cachedTokens * pricing.cachedPerToken +
      outputTokens * pricing.outputPerToken
    );
  }
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
export function createUsageInfo(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): UsageInfo {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: calculateCost(inputTokens, outputTokens, pricing, cachedTokens),
  };
}
```

## Step 2: Create `src/utils/compactor.ts`

Create the file:

```bash
touch src/utils/compactor.ts
```

When the conversation exceeds 90% of the context window, the compactor summarizes older messages using the LLM. The most recent messages are kept verbatim so the agent doesn't lose immediate context.

Compacting the conversation is quite simple. We take the full conversation, ask the LLM to summarize it, then build a new conversation with the original system prompt, the summarized conversation, and the recent messages.

```typescript
// src/utils/compactor.ts

import type OpenAI from 'openai';
import { estimateConversationTokens } from './cost-tracker.js';
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

  try {
    return await compactConversation(client, model, messages, requestDefaults, sessionId);
  } catch (err) {
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

  return compacted;
}
```

## Step 3: Update `src/agentic-loop.ts`

The agentic loop now checks context utilization before each API call and compacts if needed. It also emits `usage` events after each iteration.

Key changes to your existing loop:

1. Accept `pricing` and `requestDefaults` options, plus `abortSignal`
2. Before each API call, check context and compact if needed
3. After each API response, emit a `usage` event with token counts and cost
4. Track actual usage from the API response when available

Update the imports and options interface:

```typescript
// src/agentic-loop.ts
import type OpenAI from 'openai';
import { getAllTools, handleToolCall } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { compactIfNeeded } from './utils/compactor.js';
import { createUsageInfo, estimateConversationTokens, estimateTokens, getContextInfo, type ModelPricing } from './utils/cost-tracker.js';

// ─── Types ───
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
  transient?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

export interface AgenticLoopOptions {
  maxIterations?: number;
  abortSignal?: AbortSignal;
  sessionId?: string;
  pricing?: ModelPricing;
  requestDefaults?: Record<string, unknown>;
}
```

Update the `runAgenticLoop` function signature and initialization:

```typescript
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;
  const pricing = options.pricing;
  const requestDefaults = options.requestDefaults || {};

  const updatedMessages: Message[] = [...messages];
  let iterationCount = 0;

  while (iterationCount < maxIterations) {
    if (abortSignal?.aborted) {
      onEvent({ type: 'done' });
      return updatedMessages;
    }

    iterationCount++;

    // Check context utilization and compact if needed
    if (pricing) {
      const currentTokens = estimateConversationTokens(messages);
      messages = await compactIfNeeded(
        client, model, messages, pricing.contextWindow,
        currentTokens, requestDefaults, sessionId
      );
    }

    try {
      const allTools = getAllTools();

      const stream = await client.chat.completions.create({
        model,
        messages: updatedMessages,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
      }, {
        signal: abortSignal,
      });

      const assistantMessage: any = {
        role: 'assistant',
        content: '',
        tool_calls: [],
      };
      let streamedContent = '';
      let hasToolCalls = false;
      let actualUsage: OpenAI.CompletionUsage | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (chunk.usage) {
          actualUsage = chunk.usage;
        }

        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
        }

        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const idx = tc.index || 0;
            if (!assistantMessage.tool_calls[idx]) {
              assistantMessage.tool_calls[idx] = {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) assistantMessage.tool_calls[idx].id = tc.id;
            if (tc.function?.name) {
              assistantMessage.tool_calls[idx].function.name += tc.function.name;
            }
            if (tc.function?.arguments) {
              assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Emit usage event with token counts and cost
      {
        const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(updatedMessages);
        const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
        const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
        const cost = pricing
          ? createUsageInfo(inputTokens, outputTokens, pricing, cachedTokens).estimatedCost
          : 0;
        const contextPercent = pricing
          ? getContextInfo(updatedMessages, pricing).utilizationPercentage
          : 0;

        onEvent({
          type: 'usage',
          usage: { inputTokens, outputTokens, cost, contextPercent },
        });
      }

      // Handle tool calls (rest of your existing logic)...
      if (assistantMessage.tool_calls.length > 0) {
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        updatedMessages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          if (abortSignal?.aborted) {
            onEvent({ type: 'done' });
            return updatedMessages;
          }

          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' },
          });

          try {
            const args = JSON.parse(argsStr);
            const result = await handleToolCall(name, args, { sessionId });

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result },
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: ${errMsg}`,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg },
            });
          }
        }
        continue;
      }

      // Plain text response — done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
      }

      onEvent({ type: 'done' });
      return updatedMessages;

    } catch (apiError: any) {
      if (abortSignal?.aborted) {
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      const errMsg = apiError?.message || 'Unknown API error';

      if (apiError?.status === 429) {
        onEvent({ type: 'error', error: 'Rate limited. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      if (apiError?.status >= 500) {
        onEvent({ type: 'error', error: 'Server error. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      onEvent({ type: 'error', error: errMsg });
      onEvent({ type: 'done' });
      return updatedMessages;
    }
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}
```

## Step 4: Update `src/App.tsx`

Add usage tracking state, the `UsageDisplay` component, and wire up the `usage` event from the agentic loop. Also add the abort controller and pass pricing/request defaults to the loop.

Update imports:

```typescript
import { getAllProviders, getModelPricing, getProvider, getRequestDefaultParams } from './providers.js';
```

Add to `AppProps`:

```typescript
export interface AppProps {
  dangerouslySkipPermissions?: boolean;
  logLevel?: 'error' | 'warn' | 'info' | 'debug' | 'trace';
}
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

Update the `App` component signature and add state:

```typescript
export const App: React.FC<AppProps> = ({ dangerouslySkipPermissions = false, logLevel = 'info' }) => {
  // ... existing state ...

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);

  // Abort controller for cancelling the current completion
  const abortControllerRef = useRef<AbortController | null>(null);

  // ... rest of component
```

Update `handleSubmit` to use pricing, request defaults, and abort controller:

```typescript
const handleSubmit = useCallback(async (value: string) => {
  const trimmed = value.trim();
  if (!trimmed || loading || !clientRef.current || !config) return;

  setInputText('');
  setInputResetKey((prev) => prev + 1);
  setLoading(true);
  setError(null);

  const userMessage: Message = { role: 'user', content: trimmed };
  setCompletionMessages((prev) => [...prev, userMessage]);

  try {
    const pricing = getModelPricing(config.provider, config.model);
    const requestDefaults = getRequestDefaultParams(config.provider, config.model);

    // Create abort controller for this completion
    abortControllerRef.current = new AbortController();

    const updatedMessages = await runAgenticLoop(
      clientRef.current,
      config.model,
      [...completionMessages, userMessage],
      trimmed,
      (event: AgentEvent) => {
        switch (event.type) {
          case 'text_delta':
            setCompletionMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, content: (last.content || '') + (event.content || '') }];
              }
              return [...prev, { role: 'assistant', content: event.content || '' }];
            });
            break;
          case 'tool_call':
            if (event.toolCall) {
              setCompletionMessages((prev) => {
                const assistantMsg = {
                  role: 'assistant' as const,
                  content: '',
                  tool_calls: [{
                    id: event.toolCall!.id,
                    type: 'function' as const,
                    function: { name: event.toolCall!.name, arguments: event.toolCall!.args },
                  }],
                };
                return [...prev, assistantMsg as any];
              });
            }
            break;
          case 'tool_result':
            if (event.toolCall) {
              setCompletionMessages((prev) => [
                ...prev,
                {
                  role: 'tool',
                  tool_call_id: event.toolCall!.id,
                  content: event.toolCall!.result || '',
                } as any,
              ]);
            }
            break;
          case 'usage':
            if (event.usage) {
              setLastUsage(event.usage);
              setTotalCost((prev) => prev + event.usage!.cost);
            }
            break;
          case 'iteration_done':
            // Reset assistant message tracker between iterations
            break;
          case 'error':
            setError(event.error || 'Unknown error');
            break;
          case 'done':
            break;
        }
      },
      {
        pricing: pricing || undefined,
        abortSignal: abortControllerRef.current.signal,
        requestDefaults,
      }
    );

    setCompletionMessages(updatedMessages);
  } catch (err: any) {
    setError(`Error: ${err.message}`);
  } finally {
    setLoading(false);
  }
}, [loading, config, completionMessages]);
```

Add the usage display to the rendered output (before the input box):

```tsx
      {initialized && !!lastUsage && (
        <UsageDisplay usage={lastUsage} totalCost={totalCost} />
      )}

      {/* Input */}
      {initialized && !pendingApproval && (
        // ... existing input box
      )}
```

## Step 5: Update `src/cli.tsx`

Add the `--log-level` option:

```typescript
program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: error, warn, info, debug, trace')
  .action((options) => {
    render(<App dangerouslySkipPermissions={options.dangerouslySkipPermissions || false} logLevel={options.logLevel || 'info'} />);
  });
```

## Verification

```bash
npm run dev
```

After a few exchanges, you should see token and cost information displayed at the bottom of the UI. For long sessions that approach the context window limit, compaction will automatically kick in.

```
 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> hi
✅ Hello — I'm **ProtoAgent**. How can I help today?

- 🔎 *Options I can do right away:* list project files, open or search files, run
tests/build, edit code, or update the TODO.
- ❓ *Tell me what you want:* a short task (e.g., "fix bug X"), or describe a
feature to implement.
- ⚙️ If you want me to start, say which action and I’ll refresh the TODO list and
inspect the code before making changes.

tokens: 1057↓ 100↑ | ctx: 0% | cost: $0.0005
╭─────────────────────────────────────────────────────╮
│ > Type your message...                              │
╰─────────────────────────────────────────────────────╯
```

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-8`.

## Core takeaway

Compaction is what keeps a long coding session usable instead of quietly degrading once the context window fills up. The cost tracker makes context pressure visible so you (and the agent) can make informed decisions.

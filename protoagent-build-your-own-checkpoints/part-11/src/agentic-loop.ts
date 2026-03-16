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

/**
 * Initialize the conversation with a system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt }];
}
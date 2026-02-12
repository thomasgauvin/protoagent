/**
 * The agentic loop — the core of ProtoAgent.
 *
 * This module implements the standard tool-use loop:
 *
 *  1. Send the conversation to the LLM with tool definitions
 *  2. If the response contains tool_calls:
 *     a. Execute each tool
 *     b. Append the results to the conversation
 *     c. Go to step 1
 *  3. If the response is plain text:
 *     a. Return it to the caller (the UI renders it)
 *
 * The loop is a plain TypeScript module — not an Ink component.
 * The UI subscribes to events emitted by the loop and updates
 * React state accordingly. This keeps the core logic testable
 * and UI-independent.
 */

import type OpenAI from 'openai';
import { getAllTools, handleToolCall } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { subAgentTool, runSubAgent } from './sub-agent.js';
import {
  estimateTokens,
  estimateConversationTokens,
  createUsageInfo,
  getContextInfo,
  type ModelPricing,
} from './utils/cost-tracker.js';
import { compactIfNeeded } from './utils/compactor.js';
import { logger } from './utils/logger.js';

// ─── Types ───

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolCallEvent {
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
}

export type AgentEventHandler = (event: AgentEvent) => void;

// ─── Agentic Loop ───

export interface AgenticLoopOptions {
  maxIterations?: number;
  pricing?: ModelPricing;
}

/**
 * Process a single user input through the agentic loop.
 *
 * Takes the full conversation history (including system message),
 * appends the user message, runs the loop, and returns the updated
 * message history.
 *
 * The `onEvent` callback is called for each event (text deltas,
 * tool calls, usage info, etc.) so the UI can render progress.
 */
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const pricing = options.pricing;

  // Add user message
  const updatedMessages: Message[] = [
    ...messages,
    { role: 'user', content: userInput } as Message,
  ];

  let iterationCount = 0;

  while (iterationCount < maxIterations) {
    iterationCount++;

    // Check for compaction
    if (pricing) {
      const contextInfo = getContextInfo(updatedMessages, pricing);
      if (contextInfo.needsCompaction) {
        const compacted = await compactIfNeeded(
          client,
          model,
          updatedMessages,
          pricing.contextWindow,
          contextInfo.currentTokens
        );
        // Replace messages in-place
        updatedMessages.length = 0;
        updatedMessages.push(...compacted);
      }
    }

    try {
      // Build tools list: core tools + sub-agent tool + dynamic (MCP) tools
      const allTools = [...getAllTools(), subAgentTool];

      const stream = await client.chat.completions.create({
        model,
        messages: updatedMessages,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
      });

      // Accumulate the streamed response
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

        // Stream text content
        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
        }

        // Accumulate tool calls
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
            if (tc.function?.name) assistantMessage.tool_calls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
          }
        }
      }

      // Emit usage info
      if (pricing) {
        const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(updatedMessages);
        const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
        const usageInfo = createUsageInfo(inputTokens, outputTokens, pricing);
        const contextInfo = getContextInfo(updatedMessages, pricing);
        onEvent({
          type: 'usage',
          usage: {
            inputTokens,
            outputTokens,
            cost: usageInfo.estimatedCost,
            contextPercent: contextInfo.utilizationPercentage,
          },
        });
      }

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);

        updatedMessages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { name, args: argsStr, status: 'running' },
          });

          try {
            const args = JSON.parse(argsStr);
            let result: string;

            // Handle sub-agent tool specially
            if (name === 'sub_agent') {
              result = await runSubAgent(
                client,
                model,
                args.task,
                args.max_iterations,
                (msg) => onEvent({ type: 'text_delta', content: msg + '\n' })
              );
            } else {
              result = await handleToolCall(name, args);
            }

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);

            onEvent({
              type: 'tool_result',
              toolCall: { name, args: argsStr, status: 'done', result },
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
              toolCall: { name, args: argsStr, status: 'error', result: errMsg },
            });
          }
        }

        // Continue loop — let the LLM process tool results
        continue;
      }

      // Plain text response — we're done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
      }

      onEvent({ type: 'done' });
      return updatedMessages;

    } catch (apiError: any) {
      const errMsg = apiError?.message || 'Unknown API error';
      logger.error(`API error: ${errMsg}`);

      // Retry on 429 (rate limit) with backoff
      if (apiError?.status === 429) {
        const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
        const backoff = Math.min(retryAfter * 1000, 60_000);
        logger.info(`Rate limited, retrying in ${backoff / 1000}s...`);
        onEvent({ type: 'error', error: `Rate limited. Retrying in ${backoff / 1000}s...` });
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      // Retry on 5xx errors
      if (apiError?.status >= 500) {
        const backoff = Math.min(2 ** iterationCount * 1000, 30_000);
        logger.info(`Server error, retrying in ${backoff / 1000}s...`);
        onEvent({ type: 'error', error: `Server error. Retrying in ${backoff / 1000}s...` });
        await new Promise((r) => setTimeout(r, backoff));
        continue;
      }

      // Non-retryable error
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
 * Initialize the conversation with the system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt } as Message];
}

/**
 * Stream processing module for the agentic loop.
 *
 * Handles accumulation of streaming response chunks into a complete
 * assistant message, including content, tool calls, and usage data.
 */

import type OpenAI from 'openai';
import type { AgentEventHandler } from '../agentic-loop.js';
import { estimateTokens, estimateConversationTokens, createUsageInfo, getContextInfo, type ModelPricing } from '../utils/cost-tracker.js';
import { logger } from '../utils/logger.js';

/**
 * Accumulated result from processing a streaming response.
 */
export interface StreamResult {
  assistantMessage: {
    role: 'assistant';
    content: string;
    tool_calls: any[];
  };
  hasToolCalls: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cost: number;
    contextPercent: number;
  };
}

/**
 * Process a streaming API response, accumulating content and tool calls.
 *
 * Emits text_delta events for immediate UI display and usage info
 * when available. Returns the complete accumulated message.
 */
export async function processStream(
  stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
  messages: any[],
  model: string,
  pricing: ModelPricing | undefined,
  onEvent: AgentEventHandler
): Promise<StreamResult> {
  const assistantMessage = {
    role: 'assistant' as const,
    content: '',
    tool_calls: [] as any[],
  };

  let streamedContent = '';
  let hasToolCalls = false;
  let actualUsage: OpenAI.CompletionUsage | undefined;

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta;

    if (chunk.usage) {
      actualUsage = chunk.usage;
    }

    // Stream text content (and return to UI for immediate display via onEvent)
    if (delta?.content) {
      streamedContent += delta.content;
      assistantMessage.content = streamedContent;
      if (!hasToolCalls) {
        onEvent({ type: 'text_delta', content: delta.content });
      }
    }

    // Accumulate tool calls across stream chunks
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
        // Gemini 3+ models include an `extra_content` field on tool calls
        // containing a `thought_signature`. This MUST be preserved and sent
        // back in subsequent requests, otherwise Gemini returns a 400.
        // See: https://ai.google.dev/gemini-api/docs/openai
        // See also: https://gist.github.com/thomasgauvin/3cfe8e907c957fba4e132e6cf0f06292
        if ((tc as any).extra_content) {
          assistantMessage.tool_calls[idx].extra_content = (tc as any).extra_content;
        }
      }
    }
  }

  // Calculate usage metrics
  // Use actual API-reported tokens when available for accurate per-turn metrics
  const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(messages);
  const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
  const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
  const cost = pricing
    ? createUsageInfo(inputTokens, outputTokens, pricing, cachedTokens).estimatedCost
    : 0;
  // Context percent shows how full the context window is with THIS request only
  // (not cumulative across the whole session). Use the actual prompt tokens sent.
  const contextPercent = pricing && actualUsage?.prompt_tokens
    ? (actualUsage.prompt_tokens / pricing.contextWindow) * 100
    : pricing
      ? getContextInfo(messages, pricing).utilizationPercentage
      : 0;

  // Log API response with usage info at INFO level
  logger.info('Received API response', {
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    cost: cost > 0 ? `$${cost.toFixed(4)}` : 'N/A',
    contextPercent: contextPercent > 0 ? `${contextPercent.toFixed(1)}%` : 'N/A',
    hasToolCalls: assistantMessage.tool_calls.length > 0,
    contentLength: assistantMessage.content?.length || 0,
  });

  onEvent({
    type: 'usage',
    usage: { inputTokens, outputTokens, cost, contextPercent },
  });

  // Log the full assistant message for debugging
  logger.debug('Assistant response details', {
    contentLength: assistantMessage.content?.length || 0,
    contentPreview: assistantMessage.content?.slice(0, 200) || '(empty)',
    toolCallsCount: assistantMessage.tool_calls?.length || 0,
    toolCalls: assistantMessage.tool_calls?.map((tc: any) => ({
      id: tc.id,
      name: tc.function?.name,
      argsPreview: tc.function?.arguments?.slice(0, 100),
    })),
  });

  return {
    assistantMessage,
    hasToolCalls,
    usage: { inputTokens, outputTokens, cost, contextPercent },
  };
}

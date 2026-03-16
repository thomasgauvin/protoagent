/**
 * Token estimation and cost tracking.
 *
 * Uses a rough heuristic (~4 chars per token) for estimation.
 * Prefers actual usage data from the API when available.
 */

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

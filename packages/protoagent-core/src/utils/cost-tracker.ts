/**
 * Cost tracking utilities.
 */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  'gpt-4o': 128000,
  'gpt-4o-mini': 128000,
  'gpt-4-turbo': 128000,
  'claude-3-5-sonnet': 200000,
  'claude-3-opus': 200000,
};

export class CostTracker {
  estimateTokens(text: string): number {
    // Rough estimate: ~4 characters per token
    return Math.ceil(text.length / 4);
  }

  getContextPercent(messages: any[], model: string): number {
    const contextWindow = MODEL_CONTEXT_WINDOWS[model] || 128000;
    const totalText = messages
      .map((m) => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      .join('\n');
    const tokens = this.estimateTokens(totalText);
    return Math.min(100, Math.round((tokens / contextWindow) * 100));
  }
}

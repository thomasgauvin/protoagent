# Part 8: Compaction & Cost Tracking

Long conversations hit a wall — the context window. Every message, every tool call, every file read adds to the token count. Eventually you run out of space and the LLM starts dropping important context. This part handles that gracefully.

## What you'll build

- Token estimation (~4 chars per token) and cost calculation based on model pricing
- Context window utilisation tracking — how full is the context?
- Automatic conversation compaction when utilisation hits 90%
- A usage display in the Ink UI showing tokens and estimated cost

## Key concepts

- **Context windows** — they're finite, and in a coding agent session they fill up fast. A single large file read can eat thousands of tokens.
- **Summarisation** — when the context gets too full, we use the LLM itself to summarise the older conversation into a compact snapshot, then replace the old messages with the summary.
- **Cost awareness** — API calls cost money. Showing the running total helps you understand your spending and decide when to start a fresh session.

## The context window problem

A coding agent burns through tokens way faster than a normal chatbot conversation. Think about what happens when you ask the agent to refactor a module. It reads the file — maybe 200 lines, that's ~800 tokens. It reads a couple related files to understand imports — another 1500 tokens. Then it makes an edit, the tool result comes back, it reads the file again to verify. Each loop iteration adds more messages to the conversation, and none of them go away.

With a 128k context window, you'd think you have plenty of room. But the system prompt takes a chunk, tool definitions take a chunk, and then a productive 20-minute session with lots of file reads can easily push past 100k tokens. At that point the model starts silently dropping older messages, and suddenly it forgets what it was doing or makes edits that conflict with work it did five minutes ago.

The solution has two parts: track how full the context is, and compress the conversation when it gets too full. Both live in `src/utils/` — `cost-tracker.ts` handles the measurement side, `compactor.ts` handles the compression.

## Token estimation

We need to know how many tokens the conversation is using. The OpenAI API gives you actual token counts in the response, but you need an estimate *before* you send the request — that's the whole point, to check whether you're about to overflow.

The standard heuristic is roughly 4 characters per token for English text. It's not precise — code tends to tokenize differently than prose, and special characters can throw things off — but it's close enough. We don't need exact counts here. We need to know whether we're at 50% or 90% of the context window. A 10% margin of error doesn't change that decision.

```typescript
/** Rough token estimation: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
```

For a single message, there's a bit more to it. Each message has a small overhead — about 4 tokens for the role tag and message framing. And if the message contains tool calls, those add tokens for the function name, the arguments JSON, and about 10 tokens of structural overhead per call:

```typescript
export function estimateMessageTokens(
  msg: OpenAI.Chat.Completions.ChatCompletionMessageParam
): number {
  let tokens = 4; // per-message overhead
  if ('content' in msg && typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content);
  }
  if ('tool_calls' in msg && Array.isArray((msg as any).tool_calls)) {
    for (const tc of (msg as any).tool_calls) {
      tokens += estimateTokens(tc.function?.name || '')
        + estimateTokens(tc.function?.arguments || '')
        + 10;
    }
  }
  return tokens;
}
```

For the full conversation, sum up all the messages and add 10 tokens for the conversation-level overhead:

```typescript
export function estimateConversationTokens(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0) + 10;
}
```

You could use a proper tokenizer like `tiktoken` for exact counts. But it adds a dependency, it's slower, and the precision doesn't matter for our use case. The 4-chars heuristic has been good enough for years.

## Cost calculation

Cost tracking is straightforward multiplication. Each model has a per-token price for input and output — you multiply, you add, you're done.

The `ModelPricing` interface carries the rates:

```typescript
export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  contextWindow: number;
}
```

And `calculateCost` does the math:

```typescript
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): number {
  return inputTokens * pricing.inputPerToken
    + outputTokens * pricing.outputPerToken;
}
```

The `createUsageInfo` helper bundles everything into a single object — input tokens, output tokens, total, and estimated cost:

```typescript
export function createUsageInfo(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing
): UsageInfo {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: calculateCost(inputTokens, outputTokens, pricing),
  };
}
```

Nothing clever here. The value isn't in the code — it's in surfacing the information. Most people have no intuition for how much an agent session costs until they see the number ticking up in real time. That visibility changes how you use the tool.

## Context tracking

Now the interesting part. `getContextInfo` takes the current conversation and tells you how full the context window is:

```typescript
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
```

The key output is `needsCompaction`. When utilisation hits 90%, this flag flips to `true`. Why 90% and not, say, 95%? Two reasons. First, our token estimates are approximate — if we wait until we think we're at 95%, we might actually be at 100%. Second, compaction itself takes tokens. We need headroom to send the compression request and receive the summary back.

The `ContextInfo` interface gives the caller everything it needs to make decisions or display status:

```typescript
export interface ContextInfo {
  currentTokens: number;
  maxTokens: number;
  utilizationPercentage: number;
  needsCompaction: boolean;
}
```

This is the "measurement" side. Now for the action side.

## The compaction strategy

When the context gets too full, we need to shrink the conversation without losing important information. The approach: use the LLM itself to summarise the older parts of the conversation, then replace those messages with the summary.

The key insight is that you don't compress everything. You keep the system message (the agent needs its identity and instructions), you keep the most recent messages (the agent needs immediate context for what it's doing right now), and you compress everything in between.

`compactConversation` in `src/utils/compactor.ts` implements this:

```typescript
const RECENT_MESSAGES_TO_KEEP = 5;

async function compactConversation(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  // Separate system message, history to compress, and recent messages
  const systemMessage = messages[0];
  const recentMessages = messages.slice(-RECENT_MESSAGES_TO_KEEP);
  const historyToCompress = messages.slice(1, messages.length - RECENT_MESSAGES_TO_KEEP);

  if (historyToCompress.length === 0) {
    logger.debug('Nothing to compact — conversation too short');
    return messages;
  }
```

Three slices of the conversation:

1. **System message** (`messages[0]`) — never compressed, always preserved exactly as-is.
2. **History to compress** (everything between the system message and the last 5 messages) — this is the bulk of the conversation, and it's what gets summarised.
3. **Recent messages** (the last 5) — kept verbatim. These contain the immediate context the agent needs — what it just did, what it's about to do, any tool results it hasn't processed yet.

Why 5 recent messages? It's a balance. Too few and the agent loses track of what it was just doing. Too many and compaction doesn't free up enough space. Five messages typically covers the most recent tool call cycle — the assistant's response with tool calls, the tool results, and maybe a user message.

The compression itself is just another LLM call:

```typescript
  const compressionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPRESSION_PROMPT },
    {
      role: 'user',
      content: `Here is the conversation history to compress:\n\n${historyToCompress
        .map((m) => `[${(m as any).role}]: ${(m as any).content || JSON.stringify((m as any).tool_calls || '')}`)
        .join('\n\n')}`,
    },
  ];

  const response = await client.chat.completions.create({
    model,
    messages: compressionMessages,
    max_tokens: 2000,
    temperature: 0.1,
  });
```

Two settings matter here. `max_tokens: 2000` caps the summary length — the whole point is to produce something shorter than the input. `temperature: 0.1` keeps the summary factual and deterministic. You don't want creative embellishment in your conversation summary — you want an accurate record.

After getting the summary, we reconstruct the conversation:

```typescript
  const compacted: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    systemMessage,
    { role: 'system', content: `Previous conversation summary:\n\n${summary}` },
    ...recentMessages,
  ];

  const oldTokens = estimateConversationTokens(messages);
  const newTokens = estimateConversationTokens(compacted);
  logger.info(
    `Compacted ${oldTokens} → ${newTokens} tokens (${((1 - newTokens / oldTokens) * 100).toFixed(0)}% reduction)`
  );

  return compacted;
}
```

The summary gets injected as a second system message — `"Previous conversation summary: ..."`. This way the model sees its original identity and instructions, then a compact record of everything that happened before, then the most recent messages. From the model's perspective, it has full continuity.

The logging at the end is useful for debugging and for understanding how effective compaction is in practice. A typical compaction might take a 90k-token conversation down to 20k tokens — an 80% reduction — while preserving all the key information.

## The compression prompt

The compression prompt is the most important part of the whole system. It determines what information survives compaction and what gets lost. Here's what we ask for:

```typescript
const COMPRESSION_PROMPT = `You are a conversation state manager. Your job is to compress
a conversation history into a compact summary that preserves all important context.

Produce a structured summary in this format:

<state_snapshot>
<overall_goal>What the user is trying to accomplish</overall_goal>
<key_knowledge>Important facts, conventions, constraints discovered</key_knowledge>
<file_system_state>Files created, read, modified, or deleted (with paths)</file_system_state>
<recent_actions>Last significant actions and their outcomes</recent_actions>
<current_plan>Current step-by-step plan with status: [DONE], [IN PROGRESS], [TODO]</current_plan>
</state_snapshot>

Be thorough but concise. Do not lose any information that would be needed to continue
the conversation.`;
```

Each section targets a specific type of information that the agent needs to keep functioning:

**`overall_goal`** — the high-level objective. Without this, the agent loses its sense of direction after compaction. It might remember recent file edits but forget *why* it was making them. "Refactoring the auth module to use JWTs instead of session cookies" is the kind of context that threads through an entire session.

**`key_knowledge`** — facts and constraints discovered during the conversation. Maybe the user said "we use tabs, not spaces" or "don't modify files in `src/legacy/`." Maybe the agent discovered that the project uses a specific testing framework or that a certain dependency is pinned to an old version. This is the institutional knowledge of the session.

**`file_system_state`** — what files have been touched and how. This is critical for a coding agent. If the agent created a new file three compactions ago, it needs to know that file exists. If it modified `src/config.ts` to add a new export, that fact needs to persist. Without this section, the agent starts treating previously-modified files as if they're in their original state.

**`recent_actions`** — what happened recently and whether it worked. Did the last test run pass? Did a build fail? Was there a type error that needs fixing? This bridges the gap between the compressed history and the verbatim recent messages.

**`current_plan`** — the step-by-step plan with completion status. If the agent was working through a five-step refactoring and had completed three steps, the summary needs to capture that. The `[DONE]`, `[IN PROGRESS]`, `[TODO]` markers make it unambiguous.

The structured XML-ish format isn't arbitrary. It gives the LLM clear slots to fill, which produces more consistent and complete summaries than a freeform "summarise this conversation" prompt would. And the `"Be thorough but concise"` instruction pushes toward information density — capture everything important, but don't pad it.

## Hooking it into the loop

The compactor and cost tracker connect to the agentic loop at two points: before each LLM call (check for compaction) and after each LLM call (emit usage).

Before sending messages to the LLM, we check if the context is getting full:

```typescript
// In runAgenticLoop, at the top of the while loop:

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
```

This runs at the top of every loop iteration — before the LLM call, before tool execution, before anything else. If the context is under 90%, it's a no-op. If it's over, `compactIfNeeded` compresses the history and the loop continues with the smaller message array.

The `compactIfNeeded` wrapper adds error handling. If compaction fails for any reason — network error, the model returns garbage, whatever — it falls back to the original messages rather than crashing:

```typescript
export async function compactIfNeeded(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  contextWindow: number,
  currentTokens: number
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const utilisation = (currentTokens / contextWindow) * 100;
  if (utilisation < 90) return messages;

  logger.info(`Compacting conversation (${utilisation.toFixed(1)}% of context window used)`);

  try {
    return await compactConversation(client, model, messages);
  } catch (err) {
    logger.error(`Compaction failed, continuing with original messages: ${err}`);
    return messages;
  }
}
```

The double-check on utilisation (once in the loop, once in `compactIfNeeded`) is intentional. `compactIfNeeded` is a public function — other code might call it directly without checking first.

After the LLM responds, we emit a usage event so the UI can display token counts and cost:

```typescript
// After streaming the response:

if (pricing) {
  const inputTokens = actualUsage?.prompt_tokens
    ?? estimateConversationTokens(updatedMessages);
  const outputTokens = actualUsage?.completion_tokens
    ?? estimateTokens(assistantMessage.content || '');
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
```

Notice the fallback pattern: if the API returned actual usage data (`actualUsage` from `stream_options: { include_usage: true }`), we use that. If not — maybe the provider doesn't support it — we fall back to our estimates. Either way, the UI gets a number to display and the user gets visibility into their spending.

The `contextPercent` field is especially useful. A simple progress bar or percentage in the UI gives the user a heads-up that compaction is coming, and after compaction they can see the utilisation drop back down. It makes an invisible process visible.

---

That's the full picture. The cost tracker measures, the compactor compresses, and the loop ties them together. It's not a perfect system — the token estimates are approximate, the compaction loses some nuance, and the compression itself costs tokens. But it's the difference between an agent that silently degrades after 15 minutes and one that can run for an hour while keeping you informed about what it's costing.

---

**Next up:** [Part 9: Skills & Sessions](./part-9.md) — customising agent behaviour with markdown skill files, and persisting conversations so you can pick up where you left off.

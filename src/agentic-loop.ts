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
import { subAgentTool, runSubAgent, type SubAgentProgressHandler } from './sub-agent.js';
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

// ─── Agentic Loop ───

export interface AgenticLoopOptions {
  maxIterations?: number;
  pricing?: ModelPricing;
  abortSignal?: AbortSignal;
  sessionId?: string;
  requestDefaults?: Record<string, unknown>;
}

function emitAbortAndFinish(onEvent: AgentEventHandler): void {
  onEvent({ type: 'done' });
}

async function sleepWithAbort(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
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

function appendStreamingFragment(current: string, fragment: string): string {
  if (!fragment) return current;
  if (!current) return fragment;
  if (current === fragment) return current;
  if (fragment.startsWith(current)) return fragment;

  const maxOverlap = Math.min(current.length, fragment.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (current.endsWith(fragment.slice(0, overlap))) {
      return current + fragment.slice(overlap);
    }
  }

  return current + fragment;
}

function collapseRepeatedString(value: string): string {
  if (!value) return value;

  for (let size = 1; size <= Math.floor(value.length / 2); size++) {
    if (value.length % size !== 0) continue;
    const candidate = value.slice(0, size);
    if (candidate.repeat(value.length / size) === value) {
      return candidate;
    }
  }

  return value;
}

function normalizeToolName(name: string, validToolNames: Set<string>): string {
  if (!name) return name;
  if (validToolNames.has(name)) return name;

  const collapsed = collapseRepeatedString(name);
  if (validToolNames.has(collapsed)) {
    return collapsed;
  }

  return name;
}

function extractFirstCompleteJsonValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const opening = trimmed[0];
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : null;
  if (!closing) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) depth++;
    if (char === closing) depth--;

    if (depth === 0) {
      return trimmed.slice(0, i + 1);
    }
  }

  return null;
}

function normalizeJsonArguments(argumentsText: string): string {
  const trimmed = argumentsText.trim();
  if (!trimmed) return argumentsText;

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Fall through to repair heuristics.
  }

  const collapsed = collapseRepeatedString(trimmed);
  if (collapsed !== trimmed) {
    try {
      JSON.parse(collapsed);
      return collapsed;
    } catch {
      // Fall through to next heuristic.
    }
  }

  const firstJsonValue = extractFirstCompleteJsonValue(trimmed);
  if (firstJsonValue) {
    try {
      JSON.parse(firstJsonValue);
      return firstJsonValue;
    } catch {
      // Give up and return the original text below.
    }
  }

  return argumentsText;
}

function sanitizeToolCall(
  toolCall: any,
  validToolNames: Set<string>
): { toolCall: any; changed: boolean } {
  const originalName = toolCall.function?.name || '';
  const originalArgs = toolCall.function?.arguments || '';
  const normalizedName = normalizeToolName(originalName, validToolNames);
  const normalizedArgs = normalizeJsonArguments(originalArgs);
  const changed = normalizedName !== originalName || normalizedArgs !== originalArgs;

  if (!changed) {
    return { toolCall, changed: false };
  }

  return {
    changed: true,
    toolCall: {
      ...toolCall,
      function: {
        ...toolCall.function,
        name: normalizedName,
        arguments: normalizedArgs,
      },
    },
  };
}

function sanitizeMessagesForRetry(
  messages: Message[],
  validToolNames: Set<string>
): { messages: Message[]; changed: boolean } {
  let changed = false;

  const sanitizedMessages = messages.map((message) => {
    const msgAny = message as any;
    if (message.role !== 'assistant' || !Array.isArray(msgAny.tool_calls) || msgAny.tool_calls.length === 0) {
      return message;
    }

    const nextToolCalls = msgAny.tool_calls.map((toolCall: any) => {
      const sanitized = sanitizeToolCall(toolCall, validToolNames);
      changed = changed || sanitized.changed;
      return sanitized.toolCall;
    });

    return {
      ...msgAny,
      tool_calls: nextToolCalls,
    } as Message;
  });

  return { messages: sanitizedMessages, changed };
}

function getValidToolNames(): Set<string> {
  return new Set(
    [...getAllTools(), subAgentTool]
      .map((tool: any) => tool.function?.name)
      .filter((name: string | undefined): name is string => Boolean(name))
  );
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
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;
  const requestDefaults = options.requestDefaults || {};

  // Note: userInput is passed for context/logging but user message should already be in messages array
  // (added by the caller in handleSubmit for immediate UI display)
  const updatedMessages: Message[] = [...messages];

  // Refresh system prompt to pick up any new skills or project changes
  const newSystemPrompt = await generateSystemPrompt();
  const systemMsgIndex = updatedMessages.findIndex((m) => m.role === 'system');
  if (systemMsgIndex !== -1) {
    updatedMessages[systemMsgIndex] = { role: 'system', content: newSystemPrompt } as Message;
  }

  let iterationCount = 0;
  let repairRetryCount = 0;
  const validToolNames = getValidToolNames();

  while (iterationCount < maxIterations) {
    // Check if abort was requested
    if (abortSignal?.aborted) {
      logger.debug('Agentic loop aborted by user');
      emitAbortAndFinish(onEvent);
      return updatedMessages;
    }

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
          contextInfo.currentTokens,
          requestDefaults,
          sessionId
        );
        // Replace messages in-place
        updatedMessages.length = 0;
        updatedMessages.push(...compacted);
      }
    }

    try {
      // Build tools list: core tools + sub-agent tool + dynamic (MCP) tools
      const allTools = [...getAllTools(), subAgentTool];

      logger.debug('Making API request', {
        model,
        toolsCount: allTools.length,
        messagesCount: updatedMessages.length,
        toolNames: allTools.map((t: any) => t.function?.name).join(', '),
      });

      // Log message structure for debugging provider compatibility
      for (const msg of updatedMessages) {
        const m = msg as any;
        if (m.role === 'tool') {
          logger.trace('Message payload', {
            role: m.role,
            tool_call_id: m.tool_call_id,
            contentLength: m.content?.length,
            contentPreview: m.content?.slice(0, 100),
          });
        } else if (m.role === 'assistant' && m.tool_calls?.length) {
          logger.trace('Message payload', {
            role: m.role,
            toolCalls: m.tool_calls.map((tc: any) => ({
              id: tc.id,
              name: tc.function?.name,
              argsLength: tc.function?.arguments?.length,
            })),
          });
        } else {
          logger.trace('Message payload', {
            role: m.role,
            contentLength: m.content?.length,
          });
        }
      }

        const stream = await client.chat.completions.create({
         ...requestDefaults,
         model,
         messages: updatedMessages,
         tools: allTools,
         tool_choice: 'auto',
         stream: true,
         stream_options: { include_usage: true },
       }, {
        signal: abortSignal,
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
            if (tc.function?.name) {
              assistantMessage.tool_calls[idx].function.name = appendStreamingFragment(
                assistantMessage.tool_calls[idx].function.name,
                tc.function.name
              );
            }
            if (tc.function?.arguments) {
              assistantMessage.tool_calls[idx].function.arguments = appendStreamingFragment(
                assistantMessage.tool_calls[idx].function.arguments,
                tc.function.arguments
              );
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

      // Emit usage info — always emit, even without pricing (use estimates)
      {
        const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(updatedMessages);
        const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
        const cost = pricing
          ? createUsageInfo(inputTokens, outputTokens, pricing).estimatedCost
          : 0;
        const contextPercent = pricing
          ? getContextInfo(updatedMessages, pricing).utilizationPercentage
          : 0;
        onEvent({
          type: 'usage',
          usage: { inputTokens, outputTokens, cost, contextPercent },
        });
      }

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        assistantMessage.tool_calls = assistantMessage.tool_calls.map((toolCall: any) => {
          const sanitized = sanitizeToolCall(toolCall, validToolNames);
          if (sanitized.changed) {
            logger.warn('Sanitized streamed tool call', {
              originalName: toolCall.function?.name,
              sanitizedName: sanitized.toolCall.function?.name,
            });
          }
          return sanitized.toolCall;
        });

        logger.debug('Model returned tool calls', {
          count: assistantMessage.tool_calls.length,
          calls: assistantMessage.tool_calls.map((tc: any) => ({
            id: tc.id,
            name: tc.function?.name,
            argsPreview: tc.function?.arguments?.slice(0, 100),
          })),
        });

        updatedMessages.push(assistantMessage);

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            logger.debug('Agentic loop aborted between tool calls');
            emitAbortAndFinish(onEvent);
            return updatedMessages;
          }

          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' },
          });

          try {
            const args = JSON.parse(argsStr);
            let result: string;

            // Handle sub-agent tool specially
            if (name === 'sub_agent') {
              const subProgress: SubAgentProgressHandler = (evt) => {
                onEvent({
                  type: 'tool_call',
                  toolCall: {
                    id: toolCall.id,
                    name: `sub_agent → ${evt.tool}`,
                    args: '',
                    status: evt.status === 'running' ? 'running' : 'done',
                  },
                });
              };
              result = await runSubAgent(
                client,
                model,
                args.task,
                args.max_iterations,
                requestDefaults,
                subProgress,
              );
            } else {
              result = await handleToolCall(name, args, { sessionId, abortSignal });
            }

            logger.debug('Tool result', {
              tool: name,
              tool_call_id: toolCall.id,
              resultLength: result.length,
              resultPreview: result.slice(0, 200),
            });

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

        // Signal UI that this iteration's tool calls are all done,
        // so it can flush completed messages to static output.
        onEvent({ type: 'iteration_done' });

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

      repairRetryCount = 0;
      onEvent({ type: 'done' });
      return updatedMessages;

      } catch (apiError: any) {
      if (abortSignal?.aborted || apiError?.name === 'AbortError' || apiError?.message === 'Operation aborted') {
        logger.debug('Agentic loop request aborted');
        emitAbortAndFinish(onEvent);
        return updatedMessages;
      }

      const errMsg = apiError?.message || 'Unknown API error';

      // Try to extract response body for more details
      let responseBody: string | undefined;
      try {
        if (apiError?.response) {
          responseBody = JSON.stringify(apiError.response);
        } else if (apiError?.error) {
          responseBody = JSON.stringify(apiError.error);
        }
      } catch { /* ignore */ }

      logger.error(`API error: ${errMsg}`, {
        status: apiError?.status,
        code: apiError?.code,
        responseBody,
        headers: apiError?.headers ? Object.fromEntries(
          Object.entries(apiError.headers).filter(([k]) =>
            ['content-type', 'x-error', 'retry-after'].includes(k.toLowerCase())
          )
        ) : undefined,
      });

      // Log the last few messages to help debug format issues
      logger.debug('Messages at time of error', {
        lastMessages: updatedMessages.slice(-3).map((m: any) => ({
          role: m.role,
          hasToolCalls: !!(m.tool_calls?.length),
          tool_call_id: m.tool_call_id,
          contentPreview: m.content?.slice(0, 150),
        })),
      });

      const retryableStatus = apiError?.status === 408 || apiError?.status === 409 || apiError?.status === 425;
      const retryableCode = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(apiError?.code);

      if (apiError?.status === 400 && repairRetryCount < 2) {
        const sanitized = sanitizeMessagesForRetry(updatedMessages, getValidToolNames());
        if (sanitized.changed) {
          repairRetryCount++;
          updatedMessages.length = 0;
          updatedMessages.push(...sanitized.messages);
          logger.warn('400 response after malformed tool payload; retrying with sanitized messages', {
            repairRetryCount,
          });
          onEvent({
            type: 'error',
            error: 'Provider rejected the tool payload. Repairing the request and retrying...',
            transient: true,
          });
          continue;
        }
      }

      // Retry on 429 (rate limit) with backoff
      if (apiError?.status === 429) {
        const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
        const backoff = Math.min(retryAfter * 1000, 60_000);
        logger.info(`Rate limited, retrying in ${backoff / 1000}s...`);
        onEvent({ type: 'error', error: `Rate limited. Retrying in ${backoff / 1000}s...`, transient: true });
        await sleepWithAbort(backoff, abortSignal);
        continue;
      }

      // Retry on transient request failures
      if (apiError?.status >= 500 || retryableStatus || retryableCode) {
        const backoff = Math.min(2 ** iterationCount * 1000, 30_000);
        logger.info(`Request failed, retrying in ${backoff / 1000}s...`);
        onEvent({ type: 'error', error: `Request failed. Retrying in ${backoff / 1000}s...`, transient: true });
        await sleepWithAbort(backoff, abortSignal);
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

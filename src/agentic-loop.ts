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
import { setMaxListeners } from 'node:events';
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
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done' | 'sub_agent_iteration';
  content?: string;
  toolCall?: ToolCallEvent;
  /** Emitted while a sub-agent is executing — carries the child tool name and iteration status.
   *  Distinct from `tool_call` so the UI can show it as a nested progress indicator
   *  without adding it to the parent's tool-call message history. */
  subAgentTool?: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> };
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  /** Emitted when a sub-agent completes, carrying its accumulated usage. */
  subAgentUsage?: { inputTokens: number; outputTokens: number; cost: number };
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

/** @internal exported for unit testing only */
export function appendStreamingFragment(current: string, fragment: string): string {
  if (!fragment) return current;
  if (!current) return fragment;
  // Some providers resend the full accumulated value instead of a delta.
  // These two guards handle that case without corrupting normal incremental deltas.
  if (current === fragment) return current;
  if (fragment.startsWith(current)) return fragment;

  // Normal case: incremental delta, just append.
  // The previous partial-overlap loop was removed because it caused false-positive
  // deduplication: short JSON tokens (e.g. `", "`) would coincidentally match the
  // tail of `current`, silently stripping characters from valid argument payloads.
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

/**
 * Repair invalid JSON escape sequences in a string value.
 *
 * JSON only allows: \" \\ \/ \b \f \n \r \t \uXXXX
 * Models sometimes emit \| \! \- etc. (e.g. grep regex args) which make
 * JSON.parse throw, and Anthropic strict-validates tool_call arguments on
 * every subsequent request, bricking the session permanently.
 *
 * We double the backslash for any \X where X is not a valid JSON escape char.
 */
function repairInvalidEscapes(value: string): string {
  // Match a backslash followed by any character that is NOT a valid JSON escape
  // Valid escapes: " \ / b f n r t u
  return value.replace(/\\([^"\\\/bfnrtu])/g, '\\\\$1');
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

  // Heuristic: repair invalid escape sequences (e.g. \| from grep regex args)
  const repaired = repairInvalidEscapes(trimmed);
  if (repaired !== trimmed) {
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // Try repair + first-value extraction together
      const repairedFirst = extractFirstCompleteJsonValue(repaired);
      if (repairedFirst) {
        try {
          JSON.parse(repairedFirst);
          return repairedFirst;
        } catch { /* give up */ }
      }
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

  // The same AbortSignal is passed into every OpenAI SDK call and every
  // sleepWithAbort() across all loop iterations and sub-agent calls.
  // The SDK attaches an 'abort' listener per request, so on a long run
  // the default limit of 10 listeners is quickly exceeded, producing the
  // MaxListenersExceededWarning.  AbortSignal is a Web API EventTarget,
  // not a Node EventEmitter, so the instance method .setMaxListeners()
  // doesn't exist on it — use the standalone setMaxListeners() from
  // node:events instead, which handles both EventEmitter and EventTarget.
  if (abortSignal) {
    setMaxListeners(0, abortSignal); // 0 = unlimited, scoped to this signal only
  }

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
  let contextRetryCount = 0;
  let retriggerCount = 0;
  let truncateRetryCount = 0;
  let continueRetryCount = 0;
  const MAX_RETRIGGERS = 3;
  const MAX_TRUNCATE_RETRIES = 5;
  const MAX_CONTINUE_RETRIES = 1;
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

    // Declare assistantMessage outside try block so it's accessible in catch
    let assistantMessage: any;

    try {
      // Build tools list: core tools + sub-agent tool + dynamic (MCP) tools
      const allTools = [...getAllTools(), subAgentTool];

      logger.info('Making API request', {
        model,
        toolsCount: allTools.length,
        messagesCount: updatedMessages.length,
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
      assistantMessage = {
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

      // Log API response with usage info at INFO level
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
      }

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

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Reset retrigger count on valid tool call response
        retriggerCount = 0;
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

        // Validate that all tool calls have valid JSON arguments
        const invalidToolCalls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return false; // Empty args is valid
          try {
            JSON.parse(args);
            return false; // Valid JSON
          } catch {
            return true; // Invalid JSON
          }
        });

        if (invalidToolCalls.length > 0) {
          logger.warn('Assistant produced tool calls with invalid JSON, skipping this turn', {
            invalidToolCalls: invalidToolCalls.map((tc: any) => ({
              name: tc.function?.name,
              argsPreview: tc.function?.arguments?.slice(0, 100),
            })),
          });
          // Don't add the malformed assistant message to conversation
          // The loop will continue and retry
          continue;
        }

        logger.info('Model returned tool calls', {
          count: assistantMessage.tool_calls.length,
          tools: assistantMessage.tool_calls.map((tc: any) => tc.function?.name).join(', '),
        });

        updatedMessages.push(assistantMessage);

        // Track which tool_call_ids still need a tool result message.
        // This set is used to inject stub responses on abort, preventing
        // orphaned tool_call_ids from permanently bricking the session.
        const pendingToolCallIds = new Set<string>(
          assistantMessage.tool_calls.map((tc: any) => tc.id as string)
        );

        const injectStubsForPendingToolCalls = () => {
          for (const id of pendingToolCallIds) {
            updatedMessages.push({
              role: 'tool',
              tool_call_id: id,
              content: 'Aborted by user.',
            } as any);
          }
        };

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            logger.debug('Agentic loop aborted between tool calls');
            injectStubsForPendingToolCalls();
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
                  type: 'sub_agent_iteration',
                  subAgentTool: { tool: evt.tool, status: evt.status, iteration: evt.iteration, args: evt.args },
                });
              };
              const subResult = await runSubAgent(
                client,
                model,
                args.task,
                args.max_iterations,
                requestDefaults,
                subProgress,
                abortSignal,
                pricing,
              );
              result = subResult.response;
              // Emit sub-agent usage for the UI to add to total cost
              if (subResult.usage.inputTokens > 0 || subResult.usage.outputTokens > 0) {
                onEvent({
                  type: 'sub_agent_iteration',
                  subAgentUsage: subResult.usage,
                });
              }
            } else {
              result = await handleToolCall(name, args, { sessionId, abortSignal });
            }

            logger.info('Tool completed', {
              tool: name,
              resultLength: result.length,
            });

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
            pendingToolCallIds.delete(toolCall.id);

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
            pendingToolCallIds.delete(toolCall.id);

            // If the tool was aborted, inject stubs for remaining pending calls and stop
            if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
              logger.debug('Agentic loop aborted during tool execution');
              injectStubsForPendingToolCalls();
              emitAbortAndFinish(onEvent);
              return updatedMessages;
            }

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
        // Reset retrigger count on valid content response
        retriggerCount = 0;
      }

      // Check if we need to retrigger: if the last message is a tool result
      // but we got no assistant response (empty content, no tool_calls), the AI
      // may have stopped prematurely. Inject a 'continue' prompt and retry.
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      if (lastMessage?.role === 'tool' && retriggerCount < MAX_RETRIGGERS) {
        retriggerCount++;
        logger.warn('AI stopped after tool call without responding; retriggering', {
          retriggerCount,
          maxRetriggers: MAX_RETRIGGERS,
          lastMessageRole: lastMessage.role,
          assistantContent: assistantMessage.content || '(empty)',
          hasToolCalls: assistantMessage.tool_calls.length > 0,
        });
        // Inject a 'continue' prompt to help the AI continue
        updatedMessages.push({
          role: 'user',
          content: 'Please continue.',
        } as Message);
        continue;
      }

      repairRetryCount = 0;
      retriggerCount = 0;
      onEvent({ type: 'done' });
      return updatedMessages;

      } catch (apiError: any) {
      if (abortSignal?.aborted || apiError?.name === 'AbortError' || apiError?.message === 'Operation aborted') {
        logger.debug('Agentic loop request aborted');
        // If we have a partial assistant message with tool_calls, we need to
        // add it to the conversation history before returning, otherwise the
        // message sequence will be invalid (tool results without assistant tool_calls).
        if (assistantMessage && (assistantMessage.content || assistantMessage.tool_calls?.length > 0)) {
          // Clean up empty tool_calls entries
          if (assistantMessage.tool_calls?.length > 0) {
            assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
            // Filter out tool calls with malformed/incomplete JSON arguments
            assistantMessage.tool_calls = assistantMessage.tool_calls.filter((tc: any) => {
              const args = tc.function?.arguments;
              if (!args) return true; // No args is valid
              try {
                JSON.parse(args);
                return true; // Valid JSON
              } catch {
                logger.warn('Filtering out tool call with malformed JSON arguments due to abort', {
                  tool: tc.function?.name,
                  argsPreview: args.slice(0, 100),
                });
                return false; // Invalid JSON, filter out
              }
            });
          }
          // Only add the assistant message if we have content or valid tool calls
          if (assistantMessage.content || assistantMessage.tool_calls?.length > 0) {
            updatedMessages.push(assistantMessage);
          }
        }
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

      // Handle 400 errors: try sanitization first, then truncate messages
      if (apiError?.status === 400) {
        // Try sanitization first
        if (repairRetryCount < 2) {
          const sanitized = sanitizeMessagesForRetry(updatedMessages, getValidToolNames());
          if (sanitized.changed) {
            repairRetryCount++;
            updatedMessages.length = 0;
            updatedMessages.push(...sanitized.messages);
            logger.warn('400 response after malformed tool payload; retrying with sanitized messages', {
              repairRetryCount,
            });
            // Silently retry without showing error to user
            continue;
          }
        }

        // If sanitization didn't help, try removing messages one at a time (up to 5)
        if (truncateRetryCount < MAX_TRUNCATE_RETRIES) {
          truncateRetryCount++;
          const removedCount = Math.min(1, Math.max(0, updatedMessages.length - 2)); // Remove 1 at a time, keep system + at least 1 user
          if (removedCount > 0) {
            const removed = updatedMessages.splice(-removedCount);
            logger.debug('400 error: removing message from history to attempt fix', {
              truncateRetryCount,
              maxRetries: MAX_TRUNCATE_RETRIES,
              removedCount,
              removedRoles: removed.map((m: any) => m.role),
              removedPreviews: removed.map((m: any) => ({
                role: m.role,
                content: m.content?.slice(0, 100),
                tool_calls: m.tool_calls?.map((tc: any) => tc.function?.name),
              })),
            });
            // Silently retry without showing error to user
            continue;
          }
        }

        // After truncation retries exhausted, try adding a "continue" message
        if (continueRetryCount < MAX_CONTINUE_RETRIES) {
          continueRetryCount++;
          updatedMessages.push({ role: 'user', content: 'continue' } as Message);
          logger.warn('400 error: adding "continue" message to retry', {
            continueRetryCount,
            messageCount: updatedMessages.length,
          });
          onEvent({
            type: 'error',
            error: 'Request failed. Retrying with "continue"...',
            transient: true,
          });
          continue;
        }
      }

      // Handle context-window-exceeded (prompt too long) — attempt forced compaction
      // This fires when our token estimate was too low (e.g. base64 images from MCP tools)
      // and the request actually hit the hard provider limit.
      const isContextTooLong =
        apiError?.status === 400 &&
        typeof errMsg === 'string' &&
        /prompt.{0,30}too long|context.{0,30}length|maximum.{0,30}token|tokens?.{0,10}exceed/i.test(errMsg);

      if (isContextTooLong && contextRetryCount < 2) {
        contextRetryCount++;
        logger.warn(`Prompt too long (attempt ${contextRetryCount}); forcing compaction`, { errMsg });
        onEvent({
          type: 'error',
          error: 'Prompt too long. Compacting conversation and retrying...',
          transient: true,
        });

        if (pricing) {
          // Use the normal LLM-based compaction path
          try {
            const compacted = await compactIfNeeded(
              client, model, updatedMessages, pricing.contextWindow,
              // Pass the context window itself as currentTokens to force compaction
              pricing.contextWindow,
              requestDefaults, sessionId
            );
            updatedMessages.length = 0;
            updatedMessages.push(...compacted);
          } catch (compactErr) {
            logger.error(`Forced compaction failed: ${compactErr}`);
            // Fall through to truncation fallback below
          }
        }

        // Fallback: truncate any tool result messages whose content looks like
        // base64 or is extremely large (e.g. MCP screenshot data)
        const MAX_TOOL_RESULT_CHARS = 20_000;
        for (let i = 0; i < updatedMessages.length; i++) {
          const m = updatedMessages[i] as any;
          if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_RESULT_CHARS) {
            updatedMessages[i] = {
              ...m,
              content: m.content.slice(0, MAX_TOOL_RESULT_CHARS) + '\n... (truncated — content was too large)',
            };
          }
        }

        continue;
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

      // 400 error that couldn't be fixed by sanitization or truncation
      if (apiError?.status === 400) {
        onEvent({
          type: 'error',
          error: `Request failed: ${errMsg}\n\nThe conversation history could not be automatically repaired. Try /clear to start fresh.`,
          transient: false,
        });
        onEvent({ type: 'done' });
        return updatedMessages;
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

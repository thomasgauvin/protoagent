import type OpenAI from 'openai';
import { getAllTools, handleToolCall } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';

// ─── Types ───
export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

// Type for tool calls included in the model's response, which the agentic loop will execute
// Exported for use in the UI layer to display ongoing tool calls and their results
export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

// Type for events emitted during the agentic loop, such as text deltas, tool calls, and errors
// Exported for use in the UI layer to update the interface in real-time as the agent processes
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
}

// Run the agentic loop: send messages to the model, execute any tool calls,
// and continue until the model returns plain text.
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  // The onEvent callback allows the agentic loop to emit events that the UI can listen to for real-time updates (like streaming text or tool call status)
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;

  // The updatedMessages array will accumulate the conversation history, including tool call results, as we loop
  const updatedMessages: Message[] = [...messages];
  let iterationCount = 0;

  // The While loop is the core of the Agentic Loop.
  // We continue to request a new message from the LLM until it indicates it is 'done' with an empty message
  // Or, we continue until the user stops the agent
  // Or, we reach the max amount of iterations to avoid endless loops
  while (iterationCount < maxIterations) {
    // The abort signal allows the user to stop the agent from the UI
    if (abortSignal?.aborted) {
      onEvent({ type: 'done' });
      return updatedMessages;
    }

    iterationCount++;

    try {
      const allTools = getAllTools();

      // This is the API call to the LLM, passing the conversation history and available tools.
      // The model can respond with text, and/or indicate it wants to call a tool by including tool_calls in the response.
      const stream = await client.chat.completions.create({
        model,
        messages: updatedMessages,
        tools: allTools,
        tool_choice: 'auto',
        stream: true,
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

      // Iterate through all the chunks of the streamed LLM response
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        // Stream text content back to the UI
        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
        }

        // Accumulate tool calls by index
        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const idx = tc.index || 0;

            // Create a tool call entry at the correct index if it doesn't exist, then fill in details as they stream in
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

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Collapses "sparse" arrays by removing empty slots (undefined) or null values 
        // that can occur if streaming indexes arrive out of order or are skipped.
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
            // This is where the tool is actually executed. 
            // The handleToolCall function looks up the tool by name and runs it with the provided arguments.
            const args = JSON.parse(argsStr);
            const result = await handleToolCall(name, args, { sessionId });

            // We add the tool result back into the conversation history as a
            // new message with role 'tool' so that the LLM can see the result of its 
            // tool call in the next iteration.
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

        // Continue loop — let the model process tool results
        // This is the end of the if block for handling tool calls. 
        // After executing all tool calls and adding their results to the conversation history, 
        // we loop back and call the model again with the updated messages. 
        // The model can then respond with more text, more tool calls, or indicate it is done.
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

      // Retry on rate limit
      if (apiError?.status === 429) {
        onEvent({ type: 'error', error: 'Rate limited. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }

      // Retry on server errors
      if (apiError?.status >= 500) {
        onEvent({ type: 'error', error: 'Server error. Retrying...', transient: true });
        await new Promise((r) => setTimeout(r, 2000));
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
 * Initialize the conversation with a system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt }];
}
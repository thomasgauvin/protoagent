/**
 * Sub-agents — Spawn isolated child agent sessions.
 *
 * Sub-agents prevent context pollution by running tasks in a separate
 * message history. The parent agent delegates a task, the sub-agent
 * executes it with its own tool calls, and returns a summary.
 *
 * This is exposed as a `sub_agent` tool that the main agent can call.
 */

import type OpenAI from 'openai';
import crypto from 'node:crypto';
import { handleToolCall, getAllTools } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { logger } from './utils/logger.js';
import { clearTodos } from './tools/todo.js';

export const subAgentTool = {
  type: 'function' as const,
  function: {
    name: 'sub_agent',
    description:
      'Spawn an isolated sub-agent to handle a task without polluting the main conversation context. ' +
      'Use this for independent subtasks like exploring a codebase, researching a question, or making changes to a separate area. ' +
      'The sub-agent has access to the same tools but runs in its own conversation.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A detailed description of the task for the sub-agent to complete.',
        },
        max_iterations: {
          type: 'number',
          description: 'Maximum tool-call iterations for the sub-agent. Defaults to 30.',
        },
      },
      required: ['task'],
    },
  },
};

/**
 * Run a sub-agent with its own isolated conversation.
 * Returns the sub-agent's final text response.
 */
export async function runSubAgent(
  client: OpenAI,
  model: string,
  task: string,
  maxIterations = 30
): Promise<string> {
  const op = logger.startOperation('sub-agent');
  const subAgentSessionId = `sub-agent-${crypto.randomUUID()}`;

  const systemPrompt = await generateSystemPrompt();
  const subSystemPrompt = `${systemPrompt}

## Sub-Agent Mode

You are running as a sub-agent. You were given a specific task by the parent agent.
Complete the task thoroughly and return a clear, concise summary of what you did and found.
Do NOT ask the user questions — work autonomously with the tools available.`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: subSystemPrompt },
    { role: 'user', content: task },
  ];

  try {
    for (let i = 0; i < maxIterations; i++) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools: getAllTools(),
        tool_choice: 'auto',
      });

      const message = response.choices[0]?.message;
      if (!message) break;

      // Check for tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push(message as any);

        for (const toolCall of message.tool_calls) {
          const { name, arguments: argsStr } = (toolCall as any).function;
          logger.debug(`Sub-agent tool call: ${name}`);

          try {
            const args = JSON.parse(argsStr);
            const result = await handleToolCall(name, args, { sessionId: subAgentSessionId });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: ${msg}`,
            } as any);
          }
        }
        continue;
      }

      // Plain text response — we're done
      return message.content || '(sub-agent completed with no response)';
    }

    return '(sub-agent reached iteration limit)';
  } finally {
    op.end();
    clearTodos(subAgentSessionId);
  }
}

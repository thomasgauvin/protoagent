/**
 * Tool execution module for the agentic loop.
 *
 * Handles execution of tool calls including special handling for
 * sub-agents and proper abort signal management between tool calls.
 */

import type { AgentEventHandler, ToolCallEvent } from '../agentic-loop.js';
import { handleToolCall } from '../tools/index.js';
import { runSubAgent, type SubAgentProgressHandler, type SubAgentUsage } from '../sub-agent.js';
import { logger } from '../utils/logger.js';

/**
 * Context for tool execution, passed through from the main loop.
 */
export interface ToolExecutionContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
  requestDefaults: Record<string, unknown>;
  client: any;  // OpenAI client
  model: string;
  pricing?: any;  // ModelPricing
}

/**
 * Execute all tool calls from an assistant message.
 *
 * Handles:
 * - Abort checking between tool calls
 * - Sub-agent special case with progress reporting
 * - Error handling and result accumulation
 * - Pending tool call tracking for abort scenarios
 *
 * Returns true if execution completed normally, false if aborted.
 */
export async function executeToolCalls(
  toolCalls: any[],
  messages: any[],
  onEvent: AgentEventHandler,
  context: ToolExecutionContext
): Promise<{ completed: boolean; shouldAbort: boolean }> {
  const { sessionId, abortSignal, requestDefaults, client, model, pricing } = context;

  // Track which tool_call_ids still need a tool result message.
  // This set is used to inject stub responses on abort, preventing
  // orphaned tool_call_ids from permanently bricking the session.
  const pendingToolCallIds = new Set<string>(
    toolCalls.map((tc: any) => tc.id as string)
  );

  const injectStubsForPendingToolCalls = () => {
    for (const id of pendingToolCallIds) {
      messages.push({
        role: 'tool',
        tool_call_id: id,
        content: 'Aborted by user.',
      } as any);
    }
  };

  for (const toolCall of toolCalls) {
    // Check abort between tool calls
    if (abortSignal?.aborted) {
      logger.debug('Agentic loop aborted between tool calls');
      injectStubsForPendingToolCalls();
      return { completed: false, shouldAbort: true };
    }

    const { name, arguments: argsStr } = toolCall.function;

    onEvent({
      type: 'tool_call',
      toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' } as ToolCallEvent,
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
            subAgentUsage: subResult.usage as any,
          });
        }
      } else {
        result = await handleToolCall(name, args, { sessionId, abortSignal });
      }

      logger.info('Tool completed', {
        tool: name,
        resultLength: result.length,
      });

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      } as any);
      pendingToolCallIds.delete(toolCall.id);

      onEvent({
        type: 'tool_result',
        toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result } as ToolCallEvent,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: ${errMsg}`,
      } as any);
      pendingToolCallIds.delete(toolCall.id);

      // If the tool was aborted, inject stubs for remaining pending calls and stop
      if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
        logger.debug('Agentic loop aborted during tool execution');
        injectStubsForPendingToolCalls();
        return { completed: false, shouldAbort: true };
      }

      onEvent({
        type: 'tool_result',
        toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg } as ToolCallEvent,
      });
    }
  }

  return { completed: true, shouldAbort: false };
}

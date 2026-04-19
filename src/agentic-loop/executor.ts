/**
 * Tool execution module for the agentic loop.
 *
 * Handles execution of tool calls including special handling for
 * sub-agents and proper abort signal management between tool calls.
 * 
 * Supports parallel execution of independent tools and sub-agents.
 */

import type { AgentEventHandler, ToolCallEvent } from '../agentic-loop.js';
import type { ToolRegistry } from '../tools/index.js';
import { runSubAgent, type SubAgentProgressHandler, type SubAgentUsage } from '../sub-agent.js';
import { logger } from '../utils/logger.js';

/**
 * Context for tool execution, passed through from the main loop.
 */
export interface ToolExecutionContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
  approvalManager?: any;  // ApprovalManager for per-tab approval handling
  requestDefaults: Record<string, unknown>;
  client: any;  // OpenAI client
  model: string;
  pricing?: any;  // ModelPricing
  toolRegistry?: ToolRegistry;  // Per-tab tool registry (contains MCP tools)
}

interface ToolResult {
  id: string;
  name: string;
  args: string;
  status: 'done' | 'error';
  result: string;
}

/**
 * Execute a single tool call and return the result.
 */
async function executeSingleTool(
  toolCall: any,
  messages: any[],
  onEvent: AgentEventHandler,
  context: ToolExecutionContext
): Promise<ToolResult> {
  const { sessionId, abortSignal, approvalManager, requestDefaults, client, model, pricing, toolRegistry } = context;
  const { id, function: fn } = toolCall;
  const { name, arguments: argsStr } = fn;

  onEvent({
    type: 'tool_call',
    toolCall: { id, name, args: argsStr, status: 'running' } as ToolCallEvent,
  });

  try {
    const args = JSON.parse(argsStr);
    let result: string;

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
        toolRegistry,  // Pass per-tab tool registry to sub-agent
      );
      result = subResult.response;
      if (subResult.usage.inputTokens > 0 || subResult.usage.outputTokens > 0) {
        onEvent({
          type: 'sub_agent_iteration',
          subAgentUsage: subResult.usage as any,
        });
      }
    } else {
      // Use per-tab toolRegistry if provided, otherwise fall back to global handler
      if (toolRegistry) {
        result = await toolRegistry.handleToolCall(name, args, { sessionId, abortSignal, approvalManager });
      } else {
        // Fallback to global handler for backwards compatibility
        const { handleToolCall } = await import('../tools/index.js');
        result = await handleToolCall(name, args, { sessionId, abortSignal, approvalManager });
      }
    }

    logger.info('Tool completed', { tool: name, resultLength: result.length });

    onEvent({
      type: 'tool_result',
      toolCall: { id, name, args: argsStr, status: 'done', result } as ToolCallEvent,
    });

    return { id, name, args: argsStr, status: 'done', result };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    
    onEvent({
      type: 'tool_result',
      toolCall: { id, name, args: argsStr, status: 'error', result: errMsg } as ToolCallEvent,
    });

    return { id, name, args: argsStr, status: 'error', result: errMsg };
  }
}

/**
 * Execute all tool calls from an assistant message.
 *
 * Handles:
 * - Parallel execution of independent tool calls (including sub-agents)
 * - Abort checking between tool calls
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
  const { abortSignal } = context;

  // Track pending tool call IDs for abort scenarios
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

  // Check abort before starting
  if (abortSignal?.aborted) {
    logger.debug('Agentic loop aborted before tool execution');
    injectStubsForPendingToolCalls();
    return { completed: false, shouldAbort: true };
  }

  // Emit all tool_call events first (so UI shows them all as "running")
  for (const toolCall of toolCalls) {
    const { id, function: fn } = toolCall;
    const { name, arguments: argsStr } = fn;
    onEvent({
      type: 'tool_call',
      toolCall: { id, name, args: argsStr, status: 'running' } as ToolCallEvent,
    });
  }

  // Execute all tools in parallel
  const results = await Promise.all(
    toolCalls.map((toolCall) =>
      executeSingleTool(toolCall, messages, onEvent, context)
    )
  );

  // Check abort after parallel execution
  if (abortSignal?.aborted) {
    logger.debug('Agentic loop aborted during tool execution');
    injectStubsForPendingToolCalls();
    return { completed: false, shouldAbort: true };
  }

  // Add all results to messages in order
  for (const result of results) {
    messages.push({
      role: 'tool',
      tool_call_id: result.id,
      content: result.status === 'error' ? `Error: ${result.result}` : result.result,
    } as any);
    pendingToolCallIds.delete(result.id);
  }

  return { completed: true, shouldAbort: false };
}

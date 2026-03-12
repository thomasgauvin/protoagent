# Part 12: Sub-agents

Sub-agents solve context pollution. Sometimes the model needs to do noisy work — search a repo, read ten files, compare implementations — just to answer one question. Without sub-agents, all that intermediate work stays in the parent conversation forever. Sub-agents push it into an isolated child run that returns only a summary.

## What you are building

Starting from Part 11, you add:

- `src/sub-agent.ts` — isolated child agent execution
- Updated `src/agentic-loop.ts` — routes `sub_agent` tool calls to the child runner
- Updated `src/App.tsx` — registers the sub-agent tool at startup

## Step 1: Create `src/sub-agent.ts`

The sub-agent gets its own message history, system prompt, and tool access. It runs autonomously for up to N iterations, then returns its final text response to the parent.

```typescript
// src/sub-agent.ts

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

export type SubAgentProgressHandler = (event: { tool: string; status: 'running' | 'done' | 'error'; iteration: number }) => void;

export async function runSubAgent(
  client: OpenAI,
  model: string,
  task: string,
  maxIterations = 30,
  requestDefaults: Record<string, unknown> = {},
  onProgress?: SubAgentProgressHandler,
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
        ...requestDefaults,
        model,
        messages,
        tools: getAllTools(),
        tool_choice: 'auto',
      });

      const message = response.choices[0]?.message;
      if (!message) break;

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push(message as any);

        for (const toolCall of message.tool_calls) {
          const { name, arguments: argsStr } = (toolCall as any).function;
          logger.debug(`Sub-agent tool call: ${name}`);
          onProgress?.({ tool: name, status: 'running', iteration: i });

          try {
            const args = JSON.parse(argsStr);
            const result = await handleToolCall(name, args, { sessionId: subAgentSessionId });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
            onProgress?.({ tool: name, status: 'done', iteration: i });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: `Error: ${msg}`,
            } as any);
            onProgress?.({ tool: name, status: 'error', iteration: i });
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
```

## Step 2: Update `src/agentic-loop.ts`

The agentic loop needs to detect `sub_agent` tool calls and route them to the child runner instead of the normal tool handler.

In your tool execution section, add special handling for `sub_agent`:

```typescript
import { subAgentTool, runSubAgent } from './sub-agent.js';

// When processing tool calls, check for sub_agent:
if (toolName === 'sub_agent') {
  const result = await runSubAgent(
    client,
    model,
    args.task,
    args.max_iterations,
    requestDefaults,
  );
  // Push the result as a tool message
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: result,
  } as any);
} else {
  // Normal tool handling
  const result = await handleToolCall(toolName, args, { sessionId });
  messages.push({
    role: 'tool',
    tool_call_id: toolCall.id,
    content: result,
  } as any);
}
```

Also register the `sub_agent` tool in the tool list. You can do this by importing it and adding to the tools passed to the API:

```typescript
// The sub_agent tool needs to be in the tools list sent to the API.
// Register it as a dynamic tool during initialization, or include it
// directly in the getAllTools() call.
```

## Step 3: Register sub-agent at startup

In `src/App.tsx`, register the sub-agent tool during initialization:

```typescript
import { subAgentTool } from './sub-agent.js';
import { registerDynamicTool } from './tools/index.js';

// In initializeWithConfig, after MCP initialization:
registerDynamicTool(subAgentTool as any);
```

## Verification

```bash
npm run dev
```

Try a prompt that benefits from delegation:

```text
Investigate how the config system works in this project and summarize the flow.
```

You should see:
- A `sub_agent` tool call in the parent conversation
- The sub-agent working autonomously (visible in debug logs)
- Only the summary returned to the parent transcript

## Resulting snapshot

Your project should match `protoagent-tutorial-again-part-12`.

## Core takeaway

Sub-agents keep the main conversation clean by running noisy investigation work in an isolated context. The parent gets a focused summary instead of hundreds of intermediate tool calls polluting its history.

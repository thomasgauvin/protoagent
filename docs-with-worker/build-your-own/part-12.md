# Part 12: Sub-agents

Sub-agents solve context pollution. Sometimes the model needs to do noisy work — search a repo, read ten files, compare implementations — just to answer one question. Without sub-agents, all that intermediate work stays in the parent conversation forever. Sub-agents push it into an isolated child run that returns only a summary.

## What you are building

Starting from Part 11, you add:

- `src/sub-agent.ts` — isolated child agent execution
- Updated `src/agentic-loop.ts` — imports and registers the sub-agent tool, routes `sub_agent` tool calls to the child runner

## Step 1: Create `src/sub-agent.ts`

Create the file:

```bash
touch src/sub-agent.ts
```

The `sub-agent.ts` file will look very similar to the existing `agentic-loop.ts` file. That is because it has it's own loop, with a few variations. For instance, the `sub-agent.ts` must run autonomously and be a background agent, while the main `agentic-loop.ts` interacts with the user.The sub-agent gets its own message history, system prompt, and tool access.

This is the analogy: With subagents, the parent delegates a research task to a specialist. That specialist might read 20 files, run grep, compare implementations — messy exploratory work. All those intermediate steps stay in the specialist's notebook. When they're done, they hand the parent a single summary. The parent never sees the messy drafts, only the clean result.

```typescript
// src/sub-agent.ts

import type OpenAI from 'openai';
import crypto from 'node:crypto';
import { handleToolCall, getAllTools } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { clearTodos } from './tools/todo.js';
import { ModelPricing } from './utils/cost-tracker.js';

export interface SubAgentUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface SubAgentResult {
  response: string;
  usage: SubAgentUsage;
}

// Defines sub-agents as a tool that the main coding agent can invoke
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
          description: 'Maximum tool-call iterations for the sub-agent. Defaults to 500.',
        },
      },
      required: ['task'],
    },
  },
};

export type SubAgentProgressHandler = (event: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> }) => void;

// Spawns an isolated sub-agent to handle a task independently from the main conversation context.
export async function runSubAgent(
  client: OpenAI,
  model: string,
  task: string,
  maxIterations = 500,
  requestDefaults: Record<string, unknown> = {},
  onProgress?: SubAgentProgressHandler,
  abortSignal?: AbortSignal,
  pricing?: ModelPricing
): Promise<SubAgentResult> {
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

  // Track cumulative usage across all API calls in the sub-agent
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  try {
    for (let i = 0; i < maxIterations; i++) {
      // Check abort at the top of each iteration
      if (abortSignal?.aborted) {
        return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }

      let assistantMessage: any;
      let hasToolCalls = false;

      try {
        const stream = await client.chat.completions.create({
          ...requestDefaults,
          model,
          messages,
          tools: getAllTools(),
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }, { signal: abortSignal });

        // Accumulate the streamed response
        assistantMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [],
        };
        let streamedContent = '';
        hasToolCalls = false;
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
                assistantMessage.tool_calls[idx].function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }

        // Accumulate usage for this iteration
        const iterationInputTokens = actualUsage?.prompt_tokens || 0;
        const iterationOutputTokens = actualUsage?.completion_tokens || 0;
        totalInputTokens += iterationInputTokens;
        totalOutputTokens += iterationOutputTokens;

        // Calculate cost if pricing is available
        if (pricing && (iterationInputTokens > 0 || iterationOutputTokens > 0)) {
          const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
          if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
            const uncachedTokens = iterationInputTokens - cachedTokens;
            totalCost += uncachedTokens * pricing.inputPerToken + cachedTokens * pricing.cachedPerToken + iterationOutputTokens * pricing.outputPerToken;
          } else {
            totalCost += iterationInputTokens * pricing.inputPerToken + iterationOutputTokens * pricing.outputPerToken;
          }
        }
      } catch (err) {
        // If aborted during streaming, return gracefully
        if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
          return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
        }
        throw err;
      }

      const message = assistantMessage;
      if (!message) break;

      // Check for tool calls
      if (hasToolCalls && assistantMessage.tool_calls.length > 0) {
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        // Filter out tool calls with malformed JSON arguments (can happen if stream aborted mid-tool-call)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return true; // No args is valid
          try {
            JSON.parse(args);
            return true;
          } catch {
            return false;
          }
        });
        // Only add message if we have valid tool calls
        if (assistantMessage.tool_calls.length === 0) {
          hasToolCalls = false;
        } else {
          messages.push(message as any);
        }

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
          }

          const { name, arguments: argsStr } = toolCall.function;
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(argsStr);
          } catch {
            args = {};
          }
          onProgress?.({ tool: name, status: 'running', iteration: i, args });

          try {
            const result = await handleToolCall(name, args, { sessionId: subAgentSessionId, abortSignal });
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
      if (message.content) {
        messages.push({
          role: 'assistant',
          content: message.content,
        });
        return { response: message.content, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }
      return { response: '(sub-agent completed with no response)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
    }

    return { response: '(sub-agent reached iteration limit)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
  } finally {
    clearTodos(subAgentSessionId);
  }
}
```

## Step 2: Update `src/tools/index.ts`

Add `abortSignal` to `ToolCallContext` so tools can honor cancellation when a sub-agent is aborted:

```typescript
export interface ToolCallContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
}
```

## Step 3: Update `src/agentic-loop.ts`

Import the sub-agent tool and types, add `sub_agent_iteration` event type, and wire up special handling for `sub_agent` tool calls.

Add the import at the top:

```typescript
import { subAgentTool, runSubAgent, type SubAgentProgressHandler, SubAgentResult } from './sub-agent.js';
```

Update `AgentEvent` to include sub-agent progress and usage:

```typescript
export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done' | 'sub_agent_iteration';
  content?: string;
  toolCall?: ToolCallEvent;
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  error?: string;
  transient?: boolean;
  subAgentTool?: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> };
  subAgentUsage?: { inputTokens: number; outputTokens: number; cost: number };
}
```

Include `subAgentTool` in the tools list sent to the API:

```typescript
const allTools = [...getAllTools(), subAgentTool];
```

In your tool execution section (above where `handleToolCall` is called), add special handling for `sub_agent`:

```typescript
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
```

## Verification

```bash
npm run dev
```

Try a prompt that benefits from delegation:

```text
Investigate how the config system works in this project using a sub-agent and summarize the flow.
```

You should see:
- A `sub_agent` tool call in the parent conversation
- The spinner briefly showing `sub_agent → bash` (or whichever tool the sub-agent is using) — these are `sub_agent_iteration` events that update the spinner without adding entries to the parent's message history
- Only the summary returned to the parent transcript

```

 █▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
 █▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ 


Model: OpenAI / gpt-5-mini
[System prompt loaded]

> use a subagent to understand this codebase
Tool: todo_write({"todos":[{"id":"analyze-subagent","content":"Spawn sub-agent to 
analyze the codebase: list files, r)
TODO List Updated (2 items):
[~] [high] Spawn sub-agent to analyze the codebase: list files, read package.json 
and AGENTS.md, scan src/, summarize each module, identify entry points, build/test 
script...
Tool: sub_agent({"task":"Analyze the TypeScript codebase in 
/Users/thomasgauvin/work-in-progress/2025/protoagent/pro)
BEEP BEEP
{
  "files_listed": {
    "root": [
      ".env",
      ".protoagent",
      "agents.md",
      "dist",
      "node_modules",
      "package-lock.json",
      "package.json",
      "src",
  ...
BEEP BEEP

✅ Sub-agent completed analysis.

Summary (concise):
- I spawned a sub-agent that listed files, read package.json, AGENTS.md,
tsconfig.json, and key source files.
- The sub-agent produced per-file summaries, identified entry points (src/cli.tsx
and dist/cli.js), listed scripts, and proposed follow-up tasks.

Key findings:
- package.json scripts: "build" (tsc), "dev" (tsx src/cli.tsx), "build:watch". No
"test" script despite AGENTS.md recommending npm test.
- TypeScript config: strict mode enabled, NodeNext module resolution, outDir dist,
rootDir src.
- Main entry: src/cli.tsx (dev) and compiled dist/cli.js (bin).
- Notable modules: agentic-loop (core streaming logic), tools/index (tool registry),
 skills (dynamic skill discovery), mcp (Model Context Protocol integration),
sub-agent (spawns isolated agents), App.tsx (Ink UI).
- Several modules silently swallow errors (skills, mcp, session load) — add
logging/diagnostics.
- Tests and CI are missing; add unit tests for streaming/tool-calls and
runtime-config.

Next recommended tasks (pick one and I'll proceed):
- Add a test script and initial unit tests (I can scaffold tests for agentic-loop or
 tools).
- Improve error logging in skills loading and MCP initialization.
- Create README and document build/test workflow.
- Run project build (npm run build) to confirm compile status.

Which follow-up task do you want me to take next?

tokens: 7373↓ 352↑ | ctx: 1% | cost: $0.0043

Session: 1h32x5xy
╭────────────────────────────────────────────────────╮
│ > Type your message...                             │
╰────────────────────────────────────────────────────╯
```

## Resulting snapshot

Your project should match `protoagent-build-your-own-checkpoints/part-12`.

## Core takeaway

Sub-agents keep the main conversation clean by running noisy investigation work in an isolated context. The parent gets a focused summary instead of hundreds of intermediate tool calls polluting its history.

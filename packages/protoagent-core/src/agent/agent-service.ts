/**
 * Agent Service — Core agentic loop logic with message queuing.
 *
 * This runs on the server and manages:
 * - Multiple concurrent sessions
 * - Message queuing per session (sequential processing)
 * - Tool execution with timeout handling
 * - Parallel sub-agent execution
 * - Event streaming via the event bus
 */
import OpenAI from 'openai';
import { z } from 'zod';
import { eventBus } from '../bus/event-bus.js';
import {
  TextDeltaEvent,
  ToolCallEvent,
  ToolResultEvent,
  SubAgentStartEvent,
  SubAgentProgressEvent,
  SubAgentCompleteEvent,
  AgentCompleteEvent,
  AgentErrorEvent,
  SessionUpdatedEvent,
  MessageQueuedEvent,
  MessageStartedEvent,
} from '../bus/bus-event.js';
import { toolRegistry } from '../tools/tool-registry.js';
import { SessionService } from './session-service.js';
import { CostTracker } from '../utils/cost-tracker.js';
import { generateSystemPrompt } from './system-prompt.js';
import { v4 as uuidv4 } from 'uuid';

// Agent configuration schema
const AgentConfigSchema = z.object({
  provider: z.string().default('openai'),
  model: z.string().default('gpt-4o'),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  maxIterations: z.number().default(100),
  temperature: z.number().default(0.7),
});

type AgentConfig = z.infer<typeof AgentConfigSchema>;

interface QueuedMessage {
  id: string;
  content: string;
  config: AgentConfig;
  timestamp: number;
}

interface RunningSession {
  sessionId: string;
  abortController: AbortController | null;
  client: OpenAI;
  config: AgentConfig;
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
  messageQueue: QueuedMessage[];
  isProcessing: boolean;
  usage: {
    inputTokens: number;
    outputTokens: number;
    estimatedCost: number;
  };
  subAgents: Map<string, AbortController>;
}

export class AgentService {
  private sessions = new Map<string, RunningSession>();
  private sessionService = new SessionService();
  private costTracker = new CostTracker();

  /**
   * Queue a message for processing. If the session is busy,
   * the message is queued and processed when the current turn completes.
   */
  async run(sessionId: string, userInput: string, config: unknown): Promise<void> {
    const parsedConfig = AgentConfigSchema.parse(config);

    // Get or create session
    let session = await this.sessionService.get(sessionId);
    if (!session) {
      session = await this.sessionService.create({
        id: sessionId,
        title: 'New Session',
        model: parsedConfig.model,
        provider: parsedConfig.provider,
        messages: [],
      });
    }

    // Get or create running session
    let runningSession = this.sessions.get(sessionId);
    if (!runningSession) {
      const client = new OpenAI({
        apiKey: parsedConfig.apiKey || process.env.OPENAI_API_KEY,
        baseURL: parsedConfig.baseUrl,
      });

      runningSession = {
        sessionId,
        abortController: null,
        client,
        config: parsedConfig,
        messages: [...session.messages],
        messageQueue: [],
        isProcessing: false,
        usage: { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
        subAgents: new Map(),
      };
      this.sessions.set(sessionId, runningSession);
    }

    // Create queued message
    const queuedMessage: QueuedMessage = {
      id: uuidv4(),
      content: userInput,
      config: parsedConfig,
      timestamp: Date.now(),
    };

    // Add to queue
    runningSession.messageQueue.push(queuedMessage);

    // Emit queue event
    eventBus.emit(
      MessageQueuedEvent.create({
        sessionId,
        messageId: queuedMessage.id,
        queuePosition: runningSession.messageQueue.length - 1,
      })
    );

    // Process queue if not already processing
    if (!runningSession.isProcessing) {
      void this.processQueue(sessionId);
    }
  }

  /**
   * Process messages from the queue sequentially.
   */
  private async processQueue(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.isProcessing) return;

    session.isProcessing = true;

    try {
      while (session.messageQueue.length > 0) {
        const message = session.messageQueue.shift();
        if (!message) continue;

        // Emit started event
        eventBus.emit(
          MessageStartedEvent.create({
            sessionId,
            messageId: message.id,
            content: message.content,
          })
        );

        // Create abort controller for this turn
        session.abortController = new AbortController();

        try {
          await this.runTurn(session, message);
        } catch (err: any) {
          console.error(`Error processing message in session ${sessionId}:`, err);
          eventBus.emit(
            AgentErrorEvent.create({
              sessionId,
              error: err.message,
              transient: false,
            })
          );
        } finally {
          session.abortController = null;
        }
      }
    } finally {
      session.isProcessing = false;
    }
  }

  /**
   * Run a single turn with the agent loop.
   */
  private async runTurn(
    session: RunningSession,
    message: QueuedMessage
  ): Promise<void> {
    const { sessionId, client, config } = session;

    // Initialize messages with system prompt if empty
    if (session.messages.length === 0 || session.messages[0].role !== 'system') {
      const systemPrompt = await generateSystemPrompt();
      session.messages.unshift({ role: 'system', content: systemPrompt });
    } else {
      // Refresh system prompt
      const systemPrompt = await generateSystemPrompt();
      session.messages[0] = { role: 'system', content: systemPrompt };
    }

    // Add user message
    session.messages.push({ role: 'user', content: message.content });

    const maxIterations = config.maxIterations;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      if (session.abortController?.signal.aborted) {
        break;
      }

      try {
        // Get all tools including dynamic ones
        const tools = toolRegistry.getAllTools();

        const stream = await client.chat.completions.create(
          {
            model: config.model,
            messages: session.messages,
            tools,
            tool_choice: 'auto',
            stream: true,
            temperature: config.temperature,
          },
          {
            signal: session.abortController?.signal,
          }
        );

        let assistantMessage: OpenAI.Chat.Completions.ChatCompletionMessageParam =
          {
            role: 'assistant',
            content: '',
            tool_calls: [],
          };
        let hasToolCalls = false;
        let streamedContent = '';

        for await (const chunk of stream) {
          if (session.abortController?.signal.aborted) break;

          const delta = chunk.choices[0]?.delta;

          // Stream text content
          if (delta?.content) {
            streamedContent += delta.content;
            (assistantMessage as any).content = streamedContent;

            // Emit text delta event
            eventBus.emit(
              TextDeltaEvent.create({
                sessionId,
                content: delta.content,
              })
            );
          }

          // Accumulate tool calls
          if (delta?.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!(assistantMessage as any).tool_calls[idx]) {
                (assistantMessage as any).tool_calls[idx] = {
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) (assistantMessage as any).tool_calls[idx].id = tc.id;
              if (tc.function?.name) {
                (assistantMessage as any).tool_calls[idx].function.name +=
                  tc.function.name;
              }
              if (tc.function?.arguments) {
                (assistantMessage as any).tool_calls[idx].function.arguments +=
                  tc.function.arguments;
              }
            }
          }
        }

        session.messages.push(assistantMessage);

        // Handle tool calls
        if (hasToolCalls && (assistantMessage as any).tool_calls?.length > 0) {
          const toolCalls = (assistantMessage as any).tool_calls.filter(Boolean);

          // Execute tool calls in parallel
          await this.executeToolCallsInParallel(session, toolCalls);

          continue; // Continue loop for next LLM call
        }

        // Plain text response - done
        if (streamedContent) {
          eventBus.emit(
            AgentCompleteEvent.create({
              sessionId,
              finalMessage: streamedContent,
              usage: {
                inputTokens: session.usage.inputTokens,
                outputTokens: session.usage.outputTokens,
                totalTokens: session.usage.inputTokens + session.usage.outputTokens,
                estimatedCost: session.usage.estimatedCost,
                contextPercent: this.costTracker.getContextPercent(
                  session.messages,
                  config.model
                ),
              },
            })
          );

          // Save session
          await this.sessionService.update(sessionId, {
            messages: session.messages,
          });
          return;
        }
      } catch (err: any) {
        if (
          session.abortController?.signal.aborted ||
          err.name === 'AbortError'
        ) {
          return;
        }

        eventBus.emit(
          AgentErrorEvent.create({
            sessionId,
            error: err.message,
            transient: false,
          })
        );
        return;
      }
    }

    eventBus.emit(
      AgentErrorEvent.create({
        sessionId,
        error: 'Maximum iteration limit reached',
        transient: false,
      })
    );
  }

  private async executeToolCallsInParallel(
    session: RunningSession,
    toolCalls: any[]
  ): Promise<void> {
    const { sessionId } = session;

    // Separate sub-agent calls from regular tool calls
    const regularToolCalls: any[] = [];
    const subAgentCalls: any[] = [];

    for (const toolCall of toolCalls) {
      if (toolCall.function?.name === 'sub_agent') {
        subAgentCalls.push(toolCall);
      } else {
        regularToolCalls.push(toolCall);
      }
    }

    // Emit tool call events
    for (const toolCall of toolCalls) {
      const args = this.parseArgs(toolCall.function.arguments);
      eventBus.emit(
        ToolCallEvent.create({
          sessionId,
          toolCallId: toolCall.id,
          name: toolCall.function.name,
          args,
        })
      );
    }

    // Execute regular tools in parallel
    const regularPromises = regularToolCalls.map(async (toolCall) => {
      const args = this.parseArgs(toolCall.function.arguments);
      try {
        const result = await toolRegistry.execute(
          toolCall.function.name,
          args,
          {
            sessionId,
            abortSignal: session.abortController?.signal,
          }
        );

        eventBus.emit(
          ToolResultEvent.create({
            sessionId,
            toolCallId: toolCall.id,
            result,
            status: 'success',
          })
        );

        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: result,
        });
      } catch (err: any) {
        eventBus.emit(
          ToolResultEvent.create({
            sessionId,
            toolCallId: toolCall.id,
            result: err.message,
            status: 'error',
          })
        );

        session.messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: `Error: ${err.message}`,
        });
      }
    });

    // Execute sub-agents in parallel
    const subAgentPromises = subAgentCalls.map(async (toolCall) => {
      const args = this.parseArgs(toolCall.function.arguments);
      const subAgentId = `sub-${uuidv4()}`;

      await this.runSubAgent(
        session,
        subAgentId,
        args.task as string,
        (args.max_iterations as number) || 50,
        toolCall.id
      );
    });

    // Wait for all tools to complete
    await Promise.all([...regularPromises, ...subAgentPromises]);

    // Update session
    await this.sessionService.update(sessionId, { messages: session.messages });
    eventBus.emit(
      SessionUpdatedEvent.create({
        sessionId,
        messageCount: session.messages.length,
      })
    );
  }

  private async runSubAgent(
    parentSession: RunningSession,
    subAgentId: string,
    task: string,
    maxIterations: number,
    parentToolCallId: string
  ): Promise<void> {
    const { sessionId } = parentSession;
    const subAbortController = new AbortController();
    parentSession.subAgents.set(subAgentId, subAbortController);

    eventBus.emit(
      SubAgentStartEvent.create({
        sessionId,
        subAgentId,
        task,
      })
    );

    try {
      const systemPrompt = await generateSystemPrompt();
      const subSystemPrompt = `${systemPrompt}\n\n## Sub-Agent Mode\n\nYou are running as a sub-agent. Complete the task thoroughly and return a clear summary.`;

      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: 'system', content: subSystemPrompt },
        { role: 'user', content: task },
      ];

      let usage = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        estimatedCost: 0,
      };

      for (let i = 0; i < maxIterations; i++) {
        if (subAbortController.signal.aborted) break;

        const response = await parentSession.client.chat.completions.create(
          {
            model: parentSession.config.model,
            messages,
            tools: toolRegistry.getAllTools(),
            tool_choice: 'auto',
          },
          {
            signal: subAbortController.signal,
          }
        );

        const message = response.choices[0].message;

        // Track usage
        if (response.usage) {
          usage.inputTokens += response.usage.prompt_tokens;
          usage.outputTokens += response.usage.completion_tokens;
          usage.totalTokens = usage.inputTokens + usage.outputTokens;
        }

        messages.push(message);

        // Handle tool calls
        if (message.tool_calls && message.tool_calls.length > 0) {
          for (const toolCall of message.tool_calls) {
            eventBus.emit(
              SubAgentProgressEvent.create({
                sessionId,
                subAgentId,
                tool: toolCall.function.name,
                status: 'running',
                iteration: i,
              })
            );

            try {
              const args = this.parseArgs(toolCall.function.arguments);
              const result = await toolRegistry.execute(
                toolCall.function.name,
                args,
                {
                  sessionId: `${sessionId}-sub`,
                  abortSignal: subAbortController.signal,
                }
              );

              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: result,
              });

              eventBus.emit(
                SubAgentProgressEvent.create({
                  sessionId,
                  subAgentId,
                  tool: toolCall.function.name,
                  status: 'done',
                  iteration: i,
                })
              );
            } catch (err: any) {
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: `Error: ${err.message}`,
              });

              eventBus.emit(
                SubAgentProgressEvent.create({
                  sessionId,
                  subAgentId,
                  tool: toolCall.function.name,
                  status: 'error',
                  iteration: i,
                })
              );
            }
          }
          continue;
        }

        // Plain text response - done
        const responseText = message.content || '(no response)';

        eventBus.emit(
          SubAgentCompleteEvent.create({
            sessionId,
            subAgentId,
            response: responseText,
            usage: {
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              totalTokens: usage.inputTokens + usage.outputTokens,
              estimatedCost: usage.estimatedCost,
            },
          })
        );

        // Add result to parent session
        parentSession.messages.push({
          role: 'tool',
          tool_call_id: parentToolCallId,
          content: responseText,
        });

        return;
      }

      // Max iterations reached
      eventBus.emit(
        SubAgentCompleteEvent.create({
          sessionId,
          subAgentId,
          response: '(sub-agent reached iteration limit)',
          usage: {
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.inputTokens + usage.outputTokens,
            estimatedCost: usage.estimatedCost,
          },
        })
      );
    } finally {
      parentSession.subAgents.delete(subAgentId);
    }
  }

  private parseArgs(argsStr: string): Record<string, unknown> {
    try {
      return JSON.parse(argsStr);
    } catch {
      return {};
    }
  }

  async abort(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.abortController?.abort();

      // Abort all sub-agents
      for (const [id, controller] of session.subAgents) {
        controller.abort();
      }
    }
  }

  async executeTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<string> {
    return toolRegistry.execute(toolName, args, {});
  }

  /**
   * Get the current queue status for a session.
   */
  getQueueStatus(
    sessionId: string
  ): { queueLength: number; isProcessing: boolean } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      queueLength: session.messageQueue.length,
      isProcessing: session.isProcessing,
    };
  }

  /**
   * Clear the message queue for a session.
   */
  clearQueue(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.messageQueue = [];
    return true;
  }
}

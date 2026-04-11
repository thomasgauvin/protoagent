/**
 * Typed event bus for internal communication.
 * Inspired by OpenCode's event architecture.
 */
import { z, type ZodType, type ZodInfer } from 'zod';

export type EventMetadata = {
  timestamp: number;
  source: string;
};

export type EventEnvelope<T = unknown> = {
  type: string;
  payload: T;
  metadata: EventMetadata;
};

export type EventDefinition<Type extends string, Schema extends ZodType> = {
  type: Type;
  schema: Schema;
  create: (payload: ZodInfer<Schema>) => EventEnvelope<ZodInfer<Schema>>;
  parse: (data: unknown) => EventEnvelope<ZodInfer<Schema>>;
};

export function defineEvent<Type extends string, Schema extends ZodType>(
  type: Type,
  schema: Schema
): EventDefinition<Type, Schema> {
  return {
    type,
    schema,
    create: (payload) => ({
      type,
      payload,
      metadata: {
        timestamp: Date.now(),
        source: 'protoagent-core',
      },
    }),
    parse: (data) => {
      const parsed = schema.parse(data);
      return {
        type,
        payload: parsed,
        metadata: {
          timestamp: Date.now(),
          source: 'protoagent-core',
        },
      };
    },
  };
}

// Agent events
export const TextDeltaEvent = defineEvent(
  'agent.text_delta',
  z.object({
    sessionId: z.string(),
    content: z.string(),
  })
);

export const ToolCallEvent = defineEvent(
  'agent.tool_call',
  z.object({
    sessionId: z.string(),
    toolCallId: z.string(),
    name: z.string(),
    args: z.record(z.unknown()),
  })
);

export const ToolResultEvent = defineEvent(
  'agent.tool_result',
  z.object({
    sessionId: z.string(),
    toolCallId: z.string(),
    result: z.string(),
    status: z.enum(['success', 'error']),
  })
);

export const SubAgentStartEvent = defineEvent(
  'agent.sub_agent.start',
  z.object({
    sessionId: z.string(),
    subAgentId: z.string(),
    task: z.string(),
  })
);

export const SubAgentProgressEvent = defineEvent(
  'agent.sub_agent.progress',
  z.object({
    sessionId: z.string(),
    subAgentId: z.string(),
    tool: z.string(),
    status: z.enum(['running', 'done', 'error']),
    iteration: z.number(),
  })
);

export const SubAgentCompleteEvent = defineEvent(
  'agent.sub_agent.complete',
  z.object({
    sessionId: z.string(),
    subAgentId: z.string(),
    response: z.string(),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
      estimatedCost: z.number(),
    }),
  })
);

export const AgentCompleteEvent = defineEvent(
  'agent.complete',
  z.object({
    sessionId: z.string(),
    finalMessage: z.string(),
    usage: z.object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
      estimatedCost: z.number(),
      contextPercent: z.number(),
    }),
  })
);

export const AgentErrorEvent = defineEvent(
  'agent.error',
  z.object({
    sessionId: z.string(),
    error: z.string(),
    transient: z.boolean().default(false),
  })
);

// Queue events
export const MessageQueuedEvent = defineEvent(
  'queue.message_queued',
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    queuePosition: z.number(),
  })
);

export const MessageStartedEvent = defineEvent(
  'queue.message_started',
  z.object({
    sessionId: z.string(),
    messageId: z.string(),
    content: z.string(),
  })
);

// Session events
export const SessionCreatedEvent = defineEvent(
  'session.created',
  z.object({
    sessionId: z.string(),
    title: z.string(),
    model: z.string(),
    provider: z.string(),
  })
);

export const SessionUpdatedEvent = defineEvent(
  'session.updated',
  z.object({
    sessionId: z.string(),
    messageCount: z.number(),
  })
);

// All event types for type-safe subscriptions
export type ProtoAgentEvent =
  | ReturnType<typeof TextDeltaEvent.create>
  | ReturnType<typeof ToolCallEvent.create>
  | ReturnType<typeof ToolResultEvent.create>
  | ReturnType<typeof SubAgentStartEvent.create>
  | ReturnType<typeof SubAgentProgressEvent.create>
  | ReturnType<typeof SubAgentCompleteEvent.create>
  | ReturnType<typeof AgentCompleteEvent.create>
  | ReturnType<typeof AgentErrorEvent.create>
  | ReturnType<typeof MessageQueuedEvent.create>
  | ReturnType<typeof MessageStartedEvent.create>
  | ReturnType<typeof SessionCreatedEvent.create>
  | ReturnType<typeof SessionUpdatedEvent.create>;

/**
 * Typed event bus for internal communication.
 * Inspired by OpenCode's event architecture.
 */
import { z, type ZodType } from 'zod';
type ZodInfer<T extends ZodType> = z.infer<T>;
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
export declare function defineEvent<Type extends string, Schema extends ZodType>(type: Type, schema: Schema): EventDefinition<Type, Schema>;
export declare const TextDeltaEvent: EventDefinition<"agent.text_delta", z.ZodObject<{
    sessionId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    content: string;
}, {
    sessionId: string;
    content: string;
}>>;
export declare const ToolCallEvent: EventDefinition<"agent.tool_call", z.ZodObject<{
    sessionId: z.ZodString;
    toolCallId: z.ZodString;
    name: z.ZodString;
    args: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
}, {
    sessionId: string;
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
}>>;
export declare const ToolResultEvent: EventDefinition<"agent.tool_result", z.ZodObject<{
    sessionId: z.ZodString;
    toolCallId: z.ZodString;
    result: z.ZodString;
    status: z.ZodEnum<["success", "error"]>;
}, "strip", z.ZodTypeAny, {
    status: "success" | "error";
    sessionId: string;
    toolCallId: string;
    result: string;
}, {
    status: "success" | "error";
    sessionId: string;
    toolCallId: string;
    result: string;
}>>;
export declare const SubAgentStartEvent: EventDefinition<"agent.sub_agent.start", z.ZodObject<{
    sessionId: z.ZodString;
    subAgentId: z.ZodString;
    task: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    subAgentId: string;
    task: string;
}, {
    sessionId: string;
    subAgentId: string;
    task: string;
}>>;
export declare const SubAgentProgressEvent: EventDefinition<"agent.sub_agent.progress", z.ZodObject<{
    sessionId: z.ZodString;
    subAgentId: z.ZodString;
    tool: z.ZodString;
    status: z.ZodEnum<["running", "done", "error"]>;
    iteration: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    status: "error" | "running" | "done";
    sessionId: string;
    subAgentId: string;
    tool: string;
    iteration: number;
}, {
    status: "error" | "running" | "done";
    sessionId: string;
    subAgentId: string;
    tool: string;
    iteration: number;
}>>;
export declare const SubAgentCompleteEvent: EventDefinition<"agent.sub_agent.complete", z.ZodObject<{
    sessionId: z.ZodString;
    subAgentId: z.ZodString;
    response: z.ZodString;
    usage: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        estimatedCost: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
    }, {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
    }>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    subAgentId: string;
    response: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
    };
}, {
    sessionId: string;
    subAgentId: string;
    response: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
    };
}>>;
export declare const AgentCompleteEvent: EventDefinition<"agent.complete", z.ZodObject<{
    sessionId: z.ZodString;
    finalMessage: z.ZodString;
    usage: z.ZodObject<{
        inputTokens: z.ZodNumber;
        outputTokens: z.ZodNumber;
        totalTokens: z.ZodNumber;
        estimatedCost: z.ZodNumber;
        contextPercent: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
        contextPercent: number;
    }, {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
        contextPercent: number;
    }>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
        contextPercent: number;
    };
    finalMessage: string;
}, {
    sessionId: string;
    usage: {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        estimatedCost: number;
        contextPercent: number;
    };
    finalMessage: string;
}>>;
export declare const AgentErrorEvent: EventDefinition<"agent.error", z.ZodObject<{
    sessionId: z.ZodString;
    error: z.ZodString;
    transient: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    error: string;
    transient: boolean;
}, {
    sessionId: string;
    error: string;
    transient?: boolean | undefined;
}>>;
export declare const MessageQueuedEvent: EventDefinition<"queue.message_queued", z.ZodObject<{
    sessionId: z.ZodString;
    messageId: z.ZodString;
    queuePosition: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    messageId: string;
    queuePosition: number;
}, {
    sessionId: string;
    messageId: string;
    queuePosition: number;
}>>;
export declare const MessageStartedEvent: EventDefinition<"queue.message_started", z.ZodObject<{
    sessionId: z.ZodString;
    messageId: z.ZodString;
    content: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    content: string;
    messageId: string;
}, {
    sessionId: string;
    content: string;
    messageId: string;
}>>;
export declare const SessionCreatedEvent: EventDefinition<"session.created", z.ZodObject<{
    sessionId: z.ZodString;
    title: z.ZodString;
    model: z.ZodString;
    provider: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    title: string;
    model: string;
    provider: string;
}, {
    sessionId: string;
    title: string;
    model: string;
    provider: string;
}>>;
export declare const SessionUpdatedEvent: EventDefinition<"session.updated", z.ZodObject<{
    sessionId: z.ZodString;
    messageCount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    sessionId: string;
    messageCount: number;
}, {
    sessionId: string;
    messageCount: number;
}>>;
export type ProtoAgentEvent = ReturnType<typeof TextDeltaEvent.create> | ReturnType<typeof ToolCallEvent.create> | ReturnType<typeof ToolResultEvent.create> | ReturnType<typeof SubAgentStartEvent.create> | ReturnType<typeof SubAgentProgressEvent.create> | ReturnType<typeof SubAgentCompleteEvent.create> | ReturnType<typeof AgentCompleteEvent.create> | ReturnType<typeof AgentErrorEvent.create> | ReturnType<typeof MessageQueuedEvent.create> | ReturnType<typeof MessageStartedEvent.create> | ReturnType<typeof SessionCreatedEvent.create> | ReturnType<typeof SessionUpdatedEvent.create>;
export {};
//# sourceMappingURL=bus-event.d.ts.map
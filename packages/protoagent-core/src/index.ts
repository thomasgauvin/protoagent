/**
 * ProtoAgent Core — Server-side agent runtime.
 */
export { AgentService } from './agent/agent-service.js';
export { SessionService } from './agent/session-service.js';
export { generateSystemPrompt } from './agent/system-prompt.js';

export { eventBus } from './bus/event-bus.js';
export * from './bus/bus-event.js';

export { toolRegistry, type ToolDefinition, type ToolHandler } from './tools/tool-registry.js';

export { app } from './server/server.js';

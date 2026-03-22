/**
 * Core types for ProtoAgent Worker
 */

// Message types for LLM conversation (OpenAI format)
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// Tool definition for LLM
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// Tool execution result
export interface ToolResult {
  tool_call_id: string;
  role: 'tool';
  content: string;
}

// Session state stored in SQLite
export interface SessionState {
  id: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  model?: string;
}

// WebSocket message types
export type ClientMessage =
  | { type: 'input'; data: string }
  | { type: 'resize'; cols: number; rows: number };

export type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'error'; message: string }
  | { type: 'status'; status: 'connected' | 'disconnected' | 'thinking' };

// Environment variables
export interface Env {
  // Workers AI binding (REQUIRED - only works with --remote)
  AI: Ai;
  
  // Model configuration
  MODEL?: string;  // Defaults to @cf/zai-org/glm-4.7-flash
  
  // Daily message quota per session (default: 50)
  DAILY_MESSAGE_QUOTA?: string;
  
  SESSIONS: DurableObjectNamespace;
}

// Terminal size
export interface TerminalSize {
  cols: number;
  rows: number;
}

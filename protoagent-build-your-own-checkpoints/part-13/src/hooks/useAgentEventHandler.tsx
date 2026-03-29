import React, { useCallback } from 'react';
import { Text } from 'ink';
import type { AgentEvent, Message } from '../agentic-loop.js';
import { renderFormattedText, normalizeTranscriptText } from '../utils/format-message.js';
import { formatSubAgentActivity, formatToolActivity } from '../utils/tool-display.js';

export interface AssistantMessageRef {
  message: any;
  index: number;
  kind: 'streaming_text' | 'tool_call_assistant';
}

export interface StreamingBuffer {
  unflushedContent: string;
  hasFlushedAnyLine: boolean;
}

export interface InlineThreadError {
  id: string;
  message: string;
  transient?: boolean;
}

interface UseAgentEventHandlerOptions {
  addStatic: (node: React.ReactNode) => void;
  setCompletionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  setActiveTool: React.Dispatch<React.SetStateAction<string | null>>;
  setLastUsage: React.Dispatch<React.SetStateAction<AgentEvent['usage'] | null>>;
  setTotalCost: React.Dispatch<React.SetStateAction<number>>;
  setThreadErrors: React.Dispatch<React.SetStateAction<InlineThreadError[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
  assistantMessageRef: React.MutableRefObject<AssistantMessageRef | null>;
  streamingBufferRef: React.MutableRefObject<StreamingBuffer>;
}

export function useAgentEventHandler(options: UseAgentEventHandlerOptions) {
  const {
    addStatic,
    setCompletionMessages,
    setIsStreaming,
    setStreamingText,
    setActiveTool,
    setLastUsage,
    setTotalCost,
    setThreadErrors,
    setError,
    assistantMessageRef,
    streamingBufferRef,
  } = options;

  return useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'text_delta': {
        handleTextDelta(event as AgentEvent & { type: 'text_delta' }, {
          addStatic,
          setCompletionMessages,
          setIsStreaming,
          setStreamingText,
          assistantMessageRef,
          streamingBufferRef,
        });
        break;
      }
      case 'sub_agent_iteration': {
        handleSubAgentIteration(event as AgentEvent & { type: 'sub_agent_iteration' }, {
          setActiveTool,
          setTotalCost,
        });
        break;
      }
      case 'tool_call': {
        handleToolCall(event as AgentEvent & { type: 'tool_call' }, {
          addStatic,
          setCompletionMessages,
          setActiveTool,
          assistantMessageRef,
          streamingBufferRef,
          setIsStreaming,
          setStreamingText,
        });
        break;
      }
      case 'tool_result': {
        handleToolResult(event as AgentEvent & { type: 'tool_result' }, {
          addStatic,
          setCompletionMessages,
          setActiveTool,
          assistantMessageRef,
        });
        break;
      }
      case 'usage': {
        handleUsage(event as AgentEvent & { type: 'usage' }, { setLastUsage, setTotalCost });
        break;
      }
      case 'error': {
        handleError(event as AgentEvent & { type: 'error' }, { setThreadErrors, setError });
        break;
      }
      case 'iteration_done': {
        handleIterationDone({ assistantMessageRef });
        break;
      }
      case 'done': {
        handleDone(event as AgentEvent & { type: 'done' }, {
          addStatic,
          setCompletionMessages,
          setIsStreaming,
          setStreamingText,
          setActiveTool,
          setThreadErrors,
          assistantMessageRef,
          streamingBufferRef,
        });
        break;
      }
    }
  }, [
    addStatic,
    setCompletionMessages,
    setIsStreaming,
    setStreamingText,
    setActiveTool,
    setLastUsage,
    setTotalCost,
    setThreadErrors,
    setError,
    assistantMessageRef,
    streamingBufferRef,
  ]);
}

// Shared base interface for contexts that need static scrollback access
interface StaticContext {
  addStatic: (node: React.ReactNode) => void;
}

// Shared base interface for contexts that need streaming state
interface StreamingContext extends StaticContext {
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamingText: React.Dispatch<React.SetStateAction<string>>;
  assistantMessageRef: React.MutableRefObject<AssistantMessageRef | null>;
  streamingBufferRef: React.MutableRefObject<StreamingBuffer>;
}

// Helper to flush streaming buffer to static and reset state
function flushStreamingBuffer(ctx: StreamingContext) {
  const { addStatic, setIsStreaming, setStreamingText, streamingBufferRef } = ctx;
  const buffer = streamingBufferRef.current;

  if (buffer.unflushedContent) {
    addStatic(renderFormattedText(buffer.unflushedContent));
  }

  streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
  setIsStreaming(false);
  setStreamingText('');
}

interface TextDeltaContext extends StreamingContext {
  setCompletionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

function handleTextDelta(
  event: AgentEvent & { type: 'text_delta' },
  ctx: TextDeltaContext
) {
  const deltaText = event.content || '';
  const { assistantMessageRef, streamingBufferRef, addStatic, setCompletionMessages, setIsStreaming, setStreamingText } = ctx;

  // First text delta of this turn: initialize ref, show streaming indicator.
  if (!assistantMessageRef.current || assistantMessageRef.current.kind !== 'streaming_text') {
    // Trim leading whitespace from first delta - LLMs often output leading \n or spaces
    const trimmedDelta = deltaText.replace(/^\s+/, '');
    const assistantMsg = { role: 'assistant', content: trimmedDelta, tool_calls: [] } as Message;
    
    // Use functional update to get correct index
    setCompletionMessages((prev) => {
      const idx = prev.length;
      assistantMessageRef.current = { message: assistantMsg, index: idx, kind: 'streaming_text' };
      return [...prev, assistantMsg];
    });
    
    setIsStreaming(true);

    // Initialize the streaming buffer and process the first chunk
    const buffer = { unflushedContent: trimmedDelta, hasFlushedAnyLine: false };
    streamingBufferRef.current = buffer;

    // Process the first chunk: split on newlines and flush complete lines
    const lines = buffer.unflushedContent.split('\n');
    if (lines.length > 1) {
      const completeLines = lines.slice(0, -1);
      const textToFlush = completeLines.join('\n');
      if (textToFlush) {
        addStatic(renderFormattedText(textToFlush));
        buffer.hasFlushedAnyLine = true;
      }
      buffer.unflushedContent = lines[lines.length - 1];
    }

    setStreamingText(buffer.unflushedContent);
  } else {
    // Subsequent deltas — append to ref and buffer, then flush complete lines
    assistantMessageRef.current.message.content += deltaText;

    // Accumulate in buffer and flush complete lines to static
    const buffer = streamingBufferRef.current;
    buffer.unflushedContent += deltaText;

    // Split on newlines to find complete lines
    const lines = buffer.unflushedContent.split('\n');

    // If we have more than 1 element, there were newlines
    if (lines.length > 1) {
      // All lines except the last one are complete (ended with \n)
      const completeLines = lines.slice(0, -1);

      // Build the text to flush - each complete line gets a newline added back
      const textToFlush = completeLines.join('\n');

      if (textToFlush) {
        addStatic(renderFormattedText(textToFlush));
        buffer.hasFlushedAnyLine = true;
      }

      // Keep only the last (incomplete) line in the buffer
      buffer.unflushedContent = lines[lines.length - 1];
    }

    // Show the incomplete line (if any) in the dynamic frame
    setStreamingText(buffer.unflushedContent);
  }
}

interface SubAgentIterationContext {
  setActiveTool: React.Dispatch<React.SetStateAction<string | null>>;
  setTotalCost: React.Dispatch<React.SetStateAction<number>>;
}

function handleSubAgentIteration(
  event: AgentEvent & { type: 'sub_agent_iteration' },
  ctx: SubAgentIterationContext
) {
  const { setActiveTool, setTotalCost } = ctx;
  
  if (event.subAgentTool) {
    const { tool, status, args } = event.subAgentTool;
    if (status === 'running') {
      setActiveTool(formatSubAgentActivity(tool, args));
    } else {
      setActiveTool(null);
    }
  }
  // Handle sub-agent usage update
  if (event.subAgentUsage) {
    setTotalCost((prev) => prev + event.subAgentUsage!.estimatedCost);
  }
}

interface ToolCallContext extends StreamingContext {
  setActiveTool: React.Dispatch<React.SetStateAction<string | null>>;
  setCompletionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
}

function handleToolCall(
  event: AgentEvent & { type: 'tool_call' },
  ctx: ToolCallContext
) {
  const { setCompletionMessages, setActiveTool, assistantMessageRef } = ctx;
  
  if (!event.toolCall) return;
  
  const toolCall = event.toolCall;
  setActiveTool(toolCall.name);

  // If the model streamed some text before invoking this tool,
  // flush any remaining unflushed content to <Static> now.
  if (assistantMessageRef.current?.kind === 'streaming_text') {
    // Flush buffer and add spacing before the tool call
    flushStreamingBuffer(ctx);
    ctx.addStatic(renderFormattedText('\n'));
    assistantMessageRef.current = null;
  }

  // Track the tool call in the ref WITHOUT triggering a render.
  // The render will happen when tool_result arrives.
  const existingRef = assistantMessageRef.current;
  const assistantMsg = existingRef?.message
    ? {
        ...existingRef.message,
        tool_calls: [...(existingRef.message.tool_calls || [])],
      }
    : { role: 'assistant', content: '', tool_calls: [] as any[] };

  const nextToolCall = {
    id: toolCall.id,
    type: 'function',
    function: { name: toolCall.name, arguments: toolCall.args },
  };

  const idx = assistantMsg.tool_calls.findIndex(
    (tc: any) => tc.id === toolCall.id
  );
  if (idx === -1) {
    assistantMsg.tool_calls.push(nextToolCall);
  } else {
    assistantMsg.tool_calls[idx] = nextToolCall;
  }

  if (!existingRef) {
    // First tool call — we need to add the assistant message to state
    setCompletionMessages((prev) => {
      assistantMessageRef.current = {
        message: assistantMsg,
        index: prev.length,
        kind: 'tool_call_assistant',
      };
      return [...prev, assistantMsg as Message];
    });
  } else {
    // Subsequent tool calls — just update the ref, no render
    assistantMessageRef.current = {
      ...existingRef,
      message: assistantMsg,
      kind: 'tool_call_assistant',
    };
  }
}

interface ToolResultContext extends StaticContext {
  setCompletionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setActiveTool: React.Dispatch<React.SetStateAction<string | null>>;
  assistantMessageRef: React.MutableRefObject<AssistantMessageRef | null>;
}

function handleToolResult(
  event: AgentEvent & { type: 'tool_result' },
  ctx: ToolResultContext
) {
  const { addStatic, setCompletionMessages, setActiveTool, assistantMessageRef } = ctx;
  
  if (!event.toolCall) return;
  
  const toolCall = event.toolCall;
  setActiveTool(null);

  // Write the tool summary immediately — at this point loading is
  // still true but the frame height is stable (spinner + input box).
  // The next state change (setActiveTool(null)) doesn't affect
  // frame height so write() restores the correct frame.
  const compactResult = (toolCall.result || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

  // Parse tool args to show relevant parameter
  let toolDisplay = toolCall.name;
  try {
    const args = JSON.parse(toolCall.args || '{}');
    toolDisplay = formatToolActivity(toolCall.name, args);
  } catch {
    // If parsing fails, just use the tool name
  }

  addStatic(<Text dimColor>{'▶ '}{toolDisplay}{': '}{compactResult}{'\n'}</Text>);

  // Flush the assistant message + tool result into completionMessages
  // for session saving.
  setCompletionMessages((prev) => {
    const updated = [...prev];
    // Sync assistant message
    if (assistantMessageRef.current) {
      updated[assistantMessageRef.current.index] = {
        ...assistantMessageRef.current.message,
      };
    }
    // Append tool result with args for replay
    updated.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: toolCall.result || '',
      name: toolCall.name,
      args: toolCall.args,
    } as any);
    return updated;
  });
}

interface UsageContext {
  setLastUsage: React.Dispatch<React.SetStateAction<AgentEvent['usage'] | null>>;
  setTotalCost: React.Dispatch<React.SetStateAction<number>>;
}

function handleUsage(
  event: AgentEvent & { type: 'usage' },
  ctx: UsageContext
) {
  const { setLastUsage, setTotalCost } = ctx;
  
  if (event.usage) {
    setLastUsage(event.usage);
    setTotalCost((prev) => prev + event.usage!.cost);
  }
}

interface ErrorContext {
  setThreadErrors: React.Dispatch<React.SetStateAction<InlineThreadError[]>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}

function handleError(
  event: AgentEvent & { type: 'error' },
  ctx: ErrorContext
) {
  const { setThreadErrors, setError } = ctx;
  
  if (event.error) {
    const errorMessage = event.error;
    setThreadErrors((prev) => {
      if (event.transient) {
        return [
          ...prev.filter((threadError) => !threadError.transient),
          {
            id: `${Date.now()}-${prev.length}`,
            message: errorMessage,
            transient: true,
          },
        ];
      }

      if (prev[prev.length - 1]?.message === errorMessage) {
        return prev;
      }

      return [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          message: errorMessage,
          transient: false,
        },
      ];
    });
  } else {
    setError('Unknown error');
  }
}

interface IterationDoneContext {
  assistantMessageRef: React.MutableRefObject<AssistantMessageRef | null>;
}

function handleIterationDone(ctx: IterationDoneContext) {
  const { assistantMessageRef } = ctx;
  
  if (assistantMessageRef.current?.kind === 'tool_call_assistant') {
    assistantMessageRef.current = null;
  }
}

interface DoneContext extends StreamingContext {
  setCompletionMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setActiveTool: React.Dispatch<React.SetStateAction<string | null>>;
  setThreadErrors: React.Dispatch<React.SetStateAction<InlineThreadError[]>>;
}

function handleDone(
  _event: AgentEvent & { type: 'done' },
  ctx: DoneContext
) {
  const { setCompletionMessages, setActiveTool, setThreadErrors, assistantMessageRef, streamingBufferRef } = ctx;
  
  if (assistantMessageRef.current?.kind === 'streaming_text') {
    const finalRef = assistantMessageRef.current;
    const buffer = streamingBufferRef.current;

    // Flush any remaining unflushed content from the buffer
    // This is the final incomplete line that was being displayed live
    if (buffer.unflushedContent) {
      // If we've already flushed some lines, just append the remainder
      // Otherwise, normalize and flush the full content
      if (buffer.hasFlushedAnyLine) {
        ctx.addStatic(renderFormattedText(buffer.unflushedContent));
      } else {
        // Nothing was flushed yet, normalize the full content
        const normalized = normalizeTranscriptText(finalRef.message.content || '');
        if (normalized) {
          ctx.addStatic(renderFormattedText(normalized));
        }
      }
    }

    // Add final spacing after the streamed text
    // Always add one newline - the user message adds another for blank line separation
    if (buffer.unflushedContent) {
      ctx.addStatic(renderFormattedText('\n'));
    }

    // Clear streaming state and buffer
    ctx.setIsStreaming(false);
    ctx.setStreamingText('');
    streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
    setCompletionMessages((prev) => {
      const updated = [...prev];
      updated[finalRef.index] = { ...finalRef.message };
      return updated;
    });
    assistantMessageRef.current = null;
  }
  setActiveTool(null);
  setThreadErrors((prev) => prev.filter((threadError) => !threadError.transient));
}

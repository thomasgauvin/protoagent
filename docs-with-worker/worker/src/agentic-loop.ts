/**
 * Agentic Loop - Core LLM conversation loop for Workers
 */

import type { Message, ToolDefinition, ToolCall, Env } from './types.js';
import { generateSystemPrompt } from './system-prompt.js';

// Debug logging helper
function debugLog(...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[AgenticLoop ${timestamp}]`, ...args);
}

export interface AgenticLoopOptions {
  env: Env;
  tools?: ToolDefinition[];
  onStreamStart?: () => void;
  onStream?: (chunk: string) => void;
  onToolCall?: (toolCall: ToolCall) => Promise<string>;
  abortSignal?: AbortSignal;
}

export interface AgentResponse {
  content: string;
  toolCalls?: ToolCall[];
}

export class AgenticLoop {
  private env: Env;
  private tools: ToolDefinition[];
  private onStreamStart?: () => void;
  private onStream?: (chunk: string) => void;
  private onToolCall?: (toolCall: ToolCall) => Promise<string>;
  private abortSignal?: AbortSignal;
  private hasStarted = false;

  // Fallback models to try if primary fails (in order of preference)
  private fallbackModels = [
    '@cf/openai/gpt-oss-120b',     // OpenAI OSS 120B - powerful, function calling
    '@cf/meta/llama-3.2-3b-instruct', // Fast, reliable, function calling
    '@cf/meta/llama-3.1-8b-instruct', // More capable, widely available
  ];

  constructor(options: AgenticLoopOptions) {
    this.env = options.env;
    this.tools = options.tools || [];
    this.onStreamStart = options.onStreamStart;
    this.onStream = options.onStream;
    this.onToolCall = options.onToolCall;
    this.abortSignal = options.abortSignal;
  }

  private getModel(): string {
    return this.env.MODEL || '@cf/openai/gpt-oss-120b';
  }

  getProviderDisplay(): string {
    const model = this.getModel();
    if (model.includes('gpt-oss-120b')) return 'Workers AI / gpt-oss-120b';
    if (model.includes('glm-4.7-flash')) return 'Workers AI / glm-4.7-flash';
    if (model.includes('llama-3.2-3b')) return 'Workers AI / llama-3.2-3b';
    if (model.includes('llama-3.1-8b')) return 'Workers AI / llama-3.1-8b';
    return `Workers AI / ${model}`;
  }

  async run(messages: Message[]): Promise<AgentResponse> {
    if (!this.env.AI) {
      throw new Error('Workers AI binding not available.');
    }

    // Reset streaming state for each run
    this.hasStarted = false;

    const hasSystemPrompt = messages.some(m => m.role === 'system');
    const fullMessages: Message[] = hasSystemPrompt 
      ? messages 
      : [{ role: 'system', content: generateSystemPrompt() }, ...messages];

    const model = this.getModel();
    
    const requestBody: any = {
      messages: fullMessages.map(m => ({
        role: m.role,
        content: m.content || '',
      })),
      stream: true, // Request streaming response
    };
    
    // Add tools if available
    if (this.tools.length > 0) {
      requestBody.tools = this.tools;
    }
    
    debugLog('Sending request to Workers AI:', model);
    debugLog('Request body:', JSON.stringify({ ...requestBody, messages: `[${requestBody.messages.length} messages]` }));
    
    let response: unknown;
    let lastError: Error | null = null;
    const modelsToTry = [model, ...this.fallbackModels];
    
    for (let i = 0; i < modelsToTry.length; i++) {
      const currentModel = modelsToTry[i];
      try {
        debugLog(`Trying model ${i + 1}/${modelsToTry.length}:`, currentModel);
        response = await this.env.AI.run(currentModel as any, requestBody);
        debugLog('Response received from:', currentModel);
        debugLog('Response constructor:', (response as any)?.constructor?.name);
        debugLog('instanceof ReadableStream:', response instanceof ReadableStream);
        lastError = null;
        break; // Success! Exit the retry loop
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const is502Error = errorMessage.includes('502') || errorMessage.includes('InferenceUpstreamError');
        
        debugLog(`ERROR with model ${currentModel}:`, errorMessage);
        
        // If it's a 502 and we have more models to try, continue to next
        if (is502Error && i < modelsToTry.length - 1) {
          debugLog('502 error detected, trying fallback model...');
          if (this.onStream) {
            this.onStream(`\r\n\x1b[38;5;242m[Model ${currentModel} unavailable, trying fallback...]\x1b[0m\r\n`);
          }
          lastError = error as Error;
          continue;
        }
        
        // Otherwise, this is the last error we'll report
        lastError = error as Error;
        throw error;
      }
    }
    
    if (lastError) {
      throw lastError;
    }

    // Handle streaming response from binding
    if (response instanceof ReadableStream) {
      debugLog('Response is ReadableStream, parsing as stream');
      return this.parseStream(response);
    }

    // Handle non-streaming response (fallback)
    debugLog('Response is NOT a stream, handling as non-streaming');
    const result = response as any;
    
    debugLog('Full result:', JSON.stringify(result, null, 2));
    
    // Check for tool calls
    if (result.choices?.[0]?.message?.tool_calls) {
      const toolCalls = result.choices[0].message.tool_calls;
      debugLog('Found tool calls:', toolCalls.length);
      return {
        content: result.choices[0].message.content || '',
        toolCalls: toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      };
    }
    
    const content = result.choices?.[0]?.message?.content || result.response || '';
    debugLog('Extracted content length:', content.length);
    
    if (content) {
      await this.streamContent(content);
    }

    return { content };
  }

  /**
   * Parse Workers AI streaming response
   * Workers AI streams Server-Sent Events (SSE) format with OpenAI-compatible chunks:
   * data: {"id":"...","choices":[{"delta":{"content":"Hello"}}]}
   * data: {"id":"...","choices":[{"delta":{"tool_calls":[{"index":0,"id":"...","type":"function","function":{"name":"...","arguments":"..."}}]}}]}
   * data: [DONE]
   */
  private async parseStream(stream: ReadableStream): Promise<AgentResponse> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    let chunkCount = 0;
    let sseEventCount = 0;
    let contentChunkCount = 0;
    
    // For accumulating tool calls across multiple chunks
    const toolCallParts = new Map<number, { id?: string; name?: string; arguments: string }>();
    let toolCalls: ToolCall[] = [];

    debugLog('Starting stream parsing (OpenAI format)...');

    try {
      while (true) {
        if (this.abortSignal?.aborted) {
          debugLog('Stream aborted');
          break;
        }

        let readResult: ReadableStreamReadResult<Uint8Array>;
        try {
          readResult = await reader.read();
        } catch (readError) {
          debugLog('ERROR reading from stream:', readError);
          throw readError;
        }

        const { done, value } = readResult;
        
        if (done) {
          debugLog('Stream ended. Total chunks:', chunkCount, 'SSE events:', sseEventCount, 'Content chunks:', contentChunkCount, 'Content length:', content.length);
          break;
        }

        if (!value) {
          continue;
        }

        // Decode the chunk
        const decoded = decoder.decode(value, { stream: true });
        chunkCount++;
        buffer += decoded;
        
        // Process complete lines from buffer
        let lineEnd;
        while ((lineEnd = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);
          
          if (!line) continue;

          // SSE format: data: {...}
          if (line.startsWith('data:')) {
            sseEventCount++;
            const jsonStr = line.slice(5).trim();
            
            if (jsonStr === '[DONE]') {
              debugLog('Received [DONE] signal');
              continue;
            }

            // Log first few SSE events for debugging
            if (sseEventCount <= 5) {
              debugLog(`SSE event ${sseEventCount}:`, jsonStr.slice(0, 300));
            }

            try {
              const chunk = JSON.parse(jsonStr);
              const delta = chunk.choices?.[0]?.delta;
              const finishReason = chunk.choices?.[0]?.finish_reason;
              
              if (finishReason) {
                debugLog('Finish reason:', finishReason);
              }
              
              if (!delta) {
                if (sseEventCount <= 5) debugLog('No delta in chunk');
                continue;
              }
              
              // Handle content (regular text)
              if (delta.content) {
                contentChunkCount++;
                
                // Notify that streaming is starting on first content chunk
                if (!this.hasStarted) {
                  this.hasStarted = true;
                  debugLog('First content chunk received, calling onStreamStart');
                  this.onStreamStart?.();
                }
                
                content += delta.content;
                const formatted = delta.content.replace(/\n/g, '\r\n');
                this.onStream?.(formatted);
                
                // Small delay for visual typing effect
                await new Promise(r => setTimeout(r, 8));
              }
              
              // Handle tool calls
              if (delta.tool_calls && Array.isArray(delta.tool_calls)) {
                debugLog('Tool call delta received:', JSON.stringify(delta.tool_calls));
                
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;
                  
                  if (!toolCallParts.has(index)) {
                    toolCallParts.set(index, { arguments: '' });
                  }
                  
                  const part = toolCallParts.get(index)!;
                  
                  if (tc.id) part.id = tc.id;
                  if (tc.function?.name) part.name = tc.function.name;
                  if (tc.function?.arguments) part.arguments += tc.function.arguments;
                  
                  debugLog(`Tool part [${index}]: id=${tc.id}, name=${tc.function?.name}, args_len=${tc.function?.arguments?.length || 0}`);
                }
              }
            } catch (parseError) {
              debugLog('ERROR parsing SSE chunk:', jsonStr.slice(0, 100));
            }
          }
        }
      }
      
      // Process any remaining buffer
      if (buffer.trim().startsWith('data:')) {
        const jsonStr = buffer.trim().slice(5).trim();
        if (jsonStr && jsonStr !== '[DONE]') {
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) {
              content += delta.content;
              const formatted = delta.content.replace(/\n/g, '\r\n');
              this.onStream?.(formatted);
              contentChunkCount++;
            }
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const index = tc.index || 0;
                if (!toolCallParts.has(index)) {
                  toolCallParts.set(index, { arguments: '' });
                }
                const part = toolCallParts.get(index)!;
                if (tc.id) part.id = tc.id;
                if (tc.function?.name) part.name = tc.function.name;
                if (tc.function?.arguments) part.arguments += tc.function.arguments;
              }
            }
          } catch (e) {
            debugLog('ERROR parsing final buffer:', e);
          }
        }
      }
      
      // Build final tool calls from accumulated parts
      if (toolCallParts.size > 0) {
        debugLog('Building tool calls from', toolCallParts.size, 'parts');
        toolCalls = [];
        const indices = Array.from(toolCallParts.keys()).sort((a, b) => a - b);
        for (const index of indices) {
          const part = toolCallParts.get(index)!;
          if (part.id && part.name) {
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: {
                name: part.name,
                arguments: part.arguments || '{}',
              },
            });
            debugLog('Tool call built:', part.name, 'with args length:', part.arguments.length);
          }
        }
      }
    } catch (error) {
      debugLog('ERROR in parseStream:', error);
      throw error;
    } finally {
      reader.releaseLock();
      debugLog('Stream complete. Content chunks:', contentChunkCount, 'Tool calls:', toolCalls.length, 'Final content length:', content.length);
    }

    return { content, toolCalls: toolCalls.length > 0 ? toolCalls : undefined };
  }

  /**
   * Stream content word by word for typing effect
   */
  private async streamContent(content: string): Promise<void> {
    // Notify that streaming is starting
    if (!this.hasStarted) {
      this.hasStarted = true;
      debugLog('Starting non-streaming content display');
      this.onStreamStart?.();
    }
    
    const words = content.split(/(\s+)/);
    debugLog('Streaming', words.length, 'words');
    
    for (const word of words) {
      if (this.abortSignal?.aborted) return;
      
      const formatted = word.replace(/\n/g, '\r\n');
      this.onStream?.(formatted);
      
      await new Promise(r => setTimeout(r, 12));
    }
  }
}

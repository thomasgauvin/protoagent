/**
 * Other tool implementations (todos, webfetch, sub_agent stub).
 */
import { toolRegistry, todoReadTool, todoWriteTool, webfetchTool, subAgentTool } from './tool-registry.js';

// In-memory TODO storage per session
const todoStore = new Map<string, any[]>();

toolRegistry.register(todoReadTool, async (args, context) => {
  const sessionId = context.sessionId || 'default';
  const todos = todoStore.get(sessionId) || [];
  return JSON.stringify(todos);
});

toolRegistry.register(todoWriteTool, async (args, context) => {
  const sessionId = context.sessionId || 'default';
  const { todos } = args;
  todoStore.set(sessionId, todos as any[]);
  return `TODO list updated with ${(todos as any[]).length} items`;
});

toolRegistry.register(webfetchTool, async (args) => {
  const { url, format = 'text', timeout = 30 } = args;
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), (timeout as number) * 1000);
    
    const response = await fetch(url as string, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    
    if (format === 'text') {
      const text = await response.text();
      return text.slice(0, 100000); // Limit size
    }
    
    if (format === 'markdown') {
      // Simple HTML to text conversion
      const html = await response.text();
      const text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return text.slice(0, 100000);
    }
    
    if (format === 'html') {
      return await response.text();
    }
    
    return 'Unsupported format';
  } catch (err: any) {
    throw new Error(`Failed to fetch ${url}: ${err.message}`);
  }
});

// sub_agent is handled specially in AgentService - this is just the definition
// The actual execution happens in the agent service for parallel execution
toolRegistry.register(subAgentTool, async () => {
  throw new Error('sub_agent should be handled by AgentService for parallel execution');
});

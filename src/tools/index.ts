/**
 * Tool registry — collects all tool definitions and provides a dispatcher.
 *
 * This module now delegates to src/tools/registry.ts for backwards compatibility.
 * New code should import from registry.ts and use ToolRegistry class directly.
 */

// Re-export everything from registry for backwards compatibility
export {
  ToolRegistry,
  defaultRegistry,
  BUILTIN_TOOLS,
  type DynamicTool,
  type ToolCallContext,
  tools,
  registerDynamicTool,
  unregisterDynamicTool,
  clearDynamicTools,
  getAllTools,
  registerDynamicHandler,
  unregisterDynamicHandler,
  handleToolCall,
  setDangerouslySkipPermissions,
  setApprovalHandler,
  clearApprovalHandler,
} from './registry.js';


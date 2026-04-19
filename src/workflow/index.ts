/**
 * Workflow System
 *
 * Provides workflow management for agentic sessions:
 * - Queue: Unidirectional message processing
 * - Loop: Iterative execution with end conditions
 */

// Types
export type {
  WorkflowType,
  WorkflowState,
  WorkflowDiagram,
  Workflow,
  WorkflowResult,
} from './types.js';

export { createDefaultWorkflowState } from './types.js';

// Diagrams
export {
  getWorkflowDiagram,
  getCompactDiagram,
  formatDiagram,
  getNextWorkflowType,
  getAllWorkflowTypes,
  WORKFLOW_METADATA,
} from './diagrams.js';

// Workflows
export { QueueWorkflow, createQueueWorkflow } from './queue-workflow.js';
export {
  LoopWorkflow,
  createLoopWorkflow,
  type LoopWorkflowConfig,
} from './loop-workflow.js';
export {
  CronWorkflow,
  createCronWorkflow,
  type CronWorkflowConfig,
  parseSchedule,
  formatDuration,
  calculateNextRun,
} from './cron-workflow.js';

// Manager
export {
  WorkflowManager,
  createWorkflowManager,
  getWorkflowManager,
  initializeWorkflowManager,
  clearWorkflowManager,
  loadWorkflowState,
  type WorkflowManagerOptions,
} from './manager.js';

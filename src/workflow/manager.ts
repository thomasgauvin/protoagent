/**
 * Workflow Manager
 *
 * Manages the active workflow for a session.
 * Handles workflow switching, state persistence, and event notifications.
 */

import type { Message } from '../agentic-loop.js';
import type { ContentPart } from '../utils/image-utils.js';
import type { ToolRegistry } from '../tools/registry.js';
import type {
  Workflow,
  WorkflowType,
  WorkflowState,
  WorkflowResult,
} from './types.js';
import { QueueWorkflow } from './queue-workflow.js';
import { LoopWorkflow } from './loop-workflow.js';
import { CronWorkflow } from './cron-workflow.js';
import { getNextWorkflowType, getAllWorkflowTypes } from './diagrams.js';

/**
 * Tool definition for setting cron schedule
 * This tool is available when cron workflow is active
 */
export const SET_CRON_SCHEDULE_TOOL = {
  type: 'function' as const,
  function: {
    name: 'set_cron_schedule',
    description:
      'Set the schedule and prompt for the cron workflow. ' +
      'The cron workflow will automatically trigger at the specified interval. ' +
      'Only runs when the tab is visible (never in background).',
    parameters: {
      type: 'object',
      properties: {
        schedule: {
          type: 'string',
          description:
            'The schedule interval. Examples: "30s" (30 seconds), "5m" (5 minutes), "1h" (1 hour), "2h30m". Minimum 5 seconds.',
        },
        prompt: {
          type: 'string',
          description: 'The prompt to send to the agent on each cron tick.',
        },
      },
      required: ['schedule', 'prompt'],
    },
  },
};

type WorkflowChangeCallback = (type: WorkflowType, state: WorkflowState) => void;
type WorkflowCompleteCallback = (type: WorkflowType, summary?: string) => void;

export interface WorkflowManagerOptions {
  initialWorkflow?: WorkflowType;
  onWorkflowChange?: WorkflowChangeCallback;
  onWorkflowComplete?: WorkflowCompleteCallback;
}

/**
 * Manages workflows for a session
 */
export class WorkflowManager {
  private currentWorkflow: Workflow;
  private workflows: Map<WorkflowType, Workflow>;
  private onWorkflowChange?: WorkflowChangeCallback;
  private onWorkflowComplete?: WorkflowCompleteCallback;
  private compactDiagrams: boolean;
  private toolRegistry?: ToolRegistry;
  private cronScheduleHandler?: (args: { schedule: string; prompt: string }) => Promise<string>;

  constructor(options: WorkflowManagerOptions = {}, compactDiagrams = false) {
    this.compactDiagrams = compactDiagrams;
    this.onWorkflowChange = options.onWorkflowChange;
    this.onWorkflowComplete = options.onWorkflowComplete;

    // Initialize all workflow types
    this.workflows = new Map();
    this.workflows.set('queue', new QueueWorkflow(compactDiagrams));
    this.workflows.set('loop', new LoopWorkflow(undefined, compactDiagrams));
    this.workflows.set('cron', new CronWorkflow(undefined, compactDiagrams));

    // Set initial workflow
    const initialType = options.initialWorkflow || 'queue';
    this.currentWorkflow = this.workflows.get(initialType)!;
  }

  /**
   * Get the current workflow type
   */
  getCurrentType(): WorkflowType {
    return this.currentWorkflow.type;
  }

  /**
   * Get the current workflow instance
   */
  getCurrentWorkflow(): Workflow {
    return this.currentWorkflow;
  }

  /**
   * Get the current workflow state
   */
  getState(): WorkflowState {
    return this.currentWorkflow.getState();
  }

  /**
   * Switch to a specific workflow type
   */
  switchWorkflow(type: WorkflowType): void {
    if (type === this.currentWorkflow.type) {
      return;
    }

    // Stop the current workflow
    this.currentWorkflow.stop();

    // Switch to the new workflow
    const newWorkflow = this.workflows.get(type);
    if (!newWorkflow) {
      throw new Error(`Unknown workflow type: ${type}`);
    }

    this.currentWorkflow = newWorkflow;

    // Notify listeners
    this.onWorkflowChange?.(type, this.currentWorkflow.getState());
  }

  /**
   * Cycle to the next workflow type
   * Returns the new workflow type
   */
  cycleWorkflow(): WorkflowType {
    const nextType = getNextWorkflowType(this.currentWorkflow.type);
    this.switchWorkflow(nextType);
    return nextType;
  }

  /**
   * Get all available workflow types
   */
  getAvailableTypes(): WorkflowType[] {
    return getAllWorkflowTypes();
  }

  /**
   * Start the current workflow
   */
  start(state?: Partial<WorkflowState>): void {
    this.currentWorkflow.start(state);
  }

  /**
   * Stop the current workflow
   */
  stop(): void {
    this.currentWorkflow.stop();
  }

  /**
   * Process a user message through the current workflow
   */
  processMessage(content: string | ContentPart[], messages: Message[]): WorkflowResult {
    return this.currentWorkflow.processMessage(content, messages);
  }

  /**
   * Handle an LLM response
   * Returns true if the workflow should continue automatically
   */
  onResponse(response: Message): boolean {
    const shouldContinue = this.currentWorkflow.onResponse(response);

    // If workflow is complete, notify listener
    if (!shouldContinue && this.currentWorkflow.getState().isActive) {
      const state = this.currentWorkflow.getState();
      let summary: string | undefined;

      // Get summary for loop workflows
      if (this.currentWorkflow.type === 'loop') {
        summary = (this.currentWorkflow as LoopWorkflow).getLoopSummary();
      }

      this.onWorkflowComplete?.(this.currentWorkflow.type, summary);
    }

    return shouldContinue;
  }

  /**
   * Get the diagram for the current workflow
   */
  getCurrentDiagram() {
    return this.currentWorkflow.getDiagram();
  }

  /**
   * Reset the current workflow
   */
  reset(): void {
    this.currentWorkflow.reset();
  }

  /**
   * Check if the current workflow is active
   */
  isActive(): boolean {
    return this.currentWorkflow.getState().isActive;
  }

  /**
   * Serialize the current workflow state for persistence
   */
  serialize(): WorkflowState {
    return this.currentWorkflow.getState();
  }

  /**
   * Restore workflow state from persistence
   */
  deserialize(state: WorkflowState): void {
    if (state.type !== this.currentWorkflow.type) {
      this.switchWorkflow(state.type);
    }

    // Restore the state
    if (state.isActive) {
      this.currentWorkflow.start(state);
    } else {
      // For inactive workflows, just update internal state
      Object.assign(this.currentWorkflow.getState(), state);
    }
  }

  /**
   * Update compact diagram setting
   */
  setCompactDiagrams(useCompact: boolean): void {
    this.compactDiagrams = useCompact;

    // Update all workflow instances
    for (const workflow of this.workflows.values()) {
      if ('setCompactDiagram' in workflow) {
        (workflow as any).setCompactDiagram(useCompact);
      }
    }
  }

  /**
   * Get workflow metadata for display
   */
  getWorkflowInfo(type?: WorkflowType): { type: WorkflowType; name: string; description: string } {
    const workflowType = type || this.currentWorkflow.type;
    const workflow = this.workflows.get(workflowType);

    if (!workflow) {
      return { type: 'queue', name: 'Queue', description: 'Process messages one by one' };
    }

    return {
      type: workflowType,
      name: workflow.name,
      description: workflow.description,
    };
  }

  /**
   * Register a tool registry to enable workflow-specific tools
   */
  registerToolRegistry(toolRegistry: ToolRegistry): void {
    this.toolRegistry = toolRegistry;
    this.updateCronTool();
  }

  /**
   * Set the handler for set_cron_schedule tool
   */
  setCronScheduleHandler(handler: (args: { schedule: string; prompt: string }) => Promise<string>): void {
    this.cronScheduleHandler = handler;
    this.updateCronTool();
  }

  /**
   * Update cron tool registration based on current workflow
   */
  private updateCronTool(): void {
    if (!this.toolRegistry) return;

    if (this.currentWorkflow.type === 'cron') {
      // Register the cron schedule tool
      this.toolRegistry.registerDynamicTool(SET_CRON_SCHEDULE_TOOL);
      if (this.cronScheduleHandler) {
        this.toolRegistry.registerDynamicHandler('set_cron_schedule', this.cronScheduleHandler);
      }
    } else {
      // Unregister the cron schedule tool
      this.toolRegistry.unregisterDynamicTool('set_cron_schedule');
      this.toolRegistry.unregisterDynamicHandler('set_cron_schedule');
    }
  }

  /**
   * Get cron-specific state info (if cron workflow is active)
   */
  getCronState(): {
    isConfigured: boolean;
    schedule?: string;
    prompt?: string;
    nextRunAt?: string;
    lastRunAt?: string;
    timeUntilNextMs?: number;
  } | null {
    if (this.currentWorkflow.type !== 'cron') {
      return null;
    }

    const cronWorkflow = this.currentWorkflow as CronWorkflow;
    const state = cronWorkflow.getState();

    return {
      isConfigured: cronWorkflow.isConfigured(),
      schedule: state.cronSchedule,
      prompt: state.cronPrompt,
      nextRunAt: state.cronNextRunAt,
      lastRunAt: state.cronLastRunAt,
      timeUntilNextMs: cronWorkflow.getTimeUntilNextRun() ?? undefined,
    };
  }
}

/** Factory function to create a workflow manager */
export function createWorkflowManager(
  options: WorkflowManagerOptions = {},
  compactDiagrams = false
): WorkflowManager {
  return new WorkflowManager(options, compactDiagrams);
}

/** Per-session workflow managers */
const workflowManagersBySession = new Map<string, WorkflowManager>();

function getSessionKey(sessionId?: string): string {
  return sessionId ?? '__default__';
}

/**
 * Get or create a workflow manager for a session
 */
export function getWorkflowManager(sessionId?: string): WorkflowManager | undefined {
  return workflowManagersBySession.get(getSessionKey(sessionId));
}

/**
 * Initialize a workflow manager for a session
 */
export function initializeWorkflowManager(
  sessionId: string,
  options: WorkflowManagerOptions = {},
  compactDiagrams = false
): WorkflowManager {
  const manager = new WorkflowManager(options, compactDiagrams);
  workflowManagersBySession.set(getSessionKey(sessionId), manager);
  return manager;
}

/**
 * Clear the workflow manager for a session
 */
export function clearWorkflowManager(sessionId?: string): void {
  workflowManagersBySession.delete(getSessionKey(sessionId));
}

/**
 * Load workflow state for a session
 */
export function loadWorkflowState(
  sessionId: string,
  state: WorkflowState,
  options: WorkflowManagerOptions = {},
  compactDiagrams = false
): WorkflowManager {
  const manager = initializeWorkflowManager(sessionId, options, compactDiagrams);
  manager.deserialize(state);
  return manager;
}

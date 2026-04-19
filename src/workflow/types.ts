/**
 * Workflow Types
 *
 * Defines the core workflow abstractions:
 * - Queue: Unidirectional workflow (messages processed one by one)
 * - Loop: Iterative workflow with end condition
 */

import type { Message } from '../agentic-loop.js';
import type { ContentPart } from '../utils/image-utils.js';

export type WorkflowType = 'queue' | 'loop' | 'cron';

export interface WorkflowState {
  type: WorkflowType;
  isActive: boolean;
  /** For loop workflows: the iteration count */
  iterationCount: number;
  /** For loop workflows: the end condition to check */
  endCondition?: string;
  /** For loop workflows: the original user instructions */
  loopInstructions?: string;
  /** For loop workflows: accumulated results from iterations */
  loopResults?: string[];
  /** For cron workflows: the cron schedule expression (e.g., "5m", "30s", "1h") */
  cronSchedule?: string;
  /** For cron workflows: the prompt to send on each cron tick */
  cronPrompt?: string;
  /** For cron workflows: the next scheduled execution time (ISO timestamp) */
  cronNextRunAt?: string;
  /** For cron workflows: the last execution time (ISO timestamp) */
  cronLastRunAt?: string;
}

export interface WorkflowDiagram {
  /** Array of lines representing the diagram (ASCII art) */
  lines: string[];
  /** Width of the diagram in characters */
  width: number;
  /** Height of the diagram in characters */
  height: number;
}

export interface Workflow {
  readonly type: WorkflowType;
  readonly name: string;
  readonly description: string;

  /** Get the current state of this workflow */
  getState(): WorkflowState;

  /** Start the workflow with initial state */
  start(state?: Partial<WorkflowState>): void;

  /** Stop/pause the workflow */
  stop(): void;

  /**
   * Process a user message through this workflow.
   * Returns the message(s) to send to the LLM.
   */
  processMessage(content: string | ContentPart[], messages: Message[]): WorkflowResult;

  /**
   * Called after an LLM response is received.
   * Returns true if the workflow should continue.
   */
  onResponse(response: Message): boolean;

  /** Get the ASCII diagram for this workflow */
  getDiagram(): WorkflowDiagram;

  /** Reset the workflow to initial state */
  reset(): void;
}

export interface WorkflowResult {
  /** The messages to send to the LLM */
  messages: Message[];
  /** Whether this workflow iteration should continue automatically */
  shouldContinue: boolean;
  /** Optional system prompt modification for this iteration */
  systemPromptAddition?: string;
}

/** Default workflow state */
export function createDefaultWorkflowState(type: WorkflowType = 'queue'): WorkflowState {
  return {
    type,
    isActive: false,
    iterationCount: 0,
  };
}

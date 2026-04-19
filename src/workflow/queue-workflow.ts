/**
 * Queue Workflow
 *
 * The default unidirectional workflow.
 * Messages are processed one by one in the order they are received.
 * This is essentially the existing behavior extracted into a workflow class.
 */

import type { Message } from '../agentic-loop.js';
import type {
  Workflow,
  WorkflowState,
  WorkflowResult,
  WorkflowDiagram,
} from './types.js';
import { getWorkflowDiagram, getCompactDiagram } from './diagrams.js';

export class QueueWorkflow implements Workflow {
  readonly type = 'queue' as const;
  readonly name = 'Queue';
  readonly description = 'Process messages one by one in order';

  private state: WorkflowState;
  private useCompactDiagram: boolean;

  constructor(useCompact = false) {
    this.useCompactDiagram = useCompact;
    this.state = {
      type: 'queue',
      isActive: false,
      iterationCount: 0,
    };
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  start(initialState?: Partial<WorkflowState>): void {
    this.state = {
      ...this.state,
      ...initialState,
      type: 'queue',
      isActive: true,
      iterationCount: 0,
    };
  }

  stop(): void {
    this.state.isActive = false;
  }

  processMessage(content: string | any[], messages: Message[]): WorkflowResult {
    // In queue mode, we simply pass the message through
    // The actual queueing happens at the message-queue level
    this.state.iterationCount++;

    return {
      messages: [...messages, { role: 'user', content } as Message],
      shouldContinue: false, // Queue doesn't auto-continue
    };
  }

  onResponse(response: Message): boolean {
    // Queue workflow doesn't auto-continue on response
    // It waits for the next queued message or user input
    return false;
  }

  getDiagram(): WorkflowDiagram {
    return this.useCompactDiagram
      ? getCompactDiagram('queue')
      : getWorkflowDiagram('queue');
  }

  reset(): void {
    this.state = {
      type: 'queue',
      isActive: false,
      iterationCount: 0,
    };
  }

  /**
   * Check if this workflow should use compact diagrams
   */
  setCompactDiagram(useCompact: boolean): void {
    this.useCompactDiagram = useCompact;
  }
}

/** Factory function to create a queue workflow */
export function createQueueWorkflow(useCompact = false): QueueWorkflow {
  return new QueueWorkflow(useCompact);
}

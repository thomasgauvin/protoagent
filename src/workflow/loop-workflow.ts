/**
 * Loop Workflow
 *
 * An iterative workflow where the agent continues executing instructions
 * until a specified end condition is met.
 *
 * The user provides:
 * 1. Instructions for what to do in each iteration
 * 2. An end condition (when to stop looping)
 *
 * The agent will:
 * 1. Execute the instructions
 * 2. Check if the end condition is met
 * 3. If not met, continue to the next iteration
 * 4. If met, exit the loop and report results
 */

import type { Message } from '../agentic-loop.js';
import type {
  Workflow,
  WorkflowState,
  WorkflowResult,
  WorkflowDiagram,
} from './types.js';
import { getWorkflowDiagram, getCompactDiagram } from './diagrams.js';

export interface LoopWorkflowConfig {
  /** The instructions to execute in each iteration */
  instructions: string;
  /** The condition that determines when to stop looping */
  endCondition: string;
  /** Maximum number of iterations to prevent infinite loops */
  maxIterations?: number;
  /** Whether to accumulate results from each iteration */
  accumulateResults?: boolean;
}

export class LoopWorkflow implements Workflow {
  readonly type = 'loop' as const;
  readonly name = 'Loop';
  readonly description = 'Repeat instructions until a condition is met';

  private state: WorkflowState;
  private config: LoopWorkflowConfig;
  private useCompactDiagram: boolean;

  constructor(config?: LoopWorkflowConfig, useCompact = false) {
    this.useCompactDiagram = useCompact;
    this.config = {
      maxIterations: 50,
      accumulateResults: true,
      ...config,
      instructions: config?.instructions || '',
      endCondition: config?.endCondition || '',
    };
    this.state = {
      type: 'loop',
      isActive: false,
      iterationCount: 0,
      endCondition: this.config.endCondition,
      loopInstructions: this.config.instructions,
      loopResults: [],
    };
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  start(initialState?: Partial<WorkflowState>): void {
    this.state = {
      ...this.state,
      ...initialState,
      type: 'loop',
      isActive: true,
      iterationCount: 0,
      loopResults: [],
    };

    // Update config from state if provided
    if (initialState?.endCondition) {
      this.config.endCondition = initialState.endCondition;
    }
    if (initialState?.loopInstructions) {
      this.config.instructions = initialState.loopInstructions;
    }
  }

  stop(): void {
    this.state.isActive = false;
  }

  /**
   * Process a message to start the loop workflow.
   * This parses the user's input to extract instructions and end condition.
   */
  processMessage(content: string | any[], messages: Message[]): WorkflowResult {
    // Parse the message for loop configuration
    // Format: "instructions /until end condition"
    // or with explicit markers
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
    const parsed = this.parseLoopInput(contentStr);

    this.config.instructions = parsed.instructions;
    this.config.endCondition = parsed.endCondition;

    this.state = {
      ...this.state,
      isActive: true,
      iterationCount: 1,
      endCondition: parsed.endCondition,
      loopInstructions: parsed.instructions,
      loopResults: [],
    };

    // Build the system prompt addition for the loop
    const systemPromptAddition = this.buildLoopSystemPrompt();

    return {
      messages: [...messages, { role: 'user', content: parsed.instructions }],
      shouldContinue: true, // Loop starts immediately
      systemPromptAddition,
    };
  }

  /**
   * Called after each LLM response to check if loop should continue
   */
  onResponse(response: Message): boolean {
    if (!this.state.isActive) {
      return false;
    }

    // Store the result if accumulating
    if (this.config.accumulateResults && response.content) {
      this.state.loopResults = [...(this.state.loopResults || []), String(response.content)];
    }

    // Check if we've exceeded max iterations
    const maxIterations = this.config.maxIterations || 50;
    if (this.state.iterationCount >= maxIterations) {
      this.state.isActive = false;
      return false;
    }

    // The LLM should indicate if the end condition is met
    // We'll check for explicit markers in the response
    const content = typeof response.content === 'string' ? response.content : '';

    // Check for completion indicators
    if (this.isEndConditionMet(content)) {
      this.state.isActive = false;
      return false;
    }

    // Continue the loop
    this.state.iterationCount++;
    return true;
  }

  /**
   * Get the next iteration's message
   * This is called when shouldContinue is true
   */
  getNextIterationMessage(): string {
    const iterationCount = this.state.iterationCount;
    const endCondition = this.config.endCondition;
    const instructions = this.config.instructions;

    return `Iteration ${iterationCount}: Continue with the task. Check if: ${endCondition}. If met, indicate completion clearly. Otherwise, continue with: ${instructions}`;
  }

  getDiagram(): WorkflowDiagram {
    return this.useCompactDiagram
      ? getCompactDiagram('loop')
      : getWorkflowDiagram('loop');
  }

  reset(): void {
    this.state = {
      type: 'loop',
      isActive: false,
      iterationCount: 0,
      endCondition: this.config.endCondition,
      loopInstructions: this.config.instructions,
      loopResults: [],
    };
  }

  /**
   * Update loop configuration
   */
  updateConfig(config: Partial<LoopWorkflowConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.endCondition) {
      this.state.endCondition = config.endCondition;
    }
    if (config.instructions) {
      this.state.loopInstructions = config.instructions;
    }
  }

  /**
   * Parse user input to extract loop instructions and end condition
   * Supports formats like:
   *   "do X /until Y"
   *   "do X until Y"
   *   "instructions: X end: Y"
   */
  private parseLoopInput(content: string): { instructions: string; endCondition: string } {
    // Try /until syntax first
    const untilMatch = content.match(/(.+?)\s*(?:\/until|until:)\s*(.+)/i);
    if (untilMatch) {
      return {
        instructions: untilMatch[1].trim(),
        endCondition: untilMatch[2].trim(),
      };
    }

    // Try explicit markers
    const instructionsMatch = content.match(/instructions?:\s*(.+?)(?:end(?:\s*condition)?:\s*(.+))?$/i);
    if (instructionsMatch) {
      return {
        instructions: instructionsMatch[1].trim(),
        endCondition: instructionsMatch[2]?.trim() || 'task is complete',
      };
    }

    // Default: treat the whole thing as instructions with a generic end condition
    return {
      instructions: content.trim(),
      endCondition: 'the task is complete',
    };
  }

  /**
   * Build a system prompt addition that guides the LLM through the loop
   */
  private buildLoopSystemPrompt(): string {
    return `
You are in a LOOP WORKFLOW. You will execute the following instructions repeatedly until the end condition is met.

INSTRUCTIONS: ${this.config.instructions}

END CONDITION: ${this.config.endCondition}

RULES:
1. Execute the instructions in each iteration
2. After each iteration, evaluate if the end condition is met
3. If the end condition IS met, respond with "[LOOP_COMPLETE]" followed by a summary
4. If the end condition IS NOT met, continue with the next iteration
5. Keep track of your progress across iterations
6. You are on iteration ${this.state.iterationCount} of maximum ${this.config.maxIterations}

${this.state.loopResults && this.state.loopResults.length > 0 ? `PREVIOUS RESULTS:\n${this.state.loopResults.join('\n---\n')}` : ''}
`;
  }

  /**
   * Check if the end condition is met based on the LLM response
   */
  private isEndConditionMet(content: string): boolean {
    // Check for explicit completion markers
    const completionMarkers = [
      '[LOOP_COMPLETE]',
      '[COMPLETE]',
      '[DONE]',
      '[END]',
      'loop complete',
      'task complete',
      'completed successfully',
    ];

    const lowerContent = content.toLowerCase();
    return completionMarkers.some((marker) => lowerContent.includes(marker.toLowerCase()));
  }

  /**
   * Get a summary of all iterations for the final response
   */
  getLoopSummary(): string {
    const results = this.state.loopResults || [];
    const iterations = this.state.iterationCount;

    if (results.length === 0) {
      return `Loop completed after ${iterations} iteration(s).`;
    }

    return `Loop completed after ${iterations} iteration(s).\n\nResults by iteration:\n${results.map((r, i) => `\n--- Iteration ${i + 1} ---\n${r}`).join('')}`;
  }

  /**
   * Check if this workflow should use compact diagrams
   */
  setCompactDiagram(useCompact: boolean): void {
    this.useCompactDiagram = useCompact;
  }
}

/** Factory function to create a loop workflow */
export function createLoopWorkflow(
  config?: LoopWorkflowConfig,
  useCompact = false
): LoopWorkflow {
  return new LoopWorkflow(config, useCompact);
}

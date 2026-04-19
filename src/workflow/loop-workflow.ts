/**
 * Loop Workflow
 *
 * An iterative workflow where the agent continues executing instructions
 * until a specified end condition is met.
 *
 * The user provides:
 * 1. Work prompt - instructions for what to do in each iteration
 * 2. Closing condition prompt - criteria to evaluate if work is complete
 * 3. Max iterations - safety limit to prevent infinite loops
 *
 * The workflow automatically detects when an iteration completes (when the agent
 * finishes its work and all tool calls are done), then evaluates the closing condition.
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
  /** The work prompt to execute in each iteration */
  workPrompt: string;
  /** The closing condition prompt - agent evaluates this to determine if done */
  closingConditionPrompt: string;
  /** Maximum number of iterations to prevent infinite loops (default: 10) */
  maxIterations?: number;
  /** Whether to accumulate results from each iteration */
  accumulateResults?: boolean;
}

/**
 * Response format expected from the agent when evaluating closing condition
 */
interface ClosingConditionResponse {
  isComplete: boolean;
  reason: string;
}

export class LoopWorkflow implements Workflow {
  readonly type = 'loop' as const;
  readonly name = 'Loop';
  readonly description = 'Repeat work until closing condition is met';

  private state: WorkflowState;
  private config: LoopWorkflowConfig;
  private useCompactDiagram: boolean;
  /** Tracks what phase we're in */
  private phase: 'idle' | 'working' | 'evaluating' = 'idle';
  /** Tracks if there are pending tool calls */
  private pendingToolCalls: boolean = false;
  /** The last work result from the agent */
  private lastWorkResult: string = '';
  /** Accumulated results from all iterations */
  private iterationResults: string[] = [];

  constructor(config?: LoopWorkflowConfig, useCompact = false) {
    this.useCompactDiagram = useCompact;
    this.config = {
      maxIterations: 10,
      accumulateResults: true,
      workPrompt: config?.workPrompt || '',
      closingConditionPrompt: config?.closingConditionPrompt || '',
    };
    this.state = {
      type: 'loop',
      isActive: false,
      iterationCount: 0,
      endCondition: this.config.closingConditionPrompt,
      loopInstructions: this.config.workPrompt,
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
      iterationCount: initialState?.iterationCount || 0,
      loopResults: initialState?.loopResults || [],
    };

    // Update config from state if provided
    if (initialState?.endCondition) {
      this.config.closingConditionPrompt = initialState.endCondition;
    }
    if (initialState?.loopInstructions) {
      this.config.workPrompt = initialState.loopInstructions;
    }

    this.phase = 'idle';
    this.pendingToolCalls = false;
    this.lastWorkResult = '';
    this.iterationResults = this.state.loopResults || [];
  }

  stop(): void {
    this.state.isActive = false;
    this.phase = 'idle';
    this.pendingToolCalls = false;
  }

  /**
   * Process the initial message to start the loop workflow.
   * This begins the first work iteration.
   */
  processMessage(content: string | any[], messages: Message[]): WorkflowResult {
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

    // Use the content as the work prompt if we don't have one configured
    if (!this.config.workPrompt) {
      this.config.workPrompt = contentStr;
      this.state.loopInstructions = contentStr;
    }

    this.state = {
      ...this.state,
      isActive: true,
      iterationCount: 1,
      loopResults: [],
    };

    this.phase = 'working';
    this.pendingToolCalls = false;
    this.lastWorkResult = '';
    this.iterationResults = [];

    // Build the system prompt addition for the loop
    const systemPromptAddition = this.buildWorkSystemPrompt();

    return {
      messages: [...messages, { role: 'user', content: this.config.workPrompt }],
      shouldContinue: false, // We'll handle continuation via onResponse
      systemPromptAddition,
    };
  }

  /**
   * Called after each LLM response to determine if loop should continue.
   * This tracks tool calls and automatically triggers closing condition evaluation
   * when a work iteration naturally completes.
   */
  onResponse(response: Message): boolean {
    if (!this.state.isActive) {
      return false;
    }

    const content = typeof response.content === 'string' ? response.content : '';

    // Check if we've exceeded max iterations
    const maxIterations = this.config.maxIterations || 10;
    if (this.state.iterationCount >= maxIterations) {
      this.state.isActive = false;
      this.phase = 'idle';
      this.pendingToolCalls = false;
      return false;
    }

    // Check for tool calls in the response
    const hasToolCalls = 'tool_calls' in response && 
      Array.isArray((response as any).tool_calls) && 
      (response as any).tool_calls.length > 0;

    if (hasToolCalls) {
      // Agent is making tool calls - work is in progress
      this.pendingToolCalls = true;
      this.phase = 'working';
      // Store partial result
      this.lastWorkResult = content;
      return false; // Wait for tool results
    }

    // No tool calls in this response
    if (this.pendingToolCalls) {
      // This is a tool result message, not the assistant's work
      // Keep waiting for the assistant to respond after tool results
      return false;
    }

    // Check if this is an assistant message after work completion
    if (response.role === 'assistant') {
      if (this.phase === 'working') {
        // Work iteration has completed - store the result
        this.lastWorkResult = content;
        if (this.config.accumulateResults && content) {
          this.iterationResults.push(content);
          this.state.loopResults = [...this.iterationResults];
        }

        // Transition to evaluating phase
        this.phase = 'evaluating';
        return true; // Trigger closing condition evaluation
      }

      if (this.phase === 'evaluating') {
        // This is the closing condition evaluation response
        const evaluation = this.parseClosingConditionResponse(content);

        if (evaluation.isComplete) {
          // Work is done - stop the loop
          this.state.isActive = false;
          this.phase = 'idle';
          return false;
        } else {
          // Continue to next iteration
          this.phase = 'working';
          this.state.iterationCount++;
          return true; // Trigger next work iteration
        }
      }
    }

    return false;
  }

  /**
   * Signal that tool results have been processed.
   * This is called after all tool results are sent back to the LLM.
   */
  onToolResultsComplete(): void {
    if (!this.state.isActive) return;
    
    // Tool calls are now complete, wait for assistant response
    this.pendingToolCalls = false;
  }

  /**
   * Get the next message to send based on workflow state
   */
  getNextMessage(): { role: 'user'; content: string } | null {
    if (!this.state.isActive) {
      return null;
    }

    if (this.phase === 'evaluating') {
      // Send the closing condition prompt for evaluation
      return {
        role: 'user',
        content: this.buildClosingConditionPrompt(),
      };
    }

    if (this.phase === 'working' && this.state.iterationCount > 1) {
      // Continue with another work iteration (not the first one)
      return {
        role: 'user',
        content: `[Iteration ${this.state.iterationCount}] ${this.config.workPrompt}`,
      };
    }

    return null;
  }

  /**
   * @deprecated Use getNextMessage() instead
   */
  getNextIterationMessage(): string {
    const nextMsg = this.getNextMessage();
    return nextMsg?.content || '';
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
      endCondition: this.config.closingConditionPrompt,
      loopInstructions: this.config.workPrompt,
      loopResults: [],
    };
    this.phase = 'idle';
    this.pendingToolCalls = false;
    this.lastWorkResult = '';
    this.iterationResults = [];
  }

  /**
   * Update loop configuration
   */
  updateConfig(config: Partial<LoopWorkflowConfig>): void {
    if (config.workPrompt !== undefined) {
      this.config.workPrompt = config.workPrompt;
      this.state.loopInstructions = config.workPrompt;
    }
    if (config.closingConditionPrompt !== undefined) {
      this.config.closingConditionPrompt = config.closingConditionPrompt;
      this.state.endCondition = config.closingConditionPrompt;
    }
    if (config.maxIterations !== undefined) {
      this.config.maxIterations = config.maxIterations;
    }
    if (config.accumulateResults !== undefined) {
      this.config.accumulateResults = config.accumulateResults;
    }
  }

  /**
   * Get the current loop configuration
   */
  getConfig(): LoopWorkflowConfig {
    return { ...this.config };
  }

  /**
   * Check if loop is configured and ready to run
   */
  isConfigured(): boolean {
    return !!this.config.workPrompt && !!this.config.closingConditionPrompt;
  }

  /**
   * Get current phase
   */
  getPhase(): 'idle' | 'working' | 'evaluating' {
    return this.phase;
  }

  /**
   * Get current iteration progress
   */
  getProgress(): {
    currentIteration: number;
    maxIterations: number;
    phase: 'idle' | 'working' | 'evaluating';
    percentComplete: number;
  } {
    const maxIterations = this.config.maxIterations || 10;
    const percentComplete = Math.min(
      100,
      (this.state.iterationCount / maxIterations) * 100
    );

    return {
      currentIteration: this.state.iterationCount,
      maxIterations,
      phase: this.phase,
      percentComplete,
    };
  }

  /**
   * Get a summary of all iterations for the final response
   */
  getLoopSummary(): string {
    const results = this.iterationResults;
    const iterations = this.state.iterationCount;
    const maxIterations = this.config.maxIterations || 10;

    let summary = `Loop completed after ${iterations} iteration(s)`;
    if (iterations >= maxIterations) {
      summary += ` (reached max iterations limit of ${maxIterations})`;
    }
    summary += '.';

    if (results.length > 0) {
      summary += `\n\nResults by iteration:\n${results
        .map((r, i) => `\n--- Iteration ${i + 1} ---\n${r}`)
        .join('')}`;
    }

    return summary;
  }

  /**
   * Check if this workflow should use compact diagrams
   */
  setCompactDiagram(useCompact: boolean): void {
    this.useCompactDiagram = useCompact;
  }

  /**
   * Build the system prompt for work iterations
   */
  private buildWorkSystemPrompt(): string {
    return `
You are in a LOOP WORKFLOW. You will execute the following work instructions, making progress in each iteration.

WORK PROMPT: ${this.config.workPrompt}

CLOSING CONDITION: ${this.config.closingConditionPrompt}

CURRENT ITERATION: ${this.state.iterationCount} of ${this.config.maxIterations}

INSTRUCTIONS:
1. Execute the WORK PROMPT to make concrete progress
2. Use tools as needed to accomplish the work
3. Report what you accomplished in this iteration
4. The system will automatically evaluate if the closing condition is met

${this.iterationResults.length > 0 ? `PREVIOUS RESULTS:\n${this.iterationResults.join('\n---\n')}` : ''}
`;
  }

  /**
   * Build the closing condition evaluation prompt
   */
  private buildClosingConditionPrompt(): string {
    return `
Based on the work just completed, evaluate the following closing condition:

CLOSING CONDITION: ${this.config.closingConditionPrompt}

YOUR LAST WORK RESULT:
${this.lastWorkResult || '[No result from previous iteration]'}

ALL PREVIOUS ITERATIONS: ${this.state.iterationCount} completed

Respond in this exact format:
- If the closing condition IS met (work is complete): respond with "[COMPLETE]" followed by a brief summary
- If the closing condition IS NOT met (work should continue): respond with "[CONTINUE]" followed by what still needs to be done

Your response should start with either "[COMPLETE]" or "[CONTINUE]".
`;
  }

  /**
   * Parse the agent's response to the closing condition evaluation
   */
  private parseClosingConditionResponse(content: string): ClosingConditionResponse {
    const trimmed = content.trim().toUpperCase();

    // Check for explicit markers
    if (trimmed.startsWith('[COMPLETE]')) {
      return {
        isComplete: true,
        reason: content.trim(),
      };
    }

    if (trimmed.startsWith('[CONTINUE]')) {
      return {
        isComplete: false,
        reason: content.trim(),
      };
    }

    // Fallback: try to detect based on content keywords
    const completeMarkers = ['COMPLETE', 'DONE', 'FINISHED', 'FINISH', 'ALL TASKS DONE'];
    const continueMarkers = ['CONTINUE', 'MORE WORK', 'NOT DONE', 'STILL NEED'];

    const upperContent = content.toUpperCase();
    const hasComplete = completeMarkers.some((m) => upperContent.includes(m));
    const hasContinue = continueMarkers.some((m) => upperContent.includes(m));

    if (hasComplete && !hasContinue) {
      return { isComplete: true, reason: content };
    }

    // Default to continuing if unclear (safer to continue than stop prematurely)
    return {
      isComplete: false,
      reason: content,
    };
  }
}

/** Factory function to create a loop workflow */
export function createLoopWorkflow(
  config?: LoopWorkflowConfig,
  useCompact = false
): LoopWorkflow {
  return new LoopWorkflow(config, useCompact);
}

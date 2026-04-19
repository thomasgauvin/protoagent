/**
 * Cron Workflow
 *
 * A workflow that automatically triggers at scheduled intervals.
 * When the cron workflow is selected, the agent gets access to a tool
 * to set the schedule and prompt. The cron job only runs when the tab
 * is visible/active (never in the background).
 *
 * Schedule format: simple duration strings
 * - "30s" = every 30 seconds
 * - "5m" = every 5 minutes
 * - "1h" = every 1 hour
 * - "2h30m" = every 2 hours 30 minutes
 */

import type { Message } from '../agentic-loop.js';
import type {
  Workflow,
  WorkflowState,
  WorkflowResult,
  WorkflowDiagram,
} from './types.js';
import { getWorkflowDiagram, getCompactDiagram } from './diagrams.js';

export interface CronWorkflowConfig {
  /** The cron schedule expression (e.g., "5m", "30s", "1h") */
  schedule?: string;
  /** The prompt to send on each cron tick */
  prompt?: string;
}

/**
 * Parse a schedule string into milliseconds
 * Supports: s (seconds), m (minutes), h (hours)
 * Examples: "30s", "5m", "1h", "2h30m"
 */
export function parseSchedule(schedule: string): number {
  const regex = /(\d+)([smh])/gi;
  let totalMs = 0;
  let match;

  while ((match = regex.exec(schedule)) !== null) {
    const value = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();

    switch (unit) {
      case 's':
        totalMs += value * 1000;
        break;
      case 'm':
        totalMs += value * 60 * 1000;
        break;
      case 'h':
        totalMs += value * 60 * 60 * 1000;
        break;
    }
  }

  // Minimum 5 seconds to prevent spam
  return Math.max(totalMs, 5000);
}

/**
 * Format milliseconds into a human-readable string
 */
export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    const remainingSeconds = seconds % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  return `${seconds}s`;
}

/**
 * Calculate the next run time based on the schedule
 */
export function calculateNextRun(schedule: string, fromTime?: Date): Date {
  const intervalMs = parseSchedule(schedule);
  const baseTime = fromTime || new Date();
  return new Date(baseTime.getTime() + intervalMs);
}

export class CronWorkflow implements Workflow {
  readonly type = 'cron' as const;
  readonly name = 'Cron';
  readonly description = 'Scheduled recurring prompts';

  private state: WorkflowState;
  private config: CronWorkflowConfig;
  private useCompactDiagram: boolean;

  constructor(config?: CronWorkflowConfig, useCompact = false) {
    this.useCompactDiagram = useCompact;
    this.config = {
      schedule: config?.schedule || '',
      prompt: config?.prompt || '',
    };
    this.state = {
      type: 'cron',
      isActive: false,
      iterationCount: 0,
      cronSchedule: this.config.schedule,
      cronPrompt: this.config.prompt,
    };
  }

  getState(): WorkflowState {
    return { ...this.state };
  }

  start(initialState?: Partial<WorkflowState>): void {
    this.state = {
      ...this.state,
      ...initialState,
      type: 'cron',
      isActive: true,
      iterationCount: 0,
    };

    // Update config from state if provided
    if (initialState?.cronSchedule) {
      this.config.schedule = initialState.cronSchedule;
    }
    if (initialState?.cronPrompt) {
      this.config.prompt = initialState.cronPrompt;
    }

    // Calculate next run time if schedule is set
    if (this.config.schedule) {
      this.state.cronNextRunAt = calculateNextRun(this.config.schedule).toISOString();
    }
  }

  stop(): void {
    this.state.isActive = false;
  }

  /**
   * Process a message in cron workflow.
   * The initial message sets up the cron job configuration.
   */
  processMessage(content: string, messages: Message[]): WorkflowResult {
    // If schedule and prompt are already set, this is a cron-triggered run
    if (this.config.schedule && this.config.prompt) {
      this.state.iterationCount++;
      this.state.cronLastRunAt = new Date().toISOString();

      // Calculate next run time
      this.state.cronNextRunAt = calculateNextRun(this.config.schedule).toISOString();

      return {
        messages: [...messages, { role: 'user', content: this.config.prompt }],
        shouldContinue: false,
      };
    }

    // Otherwise, this is initial setup - just pass through the message
    // The agent should use the set_cron_schedule tool to configure the cron job
    return {
      messages: [...messages, { role: 'user', content }],
      shouldContinue: false,
    };
  }

  /**
   * Called after an LLM response is received.
   * Cron workflow doesn't auto-continue on response.
   */
  onResponse(response: Message): boolean {
    // Cron workflow doesn't auto-continue
    // The next iteration happens via the cron timer when tab is visible
    return false;
  }

  getDiagram(): WorkflowDiagram {
    return this.useCompactDiagram
      ? getCompactDiagram('cron')
      : getWorkflowDiagram('cron');
  }

  reset(): void {
    this.state = {
      type: 'cron',
      isActive: false,
      iterationCount: 0,
      cronSchedule: this.config.schedule,
      cronPrompt: this.config.prompt,
    };
  }

  /**
   * Update cron configuration (called via tool)
   */
  setSchedule(schedule: string, prompt: string): void {
    this.config.schedule = schedule;
    this.config.prompt = prompt;
    this.state.cronSchedule = schedule;
    this.state.cronPrompt = prompt;

    // Calculate next run time
    this.state.cronNextRunAt = calculateNextRun(schedule).toISOString();
  }

  /**
   * Get the cron configuration
   */
  getConfig(): CronWorkflowConfig {
    return { ...this.config };
  }

  /**
   * Check if the cron is configured (has schedule and prompt)
   */
  isConfigured(): boolean {
    return !!this.config.schedule && !!this.config.prompt;
  }

  /**
   * Get the time remaining until next run in milliseconds
   */
  getTimeUntilNextRun(): number | null {
    if (!this.state.cronNextRunAt || !this.state.isActive) {
      return null;
    }
    const nextRun = new Date(this.state.cronNextRunAt);
    const now = new Date();
    return Math.max(0, nextRun.getTime() - now.getTime());
  }

  /**
   * Check if it's time to run the next iteration
   */
  shouldTrigger(): boolean {
    if (!this.state.isActive || !this.config.schedule || !this.config.prompt) {
      return false;
    }

    const timeUntil = this.getTimeUntilNextRun();
    return timeUntil !== null && timeUntil <= 0;
  }

  /**
   * Trigger the next cron iteration
   * Returns the prompt to send, or null if not ready
   */
  trigger(): string | null {
    if (!this.shouldTrigger()) {
      return null;
    }

    this.state.iterationCount++;
    this.state.cronLastRunAt = new Date().toISOString();

    // Calculate next run time
    if (this.config.schedule) {
      this.state.cronNextRunAt = calculateNextRun(this.config.schedule).toISOString();
    }

    return this.config.prompt || null;
  }

  /**
   * Check if this workflow should use compact diagrams
   */
  setCompactDiagram(useCompact: boolean): void {
    this.useCompactDiagram = useCompact;
  }
}

/** Factory function to create a cron workflow */
export function createCronWorkflow(
  config?: CronWorkflowConfig,
  useCompact = false
): CronWorkflow {
  return new CronWorkflow(config, useCompact);
}

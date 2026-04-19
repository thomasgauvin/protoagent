/**
 * Workflow Diagrams
 *
 * ASCII art diagrams for each workflow type.
 * These are displayed in the right sidebar to visualize the current workflow.
 */

import type { WorkflowDiagram, WorkflowType } from './types.js';

/**
 * Diagram for Queue workflow (unidirectional)
 *
 * Shows messages flowing in a queue, processed one by one.
 */
const QUEUE_DIAGRAM: WorkflowDiagram = {
  lines: [
    '  ┌─────┐  ┌─────┐  ┌─────┐',
    '  │ Msg │→│ Msg │→│ Msg │',
    '  └─────┘  └─────┘  └─────┘',
    '     ↓        ↓        ↓',
    '  ┌─────────────────────────┐',
    '  │      Agent Process      │',
    '  └─────────────────────────┘',
  ],
  width: 28,
  height: 6,
};

/**
 * Diagram for Loop workflow (iterative with condition check)
 *
 * Shows the agent looping until a condition is met.
 */
const LOOP_DIAGRAM: WorkflowDiagram = {
  lines: [
    '  ┌──────────────────┐',
    '  │   Instructions   │',
    '  └────────┬─────────┘',
    '           ↓',
    '  ┌──────────────────┐',
    '  │   Do work        │',
    '  └────────┬─────────┘',
    '           ↓',
    '     ┌──────────┐',
    '     │  Done?   │──No──┐',
    '     └────┬─────┘      │',
    '          │Yes         │',
    '          ↓            │',
    '     [Complete]←───────┘',
  ],
  width: 25,
  height: 11,
};

/**
 * Diagram for Cron workflow (scheduled recurring execution)
 *
 * Shows the agent running at scheduled intervals.
 */
const CRON_DIAGRAM: WorkflowDiagram = {
  lines: [
    '       ┌──────────┐',
    '       │ Schedule │',
    '       └────┬─────┘',
    '            ↓',
    '       ┌──────────┐',
    '       │  Wait... │',
    '       └────┬─────┘',
    '            ↓',
    '     ┌──────────┐',
    '     │  Time?   │──No──┐',
    '     └────┬─────┘      │',
    '          │Yes         │',
    '          ↓            │',
    '     ┌──────────┐      │',
    '     │  Prompt  │──────┘',
    '     └──────────┘',
  ],
  width: 22,
  height: 13,
};

/**
 * Get the diagram for a workflow type
 */
export function getWorkflowDiagram(type: WorkflowType): WorkflowDiagram {
  switch (type) {
    case 'queue':
      return QUEUE_DIAGRAM;
    case 'loop':
      return LOOP_DIAGRAM;
    case 'cron':
      return CRON_DIAGRAM;
    default:
      return QUEUE_DIAGRAM;
  }
}

/**
 * Format a diagram for display in a constrained width.
 * Returns lines that fit within maxWidth.
 */
export function formatDiagram(
  diagram: WorkflowDiagram,
  maxWidth: number,
  highlightNode?: number
): string[] {
  // If diagram is wider than maxWidth, we need to truncate or scale
  if (diagram.width > maxWidth) {
    // Simple truncation - remove from the right
    return diagram.lines.map((line) => line.slice(0, maxWidth));
  }

  // Center the diagram if there's extra space
  const padding = Math.floor((maxWidth - diagram.width) / 2);
  const paddingStr = ' '.repeat(padding);

  return diagram.lines.map((line) => paddingStr + line);
}

/**
 * Get a compact version of the diagram for very small spaces
 */
export function getCompactDiagram(type: WorkflowType): WorkflowDiagram {
  switch (type) {
    case 'queue':
      return {
        lines: [
          ' ┌─┐ ┌─┐ ┌─┐',
          ' │A│→│B│→│C│',
          ' └─┘ └─┘ └─┘',
        ],
        width: 12,
        height: 3,
      };
    case 'loop':
      return {
        lines: [
          '  ┌──────┐',
          '  │ Work │',
          '  └──┬───┘',
          '     ↓',
          '   ┌────┐',
          '   │ ✓? │─→',
          '   └────┘',
        ],
        width: 12,
        height: 7,
      };
    case 'cron':
      return {
        lines: [
          '  ┌──────┐',
          '  │ ⏰   │',
          '  └──┬───┘',
          '     ↓',
          '   ┌────┐',
          '   │Run │',
          '   └──┬─┘',
          '      ↓',
   '   [Wait]',
        ],
        width: 10,
        height: 8,
      };
    default:
      return getCompactDiagram('queue');
  }
}

/**
 * Available workflows with their metadata
 */
export const WORKFLOW_METADATA = {
  queue: {
    type: 'queue' as const,
    name: 'Queue',
    description: 'Process messages one by one in order',
    shortcut: 'Tab',
  },
  loop: {
    type: 'loop' as const,
    name: 'Loop',
    description: 'Repeat instructions until a condition is met',
    shortcut: 'Tab',
  },
  cron: {
    type: 'cron' as const,
    name: 'Cron',
    description: 'Scheduled recurring prompts',
    shortcut: 'Tab',
  },
};

/**
 * Get the next workflow type in the cycle
 */
export function getNextWorkflowType(current: WorkflowType): WorkflowType {
  const types: WorkflowType[] = ['queue', 'loop', 'cron'];
  const index = types.indexOf(current);
  return types[(index + 1) % types.length];
}

/**
 * Get all available workflow types
 */
export function getAllWorkflowTypes(): WorkflowType[] {
  return ['queue', 'loop', 'cron'];
}

/**
 * RightSidebar — right-hand panel showing workflow diagram, message queue, and usage stats.
 *
 * - Workflow diagram (visual representation of current workflow type)
 * - Workflow type indicator
 * - Queued messages (run after current task completes)
 * - Interject messages (spliced into next LLM iteration)
 * - Usage stats (in, out, ctx, cost)
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
  dim,
  StyledText,
} from '@opentui/core'
import { ScrollBoxRenderable } from '@opentui/core'
import type { QueuedMessage } from '../message-queue.js'
import { COLORS } from './theme.js'
import type { WorkflowType, WorkflowDiagram } from '../workflow/types.js'
import { getCompactDiagram } from '../workflow/diagrams.js'
import { formatDuration } from '../workflow/cron-workflow.js'

export class RightSidebar {
  private renderer: CliRenderer
  public readonly root: BoxRenderable
  private queueScrollBox: ScrollBoxRenderable
  private queueHeaderText: TextRenderable

  // Workflow section
  private workflowBox: BoxRenderable
  private workflowHeaderText: TextRenderable
  private workflowDiagramText: TextRenderable
  private workflowTypeText: TextRenderable

  // Cron info section
  private cronInfoBox: BoxRenderable
  private cronScheduleText: TextRenderable
  private cronPromptText: TextRenderable
  private cronCountdownText: TextRenderable

  // Usage stats
  private usageText: TextRenderable

  private queueRows: BoxRenderable[] = []
  private currentWorkflowType: WorkflowType = 'queue'

  constructor(renderer: CliRenderer) {
    this.renderer = renderer

    // Calculate responsive sidebar width based on terminal size
    const termWidth = process.stdout.columns || 120
    const sidebarWidth = termWidth >= 250 ? 48 : termWidth >= 150 ? 38 : 30

    this.root = new BoxRenderable(renderer, {
      id: 'right-sidebar-root',
      flexDirection: 'column',
      flexShrink: 0,
      width: sidebarWidth,
      border: ['left'],
      borderColor: COLORS.border,
    })

    // ── Workflow section (top) ────────────────────────────
    this.workflowBox = new BoxRenderable(renderer, {
      id: 'workflow-box',
      flexDirection: 'column',
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
      border: ['bottom'],
      borderColor: COLORS.border,
    })

    // Workflow header with type
    const headerRow = new BoxRenderable(renderer, {
      id: 'workflow-header-row',
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 1,
    })

    this.workflowHeaderText = new TextRenderable(renderer, {
      id: 'workflow-header-text',
      content: t`${bold('Workflow')}`,
    })
    headerRow.add(this.workflowHeaderText)

    this.workflowTypeText = new TextRenderable(renderer, {
      id: 'workflow-type-text',
      content: t`${fg(COLORS.primary)('Queue')}`,
    })
    headerRow.add(this.workflowTypeText)

    this.workflowBox.add(headerRow)

    // Workflow diagram (compact)
    this.workflowDiagramText = new TextRenderable(renderer, {
      id: 'workflow-diagram-text',
      content: t``, // Will be populated by setWorkflowDiagram
    })
    this.workflowBox.add(this.workflowDiagramText)

    this.root.add(this.workflowBox)

    // ── Cron info section (hidden by default) ─────────────
    this.cronInfoBox = new BoxRenderable(renderer, {
      id: 'cron-info-box',
      flexDirection: 'column',
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
      border: ['bottom'],
      borderColor: COLORS.border,
    })
    // Initially hide the cron info box by setting flexShrink to 0 and not adding it
    // We'll add/remove it dynamically

    const cronHeaderText = new TextRenderable(renderer, {
      id: 'cron-header-text',
      content: t`${bold('Cron Job')}`,
      marginBottom: 1,
    })
    this.cronInfoBox.add(cronHeaderText)

    this.cronScheduleText = new TextRenderable(renderer, {
      id: 'cron-schedule-text',
      content: t``, // Will be populated by setCronInfo
    })
    this.cronInfoBox.add(this.cronScheduleText)

    this.cronPromptText = new TextRenderable(renderer, {
      id: 'cron-prompt-text',
      content: t``, // Will be populated by setCronInfo
    })
    this.cronInfoBox.add(this.cronPromptText)

    this.cronCountdownText = new TextRenderable(renderer, {
      id: 'cron-countdown-text',
      content: t``, // Will be populated by setCronInfo
      marginTop: 1,
    })
    this.cronInfoBox.add(this.cronCountdownText)

    // Add cron info box after workflow box (initially hidden via empty content)
    this.root.add(this.cronInfoBox)

    // ── Queue header ──────────────────────────────────────
    const queueHeaderBox = new BoxRenderable(renderer, {
      id: 'queue-header-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
    })
    this.queueHeaderText = new TextRenderable(renderer, {
      id: 'queue-header-text',
      content: t`${bold('Queue')} ${fg(COLORS.dim)('(0)')}`,
    })
    queueHeaderBox.add(this.queueHeaderText)
    this.root.add(queueHeaderBox)

    // ── Queue scroll list ─────────────────────────────────
    this.queueScrollBox = new ScrollBoxRenderable(renderer, {
      id: 'queue-scroll',
      flexGrow: 1,
      flexShrink: 1,
    })
    this.queueScrollBox.onMouseDown = () => {
      this.queueScrollBox.focus()
    }
    this.root.add(this.queueScrollBox)

    // ── Usage stats (bottom) ──────────────────────────────
    const usageBox = new BoxRenderable(renderer, {
      id: 'usage-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
      border: ['top'],
      borderColor: COLORS.border,
    })
    this.usageText = new TextRenderable(renderer, {
      id: 'usage-text',
      content: t`${fg(COLORS.dim)('in:0  out:0  ctx:0%  cost:$0.0000')}`,
    })
    usageBox.add(this.usageText)
    this.root.add(usageBox)

    // Show initial states
    this._redrawQueue([], [])
    this._updateWorkflowDiagram('queue')
  }

  /**
   * Set the current workflow type and update the diagram
   */
  setWorkflowType(type: WorkflowType, isActive: boolean = false): void {
    this.currentWorkflowType = type

    // Update type text
    const typeName = type.charAt(0).toUpperCase() + type.slice(1)
    const color = isActive ? COLORS.green : COLORS.primary
    const displayText = typeName + (isActive ? ' ●' : '')
    this.workflowTypeText.content = t`${fg(color)(displayText)}`

    // Update diagram
    this._updateWorkflowDiagram(type)

    this.renderer.requestRender()
  }

  /**
   * Update the workflow diagram display
   */
  private _updateWorkflowDiagram(type: WorkflowType): void {
    const diagram = getCompactDiagram(type)

    // Simply display the diagram as plain text using template literal
    this.workflowDiagramText.content = t`${diagram.lines.join('\n')}`
  }

  /**
   * Show a temporary hint about switching workflows
   */
  showWorkflowSwitchHint(): void {
    const hintText = t`${fg(COLORS.dim)('Press Tab to switch workflow')}`
    // We could add a temporary overlay or update the header temporarily
    // For now, just flash the type text
    const originalContent = this.workflowTypeText.content
    this.workflowTypeText.content = t`${fg(COLORS.yellow)('Tab →')}`

    setTimeout(() => {
      this.workflowTypeText.content = originalContent
      this.renderer.requestRender()
    }, 1000)

    this.renderer.requestRender()
  }

  setQueue(queued: QueuedMessage[], interjects: QueuedMessage[]): void {
    this._redrawQueue(queued, interjects)
    const total = queued.length + interjects.length
    this.queueHeaderText.content = t`${bold('Queue')} ${fg(COLORS.dim)(`(${total})`)}`
  }

  clearQueuedMessages(): void {
    this.setQueue([], [])
  }

  setUsage(inputTokens: number, outputTokens: number, contextPercent: number, cost: number): void {
    this.usageText.content = t`${fg(COLORS.dim)(`in:${inputTokens}  out:${outputTokens}  ctx:${contextPercent.toFixed(0)}%  cost:$${cost.toFixed(4)}`)}`
  }

  /**
   * Display cron job info in the sidebar
   */
  setCronInfo(info: {
    isConfigured: boolean;
    schedule?: string;
    prompt?: string;
    nextRunAt?: string;
    lastRunAt?: string;
    timeUntilNextMs?: number;
  }): void {
    if (!info.isConfigured) {
      // Hide by clearing content (box is still there but empty)
      this.cronScheduleText.content = t``
      this.cronPromptText.content = t``
      this.cronCountdownText.content = t``
      this.renderer.requestRender()
      return
    }

    // Update schedule text
    const scheduleStr = info.schedule || 'Not set'
    this.cronScheduleText.content = t`${fg(COLORS.primary)('Every:')} ${scheduleStr}`

    // Update prompt text (truncated)
    const promptStr = info.prompt || 'Not set'
    const truncatedPrompt = promptStr.length > 25 ? promptStr.slice(0, 22) + '…' : promptStr
    this.cronPromptText.content = t`${fg(COLORS.dim)('Prompt:')} ${truncatedPrompt}`

    // Update countdown
    let countdownStr = ''
    if (info.timeUntilNextMs !== undefined && info.timeUntilNextMs > 0) {
      countdownStr = `Next: ${formatDuration(info.timeUntilNextMs)}`
    } else if (info.timeUntilNextMs !== undefined && info.timeUntilNextMs <= 0) {
      countdownStr = 'Next: Ready!'
    } else {
      countdownStr = 'Next: Not scheduled'
    }
    this.cronCountdownText.content = t`${fg(COLORS.yellow)(countdownStr)}`

    this.renderer.requestRender()
  }

  /**
   * Hide cron info from the sidebar
   */
  clearCronInfo(): void {
    // Hide by clearing content
    this.cronScheduleText.content = t``
    this.cronPromptText.content = t``
    this.cronCountdownText.content = t``
    this.renderer.requestRender()
  }

  private _getContentText(content: QueuedMessage['content']): string {
    return content;
  }

  private _redrawQueue(queued: QueuedMessage[], interjects: QueuedMessage[]): void {
    for (const row of this.queueRows) {
      this.queueScrollBox.remove(row.id)
      row.destroyRecursively()
    }
    this.queueRows = []

    if (queued.length === 0 && interjects.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'queue-empty',
        content: t`${fg(COLORS.dim)('Empty')}`,
      })
      const emptyBox = new BoxRenderable(this.renderer, {
        id: 'queue-empty-box',
        paddingLeft: 2,
        paddingTop: 1,
      })
      emptyBox.add(emptyText)
      this.queueScrollBox.add(emptyBox)
      this.queueRows.push(emptyBox)
      return
    }

    let rowIdx = 0

    // Interjects first (spliced into next LLM iteration)
    for (const msg of interjects) {
      const contentText = this._getContentText(msg.content)
      const label = contentText.length > 19 ? contentText.slice(0, 19) + '…' : contentText
      const prefixChunk = t`${fg(COLORS.red)('!! ')}`
      const labelChunk = t`${fg(COLORS.yellow)(label)}`
      const rowContent = new StyledText([...prefixChunk.chunks, ...labelChunk.chunks])

      const rowText = new TextRenderable(this.renderer, {
        id: `queue-interject-text-${rowIdx}`,
        content: rowContent,
      })
      const rowBox = new BoxRenderable(this.renderer, {
        id: `queue-interject-${rowIdx}`,
        paddingLeft: 2,
        paddingRight: 1,
      })
      rowBox.add(rowText)
      this.queueScrollBox.add(rowBox)
      this.queueRows.push(rowBox)
      rowIdx++
    }

    // Then queued messages (run after current task completes)
    for (const msg of queued) {
      const contentText = this._getContentText(msg.content)
      const label = contentText.length > 20 ? contentText.slice(0, 20) + '…' : contentText
      const prefixChunk = t`${fg(COLORS.blue)('→ ')}`
      const labelChunk = t`${fg(COLORS.white)(label)}`
      const rowContent = new StyledText([...prefixChunk.chunks, ...labelChunk.chunks])

      const rowText = new TextRenderable(this.renderer, {
        id: `queue-msg-text-${rowIdx}`,
        content: rowContent,
      })
      const rowBox = new BoxRenderable(this.renderer, {
        id: `queue-msg-${rowIdx}`,
        paddingLeft: 2,
        paddingRight: 1,
      })
      rowBox.add(rowText)
      this.queueScrollBox.add(rowBox)
      this.queueRows.push(rowBox)
      rowIdx++
    }
  }
}

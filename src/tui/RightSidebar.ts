/**
 * RightSidebar — right-hand panel showing workflow diagram, TODOs, and contextual workflow info.
 *
 * - Top section: workflow diagram and type indicator
 * - Middle section: scrollable todo list (click to cycle status)
 * - Bottom section: CONTEXTUAL based on workflow type:
 *   - Queue: queued & interject messages
 *   - Cron: schedule info and countdown
 *   - Loop: iteration progress and config
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
  StyledText,
} from '@opentui/core'
import { ScrollBoxRenderable } from '@opentui/core'
import type { TodoItem } from '../tools/todo.js'
import type { QueuedMessage } from '../message-queue.js'
import { COLORS } from './theme.js'
import type { WorkflowType } from '../workflow/types.js'
import { getCompactDiagram } from '../workflow/diagrams.js'

const STATUS_ICONS: Record<TodoItem['status'], string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
  cancelled: '[-]',
}

const STATUS_COLORS: Record<TodoItem['status'], string> = {
  pending: COLORS.white,
  in_progress: COLORS.yellow,
  completed: COLORS.primary,
  cancelled: COLORS.gray,
}

const PRIORITY_COLORS: Record<TodoItem['priority'], string> = {
  high: COLORS.red,
  medium: COLORS.yellow,
  low: COLORS.gray,
}

const STATUS_ORDER: TodoItem['status'][] = ['pending', 'in_progress', 'completed', 'cancelled']

export interface RightSidebarCallbacks {
  onAdd: (content: string) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, updates: Partial<Pick<TodoItem, 'status' | 'priority'>>) => void
}

// Contextual info for cron workflow
interface CronInfo {
  schedule?: string
  prompt?: string
  nextRunAt?: string
  lastRunAt?: string
  timeUntilNextMs?: number
}

// Contextual info for loop workflow
interface LoopInfo {
  workPrompt?: string
  closingCondition?: string
  maxIterations?: number
  currentIteration?: number
  isActive?: boolean
  phase?: 'working' | 'evaluating' | 'idle'
}

export class RightSidebar {
  private renderer: CliRenderer
  public readonly root: BoxRenderable
  private todoScrollBox: ScrollBoxRenderable
  private todoHeaderText: TextRenderable
  private contextualScrollBox: ScrollBoxRenderable
  private contextualHeaderText: TextRenderable
  private usageText: TextRenderable

  // Workflow section
  private workflowBox: BoxRenderable
  private workflowHeaderText: TextRenderable
  private workflowDiagramText: TextRenderable
  private workflowTypeText: TextRenderable

  private todos: TodoItem[] = []
  private todoRows: BoxRenderable[] = []
  private contextualRows: BoxRenderable[] = []
  private callbacks: RightSidebarCallbacks
  private currentWorkflowType: WorkflowType = 'queue'

  // Store current contextual data
  private currentQueue: QueuedMessage[] = []
  private currentInterjects: QueuedMessage[] = []
  private currentCronInfo: CronInfo = {}
  private currentLoopInfo: LoopInfo = {}

  constructor(renderer: CliRenderer, callbacks: RightSidebarCallbacks) {
    this.renderer = renderer
    this.callbacks = callbacks

    this.root = new BoxRenderable(renderer, {
      id: 'todo-sidebar-root',
      flexDirection: 'column',
      flexShrink: 0,
      flexGrow: 1,
      backgroundColor: COLORS.darkBg,
      width: 30,
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
      content: t``, // Will be populated by setWorkflowType
    })
    this.workflowBox.add(this.workflowDiagramText)

    this.root.add(this.workflowBox)

    // Initialize with default workflow diagram
    this._updateWorkflowDiagram('queue')

    // ── TODO section ──────────────────────────────────────

    // Todo header
    const todoHeaderBox = new BoxRenderable(renderer, {
      id: 'todo-header-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
    })
    this.todoHeaderText = new TextRenderable(renderer, {
      id: 'todo-header-text',
      content: t`${bold('TODOs')} ${fg(COLORS.dim)('(0)')}`,
    })
    todoHeaderBox.add(this.todoHeaderText)
    this.root.add(todoHeaderBox)

    // Todo scroll list - takes remaining space
    this.todoScrollBox = new ScrollBoxRenderable(renderer, {
      id: 'todo-scroll',
      flexGrow: 1,
      flexShrink: 1,
    })
    // Enable mouse wheel scrolling on the scroll box
    this.todoScrollBox.onMouseDown = () => {
      this.todoScrollBox.focus()
    }
    this.root.add(this.todoScrollBox)

    // ── Contextual section (bottom - changes based on workflow type) ─────────────────────────

    // Divider + Contextual header
    const contextualHeaderBox = new BoxRenderable(renderer, {
      id: 'contextual-header-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
      border: ['top'],
      borderColor: COLORS.border,
    })
    this.contextualHeaderText = new TextRenderable(renderer, {
      id: 'contextual-header-text',
      content: t`${bold('Queue')} ${fg(COLORS.dim)('(0)')}`,
    })
    contextualHeaderBox.add(this.contextualHeaderText)
    this.root.add(contextualHeaderBox)

    // Contextual scroll list - fixed max height but scrollable
    this.contextualScrollBox = new ScrollBoxRenderable(renderer, {
      id: 'contextual-scroll',
      flexShrink: 0,
      maxHeight: 10,
    })
    // Enable mouse wheel scrolling on the scroll box
    this.contextualScrollBox.onMouseDown = () => {
      this.contextualScrollBox.focus()
    }
    this.root.add(this.contextualScrollBox)

    // Usage row
    const usageBox = new BoxRenderable(renderer, {
      id: 'todo-usage-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
      border: ['top'],
      borderColor: COLORS.border,
    })
    this.usageText = new TextRenderable(renderer, {
      id: 'todo-usage-text',
      content: t``,
    })
    usageBox.add(this.usageText)
    this.root.add(usageBox)
  }

  setTodos(todos: TodoItem[]): void {
    this.todos = todos
    this._redrawTodos()
    this.todoHeaderText.content = t`${bold('TODOs')} ${fg(COLORS.dim)(`(${todos.length})`)}`
  }

  setQueue(queued: QueuedMessage[], interjects: QueuedMessage[]): void {
    this.currentQueue = queued
    this.currentInterjects = interjects
    if (this.currentWorkflowType === 'queue') {
      this._redrawContextual()
    }
  }

  setCronInfo(info: CronInfo): void {
    this.currentCronInfo = info
    if (this.currentWorkflowType === 'cron') {
      this._redrawContextual()
    }
  }

  setLoopInfo(info: LoopInfo): void {
    this.currentLoopInfo = info
    if (this.currentWorkflowType === 'loop') {
      this._redrawContextual()
    }
  }

  setUsage(usage: { inputTokens?: number; outputTokens?: number; contextPercent?: number } | null, totalCost: number): void {
    if (!usage) {
      this.usageText.content = t``
      return
    }
    const parts: string[] = []
    if (usage.inputTokens) parts.push(`in:${usage.inputTokens}`)
    if (usage.outputTokens) parts.push(`out:${usage.outputTokens}`)
    if (usage.contextPercent) parts.push(`ctx:${usage.contextPercent.toFixed(0)}%`)
    parts.push(`$${totalCost.toFixed(4)}`)
    this.usageText.content = t`${fg(COLORS.dim)(parts.join(' · '))}`
  }

  /**
   * Set the current workflow type and update the diagram and contextual section
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

    // Update contextual section header and content
    this._redrawContextual()

    this.renderer.requestRender()
  }

  /**
   * Update the workflow diagram display
   */
  private _updateWorkflowDiagram(type: WorkflowType): void {
    const diagram = getCompactDiagram(type)
    this.workflowDiagramText.content = t`${diagram.lines.join('\n')}`
  }

  private _redrawTodos(): void {
    for (const row of this.todoRows) {
      this.todoScrollBox.remove(row.id)
      row.destroyRecursively()
    }
    this.todoRows = []

    if (this.todos.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'todo-empty',
        content: t`${fg(COLORS.dim)('No todos')}`,
      })
      const emptyBox = new BoxRenderable(this.renderer, {
        id: 'todo-empty-box',
        paddingLeft: 2,
        paddingTop: 1,
      })
      emptyBox.add(emptyText)
      this.todoScrollBox.add(emptyBox)
      this.todoRows.push(emptyBox)
      return
    }

    for (let i = 0; i < this.todos.length; i++) {
      const todo = this.todos[i]

      const statusColor = STATUS_COLORS[todo.status]
      const priorityColor = PRIORITY_COLORS[todo.priority]

      const icon = STATUS_ICONS[todo.status]
      const pri = `[${todo.priority[0].toUpperCase()}]`
      const label = todo.content.length > 22 ? todo.content.slice(0, 22) + '…' : todo.content

      const iconChunk = t`${fg(statusColor)(icon)}`
      const priChunk = t`${fg(priorityColor)(` ${pri}`)}`
      const labelChunk = t`${fg(statusColor)(` ${label}`)}`
      const rowContent = new StyledText([...iconChunk.chunks, ...priChunk.chunks, ...labelChunk.chunks])

      const rowText = new TextRenderable(this.renderer, {
        id: `todo-row-text-${i}`,
        content: rowContent,
      })

      const rowBox = new BoxRenderable(this.renderer, {
        id: `todo-row-${i}`,
        paddingLeft: 2,
        paddingRight: 1,
      })

      rowBox.onMouseDown = () => {
        const nextStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(todo.status) + 1) % STATUS_ORDER.length]
        this.callbacks.onUpdate(todo.id, { status: nextStatus })
      }

      rowBox.add(rowText)
      this.todoScrollBox.add(rowBox)
      this.todoRows.push(rowBox)
    }
  }

  private _getContentText(content: QueuedMessage['content']): string {
    return typeof content === 'string' ? content : '[complex content]'
  }

  private _formatDuration(ms: number): string {
    if (ms <= 0) return 'Ready!'
    const seconds = Math.floor(ms / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  private _redrawContextual(): void {
    // Clear existing rows
    for (const row of this.contextualRows) {
      this.contextualScrollBox.remove(row.id)
      row.destroyRecursively()
    }
    this.contextualRows = []

    // Draw based on workflow type
    switch (this.currentWorkflowType) {
      case 'queue':
        this._drawQueueContextual()
        break
      case 'cron':
        this._drawCronContextual()
        break
      case 'loop':
        this._drawLoopContextual()
        break
    }
  }

  private _drawQueueContextual(): void {
    const queued = this.currentQueue
    const interjects = this.currentInterjects
    const total = queued.length + interjects.length

    this.contextualHeaderText.content = t`${bold('Queue')} ${fg(COLORS.dim)(`(${total})`)}`

    if (queued.length === 0 && interjects.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'contextual-empty',
        content: t`${fg(COLORS.dim)('Empty')}`,
      })
      const emptyBox = new BoxRenderable(this.renderer, {
        id: 'contextual-empty-box',
        paddingLeft: 2,
        paddingTop: 0,
      })
      emptyBox.add(emptyText)
      this.contextualScrollBox.add(emptyBox)
      this.contextualRows.push(emptyBox)
      return
    }

    let rowIdx = 0

    // Interjects first (they run next)
    for (const msg of interjects) {
      const contentText = this._getContentText(msg.content)
      const label = contentText.length > 26 ? contentText.slice(0, 26) + '…' : contentText
      const prefixChunk = t`${fg(COLORS.red)('!! ')}`
      const labelChunk = t`${fg(COLORS.yellow)(label)}`
      const rowContent = new StyledText([...prefixChunk.chunks, ...labelChunk.chunks])

      const rowText = new TextRenderable(this.renderer, {
        id: `contextual-interject-text-${rowIdx}`,
        content: rowContent,
      })
      const rowBox = new BoxRenderable(this.renderer, {
        id: `contextual-interject-${rowIdx}`,
        paddingLeft: 2,
        paddingRight: 1,
      })
      rowBox.add(rowText)
      this.contextualScrollBox.add(rowBox)
      this.contextualRows.push(rowBox)
      rowIdx++
    }

    // Then queued messages
    for (const msg of queued) {
      const contentText = this._getContentText(msg.content)
      const label = contentText.length > 27 ? contentText.slice(0, 27) + '…' : contentText
      const prefixChunk = t`${fg(COLORS.blue)('  → ')}`
      const labelChunk = t`${fg(COLORS.white)(label)}`
      const rowContent = new StyledText([...prefixChunk.chunks, ...labelChunk.chunks])

      const rowText = new TextRenderable(this.renderer, {
        id: `contextual-msg-text-${rowIdx}`,
        content: rowContent,
      })
      const rowBox = new BoxRenderable(this.renderer, {
        id: `contextual-msg-${rowIdx}`,
        paddingLeft: 2,
        paddingRight: 1,
      })
      rowBox.add(rowText)
      this.contextualScrollBox.add(rowBox)
      this.contextualRows.push(rowBox)
      rowIdx++
    }
  }

  private _drawCronContextual(): void {
    const info = this.currentCronInfo
    this.contextualHeaderText.content = t`${bold('Cron')}`

    const lines: string[] = []

    if (info.schedule) {
      lines.push(`${fg(COLORS.primary)('Schedule:')} ${info.schedule}`)
    }

    if (info.prompt) {
      const promptText = info.prompt.length > 26 ? info.prompt.slice(0, 24) + '…' : info.prompt
      lines.push(`${fg(COLORS.primary)('Prompt:')} ${promptText}`)
    }

    if (info.timeUntilNextMs !== undefined) {
      lines.push(`${fg(COLORS.yellow)('Next:')} ${this._formatDuration(info.timeUntilNextMs)}`)
    }

    if (info.lastRunAt) {
      const lastRun = new Date(info.lastRunAt)
      lines.push(`${fg(COLORS.dim)(`Last: ${lastRun.toLocaleTimeString()}`)}`)
    }

    if (lines.length === 0) {
      lines.push(`${fg(COLORS.dim)('Not configured')}`)
    }

    // Draw each line
    lines.forEach((line, idx) => {
      const rowText = new TextRenderable(this.renderer, {
        id: `contextual-cron-text-${idx}`,
        content: t`${line}`,
      })
      const rowBox = new BoxRenderable(this.renderer, {
        id: `contextual-cron-${idx}`,
        paddingLeft: 2,
        paddingRight: 1,
      })
      rowBox.add(rowText)
      this.contextualScrollBox.add(rowBox)
      this.contextualRows.push(rowBox)
    })
  }

  private _drawLoopContextual(): void {
    const info = this.currentLoopInfo
    this.contextualHeaderText.content = t`${bold('Loop')}${info.isActive ? fg(COLORS.green)(' ●') : ''}`

    const lines: string[] = []

    if (info.workPrompt) {
      const workText = info.workPrompt.length > 26 ? info.workPrompt.slice(0, 24) + '…' : info.workPrompt
      lines.push(`${fg(COLORS.primary)('Work:')} ${workText}`)
    }

    if (info.closingCondition) {
      const condText = info.closingCondition.length > 20 ? info.closingCondition.slice(0, 18) + '…' : info.closingCondition
      lines.push(`${fg(COLORS.primary)('Until:')} ${condText}`)
    }

    if (info.maxIterations) {
      lines.push(`${fg(COLORS.primary)('Max:')} ${info.currentIteration || 0}/${info.maxIterations}`)
    }

    if (info.phase && info.phase !== 'idle') {
      const phaseColor = info.phase === 'working' ? COLORS.green : COLORS.yellow
      lines.push(`${fg(phaseColor)(`Status: ${info.phase}`)}`)
    }

    if (lines.length === 0) {
      lines.push(`${fg(COLORS.dim)('Use /loop to configure')}`)
    }

    // Draw each line
    lines.forEach((line, idx) => {
      const rowText = new TextRenderable(this.renderer, {
        id: `contextual-loop-text-${idx}`,
        content: t`${line}`,
      })
      const rowBox = new BoxRenderable(this.renderer, {
        id: `contextual-loop-${idx}`,
        paddingLeft: 2,
        paddingRight: 1,
      })
      rowBox.add(rowText)
      this.contextualScrollBox.add(rowBox)
      this.contextualRows.push(rowBox)
    })
  }
}

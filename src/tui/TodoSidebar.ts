/**
 * TodoSidebar — right-hand panel showing TODOs and the message queue.
 *
 * - Top section: scrollable todo list (click to cycle status)
 * - Bottom section: queued & interject messages
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

export interface TodoSidebarCallbacks {
  onAdd: (content: string) => void
  onDelete: (id: string) => void
  onUpdate: (id: string, updates: Partial<Pick<TodoItem, 'status' | 'priority'>>) => void
}

export class TodoSidebar {
  private renderer: CliRenderer
  public readonly root: BoxRenderable
  private todoScrollBox: ScrollBoxRenderable
  private todoHeaderText: TextRenderable
  private queueScrollBox: ScrollBoxRenderable
  private queueHeaderText: TextRenderable
  private usageText: TextRenderable

  private todos: TodoItem[] = []
  private todoRows: BoxRenderable[] = []
  private queueRows: BoxRenderable[] = []
  private callbacks: TodoSidebarCallbacks

  constructor(renderer: CliRenderer, callbacks: TodoSidebarCallbacks) {
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

    // ── Queue section ─────────────────────────────────────

    // Divider + Queue header
    const queueHeaderBox = new BoxRenderable(renderer, {
      id: 'queue-header-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
      border: ['top'],
      borderColor: COLORS.border,
    })
    this.queueHeaderText = new TextRenderable(renderer, {
      id: 'queue-header-text',
      content: t`${bold('Queue')} ${fg(COLORS.dim)('(0)')}`,
    })
    queueHeaderBox.add(this.queueHeaderText)
    this.root.add(queueHeaderBox)

    // Queue scroll list - fixed max height but scrollable
    this.queueScrollBox = new ScrollBoxRenderable(renderer, {
      id: 'queue-scroll',
      flexShrink: 0,
      maxHeight: 10,
    })
    // Enable mouse wheel scrolling on the scroll box
    this.queueScrollBox.onMouseDown = () => {
      this.queueScrollBox.focus()
    }
    this.root.add(this.queueScrollBox)

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
    this._redrawQueue(queued, interjects)
    const total = queued.length + interjects.length
    this.queueHeaderText.content = t`${bold('Queue')} ${fg(COLORS.dim)(`(${total})`)}`
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
        paddingTop: 0,
      })
      emptyBox.add(emptyText)
      this.queueScrollBox.add(emptyBox)
      this.queueRows.push(emptyBox)
      return
    }

    let rowIdx = 0

    // Interjects first (they run next, at the next LLM iteration boundary)
    for (const msg of interjects) {
      const contentText = this._getContentText(msg.content)
      const label = contentText.length > 26 ? contentText.slice(0, 26) + '…' : contentText
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
      const label = contentText.length > 27 ? contentText.slice(0, 27) + '…' : contentText
      const prefixChunk = t`${fg(COLORS.blue)('  → ')}`
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

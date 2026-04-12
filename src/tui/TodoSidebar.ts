/**
 * TodoSidebar — right-hand todo panel.
 *
 * - ScrollBoxRenderable lists todos with status icons & colours
 * - Click to cycle todo status
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

const GREEN = '#09A469'
const DIM = '#666666'
const YELLOW = '#e0af68'
const RED = '#f7768e'
const GRAY = '#666666'
const WHITE = '#cccccc'

const STATUS_ICONS: Record<TodoItem['status'], string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
  cancelled: '[-]',
}

const STATUS_COLORS: Record<TodoItem['status'], string> = {
  pending: WHITE,
  in_progress: YELLOW,
  completed: GREEN,
  cancelled: GRAY,
}

const PRIORITY_COLORS: Record<TodoItem['priority'], string> = {
  high: RED,
  medium: YELLOW,
  low: GRAY,
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
  private scrollBox: ScrollBoxRenderable
  private headerText: TextRenderable
  private footerText: TextRenderable
  private usageText: TextRenderable

  private todos: TodoItem[] = []
  private todoRows: BoxRenderable[] = []
  private callbacks: TodoSidebarCallbacks

  constructor(renderer: CliRenderer, callbacks: TodoSidebarCallbacks) {
    this.renderer = renderer
    this.callbacks = callbacks

    this.root = new BoxRenderable(renderer, {
      id: 'todo-sidebar-root',
      flexDirection: 'column',
      flexShrink: 0,
      flexGrow: 1,
      backgroundColor: '#111111',
      width: 36,
      border: ['left'],
      borderColor: '#333333',
    })

    // Header
    const headerBox = new BoxRenderable(renderer, {
      id: 'todo-header-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
    })
    this.headerText = new TextRenderable(renderer, {
      id: 'todo-header-text',
      content: t`${bold('TODOs')} ${fg(DIM)('(0)')}`,
    })
    headerBox.add(this.headerText)
    this.root.add(headerBox)

    // ScrollBox for todo list
    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: 'todo-scroll',
      flexGrow: 1,
    })
    this.root.add(this.scrollBox)

    // Footer hint
    const footerBox = new BoxRenderable(renderer, {
      id: 'todo-footer-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      flexShrink: 0,
    })
    this.footerText = new TextRenderable(renderer, {
      id: 'todo-footer-text',
      content: t`${fg(DIM)('Click todo to cycle status')}`,
    })
    footerBox.add(this.footerText)
    this.root.add(footerBox)

    // Usage row (shows token counts)
    const usageBox = new BoxRenderable(renderer, {
      id: 'todo-usage-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingBottom: 1,
      flexShrink: 0,
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
    this._redrawRows()
    this.headerText.content = t`${bold('TODOs')} ${fg(DIM)(`(${todos.length})`)}`
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
    this.usageText.content = t`${fg(DIM)(parts.join(' · '))}`
  }

  private _redrawRows(): void {
    // Remove existing rows
    for (const row of this.todoRows) {
      this.scrollBox.remove(row.id)
      row.destroyRecursively()
    }
    this.todoRows = []

    if (this.todos.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: 'todo-empty',
        content: t`${fg(DIM)("No todos")}`,
      })
      const emptyBox = new BoxRenderable(this.renderer, {
        id: 'todo-empty-box',
        paddingLeft: 2,
        paddingTop: 1,
      })
      emptyBox.add(emptyText)
      this.scrollBox.add(emptyBox)
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

      // Build row content
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
      
      // Click to cycle status
      rowBox.onMouseDown = () => {
        const nextStatus = STATUS_ORDER[(STATUS_ORDER.indexOf(todo.status) + 1) % STATUS_ORDER.length]
        this.callbacks.onUpdate(todo.id, { status: nextStatus })
      }
      
      rowBox.add(rowText)
      this.scrollBox.add(rowBox)
      this.todoRows.push(rowBox)
    }
  }
}

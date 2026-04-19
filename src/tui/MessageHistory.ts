/**
 * MessageHistory — scrollable chat history panel built on ScrollBoxRenderable.
 *
 * - Auto-scrolls to bottom when new messages arrive (sticky scroll)
 * - Mouse wheel and keyboard scroll are handled natively by ScrollBoxRenderable
 * - Text is selectable (drag to select) via OpenTUI
 * - ANSI escape codes stripped before display
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
  italic,
  StyledText,
} from '@opentui/core'
import { ScrollBoxRenderable } from '@opentui/core'
import type { Message } from '../agentic-loop.js'
import { normalizeTranscriptText } from '../utils/format-message.js'
import { formatToolActivity } from '../utils/tool-display.js'
import { COLORS } from './theme.js'

// ─── Strip ANSI escape sequences ───
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '')
}

// ─── Simple markdown to StyledText ───
// Converts **bold**, *italic*, ***both*** to styled chunks.
function styledText(raw: string): StyledText {
  const cleaned = raw.replace(/^#+\s+/gm, '')
  const pattern = /(\*\*\*[^*]+?\*\*\*|\*\*[^*]+?\*\*|\*[^\s*][^*]*?\*)/g
  const chunks: ReturnType<typeof t>[] = []
  let last = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(cleaned)) !== null) {
    if (match.index > last) chunks.push(t`${cleaned.slice(last, match.index)}`)
    const full = match[0]
    if (full.startsWith('***')) chunks.push(t`${bold(italic(full.slice(3, -3)))}`)
    else if (full.startsWith('**')) chunks.push(t`${bold(full.slice(2, -2))}`)
    else chunks.push(t`${italic(full.slice(1, -1))}`)
    last = pattern.lastIndex
  }
  if (last < cleaned.length) chunks.push(t`${cleaned.slice(last)}`)
  if (chunks.length === 0) return t`${cleaned}`
  // Merge all StyledText chunks into one
  const allChunks = chunks.flatMap((st) => st.chunks)
  return new StyledText(allChunks)
}

export interface MessageHistoryOptions {
  renderer: CliRenderer
  onMouseDown?: () => void
}

export class MessageHistory {
  private renderer: CliRenderer
  public readonly root: BoxRenderable
  private scrollBox: ScrollBoxRenderable
  private onMouseDownCb?: () => void

  private messageItems: Array<BoxRenderable> = []

  // streaming state
  private streamingBox: BoxRenderable | null = null
  private streamingText: TextRenderable | null = null

  private _messageCount = 0

  // live tool rows keyed by tool call id
  private liveToolRows: Map<string, BoxRenderable> = new Map()
  private liveToolTexts: Map<string, TextRenderable> = new Map()

  // pending interject rows keyed by QueuedMessage.id — shown below scroll box
  private interjectPanel: BoxRenderable
  private interjectRows: Map<string, BoxRenderable> = new Map()

  // Track todo list boxes to prevent duplicates
  private todoListBoxes: BoxRenderable[] = []
  // Debounce timer for todo list updates
  private todoListDebounceTimer: NodeJS.Timeout | null = null
  // Pending todos for debounced update
  private pendingTodos: Array<{ id: string; content: string; status: string; priority: string }> | null = null

  constructor({ renderer, onMouseDown }: MessageHistoryOptions) {
    this.renderer = renderer
    this.onMouseDownCb = onMouseDown

    this.root = new BoxRenderable(renderer, {
      id: 'msg-history-root',
      flexDirection: 'column',
      flexGrow: 1,
      paddingTop: 1,
    })

    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: 'msg-history-scroll',
      flexGrow: 1,
      stickyScroll: true,
      stickyStart: 'bottom',
    })
    this.scrollBox.onMouseDown = () => {
      this.onMouseDownCb?.()
    }
    this.root.add(this.scrollBox)

    // Interject panel — sits below the scroll box, always visible
    this.interjectPanel = new BoxRenderable(renderer, {
      id: 'msg-interject-panel',
      flexDirection: 'column',
      flexShrink: 0,
    })
    this.root.add(this.interjectPanel)

    this.scrollBox.focus()
  }

  // Track last message's tool call count to detect when tool calls are added
  private _lastToolCallCount = 0

  // Track live tool row count to trigger re-render when rows are removed
  private _lastLiveToolRowCount = 0

  // Track streaming thinking content
  private streamingThinkingText: string = ''

  /**
   * Re-render the message list. Called whenever messages or streaming state changes.
   */
  setMessages(messages: Message[], currentStreamingText?: string, isStreaming?: boolean, currentStreamingThinking?: string): void {
    const visible = messages.filter((m: any) => m.role !== 'system')

    // Check if the last message has new tool calls (needs re-render)
    const lastMsg = visible[visible.length - 1]
    const currentToolCallCount = (lastMsg as any)?.tool_calls?.length ?? 0
    const toolCallsChanged = currentToolCallCount !== this._lastToolCallCount
    this._lastToolCallCount = currentToolCallCount

    // Check if live tool rows were removed (need to re-render to show the tool calls in message)
    const currentLiveRowCount = this.liveToolRows.size
    const liveRowsChanged = currentLiveRowCount !== this._lastLiveToolRowCount
    this._lastLiveToolRowCount = currentLiveRowCount

    // Append newly arrived messages, or re-render last message if tool calls changed or live rows removed
    if (visible.length !== this._messageCount || toolCallsChanged || liveRowsChanged) {
      this._removeStreamingBox()

      // If tool calls changed or live rows removed, re-render the last message box
      // This is needed when: (1) tool calls were added to existing message, or
      // (2) live rows were removed and we need to show tool calls in static message
      if ((toolCallsChanged || liveRowsChanged) && visible.length > 0) {
        const lastIndex = this.messageItems.length - 1
        if (lastIndex >= 0) {
          const oldBox = this.messageItems[lastIndex]
          this.scrollBox.remove(oldBox.id)
          oldBox.destroyRecursively()
          this.messageItems.pop()
        }
      }

      // Determine where to start rendering from:
      // - If live rows changed: re-render from the second-to-last visible message
      //   (to re-render the assistant message without live row, plus any new messages)
      // - If tool calls changed (but no new messages): re-render just the last message
      // - Otherwise: just append new messages starting from this._messageCount
      let newStart: number
      if (liveRowsChanged) {
        // Live rows removed + possibly new messages: re-render assistant + new messages
        newStart = Math.max(0, visible.length - 2)
      } else if (toolCallsChanged && visible.length === this._messageCount) {
        // Only tool calls added to existing message, no new messages
        newStart = visible.length - 1
      } else {
        // Just new messages, no changes to existing
        newStart = this._messageCount
      }
      for (let i = newStart; i < visible.length; i++) {
        const box = this._buildMessageBox(visible[i], i)
        if (box) {
          this.messageItems.push(box)
          this.scrollBox.add(box)
        }
      }
      this._messageCount = visible.length
    }

    // Update thinking content
    this.streamingThinkingText = currentStreamingThinking || ''

    // Streaming text - recreate the streaming box each time to avoid child management issues
    if (isStreaming && (currentStreamingText || this.streamingThinkingText)) {
      // Remove old streaming box if it exists
      if (this.streamingBox) {
        this.scrollBox.remove(this.streamingBox.id)
        this.streamingBox.destroyRecursively()
      }

      // Create fresh streaming box
      this.streamingBox = new BoxRenderable(this.renderer, {
        id: 'msg-streaming-box',
        paddingLeft: 2,
        paddingRight: 2,
        marginBottom: 1,
        flexDirection: 'column',
      })
      this.scrollBox.add(this.streamingBox)

      // Add thinking content if present
      if (this.streamingThinkingText) {
        const thinkingClean = stripAnsi(this.streamingThinkingText)
        const prefixChunk = t`${fg(COLORS.dim)('🧠 ')}`
        // Combine prefix with italic dimmed body
        const thinkingBodyChunk = t`${italic(fg(COLORS.dim)(thinkingClean))}`
        const thinkingText = new TextRenderable(this.renderer, {
          id: 'msg-streaming-thinking-text',
          content: new StyledText([...prefixChunk.chunks, ...thinkingBodyChunk.chunks]),
          selectionBg: '#333333',
        })
        this.streamingBox.add(thinkingText)
      }

      // Add main content
      if (currentStreamingText) {
        const clean = stripAnsi(currentStreamingText)
        const body = styledText(clean)
        const cursor = t`${fg(COLORS.dim)('▍')}`
        const mainText = new TextRenderable(this.renderer, {
          id: 'msg-streaming-text',
          content: new StyledText([...body.chunks, ...cursor.chunks]),
          selectionBg: '#333333',
        })
        this.streamingBox.add(mainText)
      } else if (this.streamingThinkingText) {
        // Show cursor after thinking if no main content yet
        const cursor = t`${fg(COLORS.dim)('▍')}`
        const cursorText = new TextRenderable(this.renderer, {
          id: 'msg-streaming-cursor',
          content: cursor,
          selectionBg: '#333333',
        })
        this.streamingBox.add(cursorText)
      }
    } else {
      this._removeStreamingBox()
    }
  }

  private _removeStreamingBox(): void {
    if (this.streamingBox) {
      this.scrollBox.remove(this.streamingBox.id)
      this.streamingBox.destroyRecursively()
      this.streamingBox = null
      this.streamingText = null
      this.streamingThinkingText = ''
    }
  }

  private _buildMessageBox(msg: any, idx: number): BoxRenderable | null {
    const id = `msg-item-${idx}`

    const box = new BoxRenderable(this.renderer, {
      id: `${id}-box`,
      paddingLeft: 2,
      paddingRight: 2,
      marginBottom: 1,
      flexDirection: 'column',
    })

    let content: StyledText | null = null

    if (msg.role === 'user') {
      // Handle array content (text + images)
      if (Array.isArray(msg.content)) {
        const parts: string[] = []
        for (const part of msg.content) {
          if (part.type === 'text' && typeof part.text === 'string') {
            parts.push(part.text)
          } else if (part.type === 'image_url') {
            parts.push('[📷 Image]')
          }
        }
        const text = stripAnsi(normalizeTranscriptText(parts.join(' ')))
        if (!text) return null
        const prefixChunk = t`${bold(fg(COLORS.primary)('> '))}`
        const bodyChunk = t`${fg(COLORS.white)(text)}`
        content = new StyledText([...prefixChunk.chunks, ...bodyChunk.chunks])
      } else if (typeof msg.content === 'object' && msg.content !== null) {
        // Handle object content (e.g., {type: 'text', text: '...'})
        const textContent = (msg.content as any).text
        const text = typeof textContent === 'string'
          ? stripAnsi(normalizeTranscriptText(textContent))
          : stripAnsi(normalizeTranscriptText(String(msg.content)))
        if (!text) return null
        const prefixChunk = t`${bold(fg(COLORS.primary)('> '))}`
        const bodyChunk = t`${fg(COLORS.white)(text)}`
        content = new StyledText([...prefixChunk.chunks, ...bodyChunk.chunks])
      } else {
        const text = stripAnsi(normalizeTranscriptText(String(msg.content || '')))
        if (!text) return null
        const prefixChunk = t`${bold(fg(COLORS.primary)('> '))}`
        const bodyChunk = t`${fg(COLORS.white)(text)}`
        content = new StyledText([...prefixChunk.chunks, ...bodyChunk.chunks])
      }
    } else if (msg.role === 'assistant' && Array.isArray((msg as any).tool_calls) && (msg as any).tool_calls.length > 0) {
      const lines: StyledText[] = []
      // Add thinking/reasoning content if present
      if ((msg as any).reasoning_content?.trim()) {
        lines.push(t`${fg(COLORS.dim)('🧠 ')}${italic(fg(COLORS.dim)((msg as any).reasoning_content.trim()))}`)
      }
      if (msg.content?.trim()) lines.push(styledText(stripAnsi(msg.content.trim())))
      for (const tc of (msg as any).tool_calls) {
        // Skip tool calls that are currently shown as live rows (prevents duplication)
        if (this.liveToolRows.has(tc.id)) continue
        const toolName = tc.function?.name || 'tool'
        let display = toolName
        try {
          const args = JSON.parse(tc.function?.arguments || '{}')
          display = formatToolActivity(toolName, args)
        } catch {}
        lines.push(t`${fg(COLORS.primary)(`▶ ${display}`)}`)
      }
      // Combine all lines by merging their chunks with newline chunks between them
      const newlineChunk = t`\n`.chunks[0]
      const allChunks: typeof lines[0]['chunks'] = []
      for (let i = 0; i < lines.length; i++) {
        allChunks.push(...lines[i].chunks)
        if (i < lines.length - 1) allChunks.push(newlineChunk)
      }
      content = new StyledText(allChunks)
    } else if (msg.role === 'assistant' && (msg.content?.trim() || (msg as any).reasoning_content?.trim())) {
      const lines: StyledText[] = []
      // Add thinking/reasoning content if present
      if ((msg as any).reasoning_content?.trim()) {
        lines.push(t`${fg(COLORS.dim)('🧠 ')}${italic(fg(COLORS.dim)((msg as any).reasoning_content.trim()))}`)
      }
      if (msg.content?.trim()) {
        lines.push(styledText(stripAnsi(msg.content.trim())))
      }
      // Combine all lines by merging their chunks with newline chunks between them
      const newlineChunk = t`\n`.chunks[0]
      const allChunks: typeof lines[0]['chunks'] = []
      for (let i = 0; i < lines.length; i++) {
        allChunks.push(...lines[i].chunks)
        if (i < lines.length - 1) allChunks.push(newlineChunk)
      }
      content = new StyledText(allChunks)
    } else if (msg.role === 'tool') {
      // Tool results — shown dim, compact
      const toolName = msg.name || 'tool'
      const raw = String(msg.content || '')
      const compact = stripAnsi(raw).replace(/\s+/g, ' ').trim().slice(0, 120)
      let display = toolName
      try {
        if (msg.args) display = formatToolActivity(toolName, JSON.parse(msg.args))
      } catch {}
      const result = compact ? `: ${compact}${raw.length > 120 ? '…' : ''}` : ''
      content = t`${fg(COLORS.dim)(`◀ ${display}${result}`)}`
    }

    if (!content) return null

    const textNode = new TextRenderable(this.renderer, {
      id: `${id}-text`,
      content,
      selectionBg: '#333333',
    })
    box.add(textNode)
    return box
  }

  /** Show or update a live tool-call row while the tool is running */
  addLiveToolRow(id: string, display: string): void {
    if (this.liveToolRows.has(id)) {
      const textNode = this.liveToolTexts.get(id)
      if (textNode) textNode.content = t`${fg(COLORS.primary)(display)}`
      return
    }
    const box = new BoxRenderable(this.renderer, {
      id: `live-tool-${id}`,
      paddingLeft: 2,
      paddingRight: 2,
      marginBottom: 1,
    })
    const textNode = new TextRenderable(this.renderer, {
      id: `live-tool-text-${id}`,
      content: t`${fg(COLORS.primary)(display)}`,
      selectionBg: '#333333',
    })
    box.add(textNode)
    this.liveToolRows.set(id, box)
    this.liveToolTexts.set(id, textNode)
    this.scrollBox.add(box)
  }

  /** Remove a live tool-call row once the tool completes */
  removeLiveToolRow(id: string): void {
    const box = this.liveToolRows.get(id)
    if (!box) return
    this.scrollBox.remove(box.id)
    box.destroyRecursively()
    this.liveToolRows.delete(id)
    this.liveToolTexts.delete(id)
  }

  /** Remove all live tool rows (e.g. on reset) */
  private _clearLiveToolRows(): void {
    for (const [, box] of this.liveToolRows) {
      try { this.scrollBox.remove(box.id) } catch {}
      box.destroyRecursively()
    }
    this.liveToolRows.clear()
    this.liveToolTexts.clear()
  }

  /** Show pending interjects in the panel below scroll box */
  setInterjects(interjects: Array<{ id: string; content: string }>): void {
    // Remove old interject rows
    for (const [, box] of this.interjectRows) {
      try { this.interjectPanel.remove(box.id) } catch {}
      box.destroyRecursively()
    }
    this.interjectRows.clear()

    if (interjects.length === 0) return

    // Add header
    const headerBox = new BoxRenderable(this.renderer, {
      id: 'interject-header',
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
    })
    const headerText = new TextRenderable(this.renderer, {
      id: 'interject-header-text',
      content: t`${fg(COLORS.yellow)('Pending interjects:')}`,
    })
    headerBox.add(headerText)
    this.interjectPanel.add(headerBox)
    this.interjectRows.set('header', headerBox)

    // Add each interject with full text
    for (const interject of interjects) {
      const box = new BoxRenderable(this.renderer, {
        id: `interject-${interject.id}`,
        paddingLeft: 2,
        paddingRight: 2,
        flexDirection: 'column',
      })
      const text = stripAnsi(interject.content)
      const textNode = new TextRenderable(this.renderer, {
        id: `interject-text-${interject.id}`,
        content: t`${fg(COLORS.white)(text)}`,
        selectionBg: '#333333',
      })
      box.add(textNode)
      this.interjectPanel.add(box)
      this.interjectRows.set(interject.id, box)
    }
  }

  /** Show full TODO list in the chat history */
  showTodoList(todos: Array<{ id: string; content: string; status: string; priority: string }>): void {
    // Debounce rapid successive calls (e.g., from parallel tool execution)
    // Clear any pending update and schedule a new one
    if (this.todoListDebounceTimer) {
      clearTimeout(this.todoListDebounceTimer)
    }
    this.pendingTodos = todos
    this.todoListDebounceTimer = setTimeout(() => {
      this._renderTodoList(this.pendingTodos!)
      this.pendingTodos = null
      this.todoListDebounceTimer = null
    }, 50) // 50ms debounce window
  }

  /** Internal method to actually render the todo list (called after debounce) */
  private _renderTodoList(todos: Array<{ id: string; content: string; status: string; priority: string }>): void {
    // Remove any existing todo list boxes to prevent duplicates
    for (const oldBox of this.todoListBoxes) {
      this.scrollBox.remove(oldBox.id)
      oldBox.destroyRecursively()
    }
    this.todoListBoxes = []

    const STATUS_ICONS: Record<string, string> = {
      pending: '[ ]',
      in_progress: '[~]',
      completed: '[x]',
      cancelled: '[-]',
    }

    const STATUS_COLORS: Record<string, string> = {
      pending: COLORS.white,
      in_progress: COLORS.yellow,
      completed: COLORS.primary,
      cancelled: COLORS.gray,
    }

    const PRIORITY_COLORS: Record<string, string> = {
      high: COLORS.red,
      medium: COLORS.yellow,
      low: COLORS.gray,
    }

    const box = new BoxRenderable(this.renderer, {
      id: `todo-list-${Date.now()}`,
      paddingLeft: 2,
      paddingRight: 2,
      marginBottom: 1,
      flexDirection: 'column',
    })

    // Header
    const headerText = new TextRenderable(this.renderer, {
      id: `todo-list-header-${Date.now()}`,
      content: t`${bold(fg(COLORS.primary)(`TODO List (${todos.length} items):`))}`,
    })
    box.add(headerText)

    // Each todo item
    for (let i = 0; i < todos.length; i++) {
      const todo = todos[i]
      const icon = STATUS_ICONS[todo.status] ?? '[ ]'
      const statusColor = STATUS_COLORS[todo.status] ?? COLORS.white
      const priorityColor = PRIORITY_COLORS[todo.priority] ?? COLORS.gray
      const pri = `[${todo.priority[0]?.toUpperCase() ?? '?'}]`

      const iconChunk = t`${fg(statusColor)(icon)}`
      const priChunk = t`${fg(priorityColor)(` ${pri}`)}`
      const labelChunk = t`${fg(statusColor)(` ${todo.content}`)}`
      const rowContent = new StyledText([...iconChunk.chunks, ...priChunk.chunks, ...labelChunk.chunks])

      const rowText = new TextRenderable(this.renderer, {
        id: `todo-row-${Date.now()}-${i}`,
        content: rowContent,
      })
      box.add(rowText)
    }

    if (todos.length === 0) {
      const emptyText = new TextRenderable(this.renderer, {
        id: `todo-empty-${Date.now()}`,
        content: t`${fg(COLORS.dim)('No TODOs.')}`,
      })
      box.add(emptyText)
    }

    this.scrollBox.add(box)
    this.todoListBoxes.push(box)
  }

  /** Reset all messages (session reload) */
  resetMessages(): void {
    for (const box of this.messageItems) {
      this.scrollBox.remove(box.id)
      box.destroyRecursively()
    }
    this.messageItems = []
    this._messageCount = 0
    this._lastToolCallCount = 0
    this._lastLiveToolRowCount = 0
    this._removeStreamingBox()
    this._clearLiveToolRows()
    // Clear todo list tracking on reset
    this.todoListBoxes = []
    // Clear any pending debounced todo update
    if (this.todoListDebounceTimer) {
      clearTimeout(this.todoListDebounceTimer)
      this.todoListDebounceTimer = null
    }
    this.pendingTodos = null
  }

   focus(): void {
     this.scrollBox.focus()
   }

   /** Jump to bottom and re-enable sticky scroll (e.g. when switching back to this tab) */
   scrollToBottom(): void {
     const max = Math.max(0, this.scrollBox.scrollHeight - this.scrollBox.viewport.height)
     this.scrollBox.stickyScroll = false
     this.scrollBox.scrollTop = max
     this.scrollBox.stickyScroll = true
   }
}

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

// ─── Strip ANSI escape sequences ───
const ANSI_RE = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g
function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '')
}

// ─── Colour constants ───
const GREEN = '#09A469'
const DIM = '#666666'
const WHITE = '#cccccc'

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
}

export class MessageHistory {
  private renderer: CliRenderer
  public readonly root: BoxRenderable
  private scrollBox: ScrollBoxRenderable

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

  constructor({ renderer }: MessageHistoryOptions) {
    this.renderer = renderer

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

  /**
   * Re-render the message list. Called whenever messages or streaming state changes.
   */
  setMessages(messages: Message[], currentStreamingText?: string, isStreaming?: boolean): void {
    const visible = messages.filter((m: any) => m.role !== 'system')

    // Append newly arrived messages
    if (visible.length !== this._messageCount) {
      this._removeStreamingBox()

      const newStart = this._messageCount
      for (let i = newStart; i < visible.length; i++) {
        const box = this._buildMessageBox(visible[i], i)
        if (box) {
          this.messageItems.push(box)
          this.scrollBox.add(box)
        }
      }
      this._messageCount = visible.length
      this.scrollToBottom()
    }

    // Streaming text
    if (isStreaming && currentStreamingText) {
      if (!this.streamingBox) {
        this.streamingBox = new BoxRenderable(this.renderer, {
          id: 'msg-streaming-box',
          paddingLeft: 2,
          paddingRight: 2,
          marginBottom: 1,
        })
        this.streamingText = new TextRenderable(this.renderer, {
          id: 'msg-streaming-text',
          content: t`${fg(DIM)('▍')}`,
          selectionBg: '#333333',
        })
        this.streamingBox.add(this.streamingText)
        this.scrollBox.add(this.streamingBox)
      }
      const clean = stripAnsi(currentStreamingText)
      // Combine styled text + cursor
      const body = styledText(clean)
      const cursor = t`${fg(DIM)('▍')}`
      this.streamingText!.content = new StyledText([...body.chunks, ...cursor.chunks])
      this.scrollToBottom()
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
      const text = stripAnsi(normalizeTranscriptText(String(msg.content || '')))
      if (!text) return null
      const prefixChunk = t`${bold(fg(GREEN)('> '))}`
      const bodyChunk = t`${fg(WHITE)(text)}`
      content = new StyledText([...prefixChunk.chunks, ...bodyChunk.chunks])
    } else if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const lines: StyledText[] = []
      if (msg.content?.trim()) lines.push(styledText(stripAnsi(msg.content.trim())))
      for (const tc of msg.tool_calls) {
        const toolName = tc.function?.name || 'tool'
        let display = toolName
        try {
          const args = JSON.parse(tc.function?.arguments || '{}')
          display = formatToolActivity(toolName, args)
        } catch {}
        lines.push(t`${fg(GREEN)(`▶ ${display}`)}`)
      }
      const allChunks = lines.flatMap((st, i) =>
        i < lines.length - 1 ? [...st.chunks, ...t`\n`.chunks] : st.chunks
      )
      content = new StyledText(allChunks)
    } else if (msg.role === 'assistant' && msg.content?.trim()) {
      content = styledText(stripAnsi(msg.content))
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
      content = t`${fg(DIM)(`◀ ${display}${result}`)}`
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
      // update existing text
      const textNode = this.liveToolTexts.get(id)
      if (textNode) textNode.content = t`${fg(GREEN)(display)}`
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
      content: t`${fg(GREEN)(display)}`,
      selectionBg: '#333333',
    })
    box.add(textNode)
    this.liveToolRows.set(id, box)
    this.liveToolTexts.set(id, textNode)
    this.scrollBox.add(box)
    this.scrollToBottom()
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
      content: t`${fg('#e0af68')('Pending interjects:')}`,
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
        content: t`${fg(WHITE)(text)}`,
        selectionBg: '#333333',
      })
      box.add(textNode)
      this.interjectPanel.add(box)
      this.interjectRows.set(interject.id, box)
    }
  }

  /** Reset all messages (session reload) */
  resetMessages(): void {
    for (const box of this.messageItems) {
      this.scrollBox.remove(box.id)
      box.destroyRecursively()
    }
    this.messageItems = []
    this._messageCount = 0
    this._removeStreamingBox()
    this._clearLiveToolRows()
  }

  scrollToBottom(): void {
    const max = Math.max(0, this.scrollBox.scrollHeight - this.scrollBox.viewport.height)
    this.scrollBox.scrollTop = max
  }

  focus(): void {
    this.scrollBox.focus()
  }
}

/**
 * Renders the chat transcript (messages) plus any in-flight streaming text.
 *
 * Mirrors the layout of src/tui/MessageHistory.ts:
 *  - user messages prefixed with "> " in primary
 *  - assistant prose rendered with minimal markdown
 *  - assistant tool_calls as "▶ <formatted tool activity>" rows in primary
 *  - tool results as "◀ <tool>: <squashed content>" in dim
 *  - streaming text shown at the bottom with a blinking cursor
 */
import { useEffect, useRef } from 'react'
import type { ChatMessage } from '@/types'
import { useAppStore } from '@/store/app-store'
import { cn, formatToolActivity, normalizeTranscriptText, safeParseArgs, squashToLine } from '@/lib/utils'

function userContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = content as Array<{ type: string; text?: string }>
  return parts
    .map((p) => (p.type === 'text' ? (p.text ?? '') : '[📷 Image]'))
    .join(' ')
    .trim()
}

function StyledText({ text }: { text: string }) {
  // Minimal markdown: strip leading #'s, interpret **bold** and *italic*.
  const cleaned = text
    .split('\n')
    .map((line) => line.replace(/^\s*#+\s*/, ''))
    .join('\n')

  const nodes: React.ReactNode[] = []
  const regex = /(\*\*\*[^*]+\*\*\*|\*\*[^*]+\*\*|\*[^*]+\*)/g
  let lastIndex = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = regex.exec(cleaned))) {
    if (m.index > lastIndex) {
      nodes.push(
        <span key={key++}>{cleaned.slice(lastIndex, m.index)}</span>,
      )
    }
    const token = m[0]
    if (token.startsWith('***')) {
      nodes.push(
        <strong key={key++} className="italic">
          {token.slice(3, -3)}
        </strong>,
      )
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key++}>{token.slice(2, -2)}</strong>)
    } else {
      nodes.push(<em key={key++}>{token.slice(1, -1)}</em>)
    }
    lastIndex = m.index + token.length
  }
  if (lastIndex < cleaned.length) {
    nodes.push(<span key={key++}>{cleaned.slice(lastIndex)}</span>)
  }
  return <>{nodes}</>
}

function MessageBubble({ children, className }: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('px-4 py-2 text-sm leading-relaxed whitespace-pre-wrap font-mono bg-card text-card-foreground rounded border border-border/50', className)}>
      {children}
    </div>
  )
}

export function MessageHistory() {
  const messages = useAppStore((s) => s.messages)
  const isStreaming = useAppStore((s) => s.isStreaming)
  const streamingText = useAppStore((s) => s.streamingText)
  const streamingThinking = useAppStore((s) => s.streamingThinking)
  const runningToolCalls = useAppStore((s) => s.runningToolCalls)

  const containerRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  const stuckToBottomRef = useRef(true)

  // Sticky auto-scroll to bottom (user scrolling up releases the stick).
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onScroll = () => {
      const distanceFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight
      const goingUp = el.scrollTop < lastScrollTopRef.current
      if (goingUp && distanceFromBottom > 40) stuckToBottomRef.current = false
      else if (distanceFromBottom < 10) stuckToBottomRef.current = true
      lastScrollTopRef.current = el.scrollTop
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    if (stuckToBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, streamingText, streamingThinking])

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto space-y-2 px-3 py-3 md:px-4 md:py-4"
    >
      {messages.map((m, i) => (
        <MessageRow key={i} message={m} />
      ))}

      {/* Streaming assistant bubble */}
      {isStreaming && (streamingText || streamingThinking) && (
        <MessageBubble>
          {streamingThinking && (
            <div className="text-muted-foreground italic mb-1">
              🧠 {streamingThinking}
            </div>
          )}
          {streamingText && (
            <span className="text-card-foreground">
              <StyledText text={streamingText} />
              <span className="cursor-blink text-muted-foreground">▍</span>
            </span>
          )}
        </MessageBubble>
      )}

      {/* Live tool-call rows for tools that are still running */}
      {Object.values(runningToolCalls).map((tc) => (
        <MessageBubble key={`live-${tc.id}`} className="bg-info/10 dark:bg-info/5 border-info/30">
          <span className="text-info font-semibold">
            ▶ {formatToolActivity(tc.name, safeParseArgs(tc.args))}
          </span>
        </MessageBubble>
      ))}
    </div>
  )
}

function MessageRow({ message }: { message: ChatMessage }) {
  if (message.role === 'system') return null

  if (message.role === 'user') {
    const text = normalizeTranscriptText(userContentToString(message.content))
    return (
      <MessageBubble className="bg-primary/10 dark:bg-primary/5 border-primary/30">
        <span className="font-bold text-primary">&gt; </span>
        <span className="text-card-foreground">{text}</span>
      </MessageBubble>
    )
  }

  if (message.role === 'tool') {
    const summary = squashToLine(message.content ?? '', 120)
    return (
      <MessageBubble className="bg-secondary/30 dark:bg-secondary/20 border-border/70">
        <span className="text-muted-foreground">
          ◀ <span className="font-semibold">{message.name ?? 'tool'}</span>: {summary}
        </span>
      </MessageBubble>
    )
  }

  // assistant
  const hasTools = message.tool_calls && message.tool_calls.length > 0
  const reasoning = message.reasoning_content
  return (
    <MessageBubble>
      {reasoning && (
        <div className="text-muted-foreground italic mb-2 px-3 py-2 bg-secondary/30 dark:bg-secondary/20 rounded border border-border/50">
          🧠 {reasoning}
        </div>
      )}
      {message.content && (
        <div className="text-card-foreground">
          <StyledText text={message.content} />
        </div>
      )}
      {hasTools &&
        message.tool_calls!.map((tc) => {
          const args = safeParseArgs(tc.function.arguments)
          return (
            <div key={tc.id} className="text-primary font-semibold mt-2 pt-2 border-t border-border/30">
              ▶ {formatToolActivity(tc.function.name, args)}
            </div>
          )
        })}
    </MessageBubble>
  )
}

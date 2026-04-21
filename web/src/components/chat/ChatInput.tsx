/**
 * Multiline chat input with slash-command menu + arrow-key history.
 * Mirrors src/tui/ChatInput.ts and src/tui/InputBar.ts.
 *
 * Keybindings on the textarea:
 *   Enter          → submit (or accept selected slash command)
 *   Shift+Enter    → newline
 *   Up / Down      → cycle history (when cursor on first / last line)
 *   Tab            → accept selected slash command (else propagates to parent)
 *   Escape         → dismiss slash menu (else propagates to parent for abort)
 *
 * Submits are routed through the store: if the agent is running the send
 * becomes an interject (server-side decides); a trailing " /q" suffix marks
 * the message as queued.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { useAppStore } from '@/store/app-store'
import { matchSlashCommands, type SlashCommand } from '@/lib/slash-commands'
import { cn } from '@/lib/utils'

const MAX_HISTORY = 100

export interface ChatInputProps {
  placeholder?: string
  autoFocus?: boolean
  /** Lets the WelcomeScreen provide its own styling shell. */
  compact?: boolean
  onAbort?: () => void
}

export function ChatInput({
  placeholder,
  autoFocus,
  compact,
  onAbort,
}: ChatInputProps) {
  const sendMessage = useAppStore((s) => s.sendMessage)
  const cycleView = useAppStore((s) => s.cycleView)
  const isLoading = useAppStore((s) => s.isLoading)
  const running = useAppStore((s) => s.running)
  const abort = useAppStore((s) => s.abort)

  const [value, setValue] = useState('')
  const [history, setHistory] = useState<string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState<string>('')
  const [slashSelection, setSlashSelection] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const slashMatches: SlashCommand[] = useMemo(() => {
    const firstLine = value.split('\n')[0]
    if (!firstLine.startsWith('/')) return []
    return matchSlashCommands(firstLine)
  }, [value])

  useEffect(() => {
    setSlashSelection((s) =>
      slashMatches.length === 0 ? 0 : Math.min(s, slashMatches.length - 1),
    )
  }, [slashMatches.length])

  // Auto-size the textarea up to ~14 rows (matches TUI maxHeight).
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    const max = 14 * 20 // ~20px line-height
    el.style.height = Math.min(el.scrollHeight, max) + 'px'
  }, [value])

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  const busy = isLoading || running

  const onSubmit = () => {
    const content = value.trim()
    if (!content) return

    // Record in history (dedupe against last item).
    setHistory((prev) => {
      if (prev[prev.length - 1] === content) return prev
      const next = [...prev, content]
      if (next.length > MAX_HISTORY) next.shift()
      return next
    })
    setHistoryIndex(null)
    setDraft('')
    setValue('')

    void sendMessage(content)
  }

  const applySlashSelection = (cmd?: SlashCommand) => {
    const selected = cmd ?? slashMatches[slashSelection]
    if (!selected) return
    // If the command is one of the suffix-only commands we insert into the
    // current line; otherwise replace the first line with the full command.
    const lines = value.split('\n')
    lines[0] = selected.name + ' '
    setValue(lines.join('\n'))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const menuOpen = slashMatches.length > 0

    // Tab → accept slash command if menu open; else let parent cycle views.
    if (e.key === 'Tab' && !e.shiftKey) {
      if (menuOpen) {
        e.preventDefault()
        applySlashSelection()
        return
      }
      e.preventDefault()
      cycleView()
      return
    }

    // Escape → close slash menu OR abort running loop.
    if (e.key === 'Escape') {
      if (menuOpen) {
        e.preventDefault()
        setValue('')
        return
      }
      if (busy) {
        e.preventDefault()
        void abort()
        onAbort?.()
        return
      }
    }

    // Enter → submit; Shift+Enter → newline.
    if (e.key === 'Enter' && !e.shiftKey) {
      if (menuOpen) {
        e.preventDefault()
        applySlashSelection()
        return
      }
      e.preventDefault()
      onSubmit()
      return
    }

    // History navigation: only when cursor is at the extremes.
    if (e.key === 'ArrowUp' && !menuOpen) {
      const ta = e.currentTarget
      const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0
      if (atStart && history.length > 0) {
        e.preventDefault()
        if (historyIndex === null) setDraft(value)
        const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
        setHistoryIndex(next)
        setValue(history[next])
      }
    } else if (e.key === 'ArrowDown' && !menuOpen) {
      const ta = e.currentTarget
      const atEnd = ta.selectionStart === value.length && ta.selectionEnd === value.length
      if (atEnd && historyIndex !== null) {
        e.preventDefault()
        const next = historyIndex + 1
        if (next >= history.length) {
          setHistoryIndex(null)
          setValue(draft)
        } else {
          setHistoryIndex(next)
          setValue(history[next])
        }
      }
    } else if (menuOpen) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashSelection((i) => (i + 1) % slashMatches.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashSelection(
          (i) => (i - 1 + slashMatches.length) % slashMatches.length,
        )
      }
    }
  }

  const defaultPlaceholder = busy
    ? 'Enter to interject · Esc to abort'
    : 'Message…  (Enter to send · Tab cycles views)'

  return (
    <div
      className={cn(
        'relative flex flex-col rounded-md border border-border bg-card transition-all duration-200',
        'focus-within:border-primary focus-within:ring-1 focus-within:ring-primary',
        'shadow-sm hover:shadow-base dark:shadow-dark-sm dark:hover:shadow-dark-base',
        compact
          ? 'mx-2 my-2 px-3 py-2'
          : 'mx-2 mb-3 mt-1 px-3 py-2 md:mx-4',
      )}
    >
      {slashMatches.length > 0 && (
        <div className="mb-3 flex flex-col gap-1 text-xs border-b border-border/50 pb-2">
          {slashMatches.map((cmd, i) => (
            <button
              key={cmd.name}
              className={cn(
                'flex items-start gap-2 rounded-md px-2 py-1 text-left transition-colors duration-150',
                i === slashSelection ? 'bg-primary/10 border border-primary/30' : 'hover:bg-secondary/50 dark:hover:bg-secondary/30 border border-transparent',
              )}
              onMouseEnter={() => setSlashSelection(i)}
              onClick={() => applySlashSelection(cmd)}
            >
              <span
                className={cn(
                  'font-semibold text-sm',
                  i === slashSelection ? 'text-primary' : 'text-muted-foreground',
                )}
              >
                {cmd.name}
              </span>
              <span
                className={cn(
                  'text-xs',
                  i === slashSelection ? 'text-card-foreground' : 'text-muted-foreground',
                )}
              >
                {cmd.description}
              </span>
            </button>
          ))}
        </div>
      )}

      <Textarea
        ref={textareaRef}
        value={value}
        placeholder={placeholder ?? defaultPlaceholder}
        rows={1}
        onChange={(e) => {
          setValue(e.target.value)
          setHistoryIndex(null)
        }}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
      />
    </div>
  )
}

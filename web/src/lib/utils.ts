import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Collapse 3+ consecutive newlines to 2 and trim — mirrors
 * `normalizeTranscriptText` used by the TUI.
 */
export function normalizeTranscriptText(text: string): string {
  return text.replace(/\n{3,}/g, '\n\n').trim()
}

/** Safely JSON.parse a tool-call arguments string. */
export function safeParseArgs(args: string): Record<string, unknown> {
  if (!args) return {}
  try {
    const parsed = JSON.parse(args)
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/**
 * Mirror of `formatToolActivity` from src/tui/MessageHistory.ts. Produces a
 * human-readable one-liner for a tool invocation.
 */
export function formatToolActivity(
  name: string,
  args: Record<string, unknown>,
): string {
  switch (name) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return `${name} ${String(args.file_path ?? args.path ?? '')}`.trim()
    case 'list_directory':
      return `list_directory ${String(args.path ?? args.directory ?? '(current)')}`
    case 'search_files':
      return `search_files "${String(args.query ?? args.pattern ?? '')}"`
    case 'bash': {
      const cmd = String(args.command ?? '')
      const preview = cmd.split(/\s+/).slice(0, 3).join(' ')
      return `bash ${preview}${cmd.length > preview.length ? '…' : ''}`
    }
    case 'todo_write': {
      const todos = Array.isArray(args.todos) ? args.todos : []
      return `todo_write ${todos.length} task(s)`
    }
    case 'todo_read':
      return 'todo_read read'
    case 'webfetch': {
      try {
        const url = new URL(String(args.url ?? ''))
        return `webfetch ${url.hostname}`
      } catch {
        return 'webfetch'
      }
    }
    case 'sub_agent':
      return 'sub_agent nested task...'
    default: {
      const first = Object.values(args).find((v) => typeof v === 'string') as
        | string
        | undefined
      if (first) {
        const short = first.length > 30 ? first.slice(0, 30) + '…' : first
        return `${name} ${short}`
      }
      return name
    }
  }
}

/** Compact a multi-line string to single line, truncating at max chars. */
export function squashToLine(text: string, max = 120): string {
  const single = text.replace(/\s+/g, ' ').trim()
  return single.length > max ? single.slice(0, max) + '…' : single
}

/** Cost formatter used in the status bar & sidebar. */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`
}

/** Format a Date or ISO string as "5m ago" or "2h ago". */
export function formatRelative(when: string | number | Date): string {
  const ts = typeof when === 'string' ? Date.parse(when) : Number(when)
  if (!ts) return ''
  const diffSec = Math.round((Date.now() - ts) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  const m = Math.round(diffSec / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

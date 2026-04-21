/**
 * Inline approval prompt shown in place of the chat input when the agent
 * requests permission for a dangerous operation.
 *
 * Mirrors src/tui/ChatInput approval prompt:
 *   [ Approve once ] [ Approve for session ] [ Reject ]
 *
 * Keyboard: ←/→ moves, Enter confirms, Esc rejects.
 */
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import type { ApprovalDecision, ApprovalRequest } from '@/types'

const CHOICES: { decision: ApprovalDecision; label: string; cls: string }[] = [
  { decision: 'approve_once', label: 'Approve once', cls: 'text-tui-primary' },
  {
    decision: 'approve_session',
    label: 'Approve for session',
    cls: 'text-tui-yellow',
  },
  { decision: 'reject', label: 'Reject', cls: 'text-tui-red' },
]

export interface ApprovalPromptProps {
  approval: ApprovalRequest
  onResolve: (decision: ApprovalDecision) => void
}

export function ApprovalPrompt({ approval, onResolve }: ApprovalPromptProps) {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        setIndex((i) => (i - 1 + CHOICES.length) % CHOICES.length)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        setIndex((i) => (i + 1) % CHOICES.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onResolve(CHOICES[index].decision)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onResolve('reject')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, onResolve])

  return (
    <div className="mx-2 mb-3 mt-1 rounded-sm border border-tui-primary bg-background px-4 py-3 md:mx-4">
      <div className="font-bold text-tui-primary">Approval Required</div>
      <div className="mt-1 text-tui-white">{approval.description}</div>
      {approval.detail && (
        <div className="mt-0.5 text-tui-dim">{approval.detail}</div>
      )}
      <div className="mt-3 flex gap-3">
        {CHOICES.map((c, i) => (
          <button
            key={c.decision}
            onMouseEnter={() => setIndex(i)}
            onClick={() => onResolve(c.decision)}
            className={cn(
              'rounded-sm border border-tui px-3 py-1 text-sm',
              i === index
                ? cn('border-current', c.cls)
                : 'text-tui-dim',
            )}
          >
            [ {c.label} ]
          </button>
        ))}
      </div>
    </div>
  )
}

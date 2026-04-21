/**
 * Loop workflow setup dialog (3 steps). Mirrors src/tui/LoopSetupDialog.ts.
 *
 *   Step 1: Work Prompt       (required)
 *   Step 2: Closing Condition (required)
 *   Step 3: Max Iterations    (1..100, default 10)
 */
import { useEffect, useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { LoopConfig } from '@/types'

const STEP_TITLES = [
  'Step 1: Work Prompt',
  'Step 2: Closing Condition',
  'Step 3: Max Iterations',
]

const STEP_PROMPTS = [
  'What should the loop do each iteration?',
  'When should the loop stop? Describe the success condition.',
  'How many times at most? (1–100)',
]

const STEP_PLACEHOLDERS = [
  'e.g. "Search for TODO comments in the codebase and fix one of them"',
  'e.g. "All TODO comments have been resolved or no more TODOs exist"',
  '10',
]

export interface LoopSetupDialogProps {
  open: boolean
  onCancel: () => void
  onStart: (config: LoopConfig) => void
}

export function LoopSetupDialog({ open, onCancel, onStart }: LoopSetupDialogProps) {
  const [step, setStep] = useState(0)
  const [workPrompt, setWorkPrompt] = useState('')
  const [closingConditionPrompt, setClosingConditionPrompt] = useState('')
  const [maxIterations, setMaxIterations] = useState('10')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setStep(0)
      setWorkPrompt('')
      setClosingConditionPrompt('')
      setMaxIterations('10')
      setError(null)
    }
  }, [open])

  const next = () => {
    setError(null)
    if (step === 0) {
      if (!workPrompt.trim()) return setError('Work prompt is required.')
      setStep(1)
    } else if (step === 1) {
      if (!closingConditionPrompt.trim())
        return setError('Closing condition is required.')
      setStep(2)
    } else {
      const n = Number.parseInt(maxIterations, 10)
      if (!Number.isInteger(n) || n < 1 || n > 100)
        return setError('Max iterations must be an integer between 1 and 100.')
      onStart({
        workPrompt: workPrompt.trim(),
        closingConditionPrompt: closingConditionPrompt.trim(),
        maxIterations: n,
      })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      next()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>🔁 Loop Workflow Setup</DialogTitle>
          <DialogDescription>Step {step + 1} of 3</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="font-bold text-tui-white">{STEP_TITLES[step]}</div>
          <div className="text-sm text-tui-dim">{STEP_PROMPTS[step]}</div>

          {step === 0 && (
            <Textarea
              rows={4}
              value={workPrompt}
              autoFocus
              placeholder={STEP_PLACEHOLDERS[0]}
              onChange={(e) => setWorkPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              className="rounded-sm border border-tui px-3 py-2 focus-visible:border-tui-primary"
            />
          )}
          {step === 1 && (
            <Textarea
              rows={4}
              value={closingConditionPrompt}
              autoFocus
              placeholder={STEP_PLACEHOLDERS[1]}
              onChange={(e) => setClosingConditionPrompt(e.target.value)}
              onKeyDown={onKeyDown}
              className="rounded-sm border border-tui px-3 py-2 focus-visible:border-tui-primary"
            />
          )}
          {step === 2 && (
            <Textarea
              rows={1}
              value={maxIterations}
              autoFocus
              placeholder={STEP_PLACEHOLDERS[2]}
              onChange={(e) => setMaxIterations(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={onKeyDown}
              className="rounded-sm border border-tui px-3 py-2 focus-visible:border-tui-primary"
            />
          )}

          {error && <div className="text-sm text-tui-red">{error}</div>}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-tui-dim">
            {step < 2 ? 'Enter → Next' : 'Enter → Start Loop'} · Esc → Cancel
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={next}>
              {step < 2 ? 'Next' : 'Start Loop'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * StatusBar — bottom status row + usage row.
 *
 * Status:  6-dot indicator + active tool (or blank when idle)
 *          - Working (green dots animated)
 *          - Idle (grey dots all filled)
 *          - Approval waiting (yellow dots all filled)
 * Usage:   token cost display
 *
 * The old headerRoot (top header bar) has been removed — the welcome screen
 * and todo sidebar bottom info now carry the session/provider/model info.
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from '@opentui/core'
import type { AgentEvent } from '../agentic-loop.js'

const GREEN = '#09A469'
const DIM = '#666666'
const RED = '#f7768e'
const YELLOW = '#e0af68'

// 6-dot spinner frames for working status
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']

// State indicator (6 filled dots in different colors)
const STATUS_INDICATORS = {
  working: '● ● ● ● ● ●',    // Animated green
  idle: '● ● ● ● ● ●',        // All grey
  approval: '● ● ● ● ● ●',    // All yellow
}

export class StatusBar {
  private renderer: CliRenderer

  // ─── Status row ───
  public readonly statusRoot: BoxRenderable
  private statusText: TextRenderable

  // ─── Usage row ───
  public readonly usageRoot: BoxRenderable
  private usageText: TextRenderable

  // State
  private _loading = false
  private _activeTool: string | null = null
  private _spinnerFrame = 0
  private _spinnerTimer: ReturnType<typeof setInterval> | null = null
  private _lastUsage: AgentEvent['usage'] | null = null
  private _totalCost = 0
  private _queuedCount = 0
  private _interjectCount = 0
  private _error: string | null = null
  private _destroyed = false
  private _awaitingApproval = false

  constructor(renderer: CliRenderer) {
    this.renderer = renderer

    // Status (spinner) row
    this.statusRoot = new BoxRenderable(renderer, {
      id: 'status-row',
      flexShrink: 0,
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
    })
    this.statusText = new TextRenderable(renderer, {
      id: 'status-text',
      content: t``,
    })
    this.statusRoot.add(this.statusText)

    // Usage row
    this.usageRoot = new BoxRenderable(renderer, {
      id: 'usage-row',
      flexShrink: 0,
      paddingLeft: 2,
      paddingRight: 2,
    })
    this.usageText = new TextRenderable(renderer, {
      id: 'usage-text',
      content: t``,
    })
    this.usageRoot.add(this.usageText)
  }

  /** No-op — kept for compatibility if called, but session info is now in TodoSidebar */
  setSession(_sessionId: string, _provider: string, _model: string): void {}

  setLoading(loading: boolean, activeTool: string | null = null): void {
    this._loading = loading
    this._activeTool = activeTool

    if (loading && !this._spinnerTimer) {
      this._spinnerTimer = setInterval(() => {
        this._spinnerFrame = (this._spinnerFrame + 1) % SPINNER_FRAMES.length
        this._updateStatus()
      }, 100)
    } else if (!loading && this._spinnerTimer) {
      clearInterval(this._spinnerTimer)
      this._spinnerTimer = null
      this._spinnerFrame = 0
    }
    this._updateStatus()
  }

  setActiveTool(tool: string | null): void {
    this._activeTool = tool
    this._updateStatus()
  }

  setUsage(usage: AgentEvent['usage'] | null, totalCost: number): void {
    this._lastUsage = usage
    this._totalCost = totalCost
    this._updateUsage()
  }

  setQueueState(queued: number, interjects: number): void {
    this._queuedCount = queued
    this._interjectCount = interjects
    this._updateStatus()
  }

  setError(err: string | null): void {
    this._error = err
    this._updateStatus()
  }

  setAwaitingApproval(awaiting: boolean): void {
    this._awaitingApproval = awaiting
    this._updateStatus()
  }

  showCopied(charCount: number): void {
    const msg = `Copied ${charCount} chars to clipboard`
    this.statusText.content = t`${fg(GREEN)(msg)}`
    this.renderer.requestRender()
    setTimeout(() => {
      this._updateStatus()
      this.renderer.requestRender()
    }, 2000)
  }

  destroy(): void {
    this._destroyed = true
    if (this._spinnerTimer) {
      clearInterval(this._spinnerTimer)
      this._spinnerTimer = null
    }
  }

  private _updateStatus(): void {
    if (this._destroyed) return
    if (this._error) {
      this.statusText.content = t`${fg(RED)(`Error: ${this._error}`)}`
      return
    }

    // Build status line with indicator + info
    let statusLine = ''
    let statusColor = DIM

    if (this._loading) {
      // Working: animated green dots
      const spinner = SPINNER_FRAMES[this._spinnerFrame]
      // Create animated effect by varying dot visibility
      const workingIndicator = spinner.repeat(6)
      statusLine = `${workingIndicator}`
      statusColor = GREEN
      const label = this._activeTool ? `Running ${this._activeTool}…` : 'Thinking…'
      statusLine += `  ${label}`
    } else if (this._awaitingApproval) {
      // Approval waiting: yellow dots all filled
      statusLine = `${STATUS_INDICATORS.approval}  Awaiting approval…`
      statusColor = YELLOW
    } else {
      // Idle: grey dots all filled
      statusLine = STATUS_INDICATORS.idle
      statusColor = DIM
    }

    // Add queue info
    const queueInfo: string[] = []
    if (this._interjectCount > 0) queueInfo.push(`[${this._interjectCount} interject]`)
    if (this._queuedCount > 0) queueInfo.push(`[${this._queuedCount} queued]`)

    if (queueInfo.length > 0) {
      statusLine += `  ${queueInfo.join('  ')}`
    }

    this.statusText.content = statusLine ? t`${fg(statusColor)(statusLine)}` : t``
  }

  private _updateUsage(): void {
    if (this._destroyed) return
    if (!this._lastUsage) {
      this.usageText.content = t``
      return
    }
    const u = this._lastUsage
    const parts: string[] = []
    if (u.inputTokens) parts.push(`in:${u.inputTokens}`)
    if (u.outputTokens) parts.push(`out:${u.outputTokens}`)
    if (u.contextPercent) parts.push(`ctx:${u.contextPercent.toFixed(0)}%`)
    parts.push(`$${this._totalCost.toFixed(4)}`)
    this.usageText.content = t`${fg(DIM)(parts.join(' · '))}`
  }
}

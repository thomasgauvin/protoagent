/**
 * StatusBar — bottom status row + usage row.
 *
 * Status:  6-dot indicator + active tool (or blank when idle)
 *          - Working (green dots animated)
 *          - Idle (grey dots all filled)
 *          - Approval waiting (yellow dots all filled)
 * Usage:   token cost display with colored badges
 * MCP:     connection status indicator
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
  bg,
  bold,
  StyledText,
} from '@opentui/core'
import type { AgentEvent } from '../agentic-loop.js'
import { COLORS } from './theme.js'
import { Spinner } from './Spinner.js'

export interface McpServerStatus {
  name: string;
  connected: boolean;
  error?: string;
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
  private _spinner: Spinner
  private _lastUsage: AgentEvent['usage'] | null = null
  private _totalCost = 0
  private _queuedCount = 0
  private _interjectCount = 0
  private _error: string | null = null
  private _destroyed = false
  private _awaitingApproval = false
  private _mcpStatus: McpServerStatus[] = []
  private _sessionId: string | null = null
  private _provider: string | null = null
  private _model: string | null = null
  private _workflowType: string = 'queue'
  private _workflowActive = false
  // When true, suppress the workflow indicator entirely (e.g. Manager tab).
  private _hideWorkflow = false

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
      content: t``,})
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

    // Spinner handles its own animation
    this._spinner = new Spinner({
      onFrame: () => {
        if (this._destroyed || !this._loading) return
        // Belt-and-suspenders: the TextBuffer backing statusText can be
        // destroyed by opentui's recursive destroy before our own `_destroyed`
        // flag flips, which surfaces as "TextBuffer is destroyed" from the
        // interval firing once more during shutdown. Swallow that narrow
        // race so the exit path stays clean.
        try {
          this._updateStatus()
          this.renderer.requestRender()
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.includes('TextBuffer is destroyed')) {
            this._spinner.stop()
            return
          }
          throw err
        }
      },
    })
  }

  setSession(sessionId: string, provider: string, model: string): void {
    this._sessionId = sessionId
    this._provider = provider
    this._model = model
    this._updateUsage()
  }

  setLoading(loading: boolean, activeTool: string | null = null): void {
    this._loading = loading
    this._activeTool = activeTool

    if (loading) {
      this._spinner.start()
    } else {
      this._spinner.stop()
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

  /**
   * Set MCP server connection status
   */
  setMcpStatus(status: McpServerStatus[]): void {
    this._mcpStatus = status
    this._updateUsage()
  }

  /**
   * Set the current workflow type indicator.
   */
  setWorkflowType(type: string, isActive: boolean): void {
    this._workflowType = type
    this._workflowActive = isActive
    this._updateUsage()
  }

  /**
   * Hide the workflow indicator entirely (used by the Manager tab, which
   * does not run workflows).
   */
  hideWorkflow(): void {
    this._hideWorkflow = true
    this._updateUsage()
  }

  showCopied(charCount: number): void {
    const msg = charCount > 1000 ? `Copied ${(charCount / 1000).toFixed(1)}K chars ✓` : `Copied ${charCount} chars ✓`
    this.statusText.content = t`${fg(COLORS.green)(msg)}`
    this.renderer.requestRender()
    setTimeout(() => {
      this._updateStatus()
      this.renderer.requestRender()
    }, 1500)
  }

  destroy(): void {
    this._destroyed = true
    this._spinner.destroy()
  }

  private _updateStatus(): void {
    if (this._destroyed) return
    if (this._error) {
      this.statusText.content = t`${fg(COLORS.red)(`Error: ${this._error}`)}`
      return
    }

    // Build status line with indicator + info
    let statusLine = ''
    let statusColor: string = COLORS.dim

    if (this._awaitingApproval) {
      // When approval is pending, user is blocked - don't show thinking indicator
      statusLine = `Awaiting approval…`
      statusColor = COLORS.yellow
    } else if (this._loading) {
      const spinner = this._spinner.getFrame()
      statusLine = `${spinner}`
      statusColor = COLORS.green
      const label = this._activeTool ? `Running ${this._activeTool}…` : 'Thinking…'
      statusLine += `  ${label}`
    } else {
      statusLine = ''
      statusColor = COLORS.dim
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

    const parts: string[] = []

    // Workflow indicator (queue/cron/loop) — shows which workflow is active.
    // Hidden for the Manager tab (it doesn't run workflows).
    if (!this._hideWorkflow) {
      const workflowColors: Record<string, string> = {
        queue: COLORS.blue,
        cron: COLORS.yellow,
        loop: COLORS.green,
      }
      const color = workflowColors[this._workflowType] || COLORS.white
      const marker = this._workflowActive ? '●' : '○'
      parts.push(`${fg(color)(`[${marker} ${this._workflowType}]`)}`)
    }

    // MCP status (if any servers configured)
    if (this._mcpStatus.length > 0) {
      const connected = this._mcpStatus.filter(s => s.connected).length
      const total = this._mcpStatus.length
      parts.push(`mcp:${connected}/${total}`)
    }

    // Token usage (always show)
    const u = this._lastUsage
    parts.push(`in:${u?.inputTokens ?? 0}`)
    parts.push(`out:${u?.outputTokens ?? 0}`)
    parts.push(`ctx:${u?.contextPercent?.toFixed(0) ?? 0}%`)

    // Cost (always show)
    parts.push(`cost:$${this._totalCost.toFixed(4)}`)

    // Join with double spaces; dim everything except the workflow indicator
    // (which is already colored). When the indicator is hidden, dim all
    // parts.
    if (parts.length > 0) {
      if (this._hideWorkflow) {
        const dimmed = parts.map(p => fg(COLORS.dim)(p))
        this.usageText.content = t`${dimmed.join('  ')}`
      } else {
        const coloredParts = parts.slice(1).map(p => fg(COLORS.dim)(p))
        this.usageText.content = t`${parts[0]}  ${coloredParts.join('  ')}`
      }
    } else {
      this.usageText.content = t``
    }
  }
}

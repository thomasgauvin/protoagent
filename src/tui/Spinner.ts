/**
 * Spinner — reusable animated spinner utility.
 */

import { SPINNER_FRAMES } from './theme.js'

export interface SpinnerOptions {
  /** Animation interval in ms (default: 100) */
  intervalMs?: number
  /** Callback called on each frame change */
  onFrame?: (frame: string) => void
}

export class Spinner {
  private frame = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private readonly intervalMs: number
  private readonly onFrame: ((frame: string) => void) | undefined

  constructor(options: SpinnerOptions = {}) {
    this.intervalMs = options.intervalMs ?? 100
    this.onFrame = options.onFrame
  }

  /** Get current spinner frame */
  getFrame(): string {
    return SPINNER_FRAMES[this.frame]
  }

  /** Start the spinner animation */
  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length
      this.onFrame?.(this.getFrame())
    }, this.intervalMs)
  }

  /** Stop the spinner animation */
  stop(): void {
    if (!this.timer) return
    clearInterval(this.timer)
    this.timer = null
    this.frame = 0
  }

  /** Check if spinner is running */
  isRunning(): boolean {
    return this.timer !== null
  }

  /** Stop and cleanup */
  destroy(): void {
    this.stop()
  }
}

/**
 * ChatInput — shared input component used by both WelcomeScreen and InputBar.
 *
 * Provides common behavior:
 *  - Enter: submit message
 *  - Up/Down arrow: navigate message history
 *  - Placeholder support
 *  - Focus management
 */

import {
  type CliRenderer,
  TextareaRenderable,
} from '@opentui/core'

export type SubmitMode = 'send' | 'interject' | 'queue'

export interface ChatInputOptions {
  id: string
  placeholder?: string
  placeholderColor?: string
  textColor?: string
  backgroundColor?: string
  flexGrow?: number
}

export class ChatInput {
  public readonly textarea: TextareaRenderable
  private onSubmitCb: (value: string, mode: SubmitMode) => void
  private _isLoading = false
  private history: string[] = []
  private historyIndex = -1
  private currentInput = ''
  private readonly maxHistorySize = 100

  constructor(
    renderer: CliRenderer,
    options: ChatInputOptions,
    onSubmit: (value: string, mode: SubmitMode) => void
  ) {
    this.onSubmitCb = onSubmit

    this.textarea = new TextareaRenderable(renderer, {
      id: options.id,
      placeholder: options.placeholder ?? '',
      placeholderColor: options.placeholderColor ?? '#666666',
      textColor: options.textColor ?? '#cccccc',
      backgroundColor: options.backgroundColor ?? 'transparent',
      flexGrow: options.flexGrow ?? 1,
      // Allow escape key to propagate to global handler for abort functionality
      traits: { capture: ['escape'] },
    })

    // Handle submit from textarea (Meta+Enter)
    this.textarea.onSubmit = () => {
      const value = this.textarea.editBuffer.getText()
      const trimmed = value.trim()
      if (!trimmed) return
      this.textarea.clear()
      this.addToHistory(trimmed)
      const mode: SubmitMode = this._isLoading ? 'interject' : 'send'
      this.onSubmitCb(trimmed, mode)
    }

    // Intercept keys for submit behavior
    this.textarea.onKeyDown = (key) => {
      // Enter to submit - only if no modifier
      if (!key.meta && !key.ctrl && (key.name === 'return' || key.name === 'linefeed' || key.name === 'enter')) {
        key.preventDefault()
        const value = this.textarea.editBuffer.getText()
        const trimmed = value.trim()
        if (!trimmed) return
        this.textarea.clear()
        this.addToHistory(trimmed)
        const mode: SubmitMode = this._isLoading ? 'interject' : 'send'
        this.onSubmitCb(trimmed, mode)
        return
      }

      // Up arrow: navigate to previous history entry
      if (key.name === 'up') {
        key.preventDefault()
        this.navigateHistory(-1)
        return
      }

      // Down arrow: navigate to next history entry
      if (key.name === 'down') {
        key.preventDefault()
        this.navigateHistory(1)
        return
      }
    }

    this.textarea.focus()
  }

  setLoading(loading: boolean): void {
    this._isLoading = loading
  }

  focus(): void {
    this.textarea.focus()
  }

  blur(): void {
    this.textarea.blur()
  }

  setPlaceholder(placeholder: string): void {
    this.textarea.placeholder = placeholder
  }

  private addToHistory(message: string): void {
    // Don't add duplicates at the end of history
    if (this.history.length > 0 && this.history[this.history.length - 1] === message) {
      this.historyIndex = -1
      this.currentInput = ''
      return
    }
    this.history.push(message)
    // Trim old entries if exceeding max size
    if (this.history.length > this.maxHistorySize) {
      this.history.shift()
    }
    this.historyIndex = -1
    this.currentInput = ''
  }

  private navigateHistory(direction: number): void {
    if (this.history.length === 0) return

    // Save current input if we're starting to navigate
    if (this.historyIndex === -1) {
      this.currentInput = this.textarea.editBuffer.getText()
    }

    const newIndex = this.historyIndex + direction

    // Clamp to valid range (-1 means "current input")
    if (newIndex >= this.history.length) {
      this.historyIndex = this.history.length - 1
      this.textarea.editBuffer.setText(this.history[this.historyIndex])
      return
    }

    this.historyIndex = newIndex

    if (this.historyIndex === -1) {
      this.textarea.editBuffer.setText(this.currentInput)
    } else {
      this.textarea.editBuffer.setText(this.history[this.historyIndex])
    }
  }
}

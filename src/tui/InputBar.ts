/**
 * InputBar — multiline agent text input at the bottom of the screen.
 *
 * Behaviour:
 *  - Enter:                 new line (multiline input)
 *  - Meta+Enter (Cmd/Ctrl): send message
 *  - Meta+Shift+Enter:      queue message
 *
 * The border label reflects the current mode.
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  t,
  fg,
  bold,
} from '@opentui/core'

const GREEN  = '#09A469'
const YELLOW = '#e0af68'
const DIM    = '#666666'
const WHITE  = '#cccccc'

export type SubmitMode = 'send' | 'interject' | 'queue'

export class InputBar {
  private renderer: CliRenderer
  public readonly root: BoxRenderable
  private modeLabel: TextRenderable
  public readonly input: TextareaRenderable

  private onSubmitCb: (value: string, mode: SubmitMode) => void
  private _isLoading = false

  constructor(renderer: CliRenderer, onSubmit: (value: string, mode: SubmitMode) => void) {
    this.renderer = renderer
    this.onSubmitCb = onSubmit

    this.root = new BoxRenderable(renderer, {
      id: 'input-bar-root',
      flexDirection: 'column',
      flexShrink: 0,
      border: true,
      borderColor: GREEN,
      borderStyle: 'single',
      marginLeft: 2,
      marginRight: 2,
      marginBottom: 1,
      maxHeight: 8, // Limit max height for multiline input
    })

    // Input row: mode label + textarea input
    const inputRow = new BoxRenderable(renderer, {
      id: 'input-bar-row',
      flexDirection: 'row',
      flexGrow: 1,
    })
    this.root.add(inputRow)

    // Mode label on the left
    this.modeLabel = new TextRenderable(renderer, {
      id: 'input-bar-mode',
      content: t`${bold(fg(GREEN)('> '))}`,
      marginLeft: 1,
    })
    inputRow.add(this.modeLabel)

    this.input = new TextareaRenderable(renderer, {
      id: 'input-bar-input',
      placeholder: 'Message… (/help for commands)',
      placeholderColor: DIM,
      textColor: WHITE,
      backgroundColor: 'transparent',
      flexGrow: 1,
    })
    inputRow.add(this.input)

    // Click anywhere on the input bar to focus it
    this.root.onMouseDown = () => {
      this.input.focus()
    }

    // Handle submit from textarea (Meta+Enter)
    this.input.onSubmit = () => {
      const value = this.input.editBuffer.getText()
      const trimmed = value.trim()
      if (!trimmed) return
      this.input.clear()
      const mode: SubmitMode = this._isLoading ? 'interject' : 'send'
      this.onSubmitCb(trimmed, mode)
    }

    // Intercept keys for queue shortcuts, and Enter to submit
    this.input.onKeyDown = (key) => {
      // Enter to submit (or interject if loading) - only if no modifier (allows text wrapping)
      if (!key.meta && !key.ctrl && (key.name === 'return' || key.name === 'linefeed' || key.name === 'enter')) {
        key.preventDefault()
        const value = this.input.editBuffer.getText()
        const trimmed = value.trim()
        if (!trimmed) return
        // Clear the textarea using the clear method
        this.input.clear()
        const mode: SubmitMode = this._isLoading ? 'interject' : 'send'
        this.onSubmitCb(trimmed, mode)
        return
      }

      // Ctrl+Enter or Meta+Enter to insert newline (queue message)
      if ((key.ctrl || key.meta) && (key.name === 'return' || key.name === 'linefeed' || key.name === 'enter')) {
        // Let the default behavior insert newline
        return
      }
    }

    this.input.focus()
  }

  setFocused(focused: boolean): void {
    this.root.borderColor = focused ? GREEN : '#333333'
    if (focused) this.input.focus()
    else this.input.blur()
  }

  setLoading(loading: boolean): void {
    this._isLoading = loading
    this._updateModeLabel()
    if (loading) {
      this.input.placeholder = 'Enter to interject · Ctrl+Enter for newline · Esc to abort'
    } else {
      this.input.placeholder = 'Message…  (Enter to send, Ctrl+Enter for newline)'
    }
  }

  private _updateModeLabel(): void {
    if (this._isLoading) {
      this.modeLabel.content = t`${bold(fg(YELLOW)('> '))}`
    } else {
      this.modeLabel.content = t`${bold(fg(GREEN)('> '))}`
    }
  }

  focus(): void {
    this.input.focus()
  }
}

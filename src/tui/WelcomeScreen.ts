/**
 * WelcomeScreen — splash shown before the first message is sent.
 *
 * Layout (vertically centred):
 *
 *   ╔══════════════════════════════════╗
 *   ║                                  ║
 *   ║   PROTOAGENT                     ║  big ASCII title
 *   ║                                  ║
 *   ║   ┌──────────────────────────┐   ║  input box
 *   ║   │ >  What can I help…      │   ║
 *   ║   └──────────────────────────┘   ║
 *   ║   provider · model               ║  dim label
 *   ║                                  ║
 *   ╚══════════════════════════════════╝
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  type MouseEvent,
  t,
  fg,
  bold,
} from '@opentui/core'

const GREEN  = '#09A469'
const DIM    = '#666666'
const WHITE  = '#cccccc'

const ASCII_LOGO = [
  '█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀',
  '█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ ',
].join('\n')

export class WelcomeScreen {
  public readonly root: BoxRenderable
  private labelText: TextRenderable
  public readonly input: TextareaRenderable
  private onSubmitCb: (value: string) => void

  constructor(renderer: CliRenderer, onSubmit: (value: string) => void) {
    this.onSubmitCb = onSubmit

    // Full-screen centering wrapper
    this.root = new BoxRenderable(renderer, {
      id: 'welcome-root',
      flexDirection: 'column',
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000',
    })

    // Inner column — constrain width so input doesn't span the whole terminal
    const inner = new BoxRenderable(renderer, {
      id: 'welcome-inner',
      flexDirection: 'column',
      alignItems: 'center',
      maxWidth: 72,
    })
    this.root.add(inner)

    // ASCII logo
    const logoText = new TextRenderable(renderer, {
      id: 'welcome-logo',
      content: t`${fg(GREEN)(ASCII_LOGO)}`,
    })
    inner.add(logoText)

    // Spacer
    const spacer = new BoxRenderable(renderer, { id: 'welcome-spacer', height: 2 })
    inner.add(spacer)

    // Input box
    const inputBox = new BoxRenderable(renderer, {
      id: 'welcome-input-box',
      flexDirection: 'row',
      border: true,
      borderColor: GREEN,
      borderStyle: 'single',
      width: 72,
      maxHeight: 8,
      flexShrink: 0,
    })
    inner.add(inputBox)

    const prefix = new TextRenderable(renderer, {
      id: 'welcome-prefix',
      content: t`${bold(fg(GREEN)('> '))}`,
    })
    inputBox.add(prefix)

    this.input = new TextareaRenderable(renderer, {
      id: 'welcome-input',
      placeholder: 'What can I help you build?',
      placeholderColor: DIM,
      textColor: WHITE,
      backgroundColor: 'transparent',
      flexGrow: 1,
    })
    inputBox.add(this.input)

    // Handle submit from textarea (Meta+Enter)
    this.input.onSubmit = () => {
      const value = this.input.editBuffer.getText()
      const trimmed = value.trim()
      if (!trimmed) return
      this.input.clear()
      this.onSubmitCb(trimmed)
    }

    // Intercept Enter key to submit message (reusing InputBar logic)
    this.input.onKeyDown = (key) => {
      // Enter to submit - only if no modifier (allows text wrapping with Ctrl+Enter)
      if (!key.meta && !key.ctrl && (key.name === 'return' || key.name === 'linefeed' || key.name === 'enter')) {
        key.preventDefault()
        const value = this.input.editBuffer.getText()
        const trimmed = value.trim()
        if (!trimmed) return
        this.input.clear()
        this.onSubmitCb(trimmed)
        return
      }

      // Ctrl+Enter or Meta+Enter to insert newline (allows multiline input)
      if ((key.ctrl || key.meta) && (key.name === 'return' || key.name === 'linefeed' || key.name === 'enter')) {
        // Let the default behavior insert newline
        return
      }
    }

    // Click anywhere on the welcome screen to focus the input
    this.root.onMouseDown = (event: MouseEvent) => {
      this.input.focus()
    }

    // Dim label below input (filled in by setInfo)
    const spacer2 = new BoxRenderable(renderer, { id: 'welcome-spacer2', height: 1 })
    inner.add(spacer2)

    this.labelText = new TextRenderable(renderer, {
      id: 'welcome-label',
      content: t`${fg(DIM)('loading…')}`,
    })
    inner.add(this.labelText)

    this.input.focus()
  }

  setInfo(provider: string, model: string, sessionId?: string): void {
    const sessionPart = sessionId ? `  ${sessionId}` : ''
    this.labelText.content = t`${fg(DIM)(`${provider} · ${model}${sessionPart}`)}`
  }

  focus(): void {
    this.input.focus()
  }
}

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
 *   ║   │   What can I help…       │   ║
 *   ║   └──────────────────────────┘   ║
 *   ║   provider · model               ║  dim label
 *   ║                                  ║
 *   ╚══════════════════════════════════╝
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from '@opentui/core'
import { COLORS, getThemeMode, DARK_COLORS, LIGHT_COLORS } from './theme.js'
import { ChatInput } from './ChatInput.js'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu.js'

// ASCII logo is 42 characters wide
const ASCII_LOGO = [
  '█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀',
  '█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ ',
].join('\n')

const LOGO_WIDTH = 42

/**
 * Calculate responsive width for welcome screen elements based on terminal size.
 * Returns a width that fits comfortably within the terminal while maintaining
 * a reasonable minimum for usability.
 */
function getResponsiveWidth(): number {
  const termWidth = process.stdout.columns || 80
  // Leave some padding for borders/margins (4 chars each side = 8 total)
  const availableWidth = termWidth - 8
  // Minimum usable width (logo width + padding)
  const minWidth = LOGO_WIDTH + 4
  // Default/target width
  const targetWidth = 72

  if (availableWidth < minWidth) {
    return Math.max(minWidth - 4, termWidth - 2) // Fallback to nearly full width on tiny terminals
  }
  return Math.min(targetWidth, availableWidth)
}

export interface WelcomeScreenOptions {
  commands?: SlashCommand[]
}

export class WelcomeScreen {
  public readonly root: BoxRenderable
  private labelText: TextRenderable
  private chatInput: ChatInput
  private slashMenu: SlashCommandMenu
  private onSubmitCb: (value: string) => void
  private renderer: CliRenderer
  private inputBox: BoxRenderable

  constructor(renderer: CliRenderer, onSubmit: (value: string) => void, options: WelcomeScreenOptions = {}) {
    this.onSubmitCb = onSubmit
    this.renderer = renderer

    // Full-screen centering wrapper
    this.root = new BoxRenderable(renderer, {
      id: 'welcome-root',
      flexDirection: 'column',
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: getThemeMode() === 'dark' ? DARK_COLORS.bg : LIGHT_COLORS.bg,
    })

    // Calculate responsive width based on terminal size
    const responsiveWidth = getResponsiveWidth()

    // Inner column — constrain width so input doesn't span the whole terminal
    const inner = new BoxRenderable(renderer, {
      id: 'welcome-inner',
      flexDirection: 'column',
      alignItems: 'center',
      maxWidth: responsiveWidth,
    })
    this.root.add(inner)

    // ASCII logo
    const logoText = new TextRenderable(renderer, {
      id: 'welcome-logo',
      content: t`${fg(COLORS.primary)(ASCII_LOGO)}`,
    })
    inner.add(logoText)

    // Spacer
    const spacer = new BoxRenderable(renderer, { id: 'welcome-spacer', height: 2 })
    inner.add(spacer)

    // Input box container (column to hold menu + input)
    this.inputBox = new BoxRenderable(renderer, {
      id: 'welcome-input-box',
      flexDirection: 'column',
      border: true,
      borderColor: COLORS.primary,
      borderStyle: 'single',
      width: responsiveWidth,
      maxHeight: 14,
      flexShrink: 0,
    })
    inner.add(this.inputBox)

    // Slash command autocomplete menu (sits above the textarea inside the border)
    this.slashMenu = new SlashCommandMenu(renderer, options.commands ?? [])

    // Shared ChatInput component
    this.chatInput = new ChatInput(
      renderer,
      {
        id: 'welcome-input',
        placeholder: 'What can I help you build?',
        placeholderColor: COLORS.dim,
        textColor: COLORS.white,
        backgroundColor: 'transparent',
        flexGrow: 1,
      },
      (value) => this.onSubmitCb(value)
    )
    this.inputBox.add(this.chatInput.textarea)

    // Wire the slash menu
    this._wireSlashMenu()

    // Click anywhere on the welcome screen to focus the input
    this.root.onMouseDown = () => {
      this.chatInput.focus()
    }

    // Dim label below input (filled in by setInfo)
    const spacer2 = new BoxRenderable(renderer, { id: 'welcome-spacer2', height: 1 })
    inner.add(spacer2)

    this.labelText = new TextRenderable(renderer, {
      id: 'welcome-label',
      content: t`${fg(COLORS.dim)('loading…')}`,
    })
    inner.add(this.labelText)

    this.chatInput.focus()
  }

  private _wireSlashMenu(): void {
    const menu = this.slashMenu
    const textarea = this.chatInput.textarea
    let menuAdded = false

    // Helper to add/remove menu from layout based on visibility
    const updateMenuInLayout = () => {
      if (menu.visible && !menuAdded) {
        // Insert menu before textarea in the input box
        this.inputBox.remove(this.chatInput.textarea.id)
        this.inputBox.add(menu.root)
        this.inputBox.add(this.chatInput.textarea)
        menuAdded = true
      } else if (!menu.visible && menuAdded) {
        this.inputBox.remove(menu.root.id)
        menuAdded = false
      }
    }

    // Called when user selects a command (keyboard or mouse)
    menu.onSelect = (commandName: string) => {
      textarea.clear()
      textarea.insertText(commandName)
      menu.hide()
      updateMenuInLayout()
    }

    // Wrap the existing onKeyDown set by ChatInput
    const previousOnKeyDown = textarea.onKeyDown

    textarea.onKeyDown = (key: any) => {
      // ── Navigation inside the open menu ─────────────────────────────
      if (menu.visible) {
        if (key.name === 'up') {
          key.preventDefault()
          menu.move(-1)
          return
        }
        if (key.name === 'down') {
          key.preventDefault()
          menu.move(1)
          return
        }
        if (key.name === 'tab') {
          key.preventDefault()
          const selected = menu.getSelected()
          if (selected) menu.onSelect?.(selected)
          return
        }
        if (!key.meta && !key.ctrl && (key.name === 'return' || key.name === 'linefeed' || key.name === 'enter')) {
          const selected = menu.getSelected()
          if (selected) {
            key.preventDefault()
            menu.onSelect?.(selected)
            return
          }
          // No selection — fall through to normal submit
        }
        if (key.name === 'escape') {
          key.preventDefault()
          menu.hide()
          updateMenuInLayout()
          return
        }
      }

      // Tab key should propagate to switch workflow (don't intercept when menu is closed)
      if (key.name === 'tab' && !menu.visible) {
        // Let Tab propagate to global handler for workflow switching
        return
      }

      // ── Default key handling ─────────────────────────────────────────
      previousOnKeyDown?.(key)

      // Update menu after the keystroke has mutated the buffer.
      // Use a microtask so the buffer has been updated first.
      Promise.resolve().then(() => {
        const text = textarea.editBuffer?.getText() ?? ''
        menu.update(text)
        updateMenuInLayout()
      })
    }
  }

  setInfo(provider: string, model: string, sessionId?: string): void {
    const sessionPart = sessionId ? `  ${sessionId}` : ''
    this.labelText.content = t`${fg(COLORS.dim)(`${provider} · ${model}${sessionPart}`)}`
  }

  focus(): void {
    this.chatInput.focus()
  }

  get input(): ChatInput['textarea'] {
    return this.chatInput.textarea
  }
}

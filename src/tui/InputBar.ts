/**
 * InputBar — agent text input at the bottom of the screen.
 *
 * Behaviour:
 *  - Enter: submit message
 *
 * The border label reflects the current mode.
 */

import {
  type CliRenderer,
  BoxRenderable,
} from '@opentui/core'
import { COLORS } from './theme.js'
import { ChatInput, type SubmitMode } from './ChatInput.js'
import { SlashCommandMenu, type SlashCommand } from './SlashCommandMenu.js'

export { SubmitMode }

export class InputBar {
  private renderer: CliRenderer
  public readonly root: BoxRenderable
  public readonly chatInput: ChatInput
  private readonly slashMenu: SlashCommandMenu

  constructor(
    renderer: CliRenderer,
    onSubmit: (value: string, mode: SubmitMode) => void,
    commands: SlashCommand[] = [],
  ) {
    this.renderer = renderer

    this.root = new BoxRenderable(renderer, {
      id: 'input-bar-root',
      flexDirection: 'column',
      flexShrink: 0,
      border: true,
      borderColor: COLORS.primary,
      borderStyle: 'single',
      marginLeft: 2,
      marginRight: 2,
      maxHeight: 14,
      paddingLeft: 1,
    })

    // Slash command autocomplete menu (sits above the textarea inside the border)
    this.slashMenu = new SlashCommandMenu(renderer, commands)

    // Shared ChatInput component
    this.chatInput = new ChatInput(
      renderer,
      {
        id: 'input-bar-input',
        placeholder: 'Message… (/help · ↑ history · Tab workflow)',
        placeholderColor: COLORS.dim,
        textColor: COLORS.white,
        backgroundColor: 'transparent',
        flexGrow: 1,
      },
      onSubmit
    )
    this.root.add(this.chatInput.textarea)

    // Wire menu: update on every keystroke, intercept navigation keys
    this._wireSlashMenu()

    // Click anywhere on the input bar to focus it
    this.root.onMouseDown = () => {
      this.chatInput.focus()
    }

    this.chatInput.focus()
  }

  private _wireSlashMenu(): void {
    const menu = this.slashMenu
    const textarea = this.chatInput.textarea
    let menuAdded = false

    // Helper to add/remove menu from layout based on visibility
    const updateMenuInLayout = () => {
      if (menu.visible && !menuAdded) {
        this.root.add(menu.root)
        menuAdded = true
      } else if (!menu.visible && menuAdded) {
        this.root.remove(menu.root.id)
        menuAdded = false
      }
    }

    // Called when user selects a command (keyboard or mouse)
    menu.onSelect = (commandName: string) => {
      textarea.clear()
      // insertText is a public method on EditBufferRenderable (base class)
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

      // Tab / Shift+Tab should propagate to the global handler for workflow
      // switching (don't intercept when the slash-command menu is closed).
      if (key.name === 'tab' && !menu.visible) {
        return
      }

      // Escape should propagate to global handler for abort functionality (when menu is closed)
      if (key.name === 'escape' && !menu.visible) {
        // Let Escape propagate to global handler
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

  setFocused(focused: boolean): void {
    this.root.borderColor = focused ? COLORS.primary : COLORS.border
    if (focused) this.chatInput.focus()
    else this.chatInput.blur()
  }

  setLoading(loading: boolean): void {
    this.chatInput.setLoading(loading)
    if (loading) {
      this.chatInput.setPlaceholder('Enter to interject · Esc to abort')
    } else {
      this.chatInput.setPlaceholder('Message…  (Enter to send · Tab cycles workflows)')
    }
  }

  focus(): void {
    this.chatInput.focus()
  }

  blur(): void {
    this.chatInput.blur()
  }

  get input(): ChatInput['textarea'] {
    return this.chatInput.textarea
  }
}

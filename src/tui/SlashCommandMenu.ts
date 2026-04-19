/**
 * SlashCommandMenu — autocomplete dropdown for slash commands.
 *
 * Renders a filtered list of matching commands above the input bar.
 * Keyboard navigation: ↑/↓ to move, Tab or Enter to select, Esc to dismiss.
 */

import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
  bold,
} from '@opentui/core'
import { COLORS } from './theme.js'

export interface SlashCommand {
  name: string
  description: string
}

export class SlashCommandMenu {
  public readonly root: BoxRenderable
  private renderer: CliRenderer
  private commands: SlashCommand[]

  private rows: BoxRenderable[] = []
  private selectedIndex = 0
  private currentMatches: SlashCommand[] = []
  private _visible = false

  /** Called when the user selects a command — provides the full command name */
  onSelect?: (commandName: string) => void

  constructor(renderer: CliRenderer, commands: SlashCommand[]) {
    this.renderer = renderer
    this.commands = commands

    this.root = new BoxRenderable(renderer, {
      id: 'slash-menu-root',
      flexDirection: 'column',
      flexShrink: 0,
      paddingLeft: 1,
      paddingBottom: 1,
    })
  }

  get visible(): boolean {
    return this._visible
  }

  /**
   * Update the menu for the current input text.
   * Returns true if the menu is now visible (text starts with '/').
   */
  update(inputText: string): boolean {
    const trimmed = inputText.trimStart()
    if (!trimmed.startsWith('/')) {
      this._hide()
      return false
    }

    const matches = this.commands.filter((cmd) =>
      cmd.name.toLowerCase().startsWith(trimmed.toLowerCase())
    )

    if (matches.length === 0) {
      this._hide()
      return false
    }

    this.currentMatches = matches
    // Clamp selection
    if (this.selectedIndex >= matches.length) {
      this.selectedIndex = matches.length - 1
    }

    this._renderRows()
    this._visible = true
    return true
  }

  /** Move selection up (-1) or down (+1) */
  move(dir: -1 | 1): void {
    if (!this._visible || this.currentMatches.length === 0) return
    this.selectedIndex =
      (this.selectedIndex + dir + this.currentMatches.length) %
      this.currentMatches.length
    this._renderRows()
  }

  /** Return the currently selected command name, or null */
  getSelected(): string | null {
    if (!this._visible || this.currentMatches.length === 0) return null
    return this.currentMatches[this.selectedIndex]?.name ?? null
  }

  /** Hide the menu */
  hide(): void {
    this._hide()
  }

  private _hide(): void {
    if (!this._visible && this.rows.length === 0) return
    this._clearRows()
    this.selectedIndex = 0
    this.currentMatches = []
    this._visible = false
  }

  private _clearRows(): void {
    for (const row of this.rows) {
      try { this.root.remove(row.id) } catch {}
      row.destroyRecursively()
    }
    this.rows = []
  }

  private _renderRows(): void {
    this._clearRows()
    this.currentMatches.forEach((cmd, i) => {
      const isSelected = i === this.selectedIndex
      const row = new BoxRenderable(this.renderer, {
        id: `slash-menu-row-${i}`,
        flexDirection: 'row',
        paddingLeft: 1,
        onMouseDown: () => {
          this.selectedIndex = i
          this.onSelect?.(cmd.name)
        },
      })
      const text = new TextRenderable(this.renderer, {
        id: `slash-menu-text-${i}`,
        content: isSelected
          ? t`${bold(fg(COLORS.primary)(cmd.name))} ${fg(COLORS.white)(cmd.description)}`
          : t`${fg(COLORS.dim)(cmd.name)} ${fg(COLORS.dim)(cmd.description)}`,
      })
      row.add(text)
      this.root.add(row)
      this.rows.push(row)
    })
    this.renderer.requestRender()
  }
}

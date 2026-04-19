/**
 * Theme — shared color constants and styling utilities for OpenTUI.
 * Supports both light and dark modes, auto-detecting from terminal.
 */

import type { ThemeMode } from '@opentui/core'

// Dark mode colors (original)
export const DARK_COLORS = {
  // Primary brand color
  primary: '#09A469',

  // Grays
  dim: '#666666',
  gray: '#666666',
  white: '#cccccc',
  darkBg: '#111111',
  black: '#000000',
  bg: '#000000',
  fg: '#cccccc',

  // Accents
  yellow: '#e0af68',
  blue: '#7aa2f7',
  red: '#f7768e',
  green: '#09A469',

  // Borders
  border: '#333333',
} as const

// Light mode colors
export const LIGHT_COLORS = {
  // Primary brand color
  primary: '#0d8f5a',

  // Grays
  dim: '#666666',
  gray: '#6b7280',
  white: '#1f2937',
  darkBg: '#f3f4f6',
  black: '#ffffff',
  bg: '#ffffff',
  fg: '#1f2937',

  // Accents
  yellow: '#d97706',
  blue: '#2563eb',
  red: '#dc2626',
  green: '#0d8f5a',

  // Borders
  border: '#d1d5db',
} as const

// Current theme state
let currentMode: ThemeMode = 'dark'

// Reactive color proxy - components import COLORS and get current theme
export const COLORS = new Proxy(DARK_COLORS, {
  get(target, prop) {
    const colors = currentMode === 'dark' ? DARK_COLORS : LIGHT_COLORS
    return colors[prop as keyof typeof DARK_COLORS] ?? target[prop as keyof typeof DARK_COLORS]
  },
})

// Get current theme mode
export function getThemeMode(): ThemeMode {
  return currentMode
}

// Set theme mode (returns true if changed)
export function setThemeMode(mode: ThemeMode): boolean {
  if (currentMode === mode) return false
  currentMode = mode
  return true
}

// Toggle between light and dark
export function toggleTheme(): ThemeMode {
  currentMode = currentMode === 'dark' ? 'light' : 'dark'
  return currentMode
}

// Apply theme from renderer's detected mode
export function applyDetectedTheme(mode: ThemeMode | null): boolean {
  if (!mode) return false
  return setThemeMode(mode)
}

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const

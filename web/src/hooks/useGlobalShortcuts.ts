/**
 * Global keyboard shortcuts (mirrors src/tui/createMultiTabApp.ts +
 * src/tui/App.ts):
 *
 *   Ctrl+T            New session
 *   Ctrl+W            Close current session
 *   Ctrl+L            Toggle light/dark theme
 *   Ctrl+1..9         Jump to session N
 *   Tab               Cycle workflow views (when not in an input)
 *   Esc               Abort running loop (when not in an input)
 *
 * Shortcuts that must work inside inputs (Ctrl+…) are handled unconditionally.
 * View cycling / abort only fire when no input is focused.
 */
import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    target.isContentEditable
  )
}

export function useGlobalShortcuts({
  onOpenLoopSetup,
}: {
  onOpenLoopSetup?: () => void
} = {}) {
  const createSession = useAppStore((s) => s.createSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const sessions = useAppStore((s) => s.sessions)
  const openSession = useAppStore((s) => s.openSession)
  const cycleView = useAppStore((s) => s.cycleView)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const abort = useAppStore((s) => s.abort)
  const running = useAppStore((s) => s.running)
  const isLoading = useAppStore((s) => s.isLoading)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey

      if (mod && e.key === 't') {
        e.preventDefault()
        void createSession()
        return
      }
      if (mod && e.key === 'w') {
        e.preventDefault()
        if (activeSessionId) void deleteSession(activeSessionId)
        return
      }
      // Ctrl+Shift+L opens the loop setup dialog; plain Ctrl+L toggles theme.
      if (mod && e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault()
        onOpenLoopSetup?.()
        return
      }
      if (mod && !e.shiftKey && e.key === 'l') {
        e.preventDefault()
        toggleTheme()
        return
      }
      if (mod && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        const i = Number(e.key) - 1
        const s = sessions[i]
        if (s) void openSession(s.id)
        return
      }

      if (!isTextInput(e.target)) {
        if (e.key === 'Tab' && !e.shiftKey) {
          e.preventDefault()
          cycleView()
          return
        }
        if (e.key === 'Escape' && (running || isLoading)) {
          e.preventDefault()
          void abort()
          return
        }
      }

    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    createSession,
    deleteSession,
    activeSessionId,
    sessions,
    openSession,
    cycleView,
    toggleTheme,
    abort,
    running,
    isLoading,
    onOpenLoopSetup,
  ])
}

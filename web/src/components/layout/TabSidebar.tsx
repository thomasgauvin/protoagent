/**
 * Left-side session list. Mirrors the TUI's TabManager (/tui/TabManager.ts).
 *
 * Since the API is single-session-per-container, "tabs" here are really the
 * set of saved sessions. Clicking a session activates it on the server and
 * (re)opens the SSE stream. `+ New` creates a fresh session.
 *
 * Two entry points:
 *   <TabSidebar />          — inline aside (lg breakpoint and up)
 *   <TabSidebarContent />   — body-only, used inside a <Sheet> drawer on
 *                              mobile/tablet. See App.tsx.
 */
import { Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import { useAppStore } from '@/store/app-store'
import { cn } from '@/lib/utils'

export interface TabSidebarContentProps {
  /** Fires after the user picks a session — used to close the drawer on mobile. */
  onNavigate?: () => void
}

export function TabSidebarContent({ onNavigate }: TabSidebarContentProps) {
  const sessions = useAppStore((s) => s.sessions)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const session = useAppStore((s) => s.session)
  const running = useAppStore((s) => s.running)
  const isLoading = useAppStore((s) => s.isLoading)
  const mcp = useAppStore((s) => s.mcp)
  const approvals = useAppStore((s) => s.approvals)
  const createSession = useAppStore((s) => s.createSession)
  const deleteSession = useAppStore((s) => s.deleteSession)
  const openSession = useAppStore((s) => s.openSession)

  return (
    <div className="flex h-full flex-col text-sm bg-background text-foreground">
      {/* Header with new session button */}
      <div className="flex flex-col gap-2 border-b border-border px-3 py-3">
        <Button
          variant="default"
          size="sm"
          className="justify-start w-full"
          onClick={() => {
            void createSession()
            onNavigate?.()
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          New session
        </Button>
      </div>

      {/* Sessions list */}
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1 px-2 py-2">
          {sessions.length === 0 && (
            <div className="px-3 py-4 text-center text-muted-foreground text-xs">
              No sessions yet. Create one to begin.
            </div>
          )}
          {sessions.map((s) => {
            const isActive = s.id === activeSessionId
            const hasApproval = approvals.some((a) => a.sessionId === s.id)
            const isRunning = isActive && (running || isLoading)
            return (
              <div
                key={s.id}
                data-active={isActive}
                data-inactive={!isActive}
                className={cn(
                  'group flex items-center justify-between gap-2 rounded-md px-3 py-2 cursor-pointer transition-all duration-150 min-h-[44px]',
                  isActive
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-foreground hover:bg-secondary/60 dark:hover:bg-secondary/40 active:bg-secondary',
                )}
                onClick={() => {
                  if (!isActive) void openSession(s.id)
                  onNavigate?.()
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    if (!isActive) void openSession(s.id)
                    onNavigate?.()
                  }
                }}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      'inline-block w-3 shrink-0 text-center text-sm',
                      hasApproval ? 'text-warning' : 'text-muted-foreground',
                    )}
                    aria-hidden
                  >
                    {isRunning ? <Spinner /> : '•'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{s.title || 'Untitled'}</div>
                  </div>
                </div>
                <button
                  className={cn(
                    'shrink-0 p-1 rounded-md transition-all duration-150',
                    'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                    'hover:bg-destructive/20 hover:text-destructive dark:hover:bg-destructive/30',
                  )}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (confirm('Delete this session?'))
                      void deleteSession(s.id)
                  }}
                  aria-label="Delete session"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
      </ScrollArea>

      {/* Session details footer */}
      {(session || mcp.length > 0) && (
        <div className="border-t border-border px-3 py-3 space-y-3 text-xs">
          {session && (
            <div className="space-y-1">
              <div className="text-muted-foreground">Current session</div>
              <div className="font-mono bg-secondary/50 dark:bg-secondary/30 rounded px-2 py-1 text-foreground break-words">
                <div className="text-xs truncate">{session.provider} · {session.model}</div>
                <div className="text-xs truncate text-muted-foreground">{session.id}</div>
              </div>
            </div>
          )}

          {mcp.length > 0 && (
            <div className="space-y-1">
              <div className="text-muted-foreground">Connected MCP servers</div>
              <div className="space-y-1">
                {mcp.map((m) => (
                  <div key={m.name} className="flex items-center justify-between px-2 py-1 bg-secondary/30 dark:bg-secondary/20 rounded text-sm">
                    <span className="truncate text-foreground">{m.name}</span>
                    <span
                      className={cn(
                        'inline-block w-2 h-2 rounded-full shrink-0 ml-2',
                        m.connected ? 'bg-success' : 'bg-destructive',
                      )}
                      title={m.connected ? 'Connected' : 'Disconnected'}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Inline version of the sidebar — only visible at `lg` (≥1024px).
 */
export function TabSidebar() {
  return (
    <aside className="hidden h-full w-[280px] shrink-0 border-r border-border bg-background lg:flex lg:flex-col">
      <TabSidebarContent />
    </aside>
  )
}

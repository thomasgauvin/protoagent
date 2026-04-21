/**
 * Top-level ProtoAgent web shell. Responsive three-pane layout.
 *
 * Desktop (≥ lg, 1024px):
 *   ┌──────────────┬─────────────────────────────────┬──────────────┐
 *   │  TabSidebar  │  MainView (chat / welcome)      │ RightSidebar │
 *   │  inline      │  ┌───────────────────────────┐  │   inline     │
 *   │              │  │ MessageHistory / Welcome  │  │              │
 *   │              │  └───────────────────────────┘  │              │
 *   │              │  │ pending interjects          │  │              │
 *   │              │  │ ChatInput / ApprovalPrompt  │  │              │
 *   ├──────────────┴──┴─────────────────────────────┴──┴──────────────┤
 *   │                         StatusBar                                │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Tablet / mobile (< lg):
 *   ┌──────────────────────────────────────────────┐
 *   │  [☰]   <active session title>          [⇱] │  ← mobile header
 *   ├──────────────────────────────────────────────┤
 *   │       MainView (chat / welcome)             │
 *   │  ChatInput / ApprovalPrompt                 │
 *   ├──────────────────────────────────────────────┤
 *   │             StatusBar                        │
 *   └──────────────────────────────────────────────┘
 *   Sidebars open as slide-in sheets triggered by the header icons.
 */
import { useEffect, useState } from 'react'
import { Menu, PanelRightOpen } from 'lucide-react'

import { TabSidebar, TabSidebarContent } from '@/components/layout/TabSidebar'
import { StatusBar } from '@/components/layout/StatusBar'
import { MessageHistory } from '@/components/chat/MessageHistory'
import { ChatInput } from '@/components/chat/ChatInput'
import { ApprovalPrompt } from '@/components/chat/ApprovalPrompt'
import { WelcomeScreen } from '@/components/chat/WelcomeScreen'
import { LoopSetupDialog } from '@/components/chat/LoopSetupDialog'
import {
  RightSidebar,
  RightSidebarContent,
} from '@/components/sidebar/RightSidebar'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { useAppStore } from '@/store/app-store'
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'

export default function App() {
  const init = useAppStore((s) => s.init)
  const activeSessionId = useAppStore((s) => s.activeSessionId)
  const session = useAppStore((s) => s.session)
  const messages = useAppStore((s) => s.messages)
  const approvals = useAppStore((s) => s.approvals)
  const interjects = useAppStore((s) => s.interjects)
  const resolveApproval = useAppStore((s) => s.resolveApproval)
  const startLoop = useAppStore((s) => s.startLoop)
  const error = useAppStore((s) => s.error)
  const clearError = useAppStore((s) => s.clearError)

  const [loopOpen, setLoopOpen] = useState(false)
  const [leftDrawer, setLeftDrawer] = useState(false)
  const [rightDrawer, setRightDrawer] = useState(false)

  useGlobalShortcuts({ onOpenLoopSetup: () => setLoopOpen(true) })

  useEffect(() => {
    void init()
  }, [init])

  // Clear transient errors after 4s.
  useEffect(() => {
    if (!error) return
    const t = setTimeout(clearError, 4000)
    return () => clearTimeout(t)
  }, [error, clearError])

  const activeApproval = approvals[0] ?? null
  const hasMessages = messages.some((m) => m.role !== 'system')
  const showWelcome = !hasMessages && !activeApproval && activeSessionId

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <TabSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile / tablet header — hidden on lg+ where the inline sidebars
            are visible. */}
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-tui px-2 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open sessions"
            onClick={() => setLeftDrawer(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1 truncate px-2 text-center text-sm text-tui-white">
            {session?.title || 'ProtoAgent'}
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open workflow panel"
            onClick={() => setRightDrawer(true)}
          >
            <PanelRightOpen className="h-5 w-5" />
          </Button>
        </header>

        {showWelcome ? (
          <WelcomeScreen />
        ) : (
          <>
            <MessageHistory />

            {interjects.length > 0 && (
              <div className="mx-2 mb-1 rounded-sm border border-tui-yellow bg-background/50 px-3 py-1 text-sm md:mx-4">
                <div className="font-bold text-tui-yellow">
                  Pending interjects:
                </div>
                {interjects.map((q, i) => (
                  <div key={i} className="text-tui-white">
                    {q.content}
                  </div>
                ))}
              </div>
            )}

            {activeApproval ? (
              <ApprovalPrompt
                approval={activeApproval}
                onResolve={(d) => void resolveApproval(activeApproval.id, d)}
              />
            ) : (
              <ChatInput />
            )}
          </>
        )}

        <StatusBar />
      </div>

      <RightSidebar />

      {/* Mobile drawers */}
      <Sheet open={leftDrawer} onOpenChange={setLeftDrawer}>
        <SheetContent
          side="left"
          className="w-[85%] max-w-xs p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">Sessions</SheetTitle>
          <SheetDescription className="sr-only">
            Switch between saved ProtoAgent sessions.
          </SheetDescription>
          <TabSidebarContent onNavigate={() => setLeftDrawer(false)} />
        </SheetContent>
      </Sheet>

      <Sheet open={rightDrawer} onOpenChange={setRightDrawer}>
        <SheetContent
          side="right"
          className="w-[85%] max-w-sm p-0"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">Workflow</SheetTitle>
          <SheetDescription className="sr-only">
            Workflow, TODOs, queue, and usage details for the active session.
          </SheetDescription>
          <RightSidebarContent />
        </SheetContent>
      </Sheet>

      <LoopSetupDialog
        open={loopOpen}
        onCancel={() => setLoopOpen(false)}
        onStart={(config) => {
          setLoopOpen(false)
          void startLoop(config)
        }}
      />
    </div>
  )
}

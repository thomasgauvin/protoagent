/**
 * Bottom status bar. Mirrors src/tui/StatusBar.ts.
 *
 * Row 1: spinner + activity ("Thinking…" / "Running <tool>…" / "Awaiting
 * approval…" / "Error: …") plus small pills for queued/interject counts.
 * Row 2: current view indicator, MCP connection count, token usage, ctx %,
 * running cost.
 */
import { useAppStore } from '@/store/app-store'
import { Spinner } from '@/components/ui/spinner'
import { cn, formatCost } from '@/lib/utils'

export function StatusBar() {
  const isLoading = useAppStore((s) => s.isLoading)
  const isStreaming = useAppStore((s) => s.isStreaming)
  const running = useAppStore((s) => s.running)
  const runningToolCalls = useAppStore((s) => s.runningToolCalls)
  const approvals = useAppStore((s) => s.approvals)
  const error = useAppStore((s) => s.error)
  const interjects = useAppStore((s) => s.interjects)
  const queued = useAppStore((s) => s.queued)
  const view = useAppStore((s) => s.view)
  const mcp = useAppStore((s) => s.mcp)
  const usage = useAppStore((s) => s.usage)
  const totalCost = useAppStore((s) => s.totalCost)
  const copiedNotice = useAppStore((s) => s.copiedNotice)

  const activeTool = Object.values(runningToolCalls)[0]
  const awaitingApproval = approvals.length > 0
  const busy = isLoading || isStreaming || running

  let statusNode: React.ReactNode = null
  if (copiedNotice) {
    statusNode = <span className="text-success font-medium">{copiedNotice} ✓</span>
  } else if (error) {
    statusNode = <span className="text-destructive font-medium">Error: {error}</span>
  } else if (awaitingApproval) {
    statusNode = <span className="text-warning font-medium">Awaiting approval…</span>
  } else if (busy) {
    statusNode = (
      <span className="text-primary font-medium">
        <Spinner />{' '}
        {activeTool ? `Running ${activeTool.name}…` : 'Thinking…'}
      </span>
    )
  }

  const viewColor = {
    bot: 'text-card-foreground',
    queue: 'text-info',
    loop: 'text-primary',
    cron: 'text-warning',
  }[view]

  const connectedMcp = mcp.filter((m) => m.connected).length

  return (
    <div className="flex flex-col gap-1 border-t border-border bg-card px-3 py-2 text-xs text-muted-foreground">
      <div className="flex min-h-[20px] items-center gap-3">
        {statusNode}
        {interjects.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-warning/10 text-warning border border-warning/30 font-semibold">
            {interjects.length} interject
          </span>
        )}
        {queued.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-info/10 text-info border border-info/30 font-semibold">
            {queued.length} queued
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 overflow-x-auto">
        <span className={cn('font-semibold px-2 py-0.5 rounded bg-secondary/50 dark:bg-secondary/30', viewColor)}>
          [{view}]
        </span>
        {mcp.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary/50 dark:bg-secondary/30 font-mono text-foreground">
            mcp: <span className="font-semibold">{connectedMcp}/{mcp.length}</span>
          </span>
        )}
        <span className="font-mono text-foreground">in: {usage.inputTokens}</span>
        <span className="font-mono text-foreground">out: {usage.outputTokens}</span>
        <span className="font-mono text-foreground">ctx: {usage.contextPercent.toFixed(0)}%</span>
        <span className="font-mono text-foreground">{formatCost(totalCost)}</span>
      </div>
    </div>
  )
}

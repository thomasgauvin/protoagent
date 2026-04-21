/**
 * Right sidebar (mirrors src/tui/RightSidebar.ts):
 *   1. Workflow header + compact diagram
 *   2. TODOs with cycle-on-click statuses
 *   3. Contextual section (Queue / Loop progress / Cron next-run)
 *   4. Usage row (tokens & cost)
 */
import { cn, formatCost, formatRelative } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import type {
  TodoItem,
  TodoPriority,
  TodoStatus,
  WorkflowType,
} from '@/types'

const STATUS_ICON: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
  cancelled: '[-]',
}

const STATUS_COLOR: Record<TodoStatus, string> = {
  pending: 'text-card-foreground',
  in_progress: 'text-warning',
  completed: 'text-success',
  cancelled: 'text-muted-foreground',
}

const PRIORITY_LETTER: Record<TodoPriority, string> = {
  high: 'H',
  medium: 'M',
  low: 'L',
}

const PRIORITY_COLOR: Record<TodoPriority, string> = {
  high: 'text-destructive',
  medium: 'text-warning',
  low: 'text-muted-foreground',
}

const WORKFLOW_LABEL: Record<WorkflowType, string> = {
  queue: 'Queue',
  loop: 'Loop',
  cron: 'Cron',
}

const QUEUE_DIAGRAM = ` ┌─┐ ┌─┐ ┌─┐
 │A│→│B│→│C│
 └─┘ └─┘ └─┘`

const LOOP_DIAGRAM = `  ┌──────┐
  │ Work │
  └──┬───┘
     ↓
   ┌────┐
   │ ✓? │─→
   └────┘`

const CRON_DIAGRAM = `  ┌──────┐
  │  ⏰  │
  └──┬───┘
     ↓
   ┌────┐
   │Run │
   └──┬─┘
      ↓
   [Wait]`

function diagramFor(type: WorkflowType): string {
  return type === 'loop'
    ? LOOP_DIAGRAM
    : type === 'cron'
      ? CRON_DIAGRAM
      : QUEUE_DIAGRAM
}

/**
 * Body of the right sidebar (without the outer `<aside>` chrome). Rendered
 * both inline on desktop and inside a mobile <Sheet> drawer.
 */
export function RightSidebarContent() {
  const workflow = useAppStore((s) => s.workflow)
  const loopInfo = useAppStore((s) => s.loopInfo)
  const cronInfo = useAppStore((s) => s.cronInfo)
  const todos = useAppStore((s) => s.todos)
  const queued = useAppStore((s) => s.queued)
  const interjects = useAppStore((s) => s.interjects)
  const usage = useAppStore((s) => s.usage)
  const totalCost = useAppStore((s) => s.totalCost)
  const setWorkflowType = useAppStore((s) => s.setWorkflowType)
  const cycleTodoStatus = useAppStore((s) => s.cycleTodoStatus)

  return (
    <div className="flex h-full flex-col bg-card text-foreground text-xs">
      {/* Workflow header. `pr-10` reserves room for the sheet close button
          when this panel is rendered inside a mobile drawer. */}
      <div className="flex items-center justify-between gap-2 px-3 py-3 pr-10 lg:pr-3 border-b border-border">
        <div className="flex min-w-0 items-center gap-2">
          <span className="font-bold text-card-foreground text-sm">Workflow</span>
          <span
            className={cn(
              'uppercase font-semibold text-xs px-2 py-0.5 rounded',
              workflow.type === 'loop' && 'bg-primary/10 text-primary border border-primary/30',
              workflow.type === 'cron' && 'bg-warning/10 text-warning border border-warning/30',
              workflow.type === 'queue' && 'bg-info/10 text-info border border-info/30',
            )}
          >
            {WORKFLOW_LABEL[workflow.type]}
          </span>
          {workflow.isActive && (
            <span className={cn(
              'inline-block w-2 h-2 rounded-full',
              workflow.type === 'loop' && 'bg-primary',
              workflow.type === 'cron' && 'bg-warning',
              workflow.type === 'queue' && 'bg-info',
            )} title="Active" />
          )}
        </div>
        <div className="flex shrink-0 gap-1">
          {(['queue', 'loop', 'cron'] as WorkflowType[]).map((t) => (
            <Button
              key={t}
              size="sm"
              variant={workflow.type === t ? 'default' : 'ghost'}
              className={cn(
                'h-7 px-2 text-[11px] font-semibold',
              )}
              onClick={() => void setWorkflowType(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>
      <pre className="px-3 py-2 text-[10px] leading-tight text-muted-foreground whitespace-pre overflow-x-auto font-mono">
        {diagramFor(workflow.type)}
      </pre>

      <Separator />

      {/* TODOs */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="font-bold text-card-foreground text-sm">TODOs</span>
        <span className="text-muted-foreground bg-secondary/50 dark:bg-secondary/30 px-2 py-0.5 rounded text-xs">({todos.length})</span>
      </div>
      <ScrollArea className="max-h-48 flex-shrink-0">
        <div className="flex flex-col gap-1 px-3 py-2">
          {todos.length === 0 && (
            <div className="text-muted-foreground py-2">No TODOs.</div>
          )}
          {todos.map((t) => (
            <TodoRow
              key={t.id}
              todo={t}
              onClick={() => void cycleTodoStatus(t.id)}
            />
          ))}
        </div>
      </ScrollArea>

      <Separator />

      {/* Contextual */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2 border-b border-border">
        {workflow.type === 'queue' && (
          <QueueContext
            queued={queued.map((q) => q.content)}
            interjects={interjects.map((q) => q.content)}
          />
        )}
        {workflow.type === 'loop' && (
          <LoopContext
            workflow={workflow}
            progress={loopInfo?.progress}
            maxIterations={loopInfo?.config.maxIterations}
          />
        )}
        {workflow.type === 'cron' && cronInfo && (
          <CronContext info={cronInfo} />
        )}
      </div>

      <div className="px-3 py-2 text-muted-foreground font-mono text-xs space-y-1 bg-secondary/20 dark:bg-secondary/10 rounded">
        <div className="flex justify-between">
          <span>input</span>
          <span className="text-card-foreground font-semibold">{usage.inputTokens}</span>
        </div>
        <div className="flex justify-between">
          <span>output</span>
          <span className="text-card-foreground font-semibold">{usage.outputTokens}</span>
        </div>
        <div className="flex justify-between">
          <span>context</span>
          <span className="text-card-foreground font-semibold">{usage.contextPercent.toFixed(0)}%</span>
        </div>
        <div className="flex justify-between border-t border-border/50 pt-1">
          <span>cost</span>
          <span className="text-warning font-semibold">{formatCost(totalCost)}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Inline desktop version — rendered as a fixed-width aside beside the main
 * chat area. Hidden below `lg`.
 */
export function RightSidebar() {
  return (
    <aside className="hidden h-full w-[320px] shrink-0 border-l border-border bg-card lg:flex lg:flex-col">
      <RightSidebarContent />
    </aside>
  )
}

function TodoRow({
  todo,
  onClick,
}: {
  todo: TodoItem
  onClick: () => void
}) {
  const text = todo.content.length > 24 ? todo.content.slice(0, 24) + '…' : todo.content
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-150',
        'hover:bg-secondary/50 dark:hover:bg-secondary/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
      )}
    >
      <span className={cn('font-mono text-sm', STATUS_COLOR[todo.status])}>
        {STATUS_ICON[todo.status]}
      </span>
      <span className={cn('font-mono text-xs px-1.5 py-0.5 rounded', PRIORITY_COLOR[todo.priority], 'bg-secondary/40 dark:bg-secondary/20')}>
        {PRIORITY_LETTER[todo.priority]}
      </span>
      <span className="truncate text-card-foreground text-sm flex-1">{text}</span>
    </button>
  )
}

function QueueContext({
  queued,
  interjects,
}: {
  queued: string[]
  interjects: string[]
}) {
  const total = queued.length + interjects.length
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="font-bold text-card-foreground text-sm">Queue</span>
        <span className="text-muted-foreground bg-secondary/50 dark:bg-secondary/30 px-2 py-0.5 rounded text-xs">({total})</span>
      </div>
      <div className="flex max-h-[180px] flex-col gap-1 overflow-y-auto px-2">
        {total === 0 && <div className="text-muted-foreground text-sm italic">Empty.</div>}
        {interjects.map((content, i) => (
          <div key={`i${i}`} className="truncate bg-destructive/10 border border-destructive/30 rounded px-2 py-1">
            <span className="text-destructive font-bold">!! </span>
            <span className="text-card-foreground text-sm">{content}</span>
          </div>
        ))}
        {queued.map((content, i) => (
          <div key={`q${i}`} className="truncate bg-info/10 border border-info/30 rounded px-2 py-1">
            <span className="text-info font-bold">→ </span>
            <span className="text-card-foreground text-sm">{content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LoopContext({
  workflow,
  progress,
  maxIterations,
}: {
  workflow: { loopInstructions?: string; endCondition?: string; phase?: string; iterationCount: number }
  progress?: { currentIteration: number; phase: string }
  maxIterations?: number
}) {
  const phase = progress?.phase ?? workflow.phase ?? 'idle'
  const current = progress?.currentIteration ?? workflow.iterationCount ?? 0
  const max = maxIterations ?? 10
  return (
    <div className="space-y-2">
      {workflow.loopInstructions && (
        <div className="px-2 py-1.5 bg-secondary/30 dark:bg-secondary/20 rounded border border-border/50">
          <span className="text-muted-foreground text-xs">Work</span>
          <div className="text-card-foreground text-sm mt-1 truncate">{workflow.loopInstructions}</div>
        </div>
      )}
      {workflow.endCondition && (
        <div className="px-2 py-1.5 bg-secondary/30 dark:bg-secondary/20 rounded border border-border/50">
          <span className="text-muted-foreground text-xs">Until</span>
          <div className="text-card-foreground text-sm mt-1 truncate">{workflow.endCondition}</div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div className="px-2 py-1 bg-secondary/40 dark:bg-secondary/30 rounded border border-border/50 text-center">
          <span className="text-muted-foreground text-xs block">Progress</span>
          <span className="text-card-foreground font-semibold text-sm">{current}/{max}</span>
        </div>
        <div className="col-span-2 px-2 py-1 bg-secondary/40 dark:bg-secondary/30 rounded border border-border/50">
          <span className="text-muted-foreground text-xs">Status</span>
          <span
            className={cn(
              'text-sm font-semibold block mt-0.5',
              phase === 'working' && 'text-primary',
              phase === 'evaluating' && 'text-warning',
              phase === 'idle' && 'text-muted-foreground',
            )}
          >
            {phase}
          </span>
        </div>
      </div>
    </div>
  )
}

function CronContext({
  info,
}: {
  info: {
    schedule?: string
    prompt?: string
    nextRunAt?: string
    lastRunAt?: string
  }
}) {
  return (
    <div className="space-y-2">
      <div className="px-2 py-1.5 bg-secondary/30 dark:bg-secondary/20 rounded border border-border/50">
        <span className="text-muted-foreground text-xs">Schedule</span>
        <div className="text-card-foreground text-sm font-mono mt-0.5">{info.schedule ?? '–'}</div>
      </div>
      {info.prompt && (
        <div className="px-2 py-1.5 bg-secondary/30 dark:bg-secondary/20 rounded border border-border/50">
          <span className="text-muted-foreground text-xs">Prompt</span>
          <div className="text-card-foreground text-sm mt-1 truncate">{info.prompt}</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="px-2 py-1 bg-secondary/40 dark:bg-secondary/30 rounded border border-border/50">
          <span className="text-muted-foreground text-xs">Next run</span>
          <div className="text-card-foreground text-sm font-mono truncate mt-0.5">
            {info.nextRunAt ? formatRelative(info.nextRunAt) : '–'}
          </div>
        </div>
        <div className="px-2 py-1 bg-secondary/40 dark:bg-secondary/30 rounded border border-border/50">
          <span className="text-muted-foreground text-xs">Last run</span>
          <div className="text-card-foreground text-sm font-mono truncate mt-0.5">
            {info.lastRunAt ? formatRelative(info.lastRunAt) : '–'}
          </div>
        </div>
      </div>
    </div>
  )
}

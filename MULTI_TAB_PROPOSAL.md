# Multi-Tab TUI Implementation Proposal

## Overview

Add tabbed interface support to ProtoAgent TUI so users can run multiple
fully independent agent sessions within a single terminal. Each tab gets
its own OpenAI client, MCP connections, agent loop, message queue, TODOs,
approval handler, and UI components. Nothing is shared between tabs except
the terminal renderer and the read-only config.

## Feasibility

OpenTUI ships a production-ready `TabSelectRenderable` component with
keyboard navigation, mouse click support, scrollable overflow arrows,
and configurable styling. The UI part of tabs is solved.

The hard part is that the current codebase assumes a single running
instance. Several modules store mutable state at module scope (singletons).
These must be refactored into instance-scoped classes before multiple tabs
can coexist. This refactor is the majority of the work.

**Difficulty: 7/10** — straightforward conceptually, tedious in practice.

## The Singleton Problem

The following modules use module-level mutable state that will break with
multiple tabs if left unchanged:

### 1. Tool Registry (`src/tools/index.ts`)

```
let dynamicTools: DynamicTool[] = []                    // one global list
const dynamicHandlers = new Map<string, handler>()      // one global map
```

`registerDynamicTool()` and `registerDynamicHandler()` write to these
globals. If Tab 1 and Tab 2 both initialize MCP servers, Tab 2's
`registerDynamicHandler('mcp_chrome_navigate')` overwrites Tab 1's
handler. When Tab 1 closes and calls cleanup, it unregisters tools
that Tab 2 is still using.

`getAllTools()` returns one combined list — both tabs see each other's
MCP tools. `handleToolCall()` dispatches from the shared handler map.

The agentic loop (`src/agentic-loop.ts:22,183`) and the sub-agent
(`src/sub-agent.ts:13`) both import `getAllTools` and `handleToolCall`
directly from this module.

### 2. MCP Connections (`src/mcp.ts`)

```
const connections = new Map<string, McpConnection>()    // one global pool
```

`initializeMcp()` populates this global map. `closeMcp()` clears it
entirely. If Tab 1 calls `closeMcp()`, Tab 2's MCP connections are
gone. The reconnection logic (`ensureConnected`) also operates on
this shared map.

### 3. Approval System (`src/utils/approval.ts`)

```
let approvalHandler: ((req) => Promise<response>) | null = null   // single callback
let dangerouslySkipPermissions = false                             // single flag
const sessionApprovals = new Set<string>()                         // shared set
```

There is one `approvalHandler` callback. If both tabs set their own
handler, the last one wins. If Tab 1 has a pending approval prompt
and the user switches to Tab 2, there is no way to route the approval
response back to Tab 1.

`sessionApprovals` is a shared Set. An "approve for session" in Tab 1
would also auto-approve the same operation type in Tab 2 (since the
Set is not partitioned by tab).

### 4. TODO Store (`src/tools/todo.ts`)

```
const todosBySession = new Map<string, TodoItem[]>()    // shared map
```

Already keyed by session ID, so tabs with different sessions won't
collide. But if two tabs share the same session ID (e.g. restored
from the same session), they'd mutate the same array. Low risk since
each tab should have a unique session.

### 5. Message Queue (`src/message-queue.ts`)

```
const messageQueuesBySession = new Map<string, QueuedMessage[]>()
```

Same situation as TODOs — keyed by session ID, safe as long as
sessions are unique per tab.

### 6. Runtime Config Cache (`src/runtime-config.ts`)

```
let runtimeConfigCache: RuntimeConfigFile | null = null
```

Read-only after initial load. Safe to share across tabs — no mutation
after startup.

## Architecture

### Current
```
createApp() — single instance
├── Module-level singletons
│   ├── tools/index.ts    → dynamicTools[], dynamicHandlers Map
│   ├── mcp.ts            → connections Map
│   ├── approval.ts       → approvalHandler, sessionApprovals Set
│   ├── todo.ts           → todosBySession Map
│   └── message-queue.ts  → messageQueuesBySession Map
├── Local state (completionMessages, streaming, usage, etc.)
├── UI components (MessageHistory, TodoSidebar, InputBar, StatusBar)
└── OpenAI client + agent loop
```

### Proposed
```
TabManager (top level, owns the terminal)
├── TabSelectRenderable (tab bar)
├── Read-only shared resources
│   ├── Renderer (one terminal)
│   ├── Config (immutable after load)
│   └── Runtime config cache (immutable after load)
└── Tab[] (fully isolated instances)
    └── TabApp
        ├── Own OpenAI client
        ├── Own ToolRegistry instance
        ├── Own McpManager instance
        ├── Own ApprovalManager instance
        ├── Own TodoStore instance
        ├── Own MessageQueue instance
        ├── Own AbortController
        ├── Own UI tree (MessageHistory, TodoSidebar, etc.)
        └── Own agent loop state
```

## Implementation Plan

### Phase 0: Refactor Singletons → Injectable Classes

This is the prerequisite. No tab work happens until this is done.

**0a. ToolRegistry class** (`src/tools/registry.ts`)

Extract `dynamicTools` and `dynamicHandlers` into a class:

```typescript
export class ToolRegistry {
  private dynamicTools: DynamicTool[] = []
  private dynamicHandlers = new Map<string, (args: any) => Promise<string>>()

  registerDynamicTool(tool: DynamicTool): void
  unregisterDynamicTool(name: string): void
  registerDynamicHandler(name: string, handler): void
  unregisterDynamicHandler(name: string): void
  getAllTools(): Tool[]
  handleToolCall(name: string, args: any, ctx: ToolCallContext): Promise<string>
}
```

The built-in tools (`read_file`, `bash`, etc.) are stateless functions,
so they stay as imports. Only the dynamic tool/handler state moves into
the class.

Update call sites:
- `agentic-loop.ts` — accept `ToolRegistry` as a parameter instead of
  importing `getAllTools`/`handleToolCall`
- `sub-agent.ts` — accept `ToolRegistry` as a parameter
- `agentic-loop/executor.ts` — accept `ToolRegistry` as a parameter
- `mcp.ts` — accept `ToolRegistry` in `registerMcpTools()` instead of
  importing `registerDynamicTool`/`registerDynamicHandler`

**0b. McpManager class** (`src/mcp.ts`)

Wrap the `connections` Map and all connect/reconnect/close logic:

```typescript
export class McpManager {
  private connections = new Map<string, McpConnection>()

  constructor(private toolRegistry: ToolRegistry)
  async initialize(): Promise<void>     // reads config, connects all servers
  async close(): Promise<void>          // closes all connections
  async reconnectAll(): Promise<void>
  getStatus(): Record<string, { connected: boolean; error?: string }>
}
```

Each tab creates its own `McpManager`, which registers MCP tools into
that tab's `ToolRegistry`. When the tab closes, `mcpManager.close()`
only affects that tab's connections.

**0c. ApprovalManager class** (`src/utils/approval.ts`)

```typescript
export class ApprovalManager {
  private handler: ((req) => Promise<response>) | null = null
  private sessionApprovals = new Set<string>()
  private dangerouslySkip = false

  setHandler(handler): void
  clearHandler(): void
  setDangerouslySkip(value: boolean): void
  async requestApproval(req: ApprovalRequest): Promise<boolean>
}
```

Each tab creates its own `ApprovalManager`. The approval prompt in
Tab 1's UI resolves Tab 1's `ApprovalManager` callback. Switching
tabs doesn't interfere.

Update call sites:
- `tools/write-file.ts`, `tools/edit-file.ts`, `tools/bash.ts` — these
  call `requestApproval()`. They need to receive the `ApprovalManager`
  via the `ToolCallContext` (already passed through the tool dispatch).

Expand `ToolCallContext`:
```typescript
export interface ToolCallContext {
  sessionId?: string
  abortSignal?: AbortSignal
  approvalManager?: ApprovalManager   // NEW
}
```

**0d. TodoStore and MessageQueue** — already session-scoped via Maps
keyed by session ID. No refactoring strictly needed as long as each tab
has a unique session ID. However, for cleanliness, could optionally
extract into instance classes. Low priority.

### Phase 1: Extract TabApp Class

**File**: `src/tui/TabApp.ts`

Move all state and logic from `createApp()` into a class. Each TabApp
owns:

```typescript
export class TabApp {
  // Isolated infrastructure
  private client: OpenAI
  private toolRegistry: ToolRegistry
  private mcpManager: McpManager
  private approvalManager: ApprovalManager
  private abortController: AbortController | null = null

  // Isolated state
  private session: Session
  private completionMessages: Message[] = []
  private streamingText = ''
  private isLoading = false
  private totalCost = 0
  // ... rest of current App.ts state

  // Isolated UI
  readonly rootBox: BoxRenderable       // container for this tab's entire UI
  private msgHistory: MessageHistory
  private todoSidebar: TodoSidebar
  private inputBar: InputBar
  private statusBar: StatusBar

  constructor(ctx: { renderer, config, sessionId? })
  async initialize(): Promise<void>     // build client, init MCP, create UI
  async close(): Promise<void>          // save session, close MCP, cleanup

  // Delegated from TabManager
  handleKeyPress(key: KeyEvent): boolean
  setVisible(visible: boolean): void
  getTitle(): string
  getDescription(): string
}
```

The constructor creates the OpenAI client, ToolRegistry, McpManager,
ApprovalManager, and all UI components. The `rootBox` contains the
full layout (message history, sidebar, status, input) and can be
added/removed from the renderer tree to show/hide the tab.

### Phase 2: Create TabManager

**File**: `src/tui/TabManager.ts`

```typescript
export class TabManager {
  private tabs = new Map<string, TabApp>()
  private activeTabId: string | null = null
  private tabSelect: TabSelectRenderable
  private contentBox: BoxRenderable

  constructor(renderer, config)

  async createTab(sessionId?: string): Promise<TabApp>
    // 1. Create TabApp (which creates its own client, MCP, etc.)
    // 2. Initialize it
    // 3. Add rootBox to contentBox (hidden)
    // 4. Update tabSelect options
    // 5. Switch to it

  async switchTab(tabId: string): void
    // 1. Hide current tab's rootBox
    // 2. Show new tab's rootBox
    // 3. Update tabSelect selection
    // 4. Focus new tab's input

  async closeTab(tabId: string): void
    // 1. Save session
    // 2. tab.close() — disposes client, MCP, UI
    // 3. Remove from map
    // 4. Switch to adjacent tab or exit if last

  private updateTabOptions(): void
    // Rebuild tabSelect.options from current tabs
```

### Phase 3: Wire Up App Entry Point

Replace the current `createApp()` body with TabManager initialization:

```typescript
export async function createApp(renderer, options): Promise<void> {
  const config = readConfig('active')
  const tabManager = new TabManager(renderer, config)

  // Create initial tab
  await tabManager.createTab(options.sessionId)

  // Global keyboard handling
  renderer.keyInput.on('keypress', (key) => {
    // Global shortcuts first (only when input is NOT focused or
    // with modifier keys so they don't conflict with typing)
    if (key.meta && key.name === 'n') { tabManager.createTab(); return }
    if (key.meta && key.name === 'w') { tabManager.closeCurrentTab(); return }
    if (key.meta && key.name === 'left')  { tabManager.prevTab(); return }
    if (key.meta && key.name === 'right') { tabManager.nextTab(); return }

    // Delegate everything else to active tab
    tabManager.activeTab?.handleKeyPress(key)
  })
}
```

### Phase 4: Session Persistence (Optional)

Add a tab manifest file so open tabs can be restored on restart:

```json
{
  "version": 1,
  "openTabs": ["session-abc", "session-def"],
  "activeTabId": "session-abc"
}
```

Low priority — can ship without this. Users can always open new tabs
and load sessions manually.

## UI/UX Design

### Layout
```
┌─ [Session A ●] ─ [Session B] ─ [+] ────────────────────────────────┐
├──────────────────────────────────────────────────────────────────────┤
│ Chat History                               │ TODOs                   │
│                                            │                         │
├────────────────────────────────────────────┴─────────────────────────┤
│ Thinking...                                                          │
│ in:123 out:456  $0.0012                                              │
│ ┌──────────────────────────────────────────────────────────────────┐ │
│ │ > [type here]                                                    │ │
│ └──────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

The `●` indicator shows which tab has an active agent loop running.

### Keyboard Shortcuts

All tab shortcuts use `Alt` modifier to avoid conflicts with typing:

| Key | Action |
|-----|--------|
| `Alt+N` | New tab |
| `Alt+W` | Close current tab |
| `Alt+Left` | Previous tab |
| `Alt+Right` | Next tab |
| `Alt+1`..`Alt+9` | Jump to tab N (optional) |
| Click tab | Switch to tab |

`[` and `]` are **not** used — they are normal typing characters and
would conflict with text input.

### Tab Title

Auto-generated from the session's first user message (using the existing
`generateTitle()` function), truncated to fit `tabWidth`. Falls back to
`"New Tab"` for empty sessions. Shows `●` suffix when that tab's agent
loop is running.

## Resource and Memory Considerations

### What Each Tab Costs

| Resource | Per-Tab Cost | Notes |
|----------|-------------|-------|
| OpenAI SDK client | ~2-5 MB | Thin HTTP wrapper, negligible |
| MCP connections (stdio) | ~20-100 MB per server | Subprocess memory (e.g. Chrome DevTools MCP is heavy) |
| MCP connections (HTTP) | ~1 MB per server | Just an HTTP client |
| completionMessages | Variable (1-50 MB) | Grows with conversation length |
| UI components | ~1-2 MB | Renderable tree, text buffers |
| **Typical total** | **~30-160 MB** | Depends heavily on which MCPs are configured |

The main cost is MCP subprocesses. If you have Chrome DevTools MCP
configured, each tab spawns a new Chrome process. This is the correct
behavior (isolation), but users should be aware.

### API Rate Limits

Rate limits are **per API key**, not per client instance. Two tabs with
the same API key share the same rate limit quota. This is not a problem
in practice (the OpenAI SDK handles 429 retries internally), but it
means "independent rate limiting per tab" is not accurate — they share
a quota.

### Tab Limits

Consider a soft limit (e.g. 10 tabs) with a warning, not a hard cap.
The real constraint is MCP subprocess memory.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Singleton refactor breaks existing behavior | Medium | High | Refactor singleton modules first (Phase 0), test single-tab mode before adding multi-tab |
| MCP subprocess memory with many tabs | Medium | Medium | Lazy-init MCP (only connect when tab first needs tools), show memory warning for heavy MCPs |
| Approval prompt confusion across tabs | Low | Medium | Show tab name in approval prompt, only route approvals to active tab's ApprovalManager |
| Keyboard shortcut conflicts | Low | Low | All tab shortcuts require Alt modifier, never conflict with typing |
| Session save race conditions | Very Low | Low | Session IDs are unique per tab, no conflict |

## Estimated Timeline

| Phase | Work | Days |
|-------|------|------|
| 0a. ToolRegistry class + update call sites | Refactor tools/index.ts, agentic-loop.ts, sub-agent.ts, executor.ts, mcp.ts | 2-3 |
| 0b. McpManager class | Refactor mcp.ts into instance class | 1-2 |
| 0c. ApprovalManager class + plumb through ToolCallContext | Refactor approval.ts, update tool files | 1-2 |
| 1. Extract TabApp class from App.ts | Move all App state/logic into TabApp, verify single-tab still works | 2-3 |
| 2. Create TabManager | Tab bar, create/switch/close lifecycle | 2-3 |
| 3. Wire up entry point + keyboard routing | Replace createApp, add Alt+shortcuts | 1 |
| 4. Testing & polish | Multi-tab stress testing, edge cases, UI polish | 2-3 |
| **Total** | | **11-17 days** |

Phase 0 (singleton refactor) is ~40% of the total work. It is also
useful independent of tabs — it makes the codebase more testable and
easier to reason about.

## Implementation Order

The phases should be done **strictly in order**. Each phase should be
tested independently before moving on.

1. **Phase 0a** (ToolRegistry) — this is the most invasive change since
   it touches the agentic loop, sub-agent, executor, and MCP. Get it
   right first.
2. **Phase 0b** (McpManager) — depends on ToolRegistry existing.
3. **Phase 0c** (ApprovalManager) — depends on ToolCallContext being
   expanded.
4. **Checkpoint**: Run the app in single-tab mode. Everything should
   work exactly as before. All state is now instance-scoped but only
   one instance exists.
5. **Phase 1** (TabApp) — mechanical extraction of App.ts into a class.
6. **Phase 2** (TabManager) — the actual tab UI.
7. **Phase 3** (wiring) — connect it all.
8. **Phase 4** (testing) — multi-tab stress testing.

## Summary

The tab UI is easy (OpenTUI's TabSelectRenderable handles it). The real
work is refactoring 6 module-level singletons into injectable class
instances so that multiple tabs don't stomp on each other's state. This
refactor is roughly 40% of the effort but is a prerequisite — without
it, tabs will silently corrupt each other.

Estimated total: **11-17 days**. The singleton refactor (Phase 0) can
be done incrementally and has standalone value even if tabs are deferred.

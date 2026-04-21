/**
 * TabApp — Wrapper that manages a single tab/session instance.
 *
 * This class wraps the existing createApp() function with injectable managers.
 * Each tab gets its own TabApp instance with isolated:
 *  - ToolRegistry (per-tab tool management, especially for MCP tools)
 *  - McpManager (per-tab MCP connections)
 *  - ApprovalManager (per-tab approval handling)
 *
 * The TabApp coordinates initialization and cleanup of a single session.
 */

import { type CliRenderer, BoxRenderable } from '@opentui/core'
import type { Config } from '../config-core.js'
import type { Session } from '../sessions.js'
import { ToolRegistry } from '../tools/registry.js'
import { McpManager } from '../mcp/manager.js'
import { ApprovalManager } from '../utils/approval-manager.js'
import { createApp, type AppOptions } from './App.js'
import { TabRuntime } from './tab-runtime.js'
import { clearMessageQueue } from '../message-queue.js'
import { clearTodos } from '../tools/todo.js'
import { logger } from '../utils/logger.js'

export interface TabAppConfig {
  renderer: CliRenderer
  options: AppOptions
  container?: BoxRenderable
  initialMessage?: string
  title?: string
  onQuitAll?: () => Promise<void>
}

/**
 * TabApp — represents a single tab/session in the application.
 *
 * Usage:
 *   const tabApp = new TabApp({ renderer, options })
 *   await tabApp.initialize()
 *   // ... tab is now running
 *   await tabApp.close()
 */
export class TabApp {
  private renderer: CliRenderer
  private options: AppOptions
  private container?: BoxRenderable
  private toolRegistry: ToolRegistry
  private mcpManager: McpManager
  private approvalManager: ApprovalManager
  private tabRuntime: TabRuntime
  private isActive: boolean = false
  private isLoading: boolean = false
  private hasApprovalPending: boolean = false
  private rootBox?: BoxRenderable
  private title: string = 'New Agent'
  private messageCount: number = 0
  private abortController: AbortController | null = null
  private isClosed: boolean = false
  private cleanupCallbacks: Array<() => void> = []

  private initialMessage?: string

  constructor({ renderer, options, container, initialMessage, title }: TabAppConfig) {
    this.renderer = renderer
    this.options = options
    this.container = container
    this.initialMessage = initialMessage

    // Set initial title if provided (e.g., from saved session)
    if (title) {
      this.title = title
    }

    // Create per-tab managers for isolation
    this.toolRegistry = new ToolRegistry()
    this.mcpManager = new McpManager(this.toolRegistry)
    this.approvalManager = new ApprovalManager()

    // Per-tab SDK surface. Not initialized here — initialization pulls real
    // config/MCP/LLM client and is deferred until a later stage migrates the
    // hot path. Session-level reads (list/load) work without initialization.
    this.tabRuntime = new TabRuntime({
      toolRegistry: this.toolRegistry,
      dangerouslySkipPermissions: options.dangerouslySkipPermissions,
    })
  }

  /**
   * Get the current tab title
   */
  getTitle(): string {
    return this.title
  }

  /**
   * Update the tab title based on conversation
   */
  setTitle(title: string): void {
    this.title = title
  }

  /**
   * Increment message count and check if we should update title (every 100 messages)
   */
  incrementMessageCount(): void {
    this.messageCount++
  }

  /**
   * Check if we should update title (every 100 messages)
   */
  shouldUpdateTitle(): boolean {
    return this.messageCount % 100 === 0 && this.messageCount > 0
  }

  private onScrollToBottomCb?: () => void
  private onFocusInputCb?: () => void
  private onDeactivateCb?: () => void
  private ensureMainViewCb?: () => void

  /**
   * Set whether this tab is active (for input handling)
   */
  setActive(active: boolean): void {
    const wasActive = this.isActive
    this.isActive = active
    if (!active && wasActive) {
      this.onDeactivateCb?.()
    }
  }

  /**
   * Scroll the message history to the bottom.
   * Called immediately when switching to this tab to prevent visible scroll jump.
   */
  scrollToBottom(): void {
    this.onScrollToBottomCb?.()
  }

  /**
   * Focus the input bar.
   * Called after a small delay to ensure the render has completed.
   */
  focusInput(): void {
    this.onFocusInputCb?.()
  }

  /**
   * Ensure the main conversation view is shown (not the welcome screen).
   * Called when switching to a tab that was restored from a saved session.
   */
  ensureMainView(): void {
    this.ensureMainViewCb?.()
  }

  /**
   * Check if this tab is active
   */
  getIsActive(): boolean {
    return this.isActive
  }

  /**
   * Check if this tab has been closed
   */
  getIsClosed(): boolean {
    return this.isClosed
  }

  /**
   * Register the abort controller from the agentic loop.
   * Called by App.ts to allow cancellation when tab closes.
   */
  registerAbortController(abortController: AbortController): void {
    this.abortController = abortController
  }

  /**
   * Abort any running agentic loop without full cleanup.
   * Used during graceful shutdown (/quit) to stop work while preserving tab state.
   */
  abort(): void {
    if (this.abortController) {
      logger.debug(`Aborting running agentic loop for tab`)
      this.abortController.abort()
      this.abortController = null
    }
  }

  /**
   * Register a cleanup callback to be called when the tab closes.
   * Used by App.ts to register UI cleanup functions.
   */
  registerCleanupCallback(callback: () => void): void {
    this.cleanupCallbacks.push(callback)
  }

  /**
   * Initialize the tab by running the app
   */
  async initialize(): Promise<void> {
    const externalOnTitleUpdate = this.options.onTitleUpdate
    const externalOnLoadingChange = this.options.onLoadingChange
    const externalOnApprovalChange = this.options.onApprovalChange
    const externalOnFork = this.options.onFork
    const externalOnNewTab = this.options.onNewTab
    const externalOnOpenManager = this.options.onOpenManager
    const externalOnSaveAndExit = this.options.onSaveAndExit
    const externalOnPinTab = this.options.onPinTab
    const externalOnMcpReady = this.options.onMcpReady
    await createApp(this.renderer, {
      ...this.options,
      toolRegistry: this.toolRegistry,
      mcpManager: this.mcpManager,
      approvalManager: this.approvalManager,
      tabRuntime: this.tabRuntime,
      container: this.container,
      initialMessage: this.initialMessage,
      isActiveTab: () => this.isActive,
      onTitleUpdate: (title: string) => {
        this.setTitle(title)
        if (externalOnTitleUpdate) externalOnTitleUpdate(title)
      },
      onLoadingChange: (loading: boolean) => {
        this.isLoading = loading
        if (externalOnLoadingChange) externalOnLoadingChange(loading)
      },
      onApprovalChange: (pending: boolean) => {
        this.hasApprovalPending = pending
        if (externalOnApprovalChange) externalOnApprovalChange(pending)
      },
      onMcpReady: () => {
        if (externalOnMcpReady) externalOnMcpReady()
      },
      onFork: externalOnFork,
      onNewTab: externalOnNewTab,
      onOpenManager: externalOnOpenManager,
      onSaveAndExit: externalOnSaveAndExit,
      onPinTab: externalOnPinTab,
      registerScrollToBottom: (scrollToBottom: () => void) => {
        this.onScrollToBottomCb = scrollToBottom
      },
      registerFocusInput: (focusInput: () => void) => {
        this.onFocusInputCb = focusInput
      },
      registerAbortController: (abortController: AbortController) => {
        this.registerAbortController(abortController)
      },
      registerCleanupCallback: (callback: () => void) => {
        this.registerCleanupCallback(callback)
      },
      registerEnsureMainView: (ensureMainView: () => void) => {
        this.ensureMainViewCb = ensureMainView
      },
    })
  }

  /**
   * Close the tab and cleanup all resources.
   * This method ensures all processes, memory, and resources are freed.
   */
  async close(): Promise<void> {
    if (this.isClosed) {
      logger.debug(`Tab already closed, skipping cleanup`)
      return
    }

    this.isClosed = true
    logger.debug(`Closing tab and cleaning up resources`)

    // 1. Abort any running agentic loop (stops LLM requests and sub-agents)
    if (this.abortController) {
      logger.debug(`Aborting running agentic loop`)
      this.abortController.abort()
      this.abortController = null
    }

    // 2. Clear session-scoped message queue to free memory
    const sessionId = this.options.sessionId
    if (sessionId) {
      logger.debug(`Clearing message queue for session ${sessionId}`)
      clearMessageQueue(sessionId)
    }

    // 3. Clear session-scoped todos to free memory
    if (sessionId) {
      logger.debug(`Clearing todos for session ${sessionId}`)
      clearTodos(sessionId)
    }

    // 4. Close MCP connections (kills spawned processes)
    logger.debug(`Closing MCP connections`)
    await this.mcpManager.close()

    // 5. Clear the tool registry (removes tool handlers)
    logger.debug(`Clearing tool registry`)
    this.toolRegistry.clearDynamicTools()

    // 5b. Close the per-tab SDK runtime facade. Safe if uninitialized.
    try {
      await this.tabRuntime.close()
    } catch (err: any) {
      logger.warn(`Tab runtime close failed: ${err?.message || err}`)
    }

    // 6. Run registered cleanup callbacks (UI cleanup)
    logger.debug(`Running ${this.cleanupCallbacks.length} cleanup callbacks`)
    for (const callback of this.cleanupCallbacks) {
      try {
        callback()
      } catch (err: any) {
        logger.warn(`Cleanup callback failed: ${err.message}`)
      }
    }
    this.cleanupCallbacks = []

    // 7. Remove container from parent if it exists (frees UI memory)
    if (this.container) {
      logger.debug(`Removing container from parent`)
      // Container is removed from parent by TabManager, but we clear references here
      this.container = undefined
    }

    // 8. Clear references to help GC
    this.onScrollToBottomCb = undefined
    this.onFocusInputCb = undefined
    this.initialMessage = undefined
    this.options = {} as AppOptions  // Clear options reference

    logger.debug(`Tab cleanup complete`)
  }

  /**
   * Get the tool registry for this tab
   */
  getToolRegistry(): ToolRegistry {
    return this.toolRegistry
  }

  /**
   * Get the session ID for this tab
   */
  getSessionId(): string | undefined {
    return this.options.sessionId
  }

  /**
   * Whether this tab is currently running a turn.
   */
  getIsRunning(): boolean {
    return this.isLoading
  }

  /**
   * Whether this tab is currently waiting on an approval.
   */
  getHasApprovalPending(): boolean {
    return this.hasApprovalPending
  }

  /**
   * Get the MCP manager for this tab
   */
  getMcpManager(): McpManager {
    return this.mcpManager
  }

  /**
   * Get the approval manager for this tab
   */
  getApprovalManager(): ApprovalManager {
    return this.approvalManager
  }

  /**
   * Get the per-tab SDK runtime facade.
   *
   * Lazily initialized on construction but not yet fully bootstrapped; used
   * today for session-level reads and, in later stages, for the hot path.
   */
  getTabRuntime(): TabRuntime {
    return this.tabRuntime
  }
}

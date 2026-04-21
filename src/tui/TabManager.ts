/**
 * TabManager — manages multiple independent tab instances.
 *
 * Layout:
 * ┌─────────┬──────────────────────────────────────────────┐
 * │ [+] New │ Chat History          │ TODOs               │
 * │ ────    │                       │                     │
 * │ Tab 1 ⠋ │ (active tab content)  │                     │
 * │ Tab 2 ⠿ │                       │                     │
 * │ Tab 3 ⠿ │ ┌──────────────────┐  │                     │
 * │         │ │ > type here      │  │                     │
 * │         │ └──────────────────┘  │                     │
 * └─────────┴──────────────────────────────────────────────┘
 *
 * Left sidebar shows all open tabs with click to switch.
 * [+] button at top creates new tabs.
 *
 * Tab indicators:
 *   ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏ = Animated spinner = Running (green if active, gray if inactive)
 *   ⠿ = Static filled dots, white  = Active, idle
 *   ⠿ = Static filled dots, gray   = Inactive, idle
 *   ⠿ = Static filled dots, yellow = Approval pending
 */

import { type CliRenderer, BoxRenderable, TextRenderable, ScrollBoxRenderable, t, fg, bold } from '@opentui/core'
import type { Config } from '../config-core.js'
import type { TabSessionInfo } from '../multi-tab-sessions.js'
import { TabApp } from './TabApp.js'
import { ManagerTabApp } from './ManagerTabApp.js'
import { logger } from '../utils/logger.js'
import { COLORS } from './theme.js'
import { Spinner } from './Spinner.js'
import { markSessionDeleted } from '../sessions.js'

export interface TabManagerConfig {
  renderer: CliRenderer
  config: Config
  dangerouslySkipPermissions?: boolean
}

const TAB_COLORS = {
  activeIdle: COLORS.white,      // Active tab, idle: white
  activeRunning: COLORS.white,   // Active tab, running: white
  inactive: COLORS.dim,          // Inactive tab: gray
  approval: COLORS.yellow,       // Approval pending: yellow
  button: COLORS.yellow,
}

// Static filled dots indicator (used for idle and approval)
const DOTS_INDICATOR = '⠿'

/**
 * TabManager — manages multi-tab application state with left sidebar.
 */
export class TabManager {
  private renderer: CliRenderer
  private config: Config
  private tabs = new Map<string, TabApp>()
  private activeTabId: string | null = null
  private currentlyVisibleContainerId: string | null = null
  private sidebar: BoxRenderable
  private contentBox: BoxRenderable
  private tabListContainer: BoxRenderable
  private tabListScrollable: ScrollBoxRenderable
  private nextTabId = 0
  private tabButtons = new Map<string, BoxRenderable>()
  private tabTexts = new Map<string, TextRenderable>()
  private tabContainers = new Map<string, BoxRenderable>()
  private sessionInfoText: TextRenderable
  private mcpStatusBox: BoxRenderable
  private mcpStatusRows: TextRenderable[] = []
  onLastTabClosed?: () => Promise<void>

  // Per-tab loading state + shared spinner animation
  private tabLoadingState = new Map<string, boolean>()
  private tabApprovalState = new Map<string, boolean>()
  // Per-tab session info storage
  private tabSessionInfo = new Map<string, { provider: string; model: string; sessionId: string }>()
  // Per-tab pinned state
  private tabPinnedState = new Map<string, boolean>()
  private spinner: Spinner
  private dangerouslySkipPermissions: boolean
  private saveAndExitCallback?: () => Promise<void>
  private onTabsChangedCallback?: () => Promise<void>

  constructor({ renderer, config, dangerouslySkipPermissions }: TabManagerConfig) {
    this.renderer = renderer
    this.config = config
    this.dangerouslySkipPermissions = dangerouslySkipPermissions ?? false

    // Shared spinner for tab loading indicators
    this.spinner = new Spinner({
      onFrame: () => this.updateTabButtonStyles(),
    })

    // Root layout: row with sidebar + content
    const root = new BoxRenderable(renderer, {
      id: 'tab-manager-root',
      flexDirection: 'row',
      flexGrow: 1,
      maxHeight: '100%',
      maxWidth: '100%',
    })
    renderer.root.add(root)

    // Calculate responsive sidebar width based on terminal size
    const termWidth = process.stdout.columns || 120
    const sidebarWidth = termWidth >= 250 ? 48 : termWidth >= 150 ? 38 : 30

    // Left sidebar with tab list
    this.sidebar = new BoxRenderable(renderer, {
      id: 'tab-sidebar',
      flexDirection: 'column',
      flexShrink: 0,
      width: sidebarWidth,
      maxHeight: '100%',
      paddingTop: 1,
      paddingBottom: 1,
      border: ['right'],
      borderColor: COLORS.border,
    })
    root.add(this.sidebar)

    // New tab button at top of sidebar
    const newTabButton = new BoxRenderable(renderer, {
      id: 'new-tab-button',
      paddingLeft: 1,
      paddingRight: 1,
      marginTop: 1,
      marginBottom: 1,
      onMouseDown: () => this.createTab(),
    })
    const newTabText = new TextRenderable(renderer, {
      id: 'new-tab-text',
      content: t`${fg(TAB_COLORS.button)('+ New')}`,
    })
    newTabButton.add(newTabText)
    this.sidebar.add(newTabButton)

    // Manager button (★) - opens the Manager Agent tab
    const managerButton = new BoxRenderable(renderer, {
      id: 'manager-button',
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom: 1,
      onMouseDown: () => this.createManagerTab(),
    })
    const managerButtonText = new TextRenderable(renderer, {
      id: 'manager-button-text',
      content: t`${fg(COLORS.yellow)('★ Manager')}`,
    })
    managerButton.add(managerButtonText)
    this.sidebar.add(managerButton)

    // Tab list scrollable container - holds all tab buttons with scrollbar
    this.tabListScrollable = new ScrollBoxRenderable(renderer, {
      id: 'tab-list-scrollable',
      flexDirection: 'column',
      flexGrow: 1,
      flexShrink: 1,
      scrollY: true,
      scrollX: false,
      scrollbarOptions: {
        trackOptions: {},
      },
    })
    this.sidebar.add(this.tabListScrollable)

    // Tab list container - holds all tab buttons (add to content, not root)
    this.tabListContainer = new BoxRenderable(renderer, {
      id: 'tab-list-container',
      flexDirection: 'column',
      flexShrink: 0,
    })
    this.tabListScrollable.content.add(this.tabListContainer)

    // Divider line above session info + MCP section
    const sectionDivider = new BoxRenderable(renderer, {
      id: 'section-divider',
      height: 0,
      flexShrink: 0,
      border: ['top'],
      borderColor: COLORS.border,
    })
    this.sidebar.add(sectionDivider)

    // Session info at bottom of sidebar
    const sessionInfoBox = new BoxRenderable(renderer, {
      id: 'session-info-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 1,
      paddingBottom: 1,
      flexShrink: 0,
    })
    this.sessionInfoText = new TextRenderable(renderer, {
      id: 'session-info-text',
      content: t``,
    })
    sessionInfoBox.add(this.sessionInfoText)
    this.sidebar.add(sessionInfoBox)

    // Spacer between session info and MCP status
    const mcpSpacer = new BoxRenderable(renderer, {
      id: 'mcp-spacer',
      height: 1,
      flexShrink: 0,
    })
    this.sidebar.add(mcpSpacer)

    // MCP connections status at bottom of sidebar
    this.mcpStatusBox = new BoxRenderable(renderer, {
      id: 'mcp-status-box',
      paddingLeft: 2,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 1,
      flexShrink: 0,
      flexDirection: 'column',
    })
    this.sidebar.add(this.mcpStatusBox)

    // Content area (main application)
    this.contentBox = new BoxRenderable(renderer, {
      id: 'tab-content',
      flexDirection: 'column',
      flexGrow: 1,
      maxHeight: '100%',
    })
    root.add(this.contentBox)
  }

  /**
   * Set a callback invoked when the last tab is closed (before exit).
   * Use this to save state, etc. The callback is awaited before process.exit().
   */
  setOnLastTabClosed(cb: () => Promise<void>): void {
    this.onLastTabClosed = cb
  }

  /**
   * Set the save-and-exit callback (used by /quit command)
   */
  setSaveAndExitCallback(cb: () => Promise<void>): void {
    this.saveAndExitCallback = cb
  }

  /**
   * Set a callback invoked whenever tabs are created, closed, or renamed.
   * Use this to persist the current tab list immediately.
   */
  setOnTabsChangedCallback(cb: () => Promise<void>): void {
    this.onTabsChangedCallback = cb
  }

  /**
   * Notify that tabs have changed. Called internally after tab creation/close/rename.
   */
  private async notifyTabsChanged(): Promise<void> {
    if (this.onTabsChangedCallback) {
      try {
        await this.onTabsChangedCallback()
      } catch (err: any) {
        logger.error(`Tabs changed callback failed: ${err.message}`)
      }
    }
  }

  /**
   * Save all tabs and exit — called by /quit command
   */
  async saveAndExit(): Promise<void> {
    if (this.saveAndExitCallback) {
      await this.saveAndExitCallback()
    }
  }

  /**
   * Gracefully stop all running tabs by aborting their agentic loops.
   * This is called before saving and exiting to ensure clean shutdown.
   */
  async stopAllTabs(): Promise<void> {
    logger.info(`Stopping all ${this.tabs.size} tab(s) for graceful shutdown...`)

    for (const [tabId, tabApp] of this.tabs) {
      if (tabApp.getIsClosed()) continue

      try {
        const sessionId = tabApp.getSessionId?.()
        if (sessionId) {
          logger.debug(`Stopping tab ${tabId} (session ${sessionId})`)
        }
        // Trigger abort - this will stop the running LLM request and sub-agents
        // We use abort() instead of close() to preserve tab state for restoration
        tabApp.abort()
      } catch (err: any) {
        logger.warn(`Error stopping tab ${tabId}: ${err.message}`)
      }
    }

    // Give the event loop a moment to process abort signals
    await new Promise(resolve => setTimeout(resolve, 100))

    logger.info('All tabs stopped successfully')
  }

  /**
   * Create a new tab
   * @param sessionId Optional session ID to restore
   * @param autoSwitch Whether to immediately switch to the new tab (default: true)
   * @param initialMessage Optional message to send in the new tab (for /new suffix)
   * @param title Optional initial title for the tab (used when opening saved sessions)
   */
  async createTab(sessionId?: string, autoSwitch = true, initialMessage?: string, title?: string): Promise<TabApp> {
    const tabId = `tab-${this.nextTabId++}`

    logger.debug(`Creating new tab: ${tabId}`)

    // Create a sub-container for this tab's content
    const tabContainer = new BoxRenderable(this.renderer, {
      id: `tab-content-${tabId}`,
      flexDirection: 'column',
      flexGrow: 1,
      maxHeight: '100%',
    })
    // Don't add to contentBox yet - only add when tab becomes active
    this.tabContainers.set(tabId, tabContainer)

    const tabApp = new TabApp({
      renderer: this.renderer,
      options: {
        sessionId,
        dangerouslySkipPermissions: this.dangerouslySkipPermissions,
        onTitleUpdate: () => this.updateTabButtonStyles(),
        onLoadingChange: (loading: boolean) => this.setTabLoading(tabId, loading),
        onApprovalChange: (pending: boolean) => this.setTabApproval(tabId, pending),
        onSessionInfo: (provider: string, model: string, sessionId: string) => {
          // Store session info for this tab
          this.tabSessionInfo.set(tabId, { provider, model, sessionId })
          if (this.activeTabId === tabId) {
            this.setSessionInfo(provider, model, sessionId)
          }
        },
        onFork: async (forkedSessionId: string, forkedTitle?: string) => {
          await this.createTab(forkedSessionId, true, undefined, forkedTitle)
        },
        onNewTab: async (newTabInitialMessage?: string) => {
          await this.createTab(undefined, true, newTabInitialMessage)
        },
        onOpenManager: async () => {
          // /manager command — create or focus the Manager tab. This
          // routes through the same path as clicking the ★ Manager
          // button in the sidebar, so behavior is identical either way.
          await this.createManagerTab()
        },
        onSaveAndExit: async () => {
          await this.saveAndExit()
        },
        onPinTab: (pin: boolean) => {
          this.togglePinTab(tabId)
        },
        onMcpReady: () => {
          // Update MCP status in sidebar when MCP initialization completes
          if (this.activeTabId === tabId) {
            this.updateMcpStatus()
          }
        },
      },
      container: tabContainer,
      initialMessage,
      title,
    })

    await tabApp.initialize()

    this.tabs.set(tabId, tabApp)
    this.addTabButton(tabId)

    // Switch to the new tab if autoSwitch is enabled, or if it's the very first tab
    if (autoSwitch || this.activeTabId === null) {
      await this.switchTab(tabId)
    }

    // Notify that tabs have changed (persist immediately)
    await this.notifyTabsChanged()

    return tabApp
  }

  // Manager tab instance (singleton - only one manager tab allowed)
  private managerTabApp?: ManagerTabApp
  private managerTabId?: string

  /**
   * Create or focus the Manager Agent tab
   */
  async createManagerTab(): Promise<void> {
    // If manager already exists, just switch to it
    if (this.managerTabApp && this.managerTabId && this.tabs.has(this.managerTabId)) {
      await this.switchTab(this.managerTabId)
      return
    }

    const tabId = `manager-${this.nextTabId++}`
    this.managerTabId = tabId
    logger.debug(`Creating manager tab: ${tabId}`)

    // Create a sub-container for the manager tab's content
    const tabContainer = new BoxRenderable(this.renderer, {
      id: `tab-content-${tabId}`,
      flexDirection: 'column',
      flexGrow: 1,
      maxHeight: '100%',
    })
    this.tabContainers.set(tabId, tabContainer)

    // Create the manager tab app. Pass the same set of AppOptions
    // callbacks we pass to regular TabApps so the Manager tab gets full
    // slash-command / loading / approval / session-info / etc. wiring —
    // it IS a TabApp underneath now.
    this.managerTabApp = new ManagerTabApp({
      renderer: this.renderer,
      tabManager: this,
      tabId,
      container: tabContainer,
      options: {
        dangerouslySkipPermissions: this.dangerouslySkipPermissions,
        // Intentionally do NOT set onTitleUpdate for the Manager — the
        // title is pinned to "★ Manager".
        onLoadingChange: (loading: boolean) => this.setTabLoading(tabId, loading),
        onApprovalChange: (pending: boolean) => this.setTabApproval(tabId, pending),
        onSessionInfo: (provider: string, model: string, sessionId: string) => {
          this.tabSessionInfo.set(tabId, { provider, model, sessionId })
          if (this.activeTabId === tabId) {
            this.setSessionInfo(provider, model, sessionId)
          }
        },
        onFork: async (forkedSessionId: string, forkedTitle?: string) => {
          await this.createTab(forkedSessionId, true, undefined, forkedTitle)
        },
        onNewTab: async (newTabInitialMessage?: string) => {
          await this.createTab(undefined, true, newTabInitialMessage)
        },
        onOpenManager: async () => {
          // Already inside the manager — no-op, just refocus.
          await this.switchTab(tabId)
        },
        onSaveAndExit: async () => {
          await this.saveAndExit()
        },
        onPinTab: (_pin: boolean) => {
          // Manager is always pinned; ignore toggle requests.
        },
        onMcpReady: () => {
          if (this.activeTabId === tabId) {
            this.updateMcpStatus()
          }
        },
      },
      onClose: () => {
        this.managerTabApp = undefined
        this.managerTabId = undefined
      },
    })

    // Store in tabs map with special handling
    this.tabs.set(tabId, this.managerTabApp as any)
    this.addManagerTabButton(tabId)

    // Switch to the manager tab
    await this.switchTab(tabId)

    // Initialize the manager agent
    await this.managerTabApp.initialize()

    logger.info('Manager tab created and initialized (TabApp parity)')
  }

  /**
   * Add a clickable button for the Manager tab in the sidebar
   */
  private addManagerTabButton(tabId: string): void {
    const tabButton = new BoxRenderable(this.renderer, {
      id: `tab-button-${tabId}`,
      flexDirection: 'row',
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom: 1,
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    })

    const tabText = new TextRenderable(this.renderer, {
      id: `tab-button-text-${tabId}`,
      content: `★ Manager`,
      flexShrink: 1,
      onMouseDown: () => this.switchTab(tabId),
    })
    tabButton.add(tabText)

    // Close button (×)
    const closeButton = new TextRenderable(this.renderer, {
      id: `tab-close-${tabId}`,
      content: t`${fg(COLORS.red)('×')}`,
      marginLeft: 1,
      flexShrink: 0,
      onMouseDown: (event) => {
        event.stopPropagation()
        this.closeTab(tabId)
      },
    })
    tabButton.add(closeButton)

    // Add to top of list (before regular tabs)
    this.tabListContainer.add(tabButton, 0)
    this.tabButtons.set(tabId, tabButton)
    this.tabTexts.set(tabId, tabText)
    this.tabPinnedState.set(tabId, true) // Treat as pinned
    this.updateTabButtonStyles()
  }

  /**
   * Add a clickable tab button in the sidebar
   */
  private addTabButton(tabId: string): void {
    // Row container: title + close button (close button on right)
    const tabButton = new BoxRenderable(this.renderer, {
      id: `tab-button-${tabId}`,
      flexDirection: 'row',
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom: 1,
      alignItems: 'center',
      justifyContent: 'space-between',
      width: '100%',
    })

    const tabApp = this.tabs.get(tabId)
    const tabTitle = tabApp?.getTitle() || 'New Agent'
    const tabText = new TextRenderable(this.renderer, {
      id: `tab-button-text-${tabId}`,
      content: `○ ${tabTitle}`,
      flexShrink: 1,
      onMouseDown: () => this.switchTab(tabId),
    })
    tabButton.add(tabText)

    // Close button (×) - on the right
    const closeButton = new TextRenderable(this.renderer, {
      id: `tab-close-${tabId}`,
      content: t`${fg(COLORS.red)('×')}`,
      marginLeft: 1,
      flexShrink: 0,
      onMouseDown: (event) => {
        event.stopPropagation() // Prevent triggering switchTab
        this.closeTab(tabId)
      },
    })
    tabButton.add(closeButton)

    // Calculate insertion index: pinned tabs go first, then unpinned
    const pinnedCount = this.getPinnedTabCount()
    const isPinned = this.tabPinnedState.get(tabId) ?? false
    const insertIndex = isPinned ? 0 : pinnedCount
    this.tabListContainer.add(tabButton, insertIndex)
    this.tabButtons.set(tabId, tabButton)
    this.tabTexts.set(tabId, tabText)
    this.updateTabButtonStyles()
  }

  /**
   * Switch to a different tab
   */
  async switchTab(tabId: string): Promise<void> {
    if (!this.tabs.has(tabId)) {
      logger.warn(`Tab not found: ${tabId}`)
      return
    }

    // Don't switch if already on this tab
    if (this.activeTabId === tabId) {
      return
    }

    logger.debug(`Switching to tab: ${tabId}`)
    
    // DEBUG: Log tab state
    const tabApp = this.tabs.get(tabId)
    logger.debug(`Tab ${tabId} state: isClosed=${tabApp?.getIsClosed?.()}, title=${tabApp?.getTitle?.()}`)
    
    // Remove old tab container from contentBox
    if (this.currentlyVisibleContainerId) {
      const oldContainer = this.tabContainers.get(this.currentlyVisibleContainerId)
      if (oldContainer) {
        logger.debug(`Removing old container ${oldContainer.id} from contentBox`)
        this.contentBox.remove(oldContainer.id)
        // Force a render to ensure removal is processed
        this.renderer.requestRender()
      }
    }
    
    // Deactivate old tab
    if (this.activeTabId) {
      const oldTab = this.tabs.get(this.activeTabId)
      if (oldTab) {
        oldTab.setActive(false)
      }
    }

    // Force a render to ensure old tab's blur is processed before new tab focuses
    this.renderer.requestRender()

    // Update spinner state based on new active tab
    this.updateSpinnerState()

    // Update active tab ID
    this.activeTabId = tabId

    // Add new tab container to contentBox first (before activating)
    const newContainer = this.tabContainers.get(tabId)
    if (newContainer) {
      logger.debug(`Adding container ${newContainer.id} to contentBox`)
      this.contentBox.add(newContainer)
      this.currentlyVisibleContainerId = tabId
      // Force render after adding container
      this.renderer.requestRender()
    } else {
      logger.warn(`Container not found for tab ${tabId}`)
    }

    // Activate new tab - scrollToBottom happens immediately to prevent visible scroll jump,
    // but input focus is deferred so the render has completed and input is focusable
    const newTab = this.tabs.get(tabId)
    if (newTab) {
      // Ensure main conversation view is shown (not welcome screen) for restored tabs
      newTab.ensureMainView()
      newTab.scrollToBottom()
      // Delay focus to ensure the UI has fully rendered, especially for new tabs
      // where the input bar is being created and added to the layout
      setTimeout(() => {
        newTab.focusInput()
      }, 300)
    }

    // Update session info for the newly active tab
    const sessionInfo = this.tabSessionInfo.get(tabId)
    if (sessionInfo) {
      this.setSessionInfo(sessionInfo.provider, sessionInfo.model, sessionInfo.sessionId)
    }

    // Update MCP status for the newly active tab
    this.updateMcpStatus()

    this.updateTabButtonStyles()
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    logger.debug(`Closing tab: ${tabId}`)
    
    // Mark the session as deleted so it won't be restored on restart
    const sessionId = tab.getSessionId?.()
    if (sessionId) {
      try {
        await markSessionDeleted(sessionId)
      } catch (err: any) {
        logger.warn(`Failed to mark session ${sessionId} as deleted: ${err.message}`)
      }
    }
    
    await tab.close()
    this.tabs.delete(tabId)

    const button = this.tabButtons.get(tabId)
    if (button) {
      this.tabListContainer.remove(button.id)
      this.tabButtons.delete(tabId)
    }

    // Remove container if it's currently visible
    if (this.currentlyVisibleContainerId === tabId) {
      const container = this.tabContainers.get(tabId)
      if (container) {
        this.contentBox.remove(container.id)
      }
      this.currentlyVisibleContainerId = null
    }

    this.tabContainers.delete(tabId)
    this.tabSessionInfo.delete(tabId)
    this.tabPinnedState.delete(tabId)

    // Notify that tabs have changed (persist immediately)
    await this.notifyTabsChanged()

    if (this.activeTabId === tabId) {
      const tabIds = Array.from(this.tabs.keys())
      if (tabIds.length > 0) {
        await this.switchTab(tabIds[0])
      } else {
        // Last tab closed - invoke callback for graceful shutdown (save state, etc.)
        logger.info('Last tab closed. Exiting ProtoAgent...')
        if (this.onLastTabClosed) {
          try {
            await this.onLastTabClosed()
          } catch (err: any) {
            logger.error(`Error during last-tab-closed cleanup: ${err.message}`)
          }
        }
        process.exit(0)
      }
    }
  }

  /**
   * Set loading state for a specific tab, driving the sidebar spinner.
   */
  setTabLoading(tabId: string, loading: boolean): void {
    this.tabLoadingState.set(tabId, loading)
    this.updateSpinnerState()
    this.updateTabButtonStyles()
  }

  /**
   * Set approval pending state for a specific tab.
   */
  setTabApproval(tabId: string, pending: boolean): void {
    this.tabApprovalState.set(tabId, pending)
    this.updateTabButtonStyles()
  }

  /**
   * Update spinner state based on loading tabs.
   * Spinner runs only when at least one tab is loading.
   */
  private updateSpinnerState(): void {
    const anyLoading = [...this.tabLoadingState.values()].some(Boolean)
    if (anyLoading && !this.spinner.isRunning()) {
      this.spinner.start()
    } else if (!anyLoading && this.spinner.isRunning()) {
      this.spinner.stop()
    }
  }

  /**
   * Truncate text with ellipsis to fit within max width.
   * Accounts for the indicator prefix (2 chars: symbol + space).
   * Reserves space for the close button on the right.
   */
  private truncateTitle(title: string, maxWidth: number): string {
    const availableWidth = maxWidth - 3 // indicator (2) + space for × button margin (1)
    if (title.length > availableWidth) {
      return title.slice(0, availableWidth - 1) + '…'
    }
    return title
  }

  /**
   * Update tab button styling (highlight active tab, show spinner indicator)
   */
  private updateTabButtonStyles(): void {
    // Calculate responsive max title width based on sidebar width
    const termWidth = process.stdout.columns || 120
    const sidebarWidth = termWidth >= 250 ? 48 : termWidth >= 150 ? 38 : 30
    const maxTitleWidth = sidebarWidth - 5 // Account for padding, indicator, and close button

    for (const [tabId, ] of this.tabButtons) {
      const isActive = tabId === this.activeTabId
      const isLoading = this.tabLoadingState.get(tabId) ?? false
      const isApprovalPending = this.tabApprovalState.get(tabId) ?? false

      const tabApp = this.tabs.get(tabId)
      const rawTitle = tabApp?.getTitle() || 'New Agent'
      const tabTitle = this.truncateTitle(rawTitle, maxTitleWidth)

      let color: string
      let indicator: string
      const isPinned = this.tabPinnedState.get(tabId) ?? false

      if (isApprovalPending) {
        // Approval pending: yellow + filled dots (check before loading so approval is visible)
        color = TAB_COLORS.approval
        indicator = DOTS_INDICATOR
      } else if (isLoading) {
        // Loading: animated spinner dots
        indicator = this.spinner.getFrame()
        if (isActive) {
          // Active loading: green icon, white text
          const existingText = this.tabTexts.get(tabId)
          if (existingText) {
            existingText.content = t`${fg(TAB_COLORS.activeRunning)(indicator)} ${fg(TAB_COLORS.activeIdle)(tabTitle)}`
          }
          continue
        } else {
          // Inactive loading: gray
          color = TAB_COLORS.inactive
        }
      } else if (isActive) {
        // Active, idle: white + static dots
        color = TAB_COLORS.activeIdle
        indicator = DOTS_INDICATOR
      } else {
        // Idle inactive: gray + static dots
        color = TAB_COLORS.inactive
        indicator = DOTS_INDICATOR
      }

      // Show 📌 for pinned tabs, indicator for regular tabs
      const pinPrefix = isPinned ? '📌' : indicator
      const displayText = `${pinPrefix} ${tabTitle}`
      const existingText = this.tabTexts.get(tabId)
      if (existingText) {
        existingText.content = t`${fg(color)(displayText)}`
      }
    }
  }

  /**
   * Get the currently active tab
   */
  getActiveTab(): TabApp | null {
    if (!this.activeTabId) return null
    return this.tabs.get(this.activeTabId) || null
  }

  /**
   * Update a tab's title
   */
  updateTabTitle(tabId: string, title: string): void {
    const tab = this.tabs.get(tabId)
    if (tab) {
      tab.setTitle(title)
      this.updateTabButtonStyles()
    }
  }

  /**
   * Get all open tab session IDs for persistence
   */
  getAllTabSessionIds(): string[] {
    const sessionIds: string[] = []
    for (const [tabId, _tab] of this.tabs) {
      const sessionInfo = this.tabSessionInfo.get(tabId)
      if (sessionInfo?.sessionId) {
        sessionIds.push(sessionInfo.sessionId)
      }
    }
    return sessionIds
  }

  /**
   * Get all open tabs with session info for persistence.
   * Returns session IDs with current titles from the TabManager.
   */
  getAllTabSessionInfo(): TabSessionInfo[] {
    const tabs: TabSessionInfo[] = []
    for (const [tabId, tabApp] of this.tabs) {
      // Use tabSessionInfo map which is populated by onSessionInfo callback
      // This works for both new and restored tabs
      const sessionInfo = this.tabSessionInfo.get(tabId)
      if (sessionInfo?.sessionId) {
        tabs.push({
          id: sessionInfo.sessionId,
          title: tabApp.getTitle() || 'New session'
        })
      }
    }
    return tabs
  }

  /**
   * Get all tab IDs in creation order
   */
  getAllTabIds(): string[] {
    return Array.from(this.tabs.keys())
  }

  /**
   * Get the currently active tab ID
   */
  getActiveTabId(): string | null {
    return this.activeTabId
  }

  /**
   * Get the currently active tab's session ID
   */
  getActiveTabSessionId(): string | null {
    if (!this.activeTabId) return null
    return this.tabSessionInfo.get(this.activeTabId)?.sessionId ?? null
  }

  /**
   * Get the tab ID for a given session ID
   */
  getTabIdBySessionId(sessionId: string): string | null {
    for (const [tabId, tab] of this.tabs) {
      if (tab.getSessionId?.() === sessionId) {
        return tabId
      }
    }
    return null
  }

  /**
   * Close the currently active tab
   */
  async closeActiveTab(): Promise<void> {
    if (this.activeTabId) {
      await this.closeTab(this.activeTabId)
    }
  }

  /**
   * Update session info displayed at bottom of left sidebar
   */
  setSessionInfo(provider: string, model: string, sessionId: string): void {
    const parts: string[] = []
    if (provider) parts.push(provider)
    if (model) parts.push(model)
    if (sessionId) parts.push(sessionId.slice(0, 8))
    this.sessionInfoText.content = parts.length > 0
      ? t`${fg(COLORS.dim)(parts.join('  '))}`
      : t``
  }

  /**
   * Update MCP connections status displayed at bottom of left sidebar
   */
  updateMcpStatus(): void {
    const activeTab = this.getActiveTab()

    // Clear existing rows
    for (const row of this.mcpStatusRows) {
      this.mcpStatusBox.remove(row.id)
      row.destroyRecursively()
    }
    this.mcpStatusRows = []

    if (!activeTab) {
      return
    }

    const mcpManager = activeTab.getMcpManager()
    if (!mcpManager) {
      return
    }

    const connectedServers = mcpManager.getConnectedServers()

    if (connectedServers.length === 0) {
      const rowText = new TextRenderable(this.renderer, {
        id: 'mcp-status-row-0',
        content: t`${fg(COLORS.dim)('MCP: None')}`,
      })
      this.mcpStatusBox.add(rowText)
      this.mcpStatusRows.push(rowText)
    } else {
      const termWidth = process.stdout.columns || 120
      const sidebarWidth = termWidth >= 250 ? 48 : termWidth >= 150 ? 38 : 30
      const availableWidth = sidebarWidth - 4 // Account for padding

      // Wrap server names to fit sidebar width
      const wrappedLines = this.wrapServerNames(connectedServers, availableWidth)

      for (let i = 0; i < wrappedLines.length; i++) {
        const rowText = new TextRenderable(this.renderer, {
          id: `mcp-status-row-${i}`,
          content: t`${fg(COLORS.dim)(wrappedLines[i])}`,
        })
        this.mcpStatusBox.add(rowText)
        this.mcpStatusRows.push(rowText)
      }
    }
  }

  /**
   * Wrap server names to fit within max width, keeping each server name intact
   */
  private wrapServerNames(servers: string[], maxWidth: number): string[] {
    if (servers.length === 0) return []

    const lines: string[] = []
    let currentLine = 'MCP:'

    for (const server of servers) {
      // Check if adding this server would exceed width
      const testLine = currentLine === 'MCP:' ? `MCP: ${server}` : `${currentLine}, ${server}`

      if (testLine.length <= maxWidth) {
        currentLine = testLine
      } else {
        // Start a new line with the server name (indented)
        if (currentLine !== 'MCP:') {
          lines.push(currentLine)
        }
        currentLine = `     ${server}` // 5 spaces indent
      }
    }

    // Don't forget the last line
    if (currentLine !== 'MCP:') {
      lines.push(currentLine)
    }

    return lines
  }

  /**
   * Get the number of pinned tabs
   */
  private getPinnedTabCount(): number {
    let count = 0
    for (const tabId of this.tabButtons.keys()) {
      if (this.tabPinnedState.get(tabId)) count++
    }
    return count
  }

  /**
   * Pin a tab - moves it to the top of the sidebar
   */
  pinTab(tabId: string): void {
    if (!this.tabs.has(tabId) || this.tabPinnedState.get(tabId)) return
    this.tabPinnedState.set(tabId, true)
    // Move button to after pinned tabs
    const button = this.tabButtons.get(tabId)
    if (button) {
      this.tabListContainer.remove(button.id)
      this.tabListContainer.add(button, 0)
    }
    this.updateTabButtonStyles()
  }

  /**
   * Unpin a tab - moves it after all pinned tabs
   */
  unpinTab(tabId: string): void {
    if (!this.tabs.has(tabId) || !this.tabPinnedState.get(tabId)) return
    this.tabPinnedState.set(tabId, false)
    // Move button to after pinned tabs
    const button = this.tabButtons.get(tabId)
    if (button) {
      this.tabListContainer.remove(button.id)
      const pinnedCount = this.getPinnedTabCount()
      this.tabListContainer.add(button, pinnedCount)
    }
    this.updateTabButtonStyles()
  }

  /**
   * Toggle pinned state of a tab
   */
  togglePinTab(tabId: string): void {
    if (this.tabPinnedState.get(tabId)) {
      this.unpinTab(tabId)
    } else {
      this.pinTab(tabId)
    }
  }

  /**
   * Check if a tab is pinned
   */
  isTabPinned(tabId: string): boolean {
    return this.tabPinnedState.get(tabId) ?? false
  }
}

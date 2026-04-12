/**
 * TabManager — manages multiple independent tab instances.
 *
 * Layout:
 * ┌─────────┬──────────────────────────────────────────────┐
 * │ [+] New │ Chat History          │ TODOs               │
 * │ ────    │                       │                     │
 * │ Tab 1 ● │ (active tab content)  │                     │
 * │ Tab 2   │                       │                     │
 * │ Tab 3   │ ┌──────────────────┐  │                     │
 * │         │ │ > type here      │  │                     │
 * │         │ └──────────────────┘  │                     │
 * └─────────┴──────────────────────────────────────────────┘
 *
 * Left sidebar shows all open tabs with click to switch.
 * [+] button at top creates new tabs.
 * Active tab marked with ● indicator.
 */

import { type CliRenderer, BoxRenderable, TextRenderable, t, fg, bold } from '@opentui/core'
import type { Config } from '../config-core.js'
import { TabApp } from './TabApp.js'
import { logger } from '../utils/logger.js'

export interface TabManagerConfig {
  renderer: CliRenderer
  config: Config
}

const COLORS = {
  active: '#09A469',
  inactive: '#666666',
  button: '#e0af68',
}

/**
 * TabManager — manages multi-tab application state with left sidebar.
 */
export class TabManager {
  private renderer: CliRenderer
  private config: Config
  private tabs = new Map<string, TabApp>()
  private activeTabId: string | null = null
  private sidebar: BoxRenderable
  private contentBox: BoxRenderable
  private nextTabId = 0
  private tabButtons = new Map<string, BoxRenderable>()
  private tabTexts = new Map<string, TextRenderable>()
  private tabContainers = new Map<string, BoxRenderable>()

  constructor({ renderer, config }: TabManagerConfig) {
    this.renderer = renderer
    this.config = config

    // Root layout: row with sidebar + content
    const root = new BoxRenderable(renderer, {
      id: 'tab-manager-root',
      flexDirection: 'row',
      flexGrow: 1,
      maxHeight: '100%',
      maxWidth: '100%',
    })
    renderer.root.add(root)

    // Left sidebar with tab list
    this.sidebar = new BoxRenderable(renderer, {
      id: 'tab-sidebar',
      flexDirection: 'column',
      flexShrink: 0,
      width: 25,
      maxHeight: '100%',
      paddingTop: 1,
      paddingBottom: 1,
      border: ['right'],
      borderColor: '#333333',
    })
    root.add(this.sidebar)

    // New tab button at top
    const newTabButton = new BoxRenderable(renderer, {
      id: 'new-tab-button',
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom: 1,
      onMouseDown: () => this.createTab(),
    })
    const newTabText = new TextRenderable(renderer, {
      id: 'new-tab-text',
      content: t`${fg(COLORS.button)('+ New')}`,
    })
    newTabButton.add(newTabText)
    this.sidebar.add(newTabButton)

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
   * Create a new tab
   */
  async createTab(sessionId?: string): Promise<TabApp> {
    const tabId = `tab-${this.nextTabId++}`

    logger.debug(`Creating new tab: ${tabId}`)

    // Create a sub-container for this tab's content
    const tabContainer = new BoxRenderable(this.renderer, {
      id: `tab-content-${tabId}`,
      flexDirection: 'column',
      flexGrow: 1,
      maxHeight: '100%',
    })
    this.contentBox.add(tabContainer)
    this.tabContainers.set(tabId, tabContainer)

    const tabApp = new TabApp({
      renderer: this.renderer,
      options: { sessionId },
      container: tabContainer,
    })

    await tabApp.initialize()

    this.tabs.set(tabId, tabApp)
    this.addTabButton(tabId)
    
    if (this.activeTabId === null) {
      // First tab - make it active
      this.switchTab(tabId)
    }

    return tabApp
  }

  /**
   * Add a clickable tab button in the sidebar
   */
  private addTabButton(tabId: string): void {
    const tabButton = new BoxRenderable(this.renderer, {
      id: `tab-button-${tabId}`,
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom: 1,
      onMouseDown: () => this.switchTab(tabId),
    })

    const tabApp = this.tabs.get(tabId)
    const tabTitle = tabApp?.getTitle() || 'New Chat'
    const tabText = new TextRenderable(this.renderer, {
      id: `tab-button-text-${tabId}`,
      content: `○ ${tabTitle}`,
    })
    tabButton.add(tabText)

    this.sidebar.add(tabButton)
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

    logger.debug(`Switching to tab: ${tabId}`)
    
    // Deactivate old tab
    if (this.activeTabId && this.activeTabId !== tabId) {
      const oldTab = this.tabs.get(this.activeTabId)
      if (oldTab) {
        oldTab.setActive(false)
      }
    }

    // Activate new tab
    this.activeTabId = tabId
    const newTab = this.tabs.get(tabId)
    if (newTab) {
      newTab.setActive(true)
    }
    
    this.updateTabButtonStyles()
  }

  /**
   * Close a tab
   */
  async closeTab(tabId: string): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    logger.debug(`Closing tab: ${tabId}`)
    await tab.close()
    this.tabs.delete(tabId)

    const button = this.tabButtons.get(tabId)
    if (button) {
      this.sidebar.remove(button.id)
      this.tabButtons.delete(tabId)
    }

    if (this.activeTabId === tabId) {
      const tabIds = Array.from(this.tabs.keys())
      if (tabIds.length > 0) {
        await this.switchTab(tabIds[0])
      } else {
        logger.info('All tabs closed. Exiting.')
        process.exit(0)
      }
    }
  }

  /**
   * Update tab button styling (highlight active tab)
   */
  private updateTabButtonStyles(): void {
    for (const [tabId, button] of this.tabButtons) {
      const isActive = tabId === this.activeTabId
      const color = isActive ? COLORS.active : COLORS.inactive
      const indicator = isActive ? '●' : '○'
      
      const tabApp = this.tabs.get(tabId)
      const tabTitle = tabApp?.getTitle() || 'New Chat'
      const displayText = `${indicator} ${tabTitle}`

      // Remove old text if it exists
      const oldText = this.tabTexts.get(tabId)
      if (oldText) {
        button.remove(oldText.id)
      }

      const text = new TextRenderable(
        this.renderer,
        {
          id: `tab-button-text-${tabId}`,
          content: t`${fg(color)(displayText)}`,
        }
      )

      button.add(text)
      this.tabTexts.set(tabId, text)
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
}

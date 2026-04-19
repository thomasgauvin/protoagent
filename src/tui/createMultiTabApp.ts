/**
 * createMultiTabApp — Multi-tab application entry point.
 *
 * Replaces the single-tab createApp() with a TabManager-based multi-tab system.
 * The TabManager handles:
 * - Left sidebar UI with clickable tabs
 * - Tab lifecycle and switching
 * - "[+] New" button to create new tabs
 * - Tab persistence (saves/restores open tabs on startup)
 */

import { type CliRenderer, CliRenderEvents } from '@opentui/core'
import { readConfig } from '../config-core.js'
import { TabManager } from './TabManager.js'
import { logger } from '../utils/logger.js'
import { saveTabGroup, loadLastTabGroup, clearLastTabGroup, type TabSessionInfo, setAgentName, acquireAgentLock, releaseAgentLock, getAgentName } from '../multi-tab-sessions.js'
import { applyDetectedTheme, getThemeMode, toggleTheme } from './theme.js'
import { restoreTerminal } from './terminal-cleanup.js'

export interface MultiTabAppOptions {
  dangerouslySkipPermissions?: boolean
  logLevel?: string
  sessionId?: string
  agentName?: string
}

/**
 * Create multi-tab application
 */
export async function createMultiTabApp(renderer: CliRenderer, options: MultiTabAppOptions): Promise<void> {
  try {
    // Set agent name for session isolation (default: 'default')
    setAgentName(options.agentName || 'default')

    // Acquire lock to prevent multiple instances of the same agent
    const lockResult = await acquireAgentLock()
    if (!lockResult.locked) {
      logger.error(lockResult.error || `Another instance of agent '${getAgentName()}' is already running`)
      console.error(`\nError: ${lockResult.error}`)
      console.error(`\nTo run multiple ProtoAgent instances, use different agent names:`)
      console.error(`  protoagent --name ${getAgentName()}-2`)
      process.exit(1)
    }

    const config = readConfig('active')
    if (!config) {
      logger.error('No config found. Run: protoagent configure')
      process.exit(1)
    }

    const tabManager = new TabManager({ renderer, config, dangerouslySkipPermissions: options.dangerouslySkipPermissions })

    // Track tabs that are being restored (used as fallback if exit happens during initialization)
    let pendingTabsToRestore: TabSessionInfo[] = []

    // Shared save-and-exit logic used by Ctrl+C, SIGTERM, last-tab-closed, and /quit
    async function saveAndExit(shouldExit = false): Promise<void> {
      try {
        // Get current tabs from TabManager
        let tabs = tabManager.getAllTabSessionInfo()

        // Fallback: if no tabs found but we were restoring tabs, use those
        // This handles the case where SIGTERM arrives during initialization
        // before onSessionInfo callback has fired
        if (tabs.length === 0 && pendingTabsToRestore.length > 0) {
          logger.info(`Using pending restore list: ${pendingTabsToRestore.length} tab(s)`)
          tabs = pendingTabsToRestore
        }

        logger.info(`Saving ${tabs.length} tab(s) before exit: ${tabs.map(t => `${t.id} (${t.title})`).join(', ') || '(none)'}`)
        // Always save tab group, even if empty (empty means fresh start on next launch)
        await saveTabGroup(tabs)
        logger.info('Tab group saved successfully')
      } catch (err: any) {
        logger.error(`Failed to save tabs: ${err.message}`)
      }
      // Release lock before destroying renderer
      await releaseAgentLock()
      // Restore terminal state (disable mouse tracking, show cursor, etc.)
      restoreTerminal()
      renderer.destroy()
      if (shouldExit) {
        process.exit(0)
      }
    }

    // When the last tab is closed via the × button, save state then exit
    tabManager.setOnLastTabClosed(async () => {
      await saveAndExit(false)
    })

    // Register save-and-exit callback for /quit command
    // This saves all tabs, stops them, and exits - preserving them for restart
    tabManager.setSaveAndExitCallback(async () => {
      logger.info('Exiting via /quit command...')
      // 1. Stop/abort all running sessions FIRST (to prevent new work)
      logger.info('Stopping all tabs before exit...')
      await tabManager.stopAllTabs()
      // 2. Save all tabs (after stopping, so state is stable)
      logger.info('Saving all tabs...')
      await saveAndExit(false)
      // 3. Release the agent lock
      await releaseAgentLock()
      logger.info('All tabs saved and stopped, exiting...')
      // 4. Exit
      process.exit(0)
    })

    // Register tabs-changed callback to persist immediately when tabs change
    tabManager.setOnTabsChangedCallback(async () => {
      // Get current tabs and save immediately
      try {
        const tabs = tabManager.getAllTabSessionInfo()
        await saveTabGroup(tabs)
        logger.debug(`Auto-saved ${tabs.length} tab(s) after change`)
      } catch (err: any) {
        logger.error(`Failed to auto-save tabs: ${err.message}`)
      }
    })

    // Decide which tabs to open on startup
    let tabsToOpen: TabSessionInfo[] = []
    if (options.sessionId) {
      // User specified a session ID to resume - load its title
      const { loadSession } = await import('../sessions.js')
      const session = await loadSession(options.sessionId)
      tabsToOpen = [{ id: options.sessionId, title: session?.title ?? 'New session' }]
      logger.debug(`Opening single session from --session flag: ${options.sessionId}`)
      await clearLastTabGroup()
    } else {
      // Try to restore last open tabs first
      const lastTabs = await loadLastTabGroup()
      if (lastTabs && lastTabs.length > 0) {
        tabsToOpen = lastTabs
        logger.info(`Restoring ${tabsToOpen.length} tab(s) from last session: ${tabsToOpen.map(t => t.id).join(', ')}`)
      } else {
        // No saved tabs - start fresh
        logger.debug('No saved tabs found, starting fresh with a new tab')
      }
    }

    // Open tabs (either restored or new)
    if (tabsToOpen.length === 0) {
      // Fresh start - create one new tab (auto-switches by default)
      await tabManager.createTab()
    } else {
      // Track tabs we're restoring for fallback on early exit
      pendingTabsToRestore = tabsToOpen
      
      // Restore saved tabs - only the first one becomes active
      // Use loadSession (not loadSessionForRestore) to filter out deleted sessions
      const { loadSession } = await import('../sessions.js')
      for (let i = 0; i < tabsToOpen.length; i++) {
        const tabInfo = tabsToOpen[i]
        try {
          // Verify the session exists and is not deleted
          const session = await loadSession(tabInfo.id)
          if (!session) {
            logger.warn(`Session ${tabInfo.id} not found or was closed, skipping restoration`)
            continue
          }
          // Use the stored title or fall back to the session title
          const title = tabInfo.title !== 'New session' ? tabInfo.title : session.title
          // First tab auto-switches; subsequent tabs are created in background
          await tabManager.createTab(tabInfo.id, i === 0, undefined, title)
        } catch (err: any) {
          logger.warn(`Failed to restore tab with session ${tabInfo.id}: ${err.message}`)
        }
      }
      // Clear pending restore list since tabs are now created
      pendingTabsToRestore = []
    }

    // Print resume command to scrollback before TUI takes over
    const activeSessionId = tabManager.getActiveTabSessionId()
    const agentName = getAgentName()
    const nameFlag = agentName !== 'default' ? ` --name ${agentName}` : ''
    if (activeSessionId) {
      console.log(`\nTo resume this session later, run: protoagent${nameFlag} --session ${activeSessionId}`)
    } else {
      console.log(`\nStarting a new session. Use "protoagent${nameFlag}" to resume your tabs next time.`)
    }

    // Initialize theme from terminal's detected mode
    const initialTheme = applyDetectedTheme(renderer.themeMode)
    if (initialTheme) {
      logger.info(`Theme initialized: ${getThemeMode()} mode`)
    }

    // Listen for terminal theme changes (when terminal switches light/dark)
    renderer.on(CliRenderEvents.THEME_MODE, (mode) => {
      const changed = applyDetectedTheme(mode)
      if (changed) {
        logger.info(`Theme changed to: ${mode} mode`)
        // Request render to update colors
        renderer.requestRender()
      }
    })

    // Global keyboard shortcuts
    renderer.keyInput.on('keypress', async (key: any) => {
      // Ctrl+C: save tabs, stop, and exit
      if (key.ctrl && !key.meta && key.name === 'c') {
        logger.info('Saving and exiting ProtoAgent...')
        // Save FIRST (before stopping so tabs aren't marked closed)
        await saveAndExit(false)
        await tabManager.stopAllTabs()
        process.exit(0)
      }

      // Ctrl+T: create new tab
      if (key.ctrl && !key.meta && key.name === 't') {
        key.preventDefault?.()
        await tabManager.createTab()
        return
      }

      // Ctrl+Tab / Ctrl+PageDown: next tab
      if ((key.ctrl && !key.meta && key.name === 'tab') ||
          (key.ctrl && !key.meta && key.name === 'pagedown')) {
        key.preventDefault?.()
        const allTabIds = tabManager.getAllTabIds()
        const activeTabId = tabManager.getActiveTabId()
        if (allTabIds.length <= 1 || !activeTabId) return

        const currentIndex = allTabIds.indexOf(activeTabId)
        const nextIndex = (currentIndex + 1) % allTabIds.length
        await tabManager.switchTab(allTabIds[nextIndex])
        return
      }

      // Ctrl+Shift+Tab / Ctrl+PageUp: previous tab
      if ((key.ctrl && key.shift && !key.meta && key.name === 'tab') ||
          (key.ctrl && !key.meta && key.name === 'pageup')) {
        key.preventDefault?.()
        const allTabIds = tabManager.getAllTabIds()
        const activeTabId = tabManager.getActiveTabId()
        if (allTabIds.length <= 1 || !activeTabId) return

        const currentIndex = allTabIds.indexOf(activeTabId)
        const prevIndex = (currentIndex - 1 + allTabIds.length) % allTabIds.length
        await tabManager.switchTab(allTabIds[prevIndex])
        return
      }

      // Ctrl+1 through Ctrl+9: switch to tab by number
      if (key.ctrl && !key.meta && !key.shift && /^[1-9]$/.test(key.name || '')) {
        key.preventDefault?.()
        const allTabIds = tabManager.getAllTabIds()
        const tabNum = parseInt(key.name, 10) - 1 // 0-indexed
        if (tabNum < allTabIds.length) {
          await tabManager.switchTab(allTabIds[tabNum])
        }
        return
      }

      // Ctrl+W: close current tab
      if (key.ctrl && !key.meta && key.name === 'w') {
        key.preventDefault?.()
        await tabManager.closeActiveTab()
        return
      }

      // Ctrl+L: toggle light/dark theme
      if (key.ctrl && !key.meta && key.name === 'l') {
        key.preventDefault?.()
        const newMode = toggleTheme()
        logger.info(`Theme manually toggled to: ${newMode} mode`)
        renderer.requestRender()
        return
      }
    })

    // SIGTERM handler (clean shutdown on kill)
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, saving and exiting...')
      // Save FIRST (before stopping so tabs aren't marked closed)
      await saveAndExit(false)
      await tabManager.stopAllTabs()
      // Lock is released by saveAndExit
      // Terminal cleanup happens in beforeExit handler
      process.exit(0)
    })

    // Auto-save every 5 minutes
    const AUTO_SAVE_INTERVAL_MS = 5 * 60 * 1000
    const autoSaveTimer = setInterval(async () => {
      try {
        const tabs = tabManager.getAllTabSessionInfo()
        if (tabs.length > 0) {
          await saveTabGroup(tabs)
          logger.debug(`Auto-saved ${tabs.length} tab(s)`)
        }
      } catch (err: any) {
        logger.error(`Auto-save failed: ${err.message}`)
      }
    }, AUTO_SAVE_INTERVAL_MS)
    // Don't let the timer prevent process from exiting
    autoSaveTimer.unref()
  } catch (err: any) {
    logger.error(`Failed to create multi-tab app: ${err.message}`)
    process.exit(1)
  }
}

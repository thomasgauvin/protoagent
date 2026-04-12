/**
 * createMultiTabApp — Multi-tab application entry point.
 *
 * Replaces the single-tab createApp() with a TabManager-based multi-tab system.
 * The TabManager handles:
 * - Left sidebar UI with clickable tabs
 * - Tab lifecycle and switching
 * - "[+] New" button to create new tabs
 */

import { type CliRenderer } from '@opentui/core'
import { readConfig } from '../config-core.js'
import { TabManager } from './TabManager.js'
import { logger } from '../utils/logger.js'

export interface MultiTabAppOptions {
  dangerouslySkipPermissions?: boolean
  logLevel?: string
  sessionId?: string
}

/**
 * Create multi-tab application
 */
export async function createMultiTabApp(renderer: CliRenderer, options: MultiTabAppOptions): Promise<void> {
  try {
    const config = readConfig('active')
    if (!config) {
      logger.error('No config found. Run: protoagent configure')
      process.exit(1)
    }

    const tabManager = new TabManager({ renderer, config })

    // Create first tab
    await tabManager.createTab(options.sessionId)

    // Global Ctrl+C handler to exit the app
    renderer.keyInput.on('keypress', async (key: any) => {
      if (key.ctrl && !key.meta && key.name === 'c') {
        logger.info('Exiting ProtoAgent...')
        renderer.destroy()
        process.exit(0)
      }
    })

    // SIGTERM handler (clean shutdown on kill)
    process.on('SIGTERM', async () => {
      logger.info('Received SIGTERM, exiting...')
      renderer.destroy()
      process.exit(0)
    })
  } catch (err: any) {
    logger.error(`Failed to create multi-tab app: ${err.message}`)
    process.exit(1)
  }
}

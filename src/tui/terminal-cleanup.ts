/**
 * Terminal cleanup utilities to ensure mouse mode is disabled on exit.
 * This prevents mouse escape sequences from leaking to other terminals.
 */

import { logger } from '../utils/logger.js'
import { killWatchdog } from './tty-watchdog.js'

/**
 * ANSI escape sequences for terminal state management
 */
const ESC = '\x1b'

/**
 * Disable all mouse tracking modes.
 * This should be called on exit to clean up terminal state.
 */
export function disableMouseTracking(): void {
  // Disable standard X10 mouse tracking
  process.stdout.write(`${ESC}[?9l`)
  // Disable normal tracking mode
  process.stdout.write(`${ESC}[?1000l`)
  // Disable button event tracking
  process.stdout.write(`${ESC}[?1002l`)
  // Disable any-event tracking (mouse movement)
  process.stdout.write(`${ESC}[?1003l`)
  // Disable SGR extended coordinates
  process.stdout.write(`${ESC}[?1006l`)
  // Disable UTF-8 extended coordinates
  process.stdout.write(`${ESC}[?1005l`)
  // Disable focus events
  process.stdout.write(`${ESC}[?1004l`)

  logger.debug('Mouse tracking disabled')
}

/**
 * Restore terminal to sane state.
 * Call this before exit to ensure clean terminal handoff.
 */
export function restoreTerminal(): void {
  // Kill the watchdog (we're doing proper cleanup ourselves)
  killWatchdog()

  // Disable mouse tracking
  disableMouseTracking()

  // Show cursor (in case it was hidden)
  process.stdout.write(`${ESC}[?25h`)

  // Reset attributes
  process.stdout.write(`${ESC}[0m`)

  // Clear any pending input
  process.stdout.write(`${ESC}[c`)

  logger.debug('Terminal restored')
}

/**
 * Setup cleanup handlers for various exit scenarios.
 * This ensures the terminal is restored even if the process crashes.
 */
export function setupTerminalCleanup(): void {
  // Normal exit
  process.on('exit', () => {
    restoreTerminal()
  })

  // Signal handlers
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']
  for (const signal of signals) {
    process.on(signal, () => {
      logger.info(`Received ${signal}, cleaning up terminal...`)
      restoreTerminal()
      // Re-raise the signal to allow default handling
      process.kill(process.pid, signal)
    })
  }

  // Uncaught exceptions
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception, cleaning up terminal...')
    restoreTerminal()
    console.error(err)
    process.exit(1)
  })

  // Unhandled rejections
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection, cleaning up terminal...')
    restoreTerminal()
    console.error(reason)
    process.exit(1)
  })
}

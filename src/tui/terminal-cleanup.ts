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

  // Leave the alternate screen buffer. Without this, the TUI's alt-screen
  // contents remain visible in the scrollback after the app exits, and
  // subsequent shell output overlaps the old frame.
  process.stdout.write(`${ESC}[?1049l`)

  // Leave bracketed paste mode (most shells enable it; if the TUI turned it
  // off, restore it implicitly by NOT leaving it disabled — we only disable
  // the TUI's own bracketed paste override).
  process.stdout.write(`${ESC}[?2004l`)

  // Leave "application cursor keys" mode (DECCKM).
  process.stdout.write(`${ESC}[?1l`)

  // Leave "application keypad" mode (DECKPAM -> DECKPNM).
  process.stdout.write(`${ESC}>`)

  // Show cursor (in case it was hidden)
  process.stdout.write(`${ESC}[?25h`)

  // Reset character attributes (SGR).
  process.stdout.write(`${ESC}[0m`)

  // NOTE: Do NOT send `CSI c` (Device Attributes query). That asks the
  // terminal to REPLY with its attributes like "CSI ?64;1;2;4;6;17;18;21;22;52c".
  // By the time we're exiting, stdin is back in line-discipline mode, so
  // the reply is delivered to the shell as if the user typed it, producing
  // gibberish like `64;1;2;4;...` at the prompt and "command not found"
  // errors. Previous versions of this file had `process.stdout.write(ESC + "[c")`
  // here with a misleading comment ("Clear any pending input") — it does
  // the opposite of clearing input.

  logger.debug('Terminal restored')
}

/**
 * Setup cleanup handlers for various exit scenarios.
 * This ensures the terminal is restored even if the process crashes.
 */
export function setupTerminalCleanup(): void {
  // Normal exit — always restore the tty before the process goes away,
  // so the shell isn't left in alt-screen / raw mode / mouse tracking.
  process.on('exit', () => {
    restoreTerminal()
  })

  // Safety-net signal handlers ONLY for signals we don't handle elsewhere.
  //
  // SIGINT/SIGTERM are owned by `createMultiTabApp.ts`'s `gracefulExit`
  // flow (which saves tabs, waits with a timeout, then exits). Do NOT
  // install our own handlers for them here — multiple handlers would
  // race, and our `process.kill(pid, signal)` re-raise trick would
  // either double-run graceful exit or be pre-empted by it.
  //
  // SIGHUP/SIGQUIT are rarer (terminal closed, Ctrl+\) and there's no
  // time for graceful save, so just restore the tty and re-raise.
  const signals: NodeJS.Signals[] = ['SIGHUP', 'SIGQUIT']
  for (const signal of signals) {
    process.on(signal, () => {
      logger.info(`Received ${signal}, cleaning up terminal...`)
      restoreTerminal()
      // Re-raise with default disposition so the process actually exits.
      process.removeAllListeners(signal)
      process.kill(process.pid, signal)
    })
  }

  // Uncaught exceptions — restore the tty so the user's shell is usable
  // before Node prints the stack trace and exits.
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception, cleaning up terminal...')
    restoreTerminal()
    console.error(err)
    process.exit(1)
  })

  // Unhandled rejections — same as above.
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection, cleaning up terminal...')
    restoreTerminal()
    console.error(reason)
    process.exit(1)
  })
}

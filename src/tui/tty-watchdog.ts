/**
 * TTY Watchdog — subprocess that monitors parent and resets terminal on crash
 *
 * This runs as a separate process to handle cases where the main process
 * is killed with SIGKILL (which cannot be caught by the main process).
 *
 * Usage: bun run tty-watchdog.ts <parent-pid> <tty-device>
 */

import { openSync, writeSync, closeSync } from 'node:fs'

/**
 * ANSI escape sequences to disable mouse tracking and restore terminal
 */
const RESET_SEQUENCES =
  '\x1b[?9l' + // Disable X10 mouse tracking
  '\x1b[?1000l' + // Disable normal tracking mode
  '\x1b[?1002l' + // Disable button event tracking
  '\x1b[?1003l' + // Disable any-event tracking (mouse movement)
  '\x1b[?1006l' + // Disable SGR extended coordinates
  '\x1b[?1005l' + // Disable UTF-8 extended coordinates
  '\x1b[?25h' + // Show cursor
  '\x1b[0m' // Reset attributes

/**
 * Check if a process is still running
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Signal 0 just checks if process exists, doesn't actually send a signal
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Main watchdog loop
 */
function startWatchdog(parentPid: number, ttyDevice: string): void {
  // Open TTY for writing
  let ttyFd: number | null = null
  try {
    ttyFd = openSync(ttyDevice, 'w')
  } catch (err) {
    console.error(`Watchdog: Failed to open TTY ${ttyDevice}:`, err)
    process.exit(1)
  }

  // Monitor parent process
  const checkInterval = setInterval(() => {
    if (!isProcessRunning(parentPid)) {
      // Parent died — clean up terminal
      try {
        writeSync(ttyFd!, RESET_SEQUENCES)
        closeSync(ttyFd!)
      } catch {
        // Ignore errors during cleanup
      }
      clearInterval(checkInterval)
      process.exit(0)
    }
  }, 100) // Check every 100ms

  // Also handle our own termination gracefully
  process.on('SIGTERM', () => {
    clearInterval(checkInterval)
    try {
      closeSync(ttyFd!)
    } catch {
      // Ignore
    }
    process.exit(0)
  })
}

// Main entry point when run as script
if (import.meta.main) {
  const args = process.argv.slice(2)
  const parentPid = parseInt(args[0], 10)
  const ttyDevice = args[1] || '/dev/tty'

  if (isNaN(parentPid)) {
    console.error('Usage: bun run tty-watchdog.ts <parent-pid> [tty-device]')
    process.exit(1)
  }

  // Don't start if parent is already dead
  if (!isProcessRunning(parentPid)) {
    console.error('Watchdog: Parent process is not running')
    process.exit(1)
  }

  startWatchdog(parentPid, ttyDevice)
}

// Store watchdog PID so we can kill it on normal exit
let watchdogPid: number | null = null

/**
 * Spawn a watchdog process for the current process
 * Returns the watchdog PID so it can be killed on normal exit
 */
export function spawnWatchdog(): number | null {
  const parentPid = process.pid
  const ttyDevice = process.stdin.isTTY ? '/dev/tty' : '/dev/null'

  if (!process.stdin.isTTY) {
    // Not running in a TTY, no need for watchdog
    return null
  }

  // Spawn watchdog as detached process so it survives parent's death
  const { spawn } = require('node:child_process')
  const path = require('node:path')

  const watchdogPath = path.join(__dirname, 'tty-watchdog.ts')

  const child = spawn('bun', ['run', watchdogPath, String(parentPid), ttyDevice], {
    detached: true,
    stdio: 'ignore',
  })

  watchdogPid = child.pid

  // Unref so parent can exit without waiting for watchdog
  child.unref()

  return child.pid
}

/**
 * Kill the watchdog process (call this on normal exit)
 */
export function killWatchdog(): void {
  if (watchdogPid) {
    try {
      process.kill(watchdogPid, 'SIGTERM')
    } catch {
      // Ignore errors (watchdog might already be dead)
    }
    watchdogPid = null
  }
}

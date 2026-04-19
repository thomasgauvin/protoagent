/**
 * Multi-Tab Session Management
 *
 * Persists which tabs were open and restores them on startup.
 * Stores a "tab group" file that lists all session IDs that were open.
 *
 * Supports named agent instances for isolation:
 *   protoagent --name work      → separate tabs from
 *   protoagent --name personal  → another isolated set
 *   protoagent                  → uses 'default' agent
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export interface TabSessionInfo {
  id: string
  title: string
}

interface TabGroupFile {
  id: string
  createdAt: string
  updatedAt: string
  tabSessionIds: string[] // List of session IDs that were open (backward compat)
  tabs?: TabSessionInfo[] // New format: session IDs with titles
}

const TAB_GROUP_DIR_MODE = 0o700
const TAB_GROUP_FILE_MODE = 0o600

// Current agent name (set via CLI --name flag)
let currentAgentName: string = 'default'

/**
 * Set the agent name for session isolation.
 * Call this at startup before using any other functions.
 */
export function setAgentName(name: string): void {
  currentAgentName = name || 'default'
}

/**
 * Get the current agent name
 */
export function getAgentName(): string {
  return currentAgentName
}

/**
 * Get the directory for tab groups for the current agent
 */
function getTabGroupsDir(): string {
  const homeDir = os.homedir()
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'agents', currentAgentName, 'tab-groups')
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'agents', currentAgentName, 'tab-groups')
}

async function ensureTabGroupsDir(): Promise<string> {
  const dir = getTabGroupsDir()
  await fs.mkdir(dir, { recursive: true, mode: TAB_GROUP_DIR_MODE })
  return dir
}

function getTabGroupPath(groupId: string): string {
  return path.join(getTabGroupsDir(), `${groupId}.json`)
}

function generateTabGroupId(): string {
  return Math.random().toString(36).slice(2, 9)
}

/**
 * Get the ID of the last tab group (for restoring tabs on startup)
 */
function getLastTabGroupFile(): string {
  const homeDir = os.homedir()
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'agents', currentAgentName, 'last-tab-group.json')
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'agents', currentAgentName, 'last-tab-group.json')
}

/**
 * Save the currently open tabs for later restoration
 */
export async function saveTabGroup(tabs: TabSessionInfo[]): Promise<void> {
  try {
    await ensureTabGroupsDir()

    const groupId = generateTabGroupId()
    const tabGroup: TabGroupFile = {
      id: groupId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tabSessionIds: tabs.map(t => t.id), // Backward compatibility
      tabs,
    }

    const filePath = getTabGroupPath(groupId)
    await fs.writeFile(filePath, JSON.stringify(tabGroup, null, 2), { mode: TAB_GROUP_FILE_MODE })

    // Write "last tab group" marker so we know which group to restore
    const lastGroupFile = getLastTabGroupFile()
    await fs.writeFile(lastGroupFile, JSON.stringify({ groupId, restoredAt: new Date().toISOString() }, null, 2), {
      mode: TAB_GROUP_FILE_MODE,
    })
  } catch (err: any) {
    console.error(`Failed to save tab group: ${err.message}`)
  }
}

/**
 * Load the last open tabs
 */
export async function loadLastTabGroup(): Promise<TabSessionInfo[] | null> {
  try {
    const lastGroupFile = getLastTabGroupFile()
    const lastGroupData = JSON.parse(await fs.readFile(lastGroupFile, 'utf8'))
    const { groupId } = lastGroupData

    const tabGroupPath = getTabGroupPath(groupId)
    const tabGroup = JSON.parse(await fs.readFile(tabGroupPath, 'utf8')) as TabGroupFile

    // Use new format if available, otherwise fall back to legacy format
    if (tabGroup.tabs && tabGroup.tabs.length > 0) {
      return tabGroup.tabs
    }

    // Legacy format: just IDs, titles will be loaded from sessions
    return tabGroup.tabSessionIds.map(id => ({ id, title: 'New session' }))
  } catch {
    // File doesn't exist or is invalid - no tabs to restore
    return null
  }
}

/**
 * Clear last tab group (when user starts fresh)
 */
export async function clearLastTabGroup(): Promise<void> {
  try {
    const lastGroupFile = getLastTabGroupFile()
    await fs.unlink(lastGroupFile)
  } catch {
    // File doesn't exist - nothing to clear
  }
}

/**
 * List all agent instances that have saved sessions
 */
export async function listAgents(): Promise<string[]> {
  try {
    const homeDir = os.homedir()
    const agentsDir = process.platform === 'win32'
      ? path.join(homeDir, 'AppData', 'Local', 'protoagent', 'agents')
      : path.join(homeDir, '.local', 'share', 'protoagent', 'agents')

    const entries = await fs.readdir(agentsDir, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort()
  } catch {
    return []
  }
}

// ─── Agent Locking ─────────────────────────────────────────────────────────
// Prevents multiple instances of the same agent from running concurrently

function getAgentLockFile(): string {
  const homeDir = os.homedir()
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'agents', currentAgentName, '.lock')
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'agents', currentAgentName, '.lock')
}

export interface LockResult {
  locked: boolean
  otherPid?: number
  error?: string
}

/**
 * Try to acquire a lock for this agent instance.
 * Returns { locked: true } if successful, { locked: false, ... } if another instance is running.
 */
export async function acquireAgentLock(): Promise<LockResult> {
  const lockFile = getAgentLockFile()

  try {
    // Check if lock file exists
    try {
      const content = await fs.readFile(lockFile, 'utf8')
      const otherPid = parseInt(content.trim(), 10)

      // Check if the other process is still running
      if (!isNaN(otherPid) && isProcessRunning(otherPid)) {
        return {
          locked: false,
          otherPid,
          error: `Another ProtoAgent instance is already running with agent '${currentAgentName}' (PID: ${otherPid})`
        }
      }

      // Stale lock file - process no longer exists, we'll overwrite it
    } catch {
      // Lock file doesn't exist - good to proceed
    }

    // Write our PID to the lock file
    await fs.mkdir(path.dirname(lockFile), { recursive: true })
    await fs.writeFile(lockFile, String(process.pid), { mode: 0o600 })

    return { locked: true }
  } catch (err: any) {
    return {
      locked: false,
      error: `Failed to acquire lock: ${err.message}`
    }
  }
}

/**
 * Release the agent lock. Called on clean shutdown.
 */
export async function releaseAgentLock(): Promise<void> {
  try {
    const lockFile = getAgentLockFile()
    // Only remove if it contains our PID (don't stomp on someone else's lock)
    const content = await fs.readFile(lockFile, 'utf8')
    if (content.trim() === String(process.pid)) {
      await fs.unlink(lockFile)
    }
  } catch {
    // Lock file doesn't exist or we don't own it - ignore
  }
}

/**
 * Check if a process is running (platform-specific)
 */
function isProcessRunning(pid: number): boolean {
  try {
    // kill with signal 0 just checks if process exists (doesn't actually kill it)
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * web-server.ts — Embedded web server for the ProtoAgent TUI
 *
 * Serves the web UI and proxies API requests to an embedded API runtime.
 * This allows `/web` command to open a browser without needing separate servers.
 *
 * Port: 5174 (same as Vite dev server for consistency)
 */

import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stat, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { createApiApp } from '../api/server.js'
import { ApiRuntime } from '../api/state.js'
import { logger } from '../utils/logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Find the web/dist folder relative to this file
// In dev: src/tui/web-server.ts -> ../../web/dist
// In build: dist/tui/web-server.js -> ../../web/dist (same relative path)
const WEB_DIST_PATH = join(__dirname, '..', '..', 'web', 'dist')

const DEFAULT_PORT = 5174
const API_PATHS = ['/sessions', '/approvals', '/workflow', '/todos', '/skills', '/mcp', '/abort', '/health']

interface WebServerState {
  server: ReturnType<typeof Bun.serve> | null
  runtime: ApiRuntime | null
  port: number
}

const state: WebServerState = {
  server: null,
  runtime: null,
  port: 0,
}

// MIME type mapping for static files
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'))
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/**
 * Check if the web dist folder exists and has content
 */
export async function isWebDistAvailable(): Promise<boolean> {
  try {
    const indexPath = join(WEB_DIST_PATH, 'index.html')
    await stat(indexPath)
    return true
  } catch {
    return false
  }
}

/**
 * Build the web UI if it doesn't exist
 * Returns true if build succeeded or dist already exists
 */
export async function buildWebIfNeeded(): Promise<{ success: boolean; message: string }> {
  // Check if already built
  if (await isWebDistAvailable()) {
    return { success: true, message: 'Web UI already built' }
  }

  // Check if web folder exists (we're in the right repo)
  const webPackageJson = join(__dirname, '..', '..', 'web', 'package.json')
  try {
    await stat(webPackageJson)
  } catch {
    return {
      success: false,
      message: 'Web folder not found. Are you in the protoagent directory?',
    }
  }

  // Run the build
  logger.info('Building web UI...')
  const projectRoot = join(__dirname, '..', '..')
  const result = spawnSync('bun', ['run', 'build:web'], {
    cwd: projectRoot,
    stdio: 'pipe',
    encoding: 'utf-8',
  })

  if (result.status !== 0) {
    const errorOutput = result.stderr || result.stdout || 'Unknown error'
    logger.error(`Web build failed: ${errorOutput}`)
    return {
      success: false,
      message: `Build failed: ${errorOutput.slice(0, 200)}`,
    }
  }

  // Verify build succeeded
  if (await isWebDistAvailable()) {
    logger.info('Web UI built successfully')
    return { success: true, message: 'Web UI built successfully' }
  }

  return { success: false, message: 'Build completed but dist not found' }
}

/**
 * Start the embedded web server
 */
export async function startWebServer(options: {
  port?: number
  dangerouslySkipPermissions?: boolean
} = {}): Promise<{ port: number; url: string }> {
  // Already running?
  if (state.server) {
    return { port: state.port, url: `http://localhost:${state.port}` }
  }

  // Check if web dist exists
  const distAvailable = await isWebDistAvailable()
  if (!distAvailable) {
    throw new Error(
      `Web UI not built. Run 'bun run build:web' from the protoagent directory first.`
    )
  }

  // Create API runtime for proxying
  state.runtime = new ApiRuntime({
    dangerouslySkipPermissions: options.dangerouslySkipPermissions ?? false,
  })
  await state.runtime.initialize()

  const apiApp = createApiApp(state.runtime)

  const requestedPort = options.port ?? DEFAULT_PORT

  // Request handler
  const fetch = async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const pathname = url.pathname

    // Check if this is an API request
    const isApiRequest = API_PATHS.some(p => pathname.startsWith(p))
    if (isApiRequest) {
      // Proxy to API app
      return apiApp.fetch(req)
    }

    // Serve static files
    try {
      // Map URL to file path
      let filePath = pathname === '/' ? '/index.html' : pathname
      const fullPath = join(WEB_DIST_PATH, filePath)

      // Security: ensure we're not escaping the dist folder
      if (!fullPath.startsWith(WEB_DIST_PATH)) {
        return new Response('Forbidden', { status: 403 })
      }

      // Check if file exists
      try {
        const fileStat = await stat(fullPath)
        if (fileStat.isDirectory()) {
          // Try index.html in directory
          filePath = join(filePath, 'index.html')
        }
      } catch {
        // File not found - serve index.html for SPA routing
        const indexContent = await readFile(join(WEB_DIST_PATH, 'index.html'))
        return new Response(indexContent, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      const content = await readFile(join(WEB_DIST_PATH, filePath))
      return new Response(content, {
        headers: { 'Content-Type': getMimeType(filePath) },
      })
    } catch (err) {
      // Fallback to index.html for SPA
      try {
        const indexContent = await readFile(join(WEB_DIST_PATH, 'index.html'))
        return new Response(indexContent, {
          headers: { 'Content-Type': 'text/html' },
        })
      } catch {
        return new Response('Not Found', { status: 404 })
      }
    }
  }

  // Start server with port fallback
  try {
    state.server = Bun.serve({
      port: requestedPort,
      hostname: '127.0.0.1',
      fetch,
    })
    state.port = state.server.port
  } catch (err: any) {
    // If port is busy, try random port
    const isPortBusy = err?.code === 'EADDRINUSE' || err?.message?.includes('address already in use')
    if (isPortBusy) {
      state.server = Bun.serve({
        port: 0,
        hostname: '127.0.0.1',
        fetch,
      })
      state.port = state.server.port
      logger.info(`Web server port ${requestedPort} busy, using ${state.port}`)
    } else {
      throw err
    }
  }

  logger.info(`Web server started on http://localhost:${state.port}`)
  return { port: state.port, url: `http://localhost:${state.port}` }
}

/**
 * Stop the web server
 */
export async function stopWebServer(): Promise<void> {
  if (state.server) {
    state.server.stop(true)
    state.server = null
  }
  if (state.runtime) {
    await state.runtime.close()
    state.runtime = null
  }
  state.port = 0
}

/**
 * Get the current web server URL if running
 */
export function getWebServerUrl(): string | null {
  if (state.server && state.port > 0) {
    return `http://localhost:${state.port}`
  }
  return null
}

/**
 * Check if web server is running
 */
export function isWebServerRunning(): boolean {
  return state.server !== null
}

/**
 * Open the web UI in the default browser
 */
export async function openWebBrowser(url: string): Promise<void> {
  const { spawn } = await import('node:child_process')

  // Platform-specific open command
  const platform = process.platform
  let cmd: string
  let args: string[]

  if (platform === 'darwin') {
    cmd = 'open'
    args = [url]
  } else if (platform === 'win32') {
    cmd = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    // Linux and others
    cmd = 'xdg-open'
    args = [url]
  }

  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
}

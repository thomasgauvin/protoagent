/**
 * debug-server.ts — OpenTUI "CDP for terminals"
 *
 * A lightweight HTTP inspection server that exposes the live opentui
 * renderable tree so external tools (or an AI agent) can introspect the
 * running application exactly like Chrome DevTools Protocol lets you
 * inspect a live browser.
 *
 * Enabled via:  PROTOAGENT_DEBUG=1 bun src/cli.ts
 * Default port: 7766  (override with PROTOAGENT_DEBUG_PORT=xxxx)
 *
 * Endpoints
 * ─────────
 *  GET  /tree          Full serialised renderable tree
 *  GET  /node/:id      Single node by ID
 *  GET  /focused       Currently focused node
 *  GET  /snapshot      Plain-text screen snapshot (id → text content)
 *  GET  /screenshot    Capture PNG screenshot of the terminal buffer
 *  GET  /bindings      List all available keyboard shortcuts
 *  POST /key           Inject a key event to focused element { name, ctrl?, meta?, shift? }
 *  POST /global-key    Emit key event globally (triggers app shortcuts) { name, ctrl?, meta?, shift? }
 *
 * The server is intentionally simple — no auth, no TLS, localhost only.
 */

import type { CliRenderer } from '@opentui/core'
import { Jimp } from 'jimp'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SerializedNode {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  visible: boolean
  focused: boolean
  text?: string          // Only present for text-bearing nodes
  children: SerializedNode[]
}

interface ServerResult {
  port: number
  server: any
  requestedPort: number
}

// ─── Text extraction ──────────────────────────────────────────────────────────

function extractText(node: any): string | undefined {
  // TextRenderable stores _text (StyledText with .chunks[].text)
  if (node._text?.chunks) {
    return node._text.chunks.map((c: any) => c.text ?? '').join('')
  }
  // EditBufferRenderable (Textarea) exposes editBuffer.getText()
  if (typeof node.editBuffer?.getText === 'function') {
    try { return node.editBuffer.getText() } catch { /* ignore */ }
  }
  return undefined
}

// ─── Tree serialisation ───────────────────────────────────────────────────────

function serializeNode(node: any, depth = 0): SerializedNode {
  const text = extractText(node)
  const result: SerializedNode = {
    id: node.id ?? `(no-id-${node.num})`,
    type: node.constructor?.name ?? 'Unknown',
    x: node.x ?? 0,
    y: node.y ?? 0,
    width: node.width ?? 0,
    height: node.height ?? 0,
    visible: node.visible ?? true,
    focused: node.focused ?? false,
    children: [],
  }
  if (text !== undefined) result.text = text

  try {
    const children: any[] = node.getChildren?.() ?? []
    result.children = children.map(c => serializeNode(c, depth + 1))
  } catch { /* ignore */ }

  return result
}

// ─── Flat snapshot (id → text) ────────────────────────────────────────────────

function snapshotNode(node: any, out: Record<string, string>): void {
  const text = extractText(node)
  if (text !== undefined && text.trim().length > 0) {
    out[node.id ?? node.num] = text
  }
  try {
    for (const child of node.getChildren?.() ?? []) snapshotNode(child, out)
  } catch { /* ignore */ }
}

// ─── Find by ID ───────────────────────────────────────────────────────────────

function findById(node: any, id: string): any | null {
  if ((node.id ?? '') === id) return node
  try {
    for (const child of node.getChildren?.() ?? []) {
      const found = findById(child, id)
      if (found) return found
    }
  } catch { /* ignore */ }
  return null
}

// ─── Screenshot generation ────────────────────────────────────────────────────

/**
 * Generate a PNG screenshot from the current render buffer.
 * Each terminal cell is rendered as a colored block representing its background color.
 */
async function generateScreenshot(renderer: CliRenderer): Promise<Buffer> {
  // Access the current render buffer
  const r = renderer as any
  const buffer = r.currentRenderBuffer

  if (!buffer) {
    throw new Error('No render buffer available')
  }

  const { width, height } = buffer
  const { bg } = buffer.buffers

  // Create a Jimp image
  const image = new Jimp({ width, height, color: 0x000000FF }) // Black background

  // Fill each pixel with the background color from the terminal buffer
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4
      // bg is Float32Array with RGBA values in range 0-1
      const r = Math.round(bg[idx] * 255)
      const g = Math.round(bg[idx + 1] * 255)
      const b = Math.round(bg[idx + 2] * 255)
      const a = Math.round(bg[idx + 3] * 255)

      // Pack into Jimp's expected format (RGBA as a single number)
      const color = (r << 24) | (g << 16) | (b << 8) | a
      image.setPixelColor(color, x, y)
    }
  }

  // Get PNG buffer
  return await image.getBuffer('image/png')
}

// ─── Port discovery helper ────────────────────────────────────────────────────

/**
 * Start server with auto-port assignment:
 * 1. If PROTOAGENT_DEBUG_PORT is set, use that explicitly
 * 2. Otherwise try default port 7766
 * 3. If busy, fall back to random available port
 */
async function startServerWithPortDiscovery(
  fetchHandler: (req: Request) => Response | Promise<Response>,
): Promise<ServerResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Bun = (globalThis as any).Bun

  const requestedPort = process.env.PROTOAGENT_DEBUG_PORT
    ? parseInt(process.env.PROTOAGENT_DEBUG_PORT, 10)
    : 7766

  // Try requested port first
  try {
    const server = Bun.serve({
      port: requestedPort,
      hostname: '127.0.0.1',
      fetch: fetchHandler,
    })
    return { port: server.port, server, requestedPort }
  } catch (err: any) {
    // If port is in use and user didn't specify one, try random port
    const isPortBusy = err?.code === 'EADDRINUSE' || err?.message?.includes('address already in use')
    if (isPortBusy && !process.env.PROTOAGENT_DEBUG_PORT) {
      const server = Bun.serve({
        port: 0, // Let Bun assign random available port
        hostname: '127.0.0.1',
        fetch: fetchHandler,
      })
      return { port: server.port, server, requestedPort }
    }
    throw err
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

export async function startDebugServer(renderer: CliRenderer): Promise<void> {
  // Store screenshot endpoint handler separately for async
  const handleScreenshot = async (): Promise<Response> => {
    try {
      const pngBuffer = await generateScreenshot(renderer)
      return new Response(pngBuffer, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache',
        },
      })
    } catch (err) {
      return json({ error: 'Failed to generate screenshot', details: String(err) }, 500)
    }
  }

  // Main request handler
  const fetchHandler = (req: Request): Response | Promise<Response> => {
    const url = new URL(req.url)
    const root = (renderer as any).root

    // ── GET /tree ────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/tree') {
      const tree = serializeNode(root)
      return json(tree)
    }

    // ── GET /focused ─────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/focused') {
      const focused = (renderer as any).currentFocusedRenderable
      if (!focused) return json({ focused: null })
      return json(serializeNode(focused))
    }

    // ── GET /snapshot ─────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/snapshot') {
      const out: Record<string, string> = {}
      snapshotNode(root, out)
      return json(out)
    }

    // ── GET /screenshot ──────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/screenshot') {
      return handleScreenshot()
    }

    // ── GET /node/:id ─────────────────────────────────────────────────
    const nodeMatch = url.pathname.match(/^\/node\/(.+)$/)
    if (req.method === 'GET' && nodeMatch) {
      const node = findById(root, nodeMatch[1])
      if (!node) return json({ error: 'not found' }, 404)
      return json(serializeNode(node))
    }

    // ── GET /bindings ───────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/bindings') {
      const bindings = {
        global: [
          { key: 'Ctrl+C', description: 'Save tabs and exit' },
          { key: 'Ctrl+T', description: 'Create new tab' },
          { key: 'Ctrl+Tab / Ctrl+PageDown', description: 'Next tab' },
          { key: 'Ctrl+Shift+Tab / Ctrl+PageUp', description: 'Previous tab' },
          { key: 'Ctrl+1 through Ctrl+9', description: 'Switch to tab by number' },
          { key: 'Ctrl+W', description: 'Close current tab' },
          { key: 'Tab / Shift+Tab', description: 'Cycle workflow (queue → loop → cron)' },
        ],
        input: [
          { key: 'Enter / Return', description: 'Submit message' },
          { key: 'Up/Down', description: 'Navigate slash command menu' },
          { key: 'Tab', description: 'Accept slash command suggestion' },
          { key: 'Escape', description: 'Close slash command menu' },
        ],
        mouse: [
          { action: 'Click tab', description: 'Switch to that tab' },
          { action: 'Click × on tab', description: 'Close that tab' },
          { action: 'Click "+ New"', description: 'Create new tab' },
        ],
      }
      return json(bindings)
    }

    // ── POST /key ────────────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/key') {
      return req.json().then((body: any) => {
        const focused = (renderer as any).currentFocusedRenderable
        if (!focused) return json({ error: 'no focused node' }, 400)

        // Build a minimal KeyEvent compatible object
        const key = {
          name: body.name ?? '',
          sequence: body.sequence ?? body.name ?? '',
          ctrl: body.ctrl ?? false,
          meta: body.meta ?? false,
          shift: body.shift ?? false,
          super: body.super ?? false,
          hyper: body.hyper ?? false,
          _defaultPrevented: false,
          preventDefault() { this._defaultPrevented = true },
        }

        // Fire onKeyDown first (hook logic, preventDefault support)
        const keyDownHandler = focused.onKeyDown
        if (typeof keyDownHandler === 'function') {
          keyDownHandler(key)
        }

        // If not prevented, let handleKeyPress insert the character / run action
        if (!key._defaultPrevented && typeof focused.handleKeyPress === 'function') {
          focused.handleKeyPress(key)
        }

        return json({ ok: true, target: focused.id ?? null })
      })
    }

    // ── POST /global-key ─────────────────────────────────────────────
    if (req.method === 'POST' && url.pathname === '/global-key') {
      return req.json().then((body: any) => {
        // Build a minimal KeyEvent compatible object
        const key = {
          name: body.name ?? '',
          sequence: body.sequence ?? body.name ?? '',
          ctrl: body.ctrl ?? false,
          meta: body.meta ?? false,
          shift: body.shift ?? false,
          super: body.super ?? false,
          hyper: body.hyper ?? false,
          _defaultPrevented: false,
          preventDefault() { this._defaultPrevented = true },
        }

        // Emit to the global keyInput handler (triggers app shortcuts)
        const keyInput = (renderer as any).keyInput
        if (keyInput) {
          keyInput.emit('keypress', key)
          return json({ ok: true, emitted: true, key: { name: key.name, ctrl: key.ctrl, meta: key.meta, shift: key.shift } })
        }

        return json({ ok: false, error: 'keyInput not available' }, 500)
      })
    }

    return json({ error: 'not found' }, 404)
  }

  const { port, requestedPort } = await startServerWithPortDiscovery(fetchHandler)

  if (port !== requestedPort) {
    console.log(`[debug-server] Port ${requestedPort} busy, using http://127.0.0.1:${port}`)
  } else {
    console.log(`[debug-server] Listening on http://127.0.0.1:${port}`)
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

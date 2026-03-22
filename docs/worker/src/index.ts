/**
 * Main Worker entrypoint
 * 
 * Routes:
 *   /           -> Create new session, redirect to /s/<id>
 *   /s/<id>     -> Serve ghostty-web terminal UI
 *   /ws/<id>    -> WebSocket for terminal I/O
 *   /info       -> Session info API
 */

import { AgentSessionDO } from './session.js';
import type { Env } from './types.js';

export { AgentSessionDO };

// Debug logging helper
function debugLog(...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[Worker ${timestamp}]`, ...args);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    debugLog('Request:', request.method, url.pathname);

    // Create new session
    if (url.pathname === '/') {
      const id = crypto.randomUUID().slice(0, 8);
      return Response.redirect(`${url.origin}/s/${id}`, 302);
    }

    // Serve terminal UI - allow embedding in iframes
    const sessionMatch = url.pathname.match(/^\/s\/([a-zA-Z0-9_-]+)$/);
    if (sessionMatch) {
      return new Response(renderFrontend(sessionMatch[1], url.origin), {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "frame-ancestors *",
        },
      });
    }

    // WebSocket endpoint
    const wsMatch = url.pathname.match(/^\/ws\/([a-zA-Z0-9_-]+)$/);
    if (wsMatch) {
      const sessionId = wsMatch[1];
      const doId = env.SESSIONS.idFromName(sessionId);
      
      // Forward the request directly - don't modify headers as it breaks WebSocket upgrade
      // The session ID is in the URL already
      return env.SESSIONS.get(doId).fetch(request);
    }

    // API endpoints
    const apiMatch = url.pathname.match(/^\/api\/sessions\/([a-zA-Z0-9_-]+)$/);
    if (apiMatch) {
      const doId = env.SESSIONS.idFromName(apiMatch[1]);
      return env.SESSIONS.get(doId).fetch(new Request(`${url.origin}/info`));
    }

    return new Response('Not found', { status: 404 });
  },
};

function renderFrontend(sessionId: string, origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ProtoAgent Worker</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=VT323&family=Share+Tech+Mono&display=swap');
  :root {
    --green: #72ff8c;
    --green-bright: #b7ff6a;
    --green-dim: #2c8a49;
    --green-deep: #12311d;
    --bg: #030805;
    --bg-soft: #07100a;
    --border: rgba(114, 255, 140, 0.22);
    --border-strong: rgba(114, 255, 140, 0.48);
    --text: #baf8c7;
    --text-dim: #5ba36c;
    --text-faint: #356043;
    --danger: #ff7a7a;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { 
    background: 
      radial-gradient(circle at top center, rgba(114, 255, 140, 0.1), transparent 36%),
      linear-gradient(180deg, #06110a 0%, var(--bg) 40%, #020502 100%);
    color: var(--text); 
    height: 100%; 
    width: 100%; 
    overflow: hidden;
    font-family: 'Share Tech Mono', monospace;
  }
  
  /* CRT scanline effect */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.24) 0,
      rgba(0, 0, 0, 0.24) 1px,
      transparent 1px,
      transparent 3px
    );
    pointer-events: none;
    z-index: 9998;
  }
  
  body::after {
    content: '';
    position: fixed;
    inset: 0;
    background: radial-gradient(ellipse at center, transparent 52%, rgba(0, 0, 0, 0.74) 100%);
    pointer-events: none;
    z-index: 9997;
  }
  
  body { display: flex; flex-direction: column; position: relative; z-index: 1; }
  
  #terminal { 
    flex: 1; 
    width: 100%; 
    height: 100%; 
    overflow: auto;
    position: relative;
    min-width: 0;
  }
  .xterm { 
    padding: 8px; 
    height: 100%;
  }
  .xterm-viewport {
    width: 100% !important;
    height: 100% !important;
    overflow-y: auto !important;
  }
  .xterm-screen { 
    width: 100% !important;
    max-width: 100% !important;
  }
  .xterm-rows {
    max-width: 100% !important;
  }
  .xterm-row {
    white-space: pre-wrap !important;
    word-wrap: break-word !important;
    overflow-wrap: anywhere !important;
  }
  .xterm-decoration-container {
    max-width: 100% !important;
  }
  canvas {
    max-width: 100% !important;
    max-height: 100% !important;
    width: 100% !important;
    height: 100% !important;
  }
  .xterm-viewport {
    height: 100% !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-end !important;
  }
  .xterm-rows {
    height: auto !important;
    flex: 1 !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: flex-end !important;
  }
  /* Mobile input bar - hidden by default, shown on touch devices */
  #mobile-input-container {
    display: none;
    padding: 8px 12px;
    background: var(--bg-soft);
    border-top: 1px solid var(--border);
  }
  #mobile-input-container.active {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  #mobile-input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--green);
    font-family: 'Share Tech Mono', monospace;
    font-size: 14px;
    padding: 8px 12px;
    outline: none;
  }
  #mobile-input:focus {
    border-color: var(--green);
    box-shadow: 0 0 8px rgba(114, 255, 140, 0.3);
  }
  #mobile-send {
    background: var(--green-deep);
    border: 1px solid var(--green-dim);
    border-radius: 4px;
    color: var(--green);
    font-family: 'Share Tech Mono', monospace;
    font-size: 12px;
    padding: 8px 16px;
    cursor: pointer;
  }
  #mobile-send:active {
    background: var(--green-dim);
  }
</style>
</head>
<body>
<div id="terminal"></div>
<div id="mobile-input-container">
  <input type="text" id="mobile-input" placeholder="Type command..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
  <button id="mobile-send">Enter</button>
</div>
<div id="debug-status" style="position:fixed; top:4px; right:4px; background:rgba(0,0,0,0.8); color:#72ff8c; font-size:11px; padding:4px 8px; z-index:10000; font-family:monospace;">Initializing...</div>

<script type="module">
import { init, Terminal } from 'https://esm.sh/ghostty-web@latest';

await init();

const term = new Terminal({
  fontSize: 13,
  fontFamily: "'Share Tech Mono', 'VT323', monospace",
  cursorBlink: true,
  cursorStyle: 'bar',
  scrollback: 50000,
  convertEol: false,
  wordWrap: true,
  allowTransparency: true,
  screenReaderMode: true,  // Use proper textarea for input - better for mobile
  theme: {
    foreground: '#baf8c7',
    background: '#030805',
    cursor: '#72ff8c',
    cursorAccent: '#030805',
    selectionBackground: 'rgba(114, 255, 140, 0.18)',
    selectionForeground: '#ffffff',
    black: '#030805',
    red: '#ff7a7a',
    green: '#72ff8c',
    yellow: '#ffe37a',
    blue: '#81a2be',
    magenta: '#b294bb',
    cyan: '#8abeb7',
    white: '#baf8c7',
    brightBlack: '#356043',
    brightRed: '#ff9a9a',
    brightGreen: '#b7ff6a',
    brightYellow: '#fff37a',
    brightBlue: '#a2c1d4',
    brightMagenta: '#c397d8',
    brightCyan: '#a0d4c8',
    brightWhite: '#ffffff',
  },
});

const container = document.getElementById('terminal');
term.open(container);

// Detect if we're on a touch device (mobile/tablet)
const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

// Mobile input handling
const mobileInputContainer = document.getElementById('mobile-input-container');
const mobileInput = document.getElementById('mobile-input');
const mobileSend = document.getElementById('mobile-send');

if (isTouchDevice) {
  // Show mobile input bar
  mobileInputContainer.classList.add('active');
  
  // When user types in mobile input, send to terminal and backend
  let currentLine = '';
  
  mobileInput.addEventListener('input', (e) => {
    const newValue = e.target.value;
    const diff = newValue.length - currentLine.length;
    
    if (diff > 0) {
      // Characters added - send them
      const added = newValue.slice(currentLine.length);
      term.write(added);
      sendJSON({ type: 'input', data: added });
    } else if (diff < 0) {
      // Characters deleted - send backspace
      for (let i = 0; i < Math.abs(diff); i++) {
        term.write('\b \b'); // Backspace visually
        sendJSON({ type: 'input', data: '\x7f' }); // DEL key for backend
      }
    }
    
    currentLine = newValue;
  });
  
  // Handle Enter key
  mobileInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      term.write('\r\n');
      sendJSON({ type: 'input', data: '\r' });
      mobileInput.value = '';
      currentLine = '';
    }
  });
  
  // Send button
  mobileSend.addEventListener('click', () => {
    term.write('\r\n');
    sendJSON({ type: 'input', data: '\r' });
    mobileInput.value = '';
    currentLine = '';
    mobileInput.focus();
  });
  
  // Focus mobile input when tapping terminal
  container.addEventListener('click', () => {
    mobileInput.focus();
  });
  
  // Auto-focus on load
  setTimeout(() => mobileInput.focus(), 100);
  
} else {
  // Desktop: use normal xterm.js focus
  function focusTerminal() {
    term.focus();
    const helperTextarea = container.querySelector('.xterm-helper-textarea');
    if (helperTextarea) helperTextarea.focus();
  }
  
  setTimeout(focusTerminal, 100);
  container.addEventListener('click', focusTerminal);
  container.addEventListener('touchend', focusTerminal);
}

// Initial fit to set proper canvas size
setTimeout(() => {
  fitTerminal();
}, 0);

// Frontend logging - capture everything written to terminal
const originalWrite = term.write.bind(term);
const frontendLogs = [];
const MAX_FRONTEND_LOGS = 1000;

term.write = function(data) {
  // Log to console for debugging
  if (typeof data === 'string') {
    console.log('[TerminalOut]', JSON.stringify(data));
    frontendLogs.push({ t: Date.now(), data });
    if (frontendLogs.length > MAX_FRONTEND_LOGS) frontendLogs.shift();
  }
  const result = originalWrite(data);
  // Scroll to bottom on new content
  term.scrollToBottom();
  return result;
};

// Expose logs for debugging
window.getFrontendLogs = () => frontendLogs;
window.clearFrontendLogs = () => { frontendLogs.length = 0; };

const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = proto + '//' + location.host + '/ws/${sessionId}';
let reconnectDelay = 1000;
let ws;

function sendJSON(obj) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function updateStatus(msg) {
  connectionState = msg;
  console.log('[WebSocket]', msg);
  const el = document.getElementById('debug-status');
  if (el) el.textContent = msg;
}

function connect() {
  updateStatus('connecting to ' + wsUrl);
  ws = new WebSocket(wsUrl);
  
  ws.onopen = () => {
    updateStatus('connected');
    term.reset();
    reconnectDelay = 1000;
    
    // Send initial size
    const cols = term.cols || 80;
    const rows = term.rows || 24;
    sendJSON({ type: 'resize', cols, rows });
  };
  
  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      term.write(event.data);
    }
  };
  
  ws.onclose = (e) => {
    updateStatus('closed (code: ' + e.code + ', wasClean: ' + e.wasClean + ')');
    setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 10000);
      connect();
    }, reconnectDelay);
  };
  
  ws.onerror = (e) => {
    updateStatus('error');
    ws.close();
  };
}

// Handle terminal input
term.onData((data) => {
  sendJSON({ type: 'input', data });
});

// Handle resize - use smaller font to fit more content
function fitTerminal() {
  const rect = container.getBoundingClientRect();
  // Use smaller char width to fit more columns
  const charWidth = 7.2; 
  const charHeight = 15;
  const cols = Math.max(50, Math.floor((rect.width - 16) / charWidth));
  const rows = Math.max(10, Math.floor(rect.height / charHeight));
  if (cols > 0 && rows > 0) {
    term.resize(cols, rows);
    sendJSON({ type: 'resize', cols, rows });
  }
}

window.addEventListener('resize', fitTerminal);
new ResizeObserver(fitTerminal).observe(container);

// Connect
connect();
</script>
</body>
</html>`;
}

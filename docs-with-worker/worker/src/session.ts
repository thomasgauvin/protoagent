/**
 * Agent Session Durable Object
 *
 * Manages a persistent chat session with:
 * - SQLite-backed message history
 * - Virtual filesystem for file operations
 * - Daily message quota tracking
 * - WebSocket multi-client support
 */

import { AgenticLoop } from './agentic-loop.js';
import type { Message, ClientMessage, Env, ToolCall } from './types.js';
import { generateSystemPrompt } from './system-prompt.js';
import { getAllTools, handleToolCall, type ToolContext } from './tools/index.js';
import type { TodoItem } from './tools/todo.js';
import { stubFiles } from './stub-files.js';

// ───────────────────────────────────────────────────────────────────────────────
// Debug Logging
// ───────────────────────────────────────────────────────────────────────────────

function debugLog(...args: unknown[]): void {
  const timestamp = new Date().toISOString();
  console.log(`[SessionDO ${timestamp}]`, ...args);
}

// ───────────────────────────────────────────────────────────────────────────────
// Quota Management Types
// ───────────────────────────────────────────────────────────────────────────────

interface QuotaInfo {
  remaining: number;
  total: number;
  resetAt: Date;
  isLimited: boolean;
}

// ───────────────────────────────────────────────────────────────────────────────
// Session DO Class
// ───────────────────────────────────────────────────────────────────────────────

export class AgentSessionDO implements DurableObject {
  private state: DurableObjectState;
  private env: Env;
  private messages: Message[] = [];
  private currentInput = '';
  private websockets: Set<WebSocket> = new Set();
  private isThinking = false;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.env = env;
    this.currentInput = '';

    debugLog('Initializing AgentSessionDO');
    debugLog('MODEL:', env.MODEL || 'default (@cf/zai-org/glm-4.7-flash)');
    debugLog('AI binding available:', !!env.AI);

    try {
      this.initDatabase();
      this.loadState();
      debugLog('Session initialized, messages loaded:', this.messages.length);
      this.loadStubFiles();
    } catch (error) {
      console.error('Failed to initialize session:', error);
      debugLog('ERROR initializing session:', error);
      this.messages = [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Database Schema & Initialization
  // ─────────────────────────────────────────────────────────────────────────────

  private initDatabase(): void {
    // Messages table for conversation history
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL,
        content TEXT,
        timestamp INTEGER NOT NULL
      )
    `);

    // Metadata table for session settings
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // Files table for virtual filesystem
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Todos table for task management
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        priority TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Quota tracking table
    this.state.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS quota_usage (
        date TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      )
    `);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State Persistence
  // ─────────────────────────────────────────────────────────────────────────────

  private loadState(): void {
    const rows = this.state.storage.sql.exec(
      'SELECT role, content, timestamp FROM messages ORDER BY id'
    ).toArray();

    this.messages = rows.map((r: unknown) => ({
      role: (r as Record<string, string>).role as Message['role'],
      content: (r as Record<string, string>).content,
    }));
  }

  private saveMessage(role: string, content: string): void {
    this.state.storage.sql.exec(
      'INSERT INTO messages (role, content, timestamp) VALUES (?, ?, ?)',
      role,
      content,
      Date.now()
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metadata Helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private getMetadata(key: string): string | null {
    try {
      const rows = this.state.storage.sql.exec(
        'SELECT value FROM metadata WHERE key = ?', key
      ).toArray();
      return rows.length > 0 ? (rows[0] as Record<string, string>).value : null;
    } catch {
      return null;
    }
  }

  private setMetadata(key: string, value: string): void {
    this.state.storage.sql.exec(
      'INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)',
      key,
      value
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Quota Management
  // ─────────────────────────────────────────────────────────────────────────────

  private getDailyQuota(): number {
    const quotaStr = this.env.DAILY_MESSAGE_QUOTA;
    const quota = quotaStr ? parseInt(quotaStr, 10) : NaN;
    return isNaN(quota) ? 50 : Math.max(0, quota);
  }

  private getTodayDate(): string {
    return new Date().toISOString().split('T')[0];
  }

  private getQuotaInfo(): QuotaInfo {
    const total = this.getDailyQuota();
    const today = this.getTodayDate();

    const rows = this.state.storage.sql.exec(
      'SELECT count FROM quota_usage WHERE date = ?',
      today
    ).toArray();

    const used = rows.length > 0 ? (rows[0] as Record<string, number>).count : 0;
    const remaining = Math.max(0, total - used);

    // Calculate next reset time (midnight UTC)
    const resetAt = new Date();
    resetAt.setUTCHours(24, 0, 0, 0);

    return {
      remaining,
      total,
      resetAt,
      isLimited: remaining <= 0,
    };
  }

  private incrementQuota(): void {
    const today = this.getTodayDate();
    this.state.storage.sql.exec(`
      INSERT INTO quota_usage (date, count) VALUES (?, 1)
      ON CONFLICT(date) DO UPDATE SET count = count + 1
    `, today);
  }

  private getModelDisplay(): string {
    const model = this.env.MODEL || '@cf/meta/llama-3.1-8b-instruct';
    if (model.includes('glm')) return 'GLM-4.7';
    if (model.includes('llama-3.1')) return 'Llama-3.1';
    if (model.includes('llama-3.2')) return 'Llama-3.2';
    return model.split('/').pop() || 'AI';
  }

  private getQuotaDisplay(): string {
    const quota = this.getQuotaInfo();
    return `${quota.remaining}/${quota.total}`;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Stub Files Loading
  // ─────────────────────────────────────────────────────────────────────────────

  private async loadStubFiles(): Promise<void> {
    try {
      const existingFiles = this.state.storage.sql.exec(
        'SELECT COUNT(*) as count FROM files'
      ).toArray();

      const fileCount = (existingFiles[0] as Record<string, number>)?.count || 0;
      if (fileCount > 0) {
        debugLog('Files already exist (' + fileCount + '), skipping stub load');
        return;
      }

      debugLog('Loading stub files into virtual filesystem...');

      let loadedCount = 0;
      for (const file of stubFiles) {
        this.state.storage.sql.exec(
          'INSERT OR IGNORE INTO files (path, content, updated_at) VALUES (?, ?, ?)',
          file.path,
          file.content,
          Date.now()
        );
        loadedCount++;
      }

      debugLog('Stub files loaded:', loadedCount);
    } catch (error) {
      debugLog('ERROR loading stub files:', error);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Virtual Filesystem
  // ─────────────────────────────────────────────────────────────────────────────

  private normalizePath(path: string): string {
    // Remove leading slash and normalize path traversal
    let normalized = path.replace(/^\/+/, '');

    // Prevent path traversal attacks (..)
    const parts = normalized.split('/');
    const safeParts: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        // Attempted path traversal - ignore this part
        continue;
      }
      if (part && part !== '.') {
        safeParts.push(part);
      }
    }

    return safeParts.join('/');
  }

  private async readFile(path: string): Promise<string | undefined> {
    const normalizedPath = this.normalizePath(path);
    const rows = this.state.storage.sql.exec(
      'SELECT content FROM files WHERE path = ?',
      normalizedPath
    ).toArray();
    return rows.length > 0 ? (rows[0] as Record<string, string>).content : undefined;
  }

  private async writeFile(path: string, content: string): Promise<void> {
    const normalizedPath = this.normalizePath(path);

    // Don't allow empty paths or paths that would traverse outside
    if (!normalizedPath) {
      throw new Error('Invalid path');
    }

    this.state.storage.sql.exec(
      'INSERT OR REPLACE INTO files (path, content, updated_at) VALUES (?, ?, ?)',
      normalizedPath,
      content,
      Date.now()
    );
  }

  private async deleteFile(path: string): Promise<boolean> {
    const normalizedPath = this.normalizePath(path);
    const result = this.state.storage.sql.exec(
      'DELETE FROM files WHERE path = ?',
      normalizedPath
    );
    // Check if any rows were affected (this is a simplification)
    return true;
  }

  private async listFiles(dir: string = ''): Promise<{ name: string; type: 'file' | 'dir' }[]> {
    const normalizedDir = this.normalizePath(dir);
    const prefix = normalizedDir ? `${normalizedDir}/` : '';

    const rows = this.state.storage.sql.exec(
      'SELECT path FROM files WHERE path LIKE ? ORDER BY path',
      `${prefix}%`
    ).toArray();

    const entries = new Map<string, { name: string; type: 'file' | 'dir' }>();

    for (const row of rows) {
      const fullPath = (row as Record<string, string>).path;
      const relativePath = fullPath.slice(prefix.length);
      const slashIdx = relativePath.indexOf('/');

      if (slashIdx === -1) {
        // This is a direct file in the directory
        entries.set(relativePath, { name: relativePath, type: 'file' });
      } else {
        // This is in a subdirectory
        const dirName = relativePath.slice(0, slashIdx);
        if (!entries.has(dirName)) {
          entries.set(dirName, { name: dirName, type: 'dir' });
        }
      }
    }

    return Array.from(entries.values()).sort((a, b) => {
      // Directories first, then alphabetically
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  private async getAllFilePaths(): Promise<string[]> {
    const rows = this.state.storage.sql.exec(
      'SELECT path FROM files ORDER BY path'
    ).toArray();
    return rows.map((r: unknown) => (r as Record<string, string>).path);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Todo Management
  // ─────────────────────────────────────────────────────────────────────────────

  private async readTodos(): Promise<TodoItem[]> {
    const rows = this.state.storage.sql.exec(
      'SELECT content, status, priority FROM todos ORDER BY id'
    ).toArray();

    return rows.map((r: unknown, idx: number) => ({
      id: String(idx + 1),
      content: (r as Record<string, string>).content,
      status: (r as Record<string, TodoItem['status']>).status,
      priority: (r as Record<string, TodoItem['priority']>).priority,
    }));
  }

  private async writeTodos(todos: TodoItem[]): Promise<void> {
    this.state.storage.sql.exec('DELETE FROM todos');

    for (const todo of todos) {
      this.state.storage.sql.exec(
        'INSERT INTO todos (content, status, priority, updated_at) VALUES (?, ?, ?, ?)',
        todo.content,
        todo.status,
        todo.priority,
        Date.now()
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Session Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  private getSessionId(): string {
    return this.getMetadata('sessionId') || this.state.id.toString().slice(0, 8);
  }

  private broadcast(data: string): void {
    for (const ws of this.websockets) {
      try {
        ws.send(data);
      } catch {
        // Socket may be closing
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // HTTP Request Handler
  // ─────────────────────────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    const upgradeHeader = request.headers.get('Upgrade') || request.headers.get('upgrade');
    if (upgradeHeader?.toLowerCase() === 'websocket') {
      return this.handleWebSocket(request);
    }

    if (url.pathname === '/info' || url.pathname.endsWith('/info')) {
      const quota = this.getQuotaInfo();
      return Response.json({
        messageCount: this.messages.length,
        websocketCount: this.websockets.size,
        isThinking: this.isThinking,
        quota: {
          remaining: quota.remaining,
          total: quota.total,
          resetAt: quota.resetAt.toISOString(),
        },
      });
    }

    return new Response('Not found', { status: 404 });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Terminal UI
  // ─────────────────────────────────────────────────────────────────────────────

  private printBanner(): string {
    return [
      '\x1b[38;5;40m█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀\x1b[0m',
      '\x1b[38;5;40m█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █\x1b[0m',
      '',
    ].join('\r\n');
  }

  private printRuntimeHeader(): string {
    return '';
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // WebSocket Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private async handleWebSocket(request: Request): Promise<Response> {
    debugLog('handleWebSocket called');
    this.currentInput = '';

    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    this.state.acceptWebSocket(server);
    this.websockets.add(server);
    debugLog('WebSocket accepted, total websockets:', this.websockets.size);

    const url = new URL(request.url);
    const pathParts = url.pathname.split('/');
    const sessionIdFromPath = pathParts[pathParts.length - 1];
    if (sessionIdFromPath) {
      debugLog('Session ID from path:', sessionIdFromPath);
      this.setMetadata('sessionId', sessionIdFromPath);
    }

    // Check quota on connect
    const quota = this.getQuotaInfo();
    if (quota.isLimited) {
      server.send('\r\n\x1b[38;5;204mDaily quota exceeded. Reset at midnight UTC.\x1b[0m\r\n');
    }

    server.send('\r\n' + this.printBanner() + '\r\n');
    server.send(`\x1b[38;5;242mModel: Workers AI / ${this.getModelDisplay()} | Session: ${sessionIdFromPath}\x1b[0m\r\n`);
    server.send('\x1b[38;5;240mTools: read, write, edit, list, search, todo\x1b[0m\r\n');
    server.send('\x1b[38;5;242mType your message and press Enter.\x1b[0m\r\n');
    server.send('\x1b[38;5;240mThis is a live demo with a subset of features of ProtoAgent.\x1b[0m\r\n\r\n');
    this.renderPrompt(server);

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const data = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);

    if (data.length < 50) {
      debugLog('WebSocket message received:', JSON.stringify(data));
    }

    let msg: ClientMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      debugLog('Failed to parse WebSocket message');
      return;
    }

    if (msg.type === 'resize') {
      debugLog('Resize message received, cols:', msg.cols, 'rows:', msg.rows);
      return;
    }
    if (msg.type === 'input') {
      await this.handleInput(ws, msg.data);
    }
  }

  private async handleInput(ws: WebSocket, input: string): Promise<void> {
    if (input === '\r' || input === '\n') {
      await this.handleSubmit(ws);
    } else if (input === '\x7f' || input === '\b') {
      if (this.currentInput.length > 0) {
        this.currentInput = this.currentInput.slice(0, -1);
        this.broadcast('\b \b');
      }
    } else if (input === '\x03') {
      this.currentInput = '';
      this.broadcast('^C\r\n');
      this.renderPrompt();
    } else if (input.startsWith('\x1b[')) {
      // ANSI escape sequence - ignore
      return;
    } else if (input.length === 1 && input >= ' ') {
      this.currentInput += input;
      this.broadcast(input);
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    debugLog('WebSocket closed, remaining websockets:', this.websockets.size - 1);
    this.websockets.delete(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    debugLog('WebSocket error');
    this.websockets.delete(ws);
  }

  private renderPrompt(ws?: WebSocket): void {
    const prompt = '\x1b[38;5;117m>\x1b[0m ';
    if (ws) {
      ws.send(prompt);
    } else {
      this.broadcast(prompt);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Command Handling
  // ─────────────────────────────────────────────────────────────────────────────

  private async handleSubmit(ws: WebSocket): Promise<void> {
    const input = this.currentInput.trim();
    this.currentInput = '';
    this.broadcast('\r\n\r\n');

    debugLog('User submitted input:', input.slice(0, 100) + (input.length > 100 ? '...' : ''));

    if (!input) {
      this.renderPrompt();
      return;
    }

    if (input.startsWith('/')) {
      await this.handleCommand(input);
      return;
    }

    // Check quota before processing
    const quota = this.getQuotaInfo();
    if (quota.isLimited) {
      this.broadcast('\x1b[38;5;204mDaily quota exceeded. Reset at midnight UTC.\x1b[0m\r\n');
      this.renderPrompt();
      return;
    }

    this.messages.push({ role: 'user', content: input });
    this.saveMessage('user', input);
    this.incrementQuota();
    debugLog('Message saved, total messages:', this.messages.length);

    await this.runAgent();
  }

  private async handleCommand(input: string): Promise<void> {
    const parts = input.slice(1).split(' ');
    const cmd = parts[0];

    switch (cmd) {
      case 'help':
        this.broadcast('\x1b[38;5;242mCommands:\x1b[0m\r\n');
        this.broadcast('  /help    - Show this help\r\n');
        this.broadcast('  /clear   - Clear conversation history\r\n');
        this.broadcast('  /history - Show conversation history\r\n');
        this.broadcast('  /quota   - Show daily message quota\r\n');
        break;

      case 'clear':
        this.messages = [{ role: 'system', content: generateSystemPrompt() }];
        this.state.storage.sql.exec('DELETE FROM messages');
        this.broadcast('\x1b[38;5;242mConversation cleared.\x1b[0m\r\n');
        break;

      case 'history':
        this.broadcast(`\x1b[38;5;242m${this.messages.length} messages in history\x1b[0m\r\n`);
        break;

      case 'quota': {
        const quota = this.getQuotaInfo();
        this.broadcast(`\x1b[38;5;242mDaily Quota: ${quota.remaining}/${quota.total} messages remaining\x1b[0m\r\n`);
        this.broadcast(`\x1b[38;5;242mResets at: ${quota.resetAt.toUTCString()}\x1b[0m\r\n`);
        break;
      }

      default:
        this.broadcast(`\x1b[38;5;204mUnknown command: /${cmd}\x1b[0m\r\n`);
    }

    this.renderPrompt();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Agent Loop
  // ─────────────────────────────────────────────────────────────────────────────

  private async runAgent(): Promise<void> {
    if (this.isThinking) {
      debugLog('runAgent called but already thinking, skipping');
      return;
    }

    this.isThinking = true;
    debugLog('Starting agent run, broadcasting Thinking...');
    this.broadcast('\x1b[38;5;242mThinking...\x1b[0m');

    const fileStore = {
      read: this.readFile.bind(this),
      write: this.writeFile.bind(this),
      list: this.listFiles.bind(this),
      delete: this.deleteFile.bind(this),
      getAllPaths: this.getAllFilePaths.bind(this),
    };

    const todoStore = {
      read: this.readTodos.bind(this),
      write: this.writeTodos.bind(this),
    };

    const toolContext: ToolContext = {
      fileStore,
      todoStore,
    };

    try {
      debugLog('Creating AgenticLoop instance');
      const loop = new AgenticLoop({
        env: this.env,
        tools: getAllTools(),
        onStreamStart: () => {
          debugLog('onStreamStart called - clearing Thinking...');
          this.broadcast('\r\x1b[K');
        },
        onStream: (chunk) => {
          this.broadcast(chunk);
        },
        onToolCall: async (toolCall: ToolCall) => {
          debugLog('onToolCall called:', toolCall.function.name);
          let toolArgs: Record<string, unknown>;
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            const errorMsg = `Error: Invalid JSON in tool arguments for ${toolCall.function.name}`;
            this.broadcast(`\x1b[38;5;204m${errorMsg}\x1b[0m\r\n`);
            return errorMsg;
          }
          const argsPreview = Object.entries(toolArgs)
            .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 50)}`)
            .join(', ');
          this.broadcast(`\r\n\x1b[38;5;242m[Running ${toolCall.function.name}(${argsPreview})...]\x1b[0m\r\n`);

          const result = await handleToolCall(
            toolCall.function.name,
            toolArgs,
            toolContext
          );
          return result;
        },
      });

      let iteration = 0;
      const maxIterations = 10;
      let isFirstIteration = true;

      while (iteration < maxIterations) {
        iteration++;
        debugLog(`=== Tool loop iteration ${iteration} ===`);

        if (!isFirstIteration) {
          this.broadcast('\r\x1b[K\x1b[38;5;242mThinking...\x1b[0m');
        }

        const response = await loop.run(this.messages);
        debugLog('loop.run completed. Content length:', response.content?.length || 0, 'Tool calls:', response.toolCalls?.length || 0);

        this.messages.push({
          role: 'assistant',
          content: response.content || '',
          tool_calls: response.toolCalls,
        });

        if (!response.toolCalls || response.toolCalls.length === 0) {
          debugLog('No tool calls, conversation complete');
          this.saveMessage('assistant', response.content);
          break;
        }

        this.broadcast('\r\x1b[K');

        debugLog('Processing', response.toolCalls.length, 'tool calls');
        const toolResults: { role: 'tool'; tool_call_id: string; content: string }[] = [];

        for (let i = 0; i < response.toolCalls.length; i++) {
          const toolCall = response.toolCalls[i];
          debugLog('Executing tool:', toolCall.function.name);

          let toolArgs: Record<string, unknown>;
          try {
            toolArgs = JSON.parse(toolCall.function.arguments);
          } catch {
            const errorMsg = `Error: Invalid JSON in tool arguments for ${toolCall.function.name}`;
            this.broadcast(`\r\n\x1b[38;5;204m${errorMsg}\x1b[0m`);
            toolResults.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: errorMsg,
            });
            continue;
          }

          const argsPreview = Object.entries(toolArgs)
            .map(([k, v]) => `${k}=${JSON.stringify(v).slice(0, 50)}`)
            .join(', ');

          if (i === 0) {
            this.broadcast(`\x1b[38;5;242m[Running ${toolCall.function.name}(${argsPreview})...]\x1b[0m`);
          } else {
            this.broadcast(`\r\n\x1b[38;5;242m[Running ${toolCall.function.name}(${argsPreview})...]\x1b[0m`);
          }

          const result = await handleToolCall(
            toolCall.function.name,
            toolArgs,
            toolContext
          );

          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          });
        }

        this.broadcast('\r\n');
        this.messages.push(...toolResults);
        debugLog('Added', toolResults.length, 'tool results to messages');

        isFirstIteration = false;
      }

      if (iteration >= maxIterations) {
        debugLog('WARNING: Hit max iterations limit');
        this.broadcast('\r\n\x1b[38;5;214m[Reached maximum tool call iterations - generating response]\x1b[0m\r\n');
        
        // Add system message asking AI to respond based on gathered info
        this.messages.push({
          role: 'system',
          content: 'You have reached the maximum number of tool calls. Please provide a response to the user based on the information you have gathered so far. Do not make additional tool calls.',
        });
        
        // Run one more time to get the final response
        const finalResponse = await loop.run(this.messages);
        this.messages.push({
          role: 'assistant',
          content: finalResponse.content || '',
        });
        this.saveMessage('assistant', finalResponse.content);
      }

      this.broadcast('\r\n\r\n');
      debugLog('Agent run completed successfully after', iteration, 'iterations');
    } catch (error) {
      debugLog('ERROR in runAgent:', error);
      this.broadcast('\r\x1b[K');
      const message = error instanceof Error ? error.message : String(error);
      this.broadcast(`\x1b[38;5;204mError: ${message}\x1b[0m\r\n`);
    } finally {
      this.isThinking = false;
      this.renderPrompt();
    }
  }
}

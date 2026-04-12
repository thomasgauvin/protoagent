/**
 * ProtoAgent TUI Client — Communicates with the core server.
 */

export interface ClientConfig {
  serverUrl: string;
  apiKey?: string;
}

export type EventHandler = (event: any) => void;

export interface ImageAttachment {
  type: 'image';
  source: 'clipboard' | 'file';
  mimeType: string;
  base64Data: string;
  filename?: string;
}

export interface TextContent {
  type: 'text';
  text: string;
}

export type MessageContent = TextContent | ImageAttachment;

export class ProtoAgentClient {
  private config: ClientConfig;
  private eventSource: EventSource | null = null;
  private handlers: EventHandler[] = [];

  constructor(config: ClientConfig) {
    this.config = {
      ...config,
    };
  }

  connect(sessionId?: string): void {
    const url = sessionId
      ? `${this.config.serverUrl}/events?sessionId=${sessionId}`
      : `${this.config.serverUrl}/events`;

    this.eventSource = new EventSource(url);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handlers.forEach((h) => h(data));
      } catch (err) {
        console.error('Failed to parse event:', err);
      }
    };

    this.eventSource.onerror = (err) => {
      console.error('EventSource error:', err);
    };
  }

  disconnect(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  onEvent(handler: EventHandler): () => void {
    this.handlers.push(handler);
    return () => {
      this.handlers = this.handlers.filter((h) => h !== handler);
    };
  }

  async sendMessage(
    sessionId: string,
    content: string | MessageContent[],
    config: Record<string, unknown>
  ): Promise<void> {
    // Normalize content to array format
    const messageContent: MessageContent[] =
      typeof content === 'string' ? [{ type: 'text', text: content }] : content;

    const response = await fetch(`${this.config.serverUrl}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, content: messageContent, config }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.statusText}`);
    }
  }

  async abort(sessionId: string): Promise<void> {
    await fetch(`${this.config.serverUrl}/agent/abort/${sessionId}`, {
      method: 'POST',
    });
  }

  async createSession(data: Record<string, unknown>): Promise<{ id: string }> {
    const response = await fetch(`${this.config.serverUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`Failed to create session: ${response.statusText}`);
    }

    return response.json() as Promise<{ id: string }>;
  }

  async listSessions(): Promise<Array<{ id: string; title: string }>> {
    const response = await fetch(`${this.config.serverUrl}/sessions`);
    return response.json() as Promise<Array<{ id: string; title: string }>>;
  }
}

/**
 * Read image from clipboard using platform-specific tools.
 * Returns base64 encoded image data.
 */
export async function readImageFromClipboard(): Promise<ImageAttachment | null> {
  try {
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { existsSync } = await import('node:fs');
    const { readFile, mkdtemp, unlink } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');

    const execAsync = promisify(exec);

    // Create temp file for image
    const tempDir = await mkdtemp(join(tmpdir(), 'protoagent-'));
    const tempFile = join(tempDir, 'clipboard.png');

    let clipboardCommand: string | null = null;

    // Detect platform and choose appropriate clipboard command
    if (process.platform === 'darwin') {
      // macOS - try pngpaste first, then osascript
      if (existsSync('/opt/homebrew/bin/pngpaste') || existsSync('/usr/local/bin/pngpaste')) {
        clipboardCommand = `pngpaste "${tempFile}" 2>/dev/null`;
      } else {
        clipboardCommand = `osascript -e 'try' -e 'set theFile to (POSIX file "${tempFile}") as string' -e 'write (the clipboard as «class PNGf») to theFile' -e 'end try' 2>/dev/null`;
      }
    } else if (process.platform === 'linux') {
      // Linux - try wl-paste (Wayland) first, then xclip (X11)
      if (existsSync('/usr/bin/wl-paste') || existsSync('/bin/wl-paste')) {
        clipboardCommand = `wl-paste --type image/png > "${tempFile}" 2>/dev/null`;
      } else if (existsSync('/usr/bin/xclip') || existsSync('/bin/xclip')) {
        clipboardCommand = `xclip -selection clipboard -t image/png -o > "${tempFile}" 2>/dev/null`;
      }
    }

    if (!clipboardCommand) {
      console.error('Clipboard image reading not supported on this platform');
      return null;
    }

    // Execute clipboard command
    try {
      await execAsync(clipboardCommand);
    } catch {
      // Clipboard might not contain an image
      return null;
    }

    // Check if file was created and has content
    try {
      const imageBuffer = await readFile(tempFile);
      if (imageBuffer.length === 0) {
        return null;
      }

      // Clean up temp file
      await unlink(tempFile);

      // Return image attachment
      return {
        type: 'image',
        source: 'clipboard',
        mimeType: 'image/png',
        base64Data: imageBuffer.toString('base64'),
      };
    } catch {
      return null;
    }
  } catch (err) {
    console.error('Failed to read clipboard:', err);
    return null;
  }
}

/**
 * Read image from file path.
 */
export async function readImageFromFile(filePath: string): Promise<ImageAttachment | null> {
  try {
    const { readFile } = await import('node:fs/promises');
    const { extname } = await import('node:path');

    const imageBuffer = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();

    let mimeType = 'image/png';
    if (ext === '.jpg' || ext === '.jpeg') mimeType = 'image/jpeg';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.webp') mimeType = 'image/webp';

    return {
      type: 'image',
      source: 'file',
      mimeType,
      base64Data: imageBuffer.toString('base64'),
      filename: filePath,
    };
  } catch (err) {
    console.error('Failed to read image file:', err);
    return null;
  }
}

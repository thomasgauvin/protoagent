/**
 * Headless CLI exec — drives the ProtoAgent SDK without a TUI.
 *
 * This command exists to prove (and exercise) the decoupling of the core
 * runtime from the terminal UI. It sends a single message to a session,
 * streams events to stdout, and exits.
 *
 * Supported runtimes:
 *   core   — run a CoreRuntime in-process via InMemoryTransport (default)
 *   api    — talk to a running protoagent-api over HttpTransport
 */

import type { ApiEvent } from './sdk/index.js';
import {
  createHttpClient,
  createInMemoryClient,
  type ProtoAgentClient,
} from './sdk/index.js';

export interface ExecOptions {
  runtime: 'core' | 'api';
  baseUrl?: string;
  sessionId?: string;
  message: string;
  json?: boolean;
  dangerouslySkipPermissions?: boolean;
}

export interface ExecIO {
  write: (line: string) => void;
  writeError: (line: string) => void;
}

const DEFAULT_IO: ExecIO = {
  write: (line) => process.stdout.write(`${line}\n`),
  writeError: (line) => process.stderr.write(`${line}\n`),
};

function formatEventLine(event: ApiEvent, json: boolean): string | null {
  if (json) return JSON.stringify(event);

  switch (event.type) {
    case 'text_delta': {
      const delta = (event.data as { content?: string } | undefined)?.content ?? '';
      return delta;
    }
    case 'tool_call': {
      const tc = (event.data as { toolCall?: { name?: string; args?: string } } | undefined)
        ?.toolCall;
      if (!tc) return null;
      return `[tool_call] ${tc.name ?? 'unknown'} ${tc.args ?? ''}`;
    }
    case 'tool_result': {
      const tc = (event.data as { toolCall?: { name?: string; status?: string } } | undefined)
        ?.toolCall;
      if (!tc) return null;
      return `[tool_result] ${tc.name ?? 'unknown'} (${tc.status ?? 'done'})`;
    }
    case 'usage':
    case 'snapshot':
    case 'session_activated':
    case 'session_updated':
    case 'workflow_updated':
      return null;
    case 'error': {
      const msg = (event.data as { error?: string } | undefined)?.error ?? 'Unknown error';
      return `[error] ${msg}`;
    }
    case 'done':
      return '[done]';
    default:
      return null;
  }
}

export async function runExec(options: ExecOptions, io: ExecIO = DEFAULT_IO): Promise<number> {
  if (!options.message.trim()) {
    io.writeError('protoagent exec requires a non-empty --message.');
    return 2;
  }

  let client: ProtoAgentClient;
  if (options.runtime === 'api') {
    const baseUrl = options.baseUrl ?? 'http://127.0.0.1:3000';
    client = createHttpClient({ baseUrl });
  } else {
    client = createInMemoryClient({
      runtimeOptions: {
        dangerouslySkipPermissions: options.dangerouslySkipPermissions,
      },
    });
  }

  try {
    const session = options.sessionId
      ? await client.getSession(options.sessionId)
      : await client.createSession();

    let exitCode = 0;
    const completion = new Promise<void>((resolve) => {
      const subscription = client.subscribeToSession(session.id, {
        onEvent: (event) => {
          const line = formatEventLine(event, Boolean(options.json));
          if (line !== null && line !== '') io.write(line);
          if (event.type === 'done') {
            subscription.close();
            resolve();
          }
          if (event.type === 'error') {
            exitCode = 1;
          }
        },
        onError: (error) => {
          io.writeError(`[stream error] ${error.message}`);
          exitCode = 1;
          resolve();
        },
      });
    });

    const send = await client.sendMessage(session.id, options.message);
    if (send.status !== 'started') {
      io.write(`[status] ${send.status}`);
    }

    await completion;
    return exitCode;
  } catch (error) {
    io.writeError(`protoagent exec failed: ${(error as Error).message}`);
    return 1;
  } finally {
    await client.close();
  }
}

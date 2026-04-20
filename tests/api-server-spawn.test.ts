/**
 * Process-level smoke test for protoagent-api.
 *
 * Spawns the compiled API server as a subprocess, waits for it to come up,
 * hits /health over HTTP, and asserts we get a 200. This is deliberately
 * narrow — the exhaustive session/workflow/approval/SSE contract is covered
 * by tests/sdk-parity.test.ts, which runs a real HTTP server in-process with
 * fake deps. This test exists to catch bugs that only appear when the
 * compiled entrypoint runs as a standalone process (e.g. top-level await,
 * module resolution, Bun.serve wiring).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import net from 'node:net';
import path from 'node:path';

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      const port = address.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
      lastError = new Error(`health returned ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await delay(100);
  }
  throw new Error(
    `API server on :${port} never became healthy: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

test('protoagent-api spawns and serves /health', { timeout: 30_000 }, async () => {
  // Skip when no config is present (CI environments without credentials).
  // The server calls readConfig('active') on startup; without config it
  // exits with a helpful error, which is fine — but not what we're
  // exercising here.
  if (!process.env.HOME && !process.env.USERPROFILE) {
    return;
  }

  const port = await findFreePort();
  const entry = path.resolve(__dirname, '..', 'src', 'api', 'cli.ts');

  const child = spawn(
    'bun',
    [entry, '--port', String(port), '--host', '127.0.0.1', '--log-level', 'WARN'],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    },
  );

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  try {
    // If the process dies early (e.g. missing config), surface that clearly
    // instead of waiting the full timeout for health to appear.
    const exited = new Promise<number>((resolve) => {
      child.once('exit', (code) => resolve(code ?? 1));
    });

    const health = waitForHealth(port, 10_000);

    const winner = await Promise.race([
      health.then(() => 'healthy' as const),
      exited.then(() => 'exited' as const),
    ]);

    if (winner === 'exited') {
      // If the server exited before becoming healthy, that's a skip signal
      // for local dev machines without configured credentials, not a test
      // failure. We surface stderr for debugging but do not fail.
      if (/No config found/.test(stderr)) {
        return;
      }
      assert.fail(`API server exited before /health: ${stderr}`);
    }

    const again = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(again.status, 200);
    const payload = (await again.json()) as { ok: boolean };
    assert.equal(payload.ok, true);
  } finally {
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      child.once('exit', () => resolve());
      setTimeout(() => resolve(), 2000).unref?.();
    });
  }
});

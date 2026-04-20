#!/usr/bin/env bun

import { Command } from 'commander';
import { createApiServer } from './server.js';
import { LogLevel, initLogFile, logger, setLogLevel } from '../utils/logger.js';

function parseLogLevel(value: string): LogLevel {
  const normalized = value.trim().toUpperCase();
  switch (normalized) {
    case 'ERROR':
      return LogLevel.ERROR;
    case 'WARN':
      return LogLevel.WARN;
    case 'INFO':
      return LogLevel.INFO;
    case 'DEBUG':
      return LogLevel.DEBUG;
    case 'TRACE':
      return LogLevel.TRACE;
    default:
      throw new Error(`Invalid log level: ${value}`);
  }
}

const program = new Command();

program
  .description('ProtoAgent REST API server')
  .option('--host <host>', 'Host to bind', '127.0.0.1')
  .option('--port <port>', 'Port to bind', '3000')
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: TRACE, DEBUG, INFO, WARN, ERROR', 'INFO')
  .action(async (options) => {
    setLogLevel(parseLogLevel(options.logLevel));
    const logFile = initLogFile();
    const port = Number.parseInt(options.port, 10);

    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`Invalid port: ${options.port}`);
    }

    const { app, runtime } = await createApiServer({
      dangerouslySkipPermissions: Boolean(options.dangerouslySkipPermissions),
    });

    const bunRuntime = (globalThis as typeof globalThis & {
      Bun?: {
        serve(options: {
          hostname: string;
          port: number;
          fetch(request: Request): Response | Promise<Response>;
        }): { stop(close?: boolean): void };
      };
    }).Bun;

    if (!bunRuntime) {
      throw new Error('ProtoAgent API server must be run with Bun.');
    }

    const server = bunRuntime.serve({
      hostname: options.host,
      port,
      fetch: app.fetch,
    });

    logger.info('ProtoAgent API server started', {
      host: options.host,
      port,
      logFile,
    });

    process.stdout.write(`ProtoAgent API listening on http://${options.host}:${port}\n`);

    const shutdown = async () => {
      server.stop(true);
      await runtime.close();
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  });

await program.parseAsync(process.argv);

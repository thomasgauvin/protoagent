#!/usr/bin/env node
/**
 * CLI entry point for ProtoAgent.
 *
 * Parses command-line flags and launches either the main chat UI
 * or the configuration wizard.
 */

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent } from './config.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-accept-all', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: TRACE, DEBUG, INFO, WARN, ERROR', 'INFO')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    // Default action - start the main app
    render(
      <App
        dangerouslyAcceptAll={options.dangerouslyAcceptAll || false}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });

// Configure subcommand
program
  .command('configure')
  .description('Configure AI model and API key settings')
  .action(() => {
    render(<ConfigureComponent />);
  });

program.parse(process.argv);

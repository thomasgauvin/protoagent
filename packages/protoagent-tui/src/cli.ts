#!/usr/bin/env node
/**
 * ProtoAgent TUI — CLI entry point.
 */
import { Command } from 'commander';
import { runTui } from './app.js';

const program = new Command();

program
  .name('protoagent')
  .description('ProtoAgent — AI coding assistant')
  .version('0.2.0');

program
  .option('-p, --provider <provider>', 'LLM provider', 'openai')
  .option('-m, --model <model>', 'Model name', 'gpt-4o')
  .option('-k, --api-key <key>', 'API key (or set OPENAI_API_KEY)')
  .option('-s, --server <url>', 'Server URL', 'http://localhost:3001')
  .option('--session <id>', 'Resume existing session')
  .action(async (options) => {
    const apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error('Error: API key required. Use -k or set OPENAI_API_KEY');
      process.exit(1);
    }

    try {
      await runTui({
        provider: options.provider,
        model: options.model,
        apiKey,
        serverUrl: options.server,
      });
    } catch (err: any) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse();

#!/usr/bin/env bun
/**
 * ProtoAgent — OpenTUI/Bun entry point.
 *
 * Creates the renderer and wires up the application.
 */

import { createCliRenderer } from '@opentui/core'
import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig, writeConfig, writeInitConfig } from './config-core.js'
import { runExec } from './exec.js'
import { acquireAgentLock, setAgentName, getAgentName } from './multi-tab-sessions.js'
import { createMultiTabApp } from './tui/createMultiTabApp.js'
import { startDebugServer } from './tui/debug-server.js'
import { setupTerminalCleanup } from './tui/terminal-cleanup.js'
import { spawnWatchdog } from './tui/tty-watchdog.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packageJson: { version: string } = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
)

const program = new Command()

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: TRACE, DEBUG, INFO, WARN, ERROR', 'DEBUG')
  .option('--session <id>', 'Resume a previous session by ID')
  .option('--name <name>', 'Agent instance name for isolated session groups', 'default')
  .action(async (options) => {
    // Check for existing instance BEFORE creating renderer
    // This ensures error messages are visible (renderer would mess with terminal)
    const agentName = options.name || 'default'
    setAgentName(agentName)
    const lockResult = await acquireAgentLock()
    if (!lockResult.locked) {
      console.error(`\nError: ${lockResult.error}`)
      console.error(`\nTo run multiple ProtoAgent instances, use different agent names:`)
      console.error(`  protoagent --name ${agentName}-2\n`)
      process.exit(1)
    }

    // Setup terminal cleanup to disable mouse tracking on exit/crash
    // This prevents mouse escape sequences from leaking to other terminals
    setupTerminalCleanup()

    // Spawn a watchdog subprocess that will reset the terminal if we crash (SIGKILL)
    // This ensures cleanup even when the main process cannot handle signals
    spawnWatchdog()

    const renderer = await createCliRenderer({
      exitOnCtrlC: false, // we handle Ctrl+C ourselves for clean session save
      enableMouseMovement: true, // needed for drag-to-select
      targetFps: 30,
    })

    await createMultiTabApp(renderer, {
      dangerouslySkipPermissions: options.dangerouslySkipPermissions || false,
      logLevel: options.logLevel,
      sessionId: options.session,
      agentName: options.name,
    })

    if (process.env.PROTOAGENT_DEBUG === '1') {
      await startDebugServer(renderer)
    }

    renderer.start()
  })

program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.')
        process.exitCode = 1
        return
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.')
        process.exitCode = 1
        return
      }
      const target = options.project ? 'project' : 'user'
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim()
            ? { apiKey: options.apiKey.trim() }
            : {}),
        },
        target,
      )
      console.log('Configured ProtoAgent:')
      console.log(resultPath)
      const selected = readConfig(target)
      if (selected) console.log(`${selected.provider} / ${selected.model}`)
      return
    }
    console.log('Interactive configure not yet supported in OpenTUI mode. Use --provider and --model flags.')
  })

program
  .command('init')
  .description('Create a project-local or shared ProtoAgent runtime config')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--force', 'Overwrite an existing target file')
  .action((options) => {
    if (options.project || options.user) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.')
        process.exitCode = 1
        return
      }
      const result = writeInitConfig(options.project ? 'project' : 'user', process.cwd(), {
        overwrite: Boolean(options.force),
      })
      const message =
        result.status === 'created'
          ? 'Created ProtoAgent config:'
          : result.status === 'overwritten'
            ? 'Overwrote ProtoAgent config:'
            : 'ProtoAgent config already exists:'
      console.log(message)
      console.log(result.path)
      return
    }
    console.log('Interactive init not yet supported in OpenTUI mode. Use --project or --user flags.')
  })

program
  .command('exec')
  .description('Run a single message headlessly via the SDK (no TUI). Proves SDK↔runtime decoupling.')
  .requiredOption('--message <text>', 'Message to send to the agent')
  .option('--runtime <mode>', 'SDK transport: core (in-process) or api (remote HTTP)', 'core')
  .option('--base-url <url>', 'Base URL for --runtime=api', 'http://127.0.0.1:3000')
  .option('--session <id>', 'Resume an existing session by ID')
  .option('--json', 'Emit raw SDK events as JSON lines instead of formatted text')
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands (core runtime only)')
  .action(async (options) => {
    const runtime = options.runtime === 'api' ? 'api' : 'core'
    const code = await runExec({
      runtime,
      baseUrl: options.baseUrl,
      sessionId: options.session,
      message: options.message,
      json: Boolean(options.json),
      dangerouslySkipPermissions: Boolean(options.dangerouslySkipPermissions),
    })
    process.exit(code)
  })

program.parse(process.argv)

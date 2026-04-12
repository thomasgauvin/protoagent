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
import { createMultiTabApp } from './tui/createMultiTabApp.js'

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
  .action(async (options) => {
    const renderer = await createCliRenderer({
      exitOnCtrlC: false, // we handle Ctrl+C ourselves for clean session save
      enableMouseMovement: true, // needed for drag-to-select
      targetFps: 30,
    })

    await createMultiTabApp(renderer, {
      dangerouslySkipPermissions: options.dangerouslySkipPermissions || false,
      logLevel: options.logLevel,
      sessionId: options.session,
    })

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

program.parse(process.argv)

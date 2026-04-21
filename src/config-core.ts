/**
 * config-core.ts — config helpers for the OpenTUI application.
 *
 * Contains configuration parsing, persistence, and path resolution.
 * Safe to import from the CLI entry point.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parse } from 'jsonc-parser'
import {
  getActiveRuntimeConfigPath,
  type RuntimeConfigFile,
  type RuntimeProviderConfig,
  RuntimeConfigFileSchema,
} from './runtime-config.js'
import { getProvider } from './providers.js'

export interface Config {
  provider: string
  model: string
  apiKey?: string
}

export type InitConfigTarget = 'project' | 'user'
export type InitConfigWriteStatus = 'created' | 'exists' | 'overwritten'

const CONFIG_DIR_MODE = 0o700
const CONFIG_FILE_MODE = 0o600
const AUTH_HEADER_NAME = /^(authorization|proxy-authorization|cookie|x-api-key|api-key|api_key|apikey|cf-access-token|cf-access-jwt-assertion)$/i

function parseHeaderLines(rawHeaders?: string): Record<string, string> {
  if (!rawHeaders?.trim()) return {}
  const parsed: Record<string, string> = {}
  for (const line of rawHeaders.split('\n')) {
    const separator = line.indexOf(': ')
    if (separator === -1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 2).trim()
    if (key && value) parsed[key] = value
  }
  return parsed
}

function hasCredentialHeaders(headers?: Record<string, string>): boolean {
  return Object.entries(headers || {}).some(
    ([key, value]) => AUTH_HEADER_NAME.test(key.trim()) && value.trim().length > 0,
  )
}

function getHomeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir()
}

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return
  chmodSync(targetPath, mode)
}

export function resolveApiKey(config: Pick<Config, 'provider' | 'apiKey'>): string | null {
  const provider = getProvider(config.provider)
  if (provider?.apiKeyEnvVar) {
    const v = process.env[provider.apiKeyEnvVar]?.trim()
    if (v) return v
  }
  const env = process.env.PROTOAGENT_API_KEY?.trim()
  if (env) return env
  const direct = config.apiKey?.trim()
  if (direct) return direct
  const providerKey = provider?.apiKey?.trim()
  if (providerKey) return providerKey
  if (hasCredentialHeaders(parseHeaderLines(process.env.PROTOAGENT_CUSTOM_HEADERS))) return 'none'
  if (hasCredentialHeaders(provider?.headers)) return 'none'
  return null
}

export const getConfigDirectory = () => {
  const homeDir = getHomeDir()
  if (process.platform === 'win32') return path.join(homeDir, 'AppData', 'Local', 'protoagent')
  return path.join(homeDir, '.local', 'share', 'protoagent')
}

export const getUserRuntimeConfigDirectory = () => {
  const homeDir = getHomeDir()
  if (process.platform === 'win32') return path.join(homeDir, 'AppData', 'Local', 'protoagent')
  return path.join(homeDir, '.config', 'protoagent')
}

export const getUserRuntimeConfigPath = () =>
  path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc')

export const getProjectRuntimeConfigDirectory = (cwd = process.cwd()) =>
  path.join(cwd, '.protoagent')

export const getProjectRuntimeConfigPath = (cwd = process.cwd()) =>
  path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc')

export const getRuntimeConfigPath = (target: InitConfigTarget, cwd = process.cwd()) =>
  target === 'project' ? getProjectRuntimeConfigPath(cwd) : getUserRuntimeConfigPath()

export const RUNTIME_CONFIG_TEMPLATE = `{
  // Add project or user-wide ProtoAgent runtime config here.
  "providers": {
    // "provider-id": {
    //   "name": "Display Name",
    //   "baseURL": "https://api.example.com/v1",
    //   "apiKey": "your-api-key",
    //   "apiKeyEnvVar": "ENV_VAR_NAME",
    //   "models": { "model-id": {} }
    // }
  },
  "mcp": { "servers": {} }
}
`

function ensureDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true, mode: CONFIG_DIR_MODE })
  hardenPermissions(targetDir, CONFIG_DIR_MODE)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readRuntimeConfigFileSync(configPath: string): RuntimeConfigFile | null {
  if (!existsSync(configPath)) return null
  try {
    const content = readFileSync(configPath, 'utf8')
    const errors: Array<{ error: number; offset: number; length: number }> = []
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false })
    if (errors.length > 0 || !isPlainObject(parsed)) return null
    const result = RuntimeConfigFileSchema.safeParse(parsed)
    if (!result.success) {
      console.error('Invalid runtime config:', result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', '))
      return null
    }
    return result.data as RuntimeConfigFile
  } catch (error) {
    console.error('Error reading runtime config file:', error)
    return null
  }
}

function getConfiguredProviderAndModel(runtimeConfig: RuntimeConfigFile): Config | null {
  for (const [providerId, providerConfig] of Object.entries(runtimeConfig.providers || {})) {
    const modelId = Object.keys(providerConfig.models || {})[0]
    if (!modelId) continue
    const apiKey =
      typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.trim().length > 0
        ? providerConfig.apiKey.trim()
        : undefined
    return { provider: providerId, model: modelId, ...(apiKey ? { apiKey } : {}) }
  }
  return null
}

function writeRuntimeConfigFile(configPath: string, runtimeConfig: RuntimeConfigFile): void {
  ensureDirectory(path.dirname(configPath))
  writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, {
    encoding: 'utf8',
    mode: CONFIG_FILE_MODE,
  })
  hardenPermissions(configPath, CONFIG_FILE_MODE)
}

function upsertSelectedConfig(
  existingRuntimeConfig: RuntimeConfigFile,
  newConfig: Config,
): RuntimeConfigFile {
  const existingProviders = existingRuntimeConfig.providers || {}
  const currentProvider = existingProviders[newConfig.provider] || {}
  const currentModels = (currentProvider as any).models || {}
  const selectedModelConfig = currentModels[newConfig.model] || {}

  const nextProvider: RuntimeProviderConfig = {
    ...currentProvider,
    ...(newConfig.apiKey?.trim() ? { apiKey: newConfig.apiKey.trim() } : {}),
    models: Object.fromEntries([
      [newConfig.model, selectedModelConfig],
      ...Object.entries(currentModels).filter(([modelId]) => modelId !== newConfig.model),
    ]),
  }
  if (!newConfig.apiKey?.trim()) delete (nextProvider as any).apiKey

  return {
    ...existingRuntimeConfig,
    providers: Object.fromEntries([
      [newConfig.provider, nextProvider],
      ...Object.entries(existingProviders).filter(([pid]) => pid !== newConfig.provider),
    ]),
  }
}

export function writeInitConfig(
  target: InitConfigTarget,
  cwd = process.cwd(),
  options: { overwrite?: boolean } = {},
): { path: string; status: InitConfigWriteStatus } {
  const configPath = getRuntimeConfigPath(target, cwd)
  const alreadyExists = existsSync(configPath)
  if (alreadyExists && !options.overwrite) return { path: configPath, status: 'exists' }
  if (!alreadyExists) ensureDirectory(path.dirname(configPath))
  writeFileSync(configPath, RUNTIME_CONFIG_TEMPLATE, { encoding: 'utf8', mode: CONFIG_FILE_MODE })
  hardenPermissions(configPath, CONFIG_FILE_MODE)
  return { path: configPath, status: alreadyExists ? 'overwritten' : 'created' }
}

export const readConfig = (target: InitConfigTarget | 'active' = 'active', cwd = process.cwd()): Config | null => {
  const configPath = target === 'active' ? getActiveRuntimeConfigPath() : getRuntimeConfigPath(target, cwd)
  if (!configPath) return null
  const runtimeConfig = readRuntimeConfigFileSync(configPath)
  if (!runtimeConfig) return null
  return getConfiguredProviderAndModel(runtimeConfig)
}

export const writeConfig = (config: Config, target: InitConfigTarget = 'user', cwd = process.cwd()) => {
  const configPath = getRuntimeConfigPath(target, cwd)
  const runtimeConfig = readRuntimeConfigFileSync(configPath) || { providers: {}, mcp: { servers: {} } }
  const nextRuntimeConfig = upsertSelectedConfig(runtimeConfig, config)
  writeRuntimeConfigFile(configPath, nextRuntimeConfig)
  return configPath
}

// src/runtime-config.ts

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';

export interface RuntimeModelConfig {
  name?: string;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  defaultParams?: Record<string, unknown>;
}

const RESERVED_DEFAULT_PARAM_KEYS = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
]);

export interface RuntimeProviderConfig {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models?: Record<string, RuntimeModelConfig>;
}

interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

interface HttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

export type RuntimeMcpServerConfig = StdioServerConfig | HttpServerConfig;

export interface RuntimeConfigFile {
  providers?: Record<string, RuntimeProviderConfig>;
  mcp?: {
    servers?: Record<string, RuntimeMcpServerConfig>;
  };
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigFile = {
  providers: {},
  mcp: { servers: {} },
};

let runtimeConfigCache: RuntimeConfigFile | null = null;

// Returns the path to the project-level runtime config file.
function getProjectRuntimeConfigPath(): string {
  return path.join(process.cwd(), '.protoagent', 'protoagent.jsonc');
}

// Returns the path to the user-level runtime config file based on the OS.
function getUserRuntimeConfigPath(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc');
}

// Returns the active config path: project if it exists, otherwise user.
export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) return projectPath;
  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) return userPath;
  return null;
}

// Checks if a value is a plain object (not an array or null).
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Replaces environment variable placeholders in a string with their values.
function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      return '';
    }
    return resolved;
  });
}

// Recursively interpolates environment variables in any value type.
function interpolateValue<T>(value: T, sourcePath: string): T {
  if (typeof value === 'string') return interpolateString(value, sourcePath) as T;
  if (Array.isArray(value)) return value.map((entry) => interpolateValue(entry, sourcePath)) as T;
  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const interpolated = interpolateValue(entry, sourcePath);
      if (key === 'headers' && isPlainObject(interpolated)) {
        // Drop headers whose values were empty after interpolation
        next[key] = Object.fromEntries(
          Object.entries(interpolated).filter(([, v]) => typeof v !== 'string' || v.length > 0)
        );
        continue;
      }
      next[key] = interpolated;
    }
    return next as T;
  }
  return value;
}

// Removes reserved parameter keys from provider and model defaultParams.
function sanitizeDefaultParamsInConfig(config: RuntimeConfigFile): RuntimeConfigFile {
  const nextProviders = Object.fromEntries(
    Object.entries(config.providers || {}).map(([providerId, provider]) => {
      const providerDefaultParams = Object.fromEntries(
        Object.entries(provider.defaultParams || {}).filter(([key]) => {
          const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
          return allowed;
        })
      );

      const nextModels = Object.fromEntries(
        Object.entries(provider.models || {}).map(([modelId, model]) => {
          const modelDefaultParams = Object.fromEntries(
            Object.entries(model.defaultParams || {}).filter(([key]) => {
              const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
              return allowed;
            })
          );
          return [modelId, { ...model, ...(Object.keys(modelDefaultParams).length > 0 ? { defaultParams: modelDefaultParams } : {}) }];
        })
      );

      return [providerId, { ...provider, ...(Object.keys(providerDefaultParams).length > 0 ? { defaultParams: providerDefaultParams } : {}), models: nextModels }];
    })
  );

  return { ...config, providers: nextProviders };
}

// Merges two runtime configs, with overlay taking precedence.
function mergeRuntimeConfig(base: RuntimeConfigFile, overlay: RuntimeConfigFile): RuntimeConfigFile {
  const mergedProviders: Record<string, RuntimeProviderConfig> = { ...(base.providers || {}) };
  for (const [providerId, providerConfig] of Object.entries(overlay.providers || {})) {
    const current = mergedProviders[providerId] || {};
    mergedProviders[providerId] = { ...current, ...providerConfig, models: { ...(current.models || {}), ...(providerConfig.models || {}) } };
  }
  const mergedServers: Record<string, RuntimeMcpServerConfig> = { ...(base.mcp?.servers || {}) };
  for (const [name, serverConfig] of Object.entries(overlay.mcp?.servers || {})) {
    const current = mergedServers[name];
    mergedServers[name] = current && isPlainObject(current) ? { ...current, ...serverConfig } : serverConfig;
  }
  return { providers: mergedProviders, mcp: { servers: mergedServers } };
}

// Reads and parses a runtime config file with interpolation and validation.
async function readRuntimeConfigFile(configPath: string): Promise<RuntimeConfigFile | null> {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      const details = errors.map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`).join(', ');
      throw new Error(`Failed to parse ${configPath}: ${details}`);
    }
    if (!isPlainObject(parsed)) throw new Error(`Failed to parse ${configPath}: top-level value must be an object`);
    return sanitizeDefaultParamsInConfig(interpolateValue(parsed as RuntimeConfigFile, configPath));
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

// Loads the runtime config from file or cache, merging with defaults.
export async function loadRuntimeConfig(forceReload = false): Promise<RuntimeConfigFile> {
  if (!forceReload && runtimeConfigCache) return runtimeConfigCache;

  const configPath = getActiveRuntimeConfigPath();
  let loaded = DEFAULT_RUNTIME_CONFIG;

  if (configPath) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (fileConfig) {
      loaded = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, fileConfig);
    }
  }

  runtimeConfigCache = loaded;
  return loaded;
}

// Returns the cached runtime config or the default config.
export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

// Clears the runtime config cache for testing purposes.
export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}
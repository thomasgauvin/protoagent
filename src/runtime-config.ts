import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';
import { logger } from './utils/logger.js';

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

function getRuntimeConfigPaths(): string[] {
  const homeDir = os.homedir();
  return [
    path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc'),
    path.join(homeDir, '.protoagent', 'protoagent.jsonc'),
    path.join(process.cwd(), '.protoagent', 'protoagent.jsonc'),
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      logger.warn(`Missing environment variable ${envVar} while loading ${sourcePath}`);
      return '';
    }
    return resolved;
  });
}

function interpolateValue<T>(value: T, sourcePath: string): T {
  if (typeof value === 'string') {
    return interpolateString(value, sourcePath) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => interpolateValue(entry, sourcePath)) as T;
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const interpolated = interpolateValue(entry, sourcePath);
      if (key === 'headers' && isPlainObject(interpolated)) {
        const filtered = Object.fromEntries(
          Object.entries(interpolated).filter(([, headerValue]) => typeof headerValue !== 'string' || headerValue.length > 0)
        );
        next[key] = filtered;
        continue;
      }
      next[key] = interpolated;
    }
    return next as T;
  }

  return value;
}

function sanitizeDefaultParamsInConfig(config: RuntimeConfigFile): RuntimeConfigFile {
  const nextProviders = Object.fromEntries(
    Object.entries(config.providers || {}).map(([providerId, provider]) => {
      const providerDefaultParams = Object.fromEntries(
        Object.entries(provider.defaultParams || {}).filter(([key]) => {
          const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
          if (!allowed) {
            logger.warn(`Ignoring reserved provider default param '${key}' for provider ${providerId}`);
          }
          return allowed;
        })
      );

      const nextModels = Object.fromEntries(
        Object.entries(provider.models || {}).map(([modelId, model]) => {
          const modelDefaultParams = Object.fromEntries(
            Object.entries(model.defaultParams || {}).filter(([key]) => {
              const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
              if (!allowed) {
                logger.warn(`Ignoring reserved model default param '${key}' for model ${providerId}/${modelId}`);
              }
              return allowed;
            })
          );

          return [
            modelId,
            {
              ...model,
              ...(Object.keys(modelDefaultParams).length > 0 ? { defaultParams: modelDefaultParams } : {}),
            },
          ];
        })
      );

      return [
        providerId,
        {
          ...provider,
          ...(Object.keys(providerDefaultParams).length > 0 ? { defaultParams: providerDefaultParams } : {}),
          models: nextModels,
        },
      ];
    })
  );

  return {
    ...config,
    providers: nextProviders,
  };
}

function mergeRuntimeConfig(base: RuntimeConfigFile, overlay: RuntimeConfigFile): RuntimeConfigFile {
  const mergedProviders: Record<string, RuntimeProviderConfig> = {
    ...(base.providers || {}),
  };

  for (const [providerId, providerConfig] of Object.entries(overlay.providers || {})) {
    const currentProvider = mergedProviders[providerId] || {};
    mergedProviders[providerId] = {
      ...currentProvider,
      ...providerConfig,
      models: {
        ...(currentProvider.models || {}),
        ...(providerConfig.models || {}),
      },
    };
  }

  const mergedServers: Record<string, RuntimeMcpServerConfig> = {
    ...(base.mcp?.servers || {}),
  };

  for (const [serverName, serverConfig] of Object.entries(overlay.mcp?.servers || {})) {
    const currentServer = mergedServers[serverName];
    mergedServers[serverName] = currentServer && isPlainObject(currentServer)
      ? { ...currentServer, ...serverConfig }
      : serverConfig;
  }

  return {
    providers: mergedProviders,
    mcp: {
      servers: mergedServers,
    },
  };
}

async function readRuntimeConfigFile(configPath: string): Promise<RuntimeConfigFile | null> {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      const details = errors
        .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
        .join(', ');
      throw new Error(`Failed to parse ${configPath}: ${details}`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error(`Failed to parse ${configPath}: top-level value must be an object`);
    }
    return sanitizeDefaultParamsInConfig(interpolateValue(parsed as RuntimeConfigFile, configPath));
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function loadRuntimeConfig(forceReload = false): Promise<RuntimeConfigFile> {
  if (!forceReload && runtimeConfigCache) {
    return runtimeConfigCache;
  }

  let merged = DEFAULT_RUNTIME_CONFIG;

  for (const configPath of getRuntimeConfigPaths()) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (!fileConfig) continue;
    logger.debug(`Loaded runtime config`, { path: configPath });
    merged = mergeRuntimeConfig(merged, fileConfig);
  }

  runtimeConfigCache = merged;
  return merged;
}

export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}

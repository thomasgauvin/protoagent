import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';
import { z } from 'zod';
import { logger } from './utils/logger.js';

// ─── Zod Schemas for Runtime Validation ───

export const RuntimeModelConfigSchema = z.object({
  name: z.string().optional(),
  contextWindow: z.number().optional(),
  inputPricePerMillion: z.number().optional(),
  outputPricePerMillion: z.number().optional(),
  cachedPricePerMillion: z.number().optional(),
  defaultParams: z.record(z.unknown()).optional(),
});

export const RuntimeProviderConfigSchema = z.object({
  name: z.string().optional(),
  baseURL: z.string().optional(),
  apiKey: z.string().optional(),
  apiKeyEnvVar: z.string().optional(),
  headers: z.record(z.string()).optional(),
  defaultParams: z.record(z.unknown()).optional(),
  models: z.record(RuntimeModelConfigSchema).optional(),
});

export const StdioServerConfigSchema = z.object({
  type: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  cwd: z.string().optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().optional(),
});

export const HttpServerConfigSchema = z.object({
  type: z.literal('http'),
  url: z.string(),
  headers: z.record(z.string()).optional(),
  enabled: z.boolean().optional(),
  timeoutMs: z.number().optional(),
});

export const RuntimeMcpServerConfigSchema = z.union([StdioServerConfigSchema, HttpServerConfigSchema]);

export const RuntimeConfigFileSchema = z.object({
  providers: z.record(z.any()).optional(),
  mcp: z.object({
    servers: z.record(z.any()).optional(),
  }).optional(),
});

// ─── TypeScript Interfaces (kept for backward compatibility) ───

export interface RuntimeModelConfig {
  name?: string;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cachedPricePerMillion?: number;
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
  /**
   * Name of an environment variable to read the API key from.
   * Resolved at runtime by config.tsx's resolveApiKey() function.
   */
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

function getHomeDir(): string {
  return process.env.HOME
    || process.env.USERPROFILE
    || os.homedir();
}

function getProjectRuntimeConfigPath(): string {
  return path.join(process.cwd(), '.protoagent', 'protoagent.jsonc');
}

function getUserRuntimeConfigPath(): string {
  const homeDir = getHomeDir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc');
}

export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) {
    return projectPath;
  }

  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) {
    return userPath;
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Replaces ${ENV_VAR} placeholders in a string with actual environment variable values.
 * Logs a warning if the environment variable is not set (replaces with empty string).
 */
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

function valueReferencesEnvVar(value: unknown, envVar: string): boolean {
  if (typeof value === 'string') {
    return value.includes(`\${${envVar}}`);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => valueReferencesEnvVar(entry, envVar));
  }
  if (isPlainObject(value)) {
    return Object.values(value).some((entry) => valueReferencesEnvVar(entry, envVar));
  }
  return false;
}

function getOriginFromBaseUrl(baseURL?: string): string | null {
  if (!baseURL?.trim()) return null;
  try {
    return new URL(baseURL).origin;
  } catch {
    return null;
  }
}

function fetchCloudflareAccessToken(appOrigin: string): string | null {
  const cloudflaredBinary = process.env.PROTOAGENT_CLOUDFLARED_BIN?.trim() || 'cloudflared';
  try {
    const token = execFileSync(
      cloudflaredBinary,
      ['access', 'login', '--no-verbose', `-app=${appOrigin}`],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ).trim();
    return token || null;
  } catch (error) {
    logger.warn('Failed to auto-resolve CF_ACCESS_TOKEN', {
      appOrigin,
      cloudflaredBinary,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function maybeHydrateCloudflareAccessToken(config: RuntimeConfigFile, sourcePath: string): void {
  if (process.env.CF_ACCESS_TOKEN?.trim()) {
    return;
  }

  const appOrigins = new Set<string>();
  for (const [providerId, provider] of Object.entries(config.providers || {})) {
    if (!valueReferencesEnvVar(provider, 'CF_ACCESS_TOKEN')) {
      continue;
    }
    const appOrigin = getOriginFromBaseUrl(provider.baseURL);
    if (appOrigin) {
      appOrigins.add(appOrigin);
      continue;
    }
    logger.warn('Cannot auto-resolve CF_ACCESS_TOKEN without a valid provider baseURL', {
      providerId,
      sourcePath,
    });
  }

  for (const appOrigin of appOrigins) {
    const token = fetchCloudflareAccessToken(appOrigin);
    if (!token) {
      continue;
    }
    process.env.CF_ACCESS_TOKEN = token;
    logger.info('Resolved CF_ACCESS_TOKEN from cloudflared', { appOrigin, sourcePath });
    return;
  }
}

/**
 * Recursively interpolates environment variables in all string values within a config object.
 * Handles nested objects and arrays. Filters out empty header values.
 */
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
        // Filter out headers with empty values (from unset env vars)
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

/**
 * Removes reserved API parameters from provider and model defaultParams.
 * Prevents users from accidentally overriding critical parameters like
 * 'model', 'messages', 'tools' that are managed by the agentic loop.
 */
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
    
    // Validate against zod schema for better error messages
    const result = RuntimeConfigFileSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Invalid runtime config in ${configPath}: ${issues}`);
    }
    
    const validatedConfig = result.data as RuntimeConfigFile;
    maybeHydrateCloudflareAccessToken(validatedConfig, configPath);
    return sanitizeDefaultParamsInConfig(interpolateValue(validatedConfig, configPath));
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

  const configPath = getActiveRuntimeConfigPath();
  let loaded = DEFAULT_RUNTIME_CONFIG;

  if (configPath) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (fileConfig) {
      logger.debug('Loaded runtime config', { path: configPath });
      loaded = fileConfig;
    }
  }

  runtimeConfigCache = loaded;
  return loaded;
}

export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}

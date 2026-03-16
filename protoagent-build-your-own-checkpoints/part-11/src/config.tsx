import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput, PasswordInput } from '@inkjs/ui';
import { parse } from 'jsonc-parser';
import { getAllProviders, getProvider } from './providers.js';
import { getActiveRuntimeConfigPath, type RuntimeConfigFile, type RuntimeProviderConfig } from './runtime-config.js';

export interface Config {
  provider: string;
  model: string;
  apiKey?: string;
}

export type InitConfigTarget = 'project' | 'user';
export type InitConfigWriteStatus = 'created' | 'exists' | 'overwritten';

// These constants define Unix file permissions in octal notation.
// They ensure config directories and files are only accessible by the owner,
// protecting sensitive data like API keys from other users on the system.
const CONFIG_DIR_MODE = 0o700;  // Owner: rwx, Group: ---, Others: ---
const CONFIG_FILE_MODE = 0o600; // Owner: rw-, Group: ---, Others: ---

// Applies restrictive Unix permissions to a file or directory.
// Skips on Windows since Unix permission concepts don't apply there.
// Uses chmodSync to enforce the permission mode immediately.
function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

// Resolves the API key for a provider using a precedence chain:
// 1. Direct API key from config
// 2. Environment variable specific to the provider (e.g., OPENAI_API_KEY)
// 3. Generic PROTOAGENT_API_KEY environment variable
// 4. Default API key from provider definition
// 5. 'none' if provider uses header-based auth instead of API key
// Returns null if no API key could be resolved.
export function resolveApiKey(config: Pick<Config, 'provider' | 'apiKey'>): string | null {
  const directApiKey = config.apiKey?.trim();
  if (directApiKey) return directApiKey;

  const provider = getProvider(config.provider);

  if (provider?.apiKeyEnvVar) {
    const envValue = process.env[provider.apiKeyEnvVar]?.trim();
    if (envValue) return envValue;
  }

  const envOverride = process.env.PROTOAGENT_API_KEY?.trim();
  if (envOverride) return envOverride;

  const providerApiKey = provider?.apiKey?.trim();
  if (providerApiKey) return providerApiKey;

  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    return 'none';
  }

  return null;
}

export const getUserRuntimeConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.config', 'protoagent');
};

export const getProjectRuntimeConfigDirectory = (cwd = process.cwd()) => {
  return path.join(cwd, '.protoagent');
};

export const getInitConfigPath = (target: InitConfigTarget, cwd = process.cwd()) => {
  const projectPath = path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc');
  const userPath = path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc');
  return target === 'project' ? projectPath : userPath;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Reads and parses protoagent.jsonc (with comments support), returns null on error/missing file.
function readRuntimeConfigFileSync(configPath: string): RuntimeConfigFile | null {
  if (!existsSync(configPath)) return null;
  try {
    const content = readFileSync(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || !isPlainObject(parsed)) return null;
    return parsed as RuntimeConfigFile;
  } catch {
    return null;
  }
}

// Extracts the first configured provider/model from runtime config (returns null if none found).
function getConfiguredProviderAndModel(runtimeConfig: RuntimeConfigFile): Config | null {
  for (const [providerId, providerConfig] of Object.entries(runtimeConfig.providers || {})) {
    const modelId = Object.keys(providerConfig.models || {})[0];
    if (!modelId) continue;
    const apiKey = typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.trim().length > 0
      ? providerConfig.apiKey.trim()
      : undefined;
    return { provider: providerId, model: modelId, ...(apiKey ? { apiKey } : {}) };
  }
  return null;
}

// Creates config directory with secure permissions if it doesn't exist.
function ensureDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  hardenPermissions(targetDir, CONFIG_DIR_MODE);
}

function writeRuntimeConfigFile(configPath: string, runtimeConfig: RuntimeConfigFile): void {
  ensureDirectory(path.dirname(configPath));
  writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
}

// Updates or inserts a provider/model selection into runtime config, preserving existing settings.
function upsertSelectedConfig(runtimeConfig: RuntimeConfigFile, config: Config): RuntimeConfigFile {
  const existingProviders = runtimeConfig.providers || {};
  const currentProvider = existingProviders[config.provider] || {};
  const currentModels = currentProvider.models || {};
  const selectedModelConfig = currentModels[config.model] || {};

  const nextProvider: RuntimeProviderConfig = {
    ...currentProvider,
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}),
    models: Object.fromEntries([
      [config.model, selectedModelConfig],
      ...Object.entries(currentModels).filter(([modelId]) => modelId !== config.model),
    ]),
  };

  if (!config.apiKey?.trim()) {
    delete nextProvider.apiKey;
  }

  return {
    ...runtimeConfig,
    providers: Object.fromEntries([
      [config.provider, nextProvider],
      ...Object.entries(existingProviders).filter(([providerId]) => providerId !== config.provider),
    ]),
  };
}

export const readConfig = (target: InitConfigTarget | 'active' = 'active', cwd = process.cwd()): Config | null => {
  const configPath = target === 'active' ? getActiveRuntimeConfigPath() : getInitConfigPath(target, cwd);
  if (!configPath) return null;
  const runtimeConfig = readRuntimeConfigFileSync(configPath);
  if (!runtimeConfig) return null;
  return getConfiguredProviderAndModel(runtimeConfig);
};

export const writeConfig = (config: Config, target: InitConfigTarget = 'user', cwd = process.cwd()) => {
  const configPath = getInitConfigPath(target, cwd);
  const runtimeConfig = readRuntimeConfigFileSync(configPath) || { providers: {}, mcp: { servers: {} } };
  const nextRuntimeConfig = upsertSelectedConfig(runtimeConfig, config);
  writeRuntimeConfigFile(configPath, nextRuntimeConfig);
  return configPath;
};

// React component for Configure Wizard (standalone subcommand)
// Guides users through selecting a provider/model and saving it to config
// Steps:
// 1. Choose project vs user config
// 2. If existing config found, show it and ask to reset or keep
// 3. If resetting or no existing config, show provider/model selection
// 4. After selection, prompt for API key (if needed) and save config
export const ConfigureComponent = () => {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<InitConfigTarget>('user');
  const [existingConfig, setExistingConfig] = useState<Config | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [configWritten, setConfigWritten] = useState(false);

  // Step 0: Choose project vs user config
  if (step === 0) {
    return (
      <Box flexDirection="column">
        <Text>Choose where to configure ProtoAgent:</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: `Project config — ${path.join(getProjectRuntimeConfigDirectory(), 'protoagent.jsonc')}`, value: 'project' },
              { label: `Shared user config — ${path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc')}`, value: 'user' },
            ]}
            onChange={(value) => {
              setTarget(value as InitConfigTarget);
              const existing = readConfig(value as InitConfigTarget);
              setExistingConfig(existing);
              setStep(existing ? 1 : 2);
            }}
          />
        </Box>
      </Box>
    );
  }

  // Step 1: Existing config found — ask to reset
  if (step === 1 && existingConfig) {
    const provider = getProvider(existingConfig.provider);
    return (
      <Box flexDirection="column">
        <Text>Existing configuration found:</Text>
        <Text>  Provider: {provider?.name || existingConfig.provider}</Text>
        <Text>  Model: {existingConfig.model}</Text>
        <Text> </Text>
        <Text>Do you want to reset and configure a new one? (y/n)</Text>
        <TextInput
          onSubmit={(answer: string) => {
            if (answer.toLowerCase() === 'y') {
              setStep(2);
            } else {
              setConfigWritten(false);
              setStep(4);
            }
          }}
        />
      </Box>
    );
  }

  // Step 2: Model selection
  if (step === 2) {
    const items = getAllProviders().flatMap((provider) =>
      provider.models.map((model) => ({
        label: `${provider.name} - ${model.name}`,
        value: `${provider.id}:::${model.id}`,
      })),
    );

    return (
      <Box flexDirection="column">
        <Text>Select an AI Model:</Text>
        <Select
          options={items}
          onChange={(value: string) => {
            const [providerId, modelId] = value.split(':::');
            setSelectedProviderId(providerId);
            setSelectedModelId(modelId);
            setStep(3);
          }}
        />
      </Box>
    );
  }

  // Step 3: API key input
  if (step === 3) {
    const provider = getProvider(selectedProviderId);
    const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

    return (
      <Box flexDirection="column">
        <Text>{hasResolvedAuth ? 'Optional API Key' : 'Enter API Key'} for {provider?.name || selectedProviderId}:</Text>
        <PasswordInput
          placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : `Enter your ${provider?.apiKeyEnvVar || 'API'} key`}
          onSubmit={(value: string) => {
            if (value.trim().length === 0 && !hasResolvedAuth) return;
            const newConfig: Config = {
              provider: selectedProviderId,
              model: selectedModelId,
              ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
            };
            writeConfig(newConfig, target);
            setConfigWritten(true);
            setStep(4);
          }}
        />
      </Box>
    );
  }

  // Step 4: Done
  return (
    <Box flexDirection="column">
      {configWritten ? (
        <Text color="green">Configuration saved successfully!</Text>
      ) : (
        <Text color="yellow">Configuration not changed.</Text>
      )}
      <Text>You can now run ProtoAgent.</Text>
    </Box>
  );
};
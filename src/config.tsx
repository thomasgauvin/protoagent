import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput, PasswordInput } from '@inkjs/ui';
import { parse } from 'jsonc-parser';
import { getActiveRuntimeConfigPath, type RuntimeConfigFile, type RuntimeProviderConfig } from './runtime-config.js';
import { getAllProviders, getProvider } from './providers.js';

export interface Config {
  provider: string;
  model: string;
  apiKey?: string;
}

export type InitConfigTarget = 'project' | 'user';
export type InitConfigWriteStatus = 'created' | 'exists' | 'overwritten';

const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

export function resolveApiKey(config: Pick<Config, 'provider' | 'apiKey'>): string | null {
  const directApiKey = config.apiKey?.trim();
  if (directApiKey) {
    return directApiKey;
  }

  const provider = getProvider(config.provider);

  if (provider?.apiKeyEnvVar) {
    const providerEnvOverride = process.env[provider.apiKeyEnvVar]?.trim();
    if (providerEnvOverride) {
      return providerEnvOverride;
    }
  }

  const envOverride = process.env.PROTOAGENT_API_KEY?.trim();
  if (envOverride) {
    return envOverride;
  }

  const providerApiKey = provider?.apiKey?.trim();
  if (providerApiKey) {
    return providerApiKey;
  }

  // Fallback for Cloudflare Gateway or other custom header setups
  if (process.env.PROTOAGENT_CUSTOM_HEADERS) {
    return 'none';
  }

  if (!provider?.apiKeyEnvVar) {
    if (provider?.headers && Object.keys(provider.headers).length > 0) {
      return 'none';
    }
    return null;
  }

  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    return 'none';
  }

  return null;
}

export const getConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent');
};

export const getUserRuntimeConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.config', 'protoagent');
};

export const getUserRuntimeConfigPath = () => {
  return path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc');
};

export const getProjectRuntimeConfigDirectory = (cwd = process.cwd()) => {
  return path.join(cwd, '.protoagent');
};

export const getProjectRuntimeConfigPath = (cwd = process.cwd()) => {
  return path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc');
};

export const getInitConfigPath = (target: InitConfigTarget, cwd = process.cwd()) => {
  return target === 'project' ? getProjectRuntimeConfigPath(cwd) : getUserRuntimeConfigPath();
};

const RUNTIME_CONFIG_TEMPLATE = `{
  // Add project or user-wide ProtoAgent runtime config here.
  // Example uses:
  // - choose the active provider/model by making it the first provider
  //   and the first model under that provider
  // - custom providers/models
  // - MCP server definitions
  // - request default parameters
  "providers": {},
  "mcp": {
    "servers": {}
  }
}
`;

function ensureDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  hardenPermissions(targetDir, CONFIG_DIR_MODE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRuntimeConfigFileSync(configPath: string): RuntimeConfigFile | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || !isPlainObject(parsed)) {
      return null;
    }
    return parsed as RuntimeConfigFile;
  } catch (error) {
    console.error('Error reading runtime config file:', error);
    return null;
  }
}

function getConfiguredProviderAndModel(runtimeConfig: RuntimeConfigFile): Config | null {
  for (const [providerId, providerConfig] of Object.entries(runtimeConfig.providers || {})) {
    const modelId = Object.keys(providerConfig.models || {})[0];
    if (!modelId) continue;
    const apiKey = typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.trim().length > 0
      ? providerConfig.apiKey.trim()
      : undefined;
    return {
      provider: providerId,
      model: modelId,
      ...(apiKey ? { apiKey } : {}),
    };
  }

  return null;
}

function writeRuntimeConfigFile(configPath: string, runtimeConfig: RuntimeConfigFile): void {
  ensureDirectory(path.dirname(configPath));
  writeFileSync(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
}

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

export function writeInitConfig(
  target: InitConfigTarget,
  cwd = process.cwd(),
  options: { overwrite?: boolean } = {}
): { path: string; status: InitConfigWriteStatus } {
  const configPath = getInitConfigPath(target, cwd);
  const alreadyExists = existsSync(configPath);
  if (alreadyExists) {
    if (!options.overwrite) {
      return { path: configPath, status: 'exists' };
    }
  } else {
    ensureDirectory(path.dirname(configPath));
  }

  writeFileSync(configPath, RUNTIME_CONFIG_TEMPLATE, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
  return { path: configPath, status: alreadyExists ? 'overwritten' : 'created' };
}

export const readConfig = (target: InitConfigTarget | 'active' = 'active', cwd = process.cwd()): Config | null => {
  const configPath = target === 'active' ? getActiveRuntimeConfigPath() : getInitConfigPath(target, cwd);
  if (!configPath) {
    return null;
  }

  const runtimeConfig = readRuntimeConfigFileSync(configPath);
  if (!runtimeConfig) {
    return null;
  }

  return getConfiguredProviderAndModel(runtimeConfig);
};

export function getDefaultConfigTarget(cwd = process.cwd()): InitConfigTarget {
  const activeConfigPath = getActiveRuntimeConfigPath();
  if (activeConfigPath === getProjectRuntimeConfigPath(cwd)) {
    return 'project';
  }
  return 'user';
}

export const writeConfig = (config: Config, target: InitConfigTarget = 'user', cwd = process.cwd()) => {
  const configPath = getInitConfigPath(target, cwd);
  const runtimeConfig = readRuntimeConfigFileSync(configPath) || { providers: {}, mcp: { servers: {} } };
  const nextRuntimeConfig = upsertSelectedConfig(runtimeConfig, config);
  writeRuntimeConfigFile(configPath, nextRuntimeConfig);
  return configPath;
};

// ─── Step Components ───

interface ResetPromptProps {
  existingConfig: Config;
  setStep: (step: number) => void;
  setConfigWritten: (written: boolean) => void;
}
export const ResetPrompt: React.FC<ResetPromptProps> = ({ existingConfig, setStep, setConfigWritten }) => {
  const [resetInput, setResetInput] = useState('');
  const provider = getProvider(existingConfig.provider);

  return (
    <Box flexDirection="column">
      <Text>Existing configuration found:</Text>
      <Text>  Provider: {provider?.name || existingConfig.provider}</Text>
      <Text>  Model: {existingConfig.model}</Text>
      <Text>  API Key: {'*'.repeat(8)}</Text>
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
};

interface ModelSelectionProps {
  setSelectedProviderId: (id: string) => void;
  setSelectedModelId: (id: string) => void;
  setStep: (step: number) => void;
}
export const ModelSelection: React.FC<ModelSelectionProps> = ({
  setSelectedProviderId,
  setSelectedModelId,
  setStep,
}) => {
  const items = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}:::${model.id}`,
    })),
  );

  const handleSelect = (value: string) => {
    const [providerId, modelId] = value.split(':::');
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setStep(3);
  };

  return (
    <Box flexDirection="column">
      <Text>Select an AI Model:</Text>
      <Select options={items} onChange={handleSelect} />
    </Box>
  );
};

interface ApiKeyInputProps {
  selectedProviderId: string;
  selectedModelId: string;
  target: InitConfigTarget;
  setStep: (step: number) => void;
  setConfigWritten: (written: boolean) => void;
}
export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  selectedProviderId,
  selectedModelId,
  target,
  setStep,
  setConfigWritten,
}) => {
  const [errorMessage, setErrorMessage] = useState('');
  const provider = getProvider(selectedProviderId);
  const canUseResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  const handleApiKeySubmit = (value: string) => {
    if (value.trim().length === 0 && !canUseResolvedAuth) {
      setErrorMessage('API key cannot be empty.');
      return;
    }

    const newConfig: Config = {
      provider: selectedProviderId,
      model: selectedModelId,
      ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
    };
    writeConfig(newConfig, target);
    setConfigWritten(true);
    setStep(4);
  };

  return (
    <Box flexDirection="column">
      <Text>
        {canUseResolvedAuth ? 'Optional API Key' : 'Enter API Key'} for {provider?.name || selectedProviderId}:
      </Text>
      {provider?.headers && Object.keys(provider.headers).length > 0 && (
        <Text dimColor>
          This provider can authenticate with configured headers or environment variables.
        </Text>
      )}
      {errorMessage && <Text color="red">{errorMessage}</Text>}
      <PasswordInput
        placeholder={canUseResolvedAuth ? 'Press enter to keep resolved auth' : `Enter your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={handleApiKeySubmit}
      />
    </Box>
  );
};

interface ConfigResultProps {
  configWritten: boolean;
}
export const ConfigResult: React.FC<ConfigResultProps> = ({ configWritten }) => {
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

export const ConfigureComponent = () => {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<InitConfigTarget>(getDefaultConfigTarget());
  const [existingConfig, setExistingConfig] = useState<Config | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [configWritten, setConfigWritten] = useState(false);

  if (step === 0) {
    return (
      <Box flexDirection="column">
        <Text>Choose where to configure ProtoAgent:</Text>
        <Box marginTop={1}>
          <Select
            options={[
              { label: `Project config — ${getProjectRuntimeConfigPath()}`, value: 'project' },
              { label: `Shared user config — ${getUserRuntimeConfigPath()}`, value: 'user' },
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

  switch (step) {
    case 1:
      return <ResetPrompt existingConfig={existingConfig!} setStep={setStep} setConfigWritten={setConfigWritten} />;
    case 2:
      return (
        <ModelSelection
          setSelectedProviderId={setSelectedProviderId}
          setSelectedModelId={setSelectedModelId}
          setStep={setStep}
        />
      );
    case 3:
      return (
        <ApiKeyInput
          selectedProviderId={selectedProviderId}
          selectedModelId={selectedModelId}
          target={target}
          setStep={setStep}
          setConfigWritten={setConfigWritten}
        />
      );
    case 4:
      return <ConfigResult configWritten={configWritten} />;
    default:
      return <Text>Unknown step.</Text>;
  }
};

export const InitComponent = () => {
  const [selectedTarget, setSelectedTarget] = useState<InitConfigTarget | null>(null);
  const [result, setResult] = useState<{ path: string; status: InitConfigWriteStatus } | null>(null);
  const options: Array<{ label: string; value: InitConfigTarget; description: string }> = [
    {
      label: 'Project config',
      value: 'project',
      description: getProjectRuntimeConfigPath(),
    },
    {
      label: 'Shared user config',
      value: 'user',
      description: getUserRuntimeConfigPath(),
    },
  ];
  const activeTarget = selectedTarget ?? 'project';
  const activeOption = options.find((option) => option.value === activeTarget) ?? options[0];

  if (selectedTarget && !result) {
    const selectedPath = getInitConfigPath(selectedTarget);
    return (
      <Box flexDirection="column">
        <Text>Config already exists:</Text>
        <Text>{selectedPath}</Text>
        <Text>Overwrite it? (y/n)</Text>
        <TextInput
          onSubmit={(answer: string) => {
            if (answer.trim().toLowerCase() === 'y') {
              setResult(writeInitConfig(selectedTarget, process.cwd(), { overwrite: true }));
            } else {
              setResult({ path: selectedPath, status: 'exists' });
            }
          }}
        />
      </Box>
    );
  }

  if (result) {
    const color = result.status === 'exists' ? 'yellow' : 'green';
    const message = result.status === 'created'
      ? 'Created ProtoAgent config:'
      : result.status === 'overwritten'
        ? 'Overwrote ProtoAgent config:'
        : 'ProtoAgent config already exists:';
    return (
      <Box flexDirection="column">
        <Text color={color}>{message}</Text>
        <Text>{result.path}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>Create a ProtoAgent runtime config:</Text>
      <Text dimColor>Select where to write `protoagent.jsonc`.</Text>
      <Text dimColor>{activeOption.description}</Text>
      <Box marginTop={1}>
        <Select
          options={options.map((option) => ({ label: option.label, value: option.value }))}
          onChange={(value) => {
            const target = value as InitConfigTarget;
            const configPath = getInitConfigPath(target);
            if (existsSync(configPath)) {
              setSelectedTarget(target);
              return;
            }
            setResult(writeInitConfig(target));
          }}
        />
      </Box>
    </Box>
  );
};

import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput, PasswordInput } from '@inkjs/ui';
import { loadRuntimeConfig } from './runtime-config.js';
import { getAllProviders, getProvider } from './providers.js';

export interface Config {
  provider: string;
  model: string;
  apiKey?: string;
}

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

export const getConfigPath = () => {
  return path.join(getConfigDirectory(), 'config.json');
};

export const ensureConfigDirectory = () => {
  const dir = getConfigDirectory();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  hardenPermissions(dir, CONFIG_DIR_MODE);
};

export const readConfig = (): Config | null => {
  const configPath = getConfigPath();
  if (existsSync(configPath)) {
    try {
      const content = readFileSync(configPath, 'utf8');
      const raw = JSON.parse(content);

      // Handle legacy format: { provider, model, credentials: { KEY: "..." } }
      let apiKey = raw.apiKey;
      if (!apiKey && raw.credentials && typeof raw.credentials === 'object') {
        const provider = getAllProviders().find((p) => p.id === raw.provider);
        if (provider?.apiKeyEnvVar) {
          apiKey = raw.credentials[provider.apiKeyEnvVar];
        }
        // Fallback: grab the first non-empty value
        if (!apiKey) {
          apiKey = Object.values(raw.credentials).find((v) => typeof v === 'string' && v.length > 0);
        }
      }

      if (!raw.provider || !raw.model) {
        return null;
      }

      return {
        provider: raw.provider,
        model: raw.model,
        apiKey: typeof apiKey === 'string' && apiKey.trim().length > 0 ? apiKey.trim() : undefined,
      } as Config;
    } catch (error) {
      console.error('Error reading config file:', error);
      return null;
    }
  }
  return null;
};

export const writeConfig = (config: Config) => {
  ensureConfigDirectory();
  const configPath = getConfigPath();
  const normalizedConfig: Config = {
    provider: config.provider,
    model: config.model,
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}),
  };
  writeFileSync(configPath, JSON.stringify(normalizedConfig, null, 2), { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
};

// ─── Step Components ───

interface InitialLoadingProps {
  setExistingConfig: (config: Config | null) => void;
  setStep: (step: number) => void;
}
export const InitialLoading: React.FC<InitialLoadingProps> = ({ setExistingConfig, setStep }) => {
  useEffect(() => {
    loadRuntimeConfig()
      .then(() => {
        const config = readConfig();
        if (config) {
          setExistingConfig(config);
          setStep(1);
        } else {
          setStep(2);
        }
      })
      .catch((error) => {
        console.error('Error loading runtime config:', error);
        setStep(2);
      });
  }, []);
  return <Text>Loading configuration...</Text>;
};

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
  setStep: (step: number) => void;
  setConfigWritten: (written: boolean) => void;
}
export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  selectedProviderId,
  selectedModelId,
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
    writeConfig(newConfig);
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
  const [existingConfig, setExistingConfig] = useState<Config | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [configWritten, setConfigWritten] = useState(false);

  switch (step) {
    case 0:
      return <InitialLoading setExistingConfig={setExistingConfig} setStep={setStep} />;
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

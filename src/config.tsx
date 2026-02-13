import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import { SUPPORTED_MODELS, getProvider } from './providers.js';

export interface Config {
  provider: string;
  model: string;
  apiKey: string;
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
    mkdirSync(dir, { recursive: true });
  }
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
        const provider = SUPPORTED_MODELS.find((p) => p.id === raw.provider);
        if (provider) {
          apiKey = raw.credentials[provider.apiKeyEnvVar];
        }
        // Fallback: grab the first non-empty value
        if (!apiKey) {
          apiKey = Object.values(raw.credentials).find((v) => typeof v === 'string' && v.length > 0);
        }
      }

      if (!raw.provider || !raw.model || !apiKey) {
        return null;
      }

      return { provider: raw.provider, model: raw.model, apiKey } as Config;
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
  writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
};

// ─── Step Components ───

interface InitialLoadingProps {
  setExistingConfig: (config: Config | null) => void;
  setStep: (step: number) => void;
}
export const InitialLoading: React.FC<InitialLoadingProps> = ({ setExistingConfig, setStep }) => {
  useEffect(() => {
    const config = readConfig();
    if (config) {
      setExistingConfig(config);
      setStep(1);
    } else {
      setStep(2);
    }
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
        value={resetInput}
        onChange={setResetInput}
        onSubmit={(answer) => {
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
  const items = SUPPORTED_MODELS.flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}:::${model.id}`,
    })),
  );

  const handleSelect = (item: { value: string; label: string }) => {
    const [providerId, modelId] = item.value.split(':::');
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setStep(3);
  };

  return (
    <Box flexDirection="column">
      <Text>Select an AI Model:</Text>
      <SelectInput items={items} onSelect={handleSelect} />
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
  const [apiKey, setApiKey] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const provider = getProvider(selectedProviderId);

  const handleApiKeySubmit = () => {
    if (apiKey.trim().length === 0) {
      setErrorMessage('API key cannot be empty.');
      return;
    }

    const newConfig: Config = {
      provider: selectedProviderId,
      model: selectedModelId,
      apiKey: apiKey.trim(),
    };
    writeConfig(newConfig);
    setConfigWritten(true);
    setStep(4);
  };

  return (
    <Box flexDirection="column">
      <Text>Enter API Key for {provider?.name || selectedProviderId}:</Text>
      {errorMessage && <Text color="red">{errorMessage}</Text>}
      <TextInput
        value={apiKey}
        onChange={setApiKey}
        placeholder={`Enter your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={handleApiKeySubmit}
        mask="*"
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

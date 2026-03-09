/**
 * ConfigDialog — Modal-like dialog for changing config mid-conversation
 *
 * Allows users to update provider, model, or API key without losing chat history.
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { PasswordInput, Select } from '@inkjs/ui';
import { getAllProviders, getProvider } from '../providers.js';
import { resolveApiKey, type Config } from '../config.js';

export interface ConfigDialogProps {
  currentConfig: Config;
  onComplete: (newConfig: Config) => void;
  onCancel: () => void;
}

export const ConfigDialog: React.FC<ConfigDialogProps> = ({
  currentConfig,
  onComplete,
  onCancel,
}) => {
  const [step, setStep] = useState<'select_provider' | 'enter_api_key'>('select_provider');
  const [selectedProviderId, setSelectedProviderId] = useState(currentConfig.provider);
  const [selectedModelId, setSelectedModelId] = useState(currentConfig.model);

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}:::${model.id}`,
    })),
  );

  const currentProvider = getProvider(currentConfig.provider);

  // Provider selection step
  if (step === 'select_provider') {
    return (
      <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
        <Text color="green" bold>
          Change Configuration
        </Text>
        <Text dimColor>Current: {currentProvider?.name} / {currentConfig.model}</Text>
        <Text dimColor>Select a new provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems.map((item) => ({ value: item.value, label: item.label }))}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setStep('enter_api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  // API key entry step
  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));
  return (
    <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="green" paddingX={1}>
      <Text color="green" bold>
        Confirm Configuration
      </Text>
      <Text dimColor>
        Provider: {provider?.name} / {selectedModelId}
      </Text>
      <Text>{hasResolvedAuth ? 'Optional API key (leave empty to keep resolved auth):' : 'Enter your API key:'}</Text>
      <PasswordInput
        placeholder={`Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={(value) => {
          const finalApiKey = value.trim().length > 0 ? value.trim() : currentConfig.apiKey;
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(finalApiKey?.trim() ? { apiKey: finalApiKey.trim() } : {}),
          };
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

# Part 3: Configuration Management

Part 2 hardcoded everything — OpenAI, one model, one env var. That works for a demo but not for a real tool. This part introduces persisted configuration: a provider/model catalog, a config wizard, and API key resolution that works across providers.

Your target snapshot is `protoagent-tutorial-again-part-3`.

## What you are building

- A provider/model catalog with pricing metadata (`src/providers.ts`)
- Persistent config storage in `protoagent.jsonc` (`src/config.tsx`)
- A `protoagent configure` subcommand for the setup wizard
- Inline first-time setup in the main app
- API key resolution: active `protoagent.jsonc` → environment variable → provider default

**Note on `configure` vs `init`:** Part 3 focuses on the `configure` command (interactive setup wizard that modifies the active config). Later parts introduce the `init` command, which creates an initial empty config template. You can use them together: `init` creates the file structure, then `configure` sets the active provider/model.

## Files to create or change

| File | Action |
|------|--------|
| `src/providers.ts` | **Create** — provider/model registry |
| `src/config.tsx` | **Create** — config persistence + setup wizard |
| `src/cli.tsx` | **Modify** — add `configure` subcommand |
| `src/App.tsx` | **Modify** — load config, build client, inline setup |
| `package.json` | **Modify** — add `jsonc-parser` dependency |

## Step 1: Update `package.json`

Add `jsonc-parser` (used later for runtime config, but good to include now):

```json
{
  "name": "protoagent",
  "version": "0.0.1",
  "description": "A simple coding agent CLI.",
  "bin": "dist/cli.js",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "build:watch": "tsc --watch"
  },
  "files": [
    "dist"
  ],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "commander": "^14.0.1",
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
    "jsonc-parser": "^3.3.1",
    "openai": "^5.23.1",
    "react": "^19.1.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2"
  }
}
```

Note: we dropped `dotenv` — API keys are now resolved through the config system or environment variables directly.

## Step 2: Create `src/providers.ts`

This file defines the built-in provider catalog. Every supported provider, model, pricing, and connection details live here.

**Note:** The models listed below are illustrative and represent a forward-looking model catalog. In your own projects, you can replace these with actual current models like `gpt-4o`, `gpt-4-turbo`, `claude-opus`, `claude-sonnet`, etc. The structure and pricing fields are what matter; the exact model IDs should match your provider's current offerings.

```typescript
export interface ModelDetails {
  id: string;
  name: string;
  contextWindow: number;
  pricingPerMillionInput: number;
  pricingPerMillionOutput: number;
  defaultParams?: Record<string, unknown>;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models: ModelDetails[];
}

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.2', name: 'GPT-5.2', contextWindow: 200_000, pricingPerMillionInput: 6.0, pricingPerMillionOutput: 24.0 },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', contextWindow: 200_000, pricingPerMillionInput: 0.15, pricingPerMillionOutput: 0.6 },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 128_000, pricingPerMillionInput: 2.5, pricingPerMillionOutput: 10.0 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200_000, pricingPerMillionInput: 5.0, pricingPerMillionOutput: 25.0 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200_000, pricingPerMillionInput: 3.0, pricingPerMillionOutput: 15.0 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, pricingPerMillionInput: 1.0, pricingPerMillionOutput: 5.0 },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 0.075, pricingPerMillionOutput: 0.3 },
      { id: 'gemini-3-pro-preview', name: 'Gemini 3 Pro (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 1.25, pricingPerMillionOutput: 10.0 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000, pricingPerMillionInput: 0.075, pricingPerMillionOutput: 0.3 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000, pricingPerMillionInput: 1.25, pricingPerMillionOutput: 10.0 },
    ],
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    baseURL: 'https://api.cerebras.ai/v1',
    apiKeyEnvVar: 'CEREBRAS_API_KEY',
    models: [
      { id: 'llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', contextWindow: 128_000, pricingPerMillionInput: 0.0, pricingPerMillionOutput: 0.0 },
    ],
  },
];

export function getAllProviders(): ModelProvider[] {
  return BUILTIN_PROVIDERS;
}

export function getProvider(providerId: string): ModelProvider | undefined {
  return getAllProviders().find((provider) => provider.id === providerId);
}

export function getModelDetails(providerId: string, modelId: string): ModelDetails | undefined {
  return getProvider(providerId)?.models.find((model) => model.id === modelId);
}

export function getModelPricing(providerId: string, modelId: string) {
  const details = getModelDetails(providerId, modelId);
  if (!details) return undefined;
  return {
    inputPerToken: details.pricingPerMillionInput / 1_000_000,
    outputPerToken: details.pricingPerMillionOutput / 1_000_000,
    contextWindow: details.contextWindow,
  };
}

export function getRequestDefaultParams(providerId: string, modelId: string): Record<string, unknown> {
  const provider = getProvider(providerId);
  const model = getModelDetails(providerId, modelId);
  return {
    ...(provider?.defaultParams || {}),
    ...(model?.defaultParams || {}),
  };
}
```

Note: `getAllProviders()` just returns the built-in list for now. In Part 11 (MCP/Runtime Config), we add runtime config loading from the active `protoagent.jsonc` so users can add custom providers via that file.

## Step 3: Create `src/config.tsx`

This file handles config persistence and the setup wizard. The active provider/model/API key selection is stored in `protoagent.jsonc`, using the project file if present and otherwise the shared user file. Configuration is read from and written to `protoagent.jsonc` using `jsonc-parser`.

```tsx
import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput, PasswordInput } from '@inkjs/ui';
import { parse } from 'jsonc-parser';
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

/** Returns the active config path: project if it exists, otherwise user. */
export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) return projectPath;
  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) return userPath;
  return null;
}

interface RuntimeProviderConfig {
  apiKey?: string;
  models?: Record<string, unknown>;
}

interface RuntimeConfigFile {
  providers?: Record<string, RuntimeProviderConfig>;
  mcp?: { servers?: Record<string, unknown> };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

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

// ─── Configure Wizard (standalone subcommand) ───

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
```

## Step 4: Update `src/cli.tsx`

Add the `configure` subcommand and pass options to App:

```tsx
#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, readConfig, writeConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .action(() => {
    render(<App />);
  });

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
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(`${selected.provider} / ${selected.model}`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program.parse(process.argv);
```

## Step 5: Rewrite `src/App.tsx`

Now the app loads config on startup, builds an OpenAI client from provider metadata, shows inline setup if no config exists, and streams responses using the configured model.

```tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput, Select, PasswordInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, resolveApiKey, type Config } from './config.js';
import { getAllProviders, getProvider } from './providers.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? `Missing API key for ${providerName}. Set it in config or export ${envVar}.`
        : `Missing API key for ${providerName}.`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey };

  const baseURL = provider?.baseURL;
  if (baseURL) clientOptions.baseURL = baseURL;

  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
  }

  return new OpenAI(clientOptions);
}

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{ onComplete: (config: Config) => void }> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'provider' | 'api_key'>('provider');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const providerItems = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}:::${model.id}`,
    })),
  );

  if (setupStep === 'provider') {
    return (
      <Box flexDirection="column" marginTop={1}>
        <Text color="yellow" bold>First-time setup</Text>
        <Text dimColor>Select a provider and model:</Text>
        <Box marginTop={1}>
          <Select
            options={providerItems}
            onChange={(value: string) => {
              const [providerId, modelId] = value.split(':::');
              setSelectedProviderId(providerId);
              setSelectedModelId(modelId);
              setSetupStep('api_key');
            }}
          />
        </Box>
      </Box>
    );
  }

  const provider = getProvider(selectedProviderId);
  const hasResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow" bold>First-time setup</Text>
      <Text dimColor>Selected: {provider?.name} / {selectedModelId}</Text>
      <Text>{hasResolvedAuth ? 'Optional API key:' : 'Enter your API key:'}</Text>
      <PasswordInput
        placeholder={hasResolvedAuth ? 'Press enter to keep resolved auth' : `Paste your ${provider?.apiKeyEnvVar || 'API'} key`}
        onSubmit={(value) => {
          if (value.trim().length === 0 && !hasResolvedAuth) return;
          const newConfig: Config = {
            provider: selectedProviderId,
            model: selectedModelId,
            ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
          };
          writeConfig(newConfig, 'user');
          onComplete(newConfig);
        }}
      />
    </Box>
  );
};

export const App: React.FC = () => {
  const { exit } = useApp();
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [client, setClient] = useState<OpenAI | null>(null);

  const initializeWithConfig = useCallback((loadedConfig: Config) => {
    setConfig(loadedConfig);
    try {
      const newClient = buildClient(loadedConfig);
      setClient(newClient);
      setMessages([
        { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
      ]);
      setNeedsSetup(false);
      setInitialized(true);
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    const loadedConfig = readConfig();
    if (!loadedConfig) {
      setNeedsSetup(true);
      return;
    }
    initializeWithConfig(loadedConfig);
  }, [initializeWithConfig]);

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !client || !config) return;

    setInputText('');
    setInputKey((prev) => prev + 1);
    setLoading(true);
    setError(null);

    const userMessage: Message = { role: 'user', content: trimmed };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    try {
      const stream = await client.chat.completions.create({
        model: config.model,
        messages: updatedMessages,
        stream: true,
      });

      const assistantMessage: Message = { role: 'assistant', content: '' };
      setMessages((prev) => [...prev, assistantMessage]);

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta?.content || '';
        assistantMessage.content += delta;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { ...assistantMessage };
          return updated;
        });
      }
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${err.message}` },
      ]);
    } finally {
      setLoading(false);
    }
  }, [loading, client, config, messages]);

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') exit();
  });

  const visibleMessages = messages.filter((msg) => msg.role !== 'system');
  const providerInfo = config ? getProvider(config.provider) : null;

  return (
    <Box flexDirection="column" height="100%">
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      {config && (
        <Text dimColor>Model: {providerInfo?.name || config.provider} / {config.model}</Text>
      )}
      {error && <Text color="red">{error}</Text>}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {needsSetup && (
        <InlineSetup onComplete={initializeWithConfig} />
      )}

      <Box flexDirection="column" flexGrow={1}>
        {visibleMessages.map((msg, i) => (
          <Box key={i} flexDirection="column">
            {msg.role === 'user' ? (
              <Text>
                <Text color="green" bold>{'> '}</Text>
                <Text>{msg.content}</Text>
              </Text>
            ) : (
              <Text>{msg.content}</Text>
            )}
          </Box>
        ))}
        {loading && visibleMessages[visibleMessages.length - 1]?.role === 'user' && (
          <Text dimColor>Agent is thinking...</Text>
        )}
      </Box>

      {initialized && (
        <Box borderStyle="round" borderColor="green" paddingX={1}>
          <Text color="green" bold>{'> '}</Text>
          <TextInput
            key={inputKey}
            defaultValue={inputText}
            onChange={setInputText}
            placeholder="Type your message..."
            onSubmit={handleSubmit}
          />
        </Box>
      )}
    </Box>
  );
};
```

## Verification

Build and run the configure wizard:

```bash
npm install
npm run build
node dist/cli.js configure
```

You should see a provider/model selector, then an API key prompt. After completing setup, run:

```bash
npm run dev
```

The app should show your configured model name and stream responses.

## Snapshot

Your project should match `protoagent-tutorial-again-part-3`.

## What comes next

Part 4 introduces the agentic loop — the tool-use cycle where the model can call tools and the app executes them. This is where ProtoAgent stops being a chat wrapper and becomes an agent.

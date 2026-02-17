# Part 3: Configuration Management

This section details how to implement a robust configuration management system for `protoagent`, allowing users to configure API keys and models directly from the CLI.

## Configuration File Structure and Location

We will store configuration in a JSON file at an OS-specific location. This will make it possible for our coding agent to be configured initialized once. The next time the `protoagent` is invoked, it will get its configurations from here:

- **macOS/Linux**: `~/.local/share/protoagent/config.json`
- **Windows**: `%USERPROFILE%/AppData/Local/protoagent/config.json`

The file will have the following structure:

```json
{
  "provider": "openai",
  "model": "gpt-5.1-codex-mini",
  "credentials": {
    "OPENAI_API_KEY": "sk-your-api-key-here"
  }
}
```

## Install New Dependencies

We'll need the Ink components for user input and additional packages for configuration management. Update your `package.json`:

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
  "files": ["dist"],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "commander": "^14.0.3",
    "dotenv": "^16.4.7",
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
    "openai": "^4.70.0",
    "react": "^19.1.1"
  },
  "devDependencies": {
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "ink-testing-library": "^4.0.0",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2"
  }
}
```

Or, install the packages manually (if you haven't already):

```bash
npm install @inkjs/ui dotenv openai
```

## Define Model Providers and Details

To support multiple AI models with specific details like context window and pricing, we'll create a new file `src/providers.ts`. This file will export interfaces for `ModelProvider` and `ModelDetails`, along with an array `SUPPORTED_MODELS` containing data for OpenAI, Google Gemini, and Anthropic Claude models.

Create the file:

```bash
touch src/providers.ts
```

Here's the content for `src/providers.ts`:

```typescript
export interface ModelDetails {
  id: string;
  name: string;
  contextWindow: number; // in tokens
  pricingPerMillionInput: number; // in USD
  pricingPerMillionOutput: number; // in USD
}

export interface ModelProvider {
  id: string;
  name: string;
  models: ModelDetails[];
}

export const SUPPORTED_MODELS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        contextWindow: 200000,
        pricingPerMillionInput: 1.75,
        pricingPerMillionOutput: 14.00,
      },
      {
        id: 'gpt-5.2-codex',
        name: 'GPT-5.2 Codex',
        contextWindow: 200000,
        pricingPerMillionInput: 1.75,
        pricingPerMillionOutput: 14.00,
      },
      {
        id: 'gpt-5.1-codex',
        name: 'GPT-5.1 Codex',
        contextWindow: 200000,
        pricingPerMillionInput: 1.07,
        pricingPerMillionOutput: 8.50,
      },
      {
        id: 'gpt-5.1-codex-max',
        name: 'GPT-5.1 Codex Max',
        contextWindow: 200000,
        pricingPerMillionInput: 1.25,
        pricingPerMillionOutput: 10.00,
      },
      {
        id: 'gpt-5.1-codex-mini',
        name: 'GPT-5.1 Codex Mini',
        contextWindow: 200000,
        pricingPerMillionInput: 0.25,
        pricingPerMillionOutput: 2.00,
      },
    ],
  },
   {
     id: 'google',
     name: 'Google Gemini',
     models: [
       {
         id: 'gemini-3-pro-preview',
         name: 'Gemini 3 Pro Preview',
         contextWindow: 1000000,
         pricingPerMillionInput: 2.00,
         pricingPerMillionOutput: 12.00,
       },
       {
         id: 'gemini-3-flash-preview',
         name: 'Gemini 3 Flash Preview',
         contextWindow: 1000000,
         pricingPerMillionInput: 0.50,
         pricingPerMillionOutput: 3.00,
       },
     ],
   },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    models: [
      {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        contextWindow: 200000,
        pricingPerMillionInput: 3.00,
        pricingPerMillionOutput: 15.00,
      },
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5',
        contextWindow: 200000,
        pricingPerMillionInput: 1.00,
        pricingPerMillionOutput: 5.00,
      },
      {
        id: 'claude-opus-4-5',
        name: 'Claude Opus 4.5',
        contextWindow: 200000,
        pricingPerMillionInput: 5.00,
        pricingPerMillionOutput: 25.00,
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        contextWindow: 200000,
        pricingPerMillionInput: 5.00,
        pricingPerMillionOutput: 25.00,
      },
    ],
  },
];
```

## Extract Configuration UI and Logic

To centralize all configuration-related interfaces, helper functions, and UI components, we'll move them into `src/config.tsx`. This file will export the `Config` interface, utility functions (`readConfig`, `writeConfig`, etc.), and the main `ConfigureComponent` along with its sub-components (`InitialLoading`, `ResetPrompt`, `ModelSelection`, `ApiKeyInput`, `ConfigResult`).

The `ModelSelection` component presents a single list where users directly select an AI model, with the provider's name prepended to each model's label for clarity. The `ApiKeyInput` receives the `selectedProviderId` and `selectedModelId` as props, and the API key input is masked.

Create the file:

```bash
touch src/config.tsx
```

Here's the complete content for `src/config.tsx`:

```typescript
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput } from '@inkjs/ui';
import { SUPPORTED_MODELS, ModelProvider, ModelDetails } from './providers.js';

export interface Config {
  provider: string;
  model: string;
  credentials: {
    OPENAI_API_KEY?: string;
    GEMINI_API_KEY?: string;
    CLAUDE_API_KEY?: string;
  };
}

// These functions allow parsing the configuration file of protoagent,
// with the expected schema detailed above.
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
      return JSON.parse(content) as Config;
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

// These functions are used to display the configuration
// management with React Ink
interface InitialLoadingProps {
  setExistingConfig: (config: Config | null) => void;
  setStep: (step: number) => void;
}
export const InitialLoading: React.FC<InitialLoadingProps> = ({ setExistingConfig, setStep }) => {
  useEffect(() => {
    const config = readConfig();
    if (config) {
      setExistingConfig(config);
      setStep(1); // Ask to reset
    } else {
      setStep(2); // No existing config, go to model selection
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
  const handleReset = (answer: string) => {
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
      setStep(2); // Go to model selection
    } else {
      setConfigWritten(false); // Do not reset
      setStep(4); // Exit with no changes
    }
  };

  return (
    <Box flexDirection="column">
      <Text>Existing configuration found:</Text>
      <Text dimColor>Provider: {existingConfig.provider}, Model: {existingConfig.model}</Text>
      <Text>Do you want to reset and configure a new one? (y/n)</Text>
      <TextInput placeholder="y/n" onSubmit={handleReset} />
    </Box>
  );
};

// Functions to display the selection of a AI model
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
  const options = SUPPORTED_MODELS.flatMap((provider) =>
    provider.models.map((model) => ({
      label: `${provider.name} - ${model.name}`,
      value: `${provider.id}-${model.id}`,
    })),
  );

  const handleSelect = (value: string) => {
    const [providerId, ...modelIdParts] = value.split('-');
    const modelId = modelIdParts.join('-');
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setStep(3); // Go to API key input
  };

  return (
    <Box flexDirection="column">
      <Text>Select an AI Model:</Text>
      <Select options={options} onChange={handleSelect} />
    </Box>
  );
};

// Functions to display the input of API keys
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

  const handleApiKeySubmit = (apiKey: string) => {
    let isValid = false;
    let credentials: Config['credentials'] = {};

    if (selectedProviderId === 'openai') {
      isValid = apiKey.startsWith('sk-');
      credentials.OPENAI_API_KEY = apiKey;
    } else if (selectedProviderId === 'google') {
      isValid = apiKey.length > 20; // Gemini API keys are longer
      credentials.GEMINI_API_KEY = apiKey;
    } else if (selectedProviderId === 'anthropic') {
      isValid = apiKey.startsWith('sk-ant-');
      credentials.CLAUDE_API_KEY = apiKey;
    }

    if (isValid) {
      const newConfig: Config = {
        provider: selectedProviderId,
        model: selectedModelId,
        credentials: credentials,
      };
      writeConfig(newConfig);
      setConfigWritten(true);
      setStep(4); // Success
    } else {
      setErrorMessage(`Invalid API key for ${selectedProviderId}. Please try again.`);
      setStep(3); // Stay on API key input
    }
  };

  return (
    <Box flexDirection="column">
      <Text>Enter API Key for {selectedProviderId}:</Text>
      {errorMessage && <Text color="red">{errorMessage}</Text>}
      <TextInput placeholder={`Enter your ${selectedProviderId} API key`} onSubmit={handleApiKeySubmit} />
    </Box>
  );
};

// Functions to display the result of configurations
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
```

## Update CLI to use Configuration

### Changes from Part 2 (CLI)

The `src/cli.tsx` now imports the `ConfigureComponent` and adds a `configure` subcommand:

```typescript
#!/usr/bin/env node
import React from 'react';
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent } from './config.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('A simple coding agent CLI')
  .version(packageJson.version)
  .option('--log-level <level>', 'Set log level (DEBUG, INFO, WARN, ERROR)', 'INFO');

program
  .command('configure')
  .description('Configure AI model settings')
  .action(() => {
    render(<ConfigureComponent />);
  });

// Set default action when no command is provided
program.action(() => {
  const options = program.opts() as { logLevel: string };
  render(<App options={options} />);
});

program.parse(process.argv);
```

## Update App to use Configuration

### Changes from Part 2 (App.tsx)

The `src/App.tsx` now loads configuration from disk and supports multiple AI providers (OpenAI, Google Gemini, and Anthropic Claude) using the OpenAI SDK's multi-provider compatibility feature:

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OptionValues } from 'commander';
import OpenAI from 'openai';
import { readConfig, Config } from './config.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

let llmClient: OpenAI | null = null;

// Map of providers to their OpenAI-compatible endpoints
const PROVIDER_ENDPOINTS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  anthropic: 'https://api.anthropic.com/v1',
};

// Note on provider compatibility:
// - OpenAI: Native OpenAI API
// - Google: Uses Gemini API with OpenAI compatibility layer
// - Anthropic: Uses Claude API with OpenAI compatibility layer
// 
// Each provider's API key format:
// - OpenAI: sk-... (required in OPENAI_API_KEY)
// - Google: API key from Google Cloud (required in GEMINI_API_KEY)
// - Anthropic: sk-ant-... (required in CLAUDE_API_KEY)

// Map of providers to their credential field names
const PROVIDER_CREDENTIAL_KEYS: Record<string, string> = {
  openai: 'OPENAI_API_KEY',
  google: 'GEMINI_API_KEY',
  anthropic: 'CLAUDE_API_KEY',
};

export const App = (options: OptionValues) => {
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
  ]);
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadedConfig = readConfig();
    if (loadedConfig) {
      const credentialKey = PROVIDER_CREDENTIAL_KEYS[loadedConfig.provider];
      const apiKey = loadedConfig.credentials[credentialKey as keyof typeof loadedConfig.credentials];
      
      setConfig(loadedConfig);
      
      if (credentialKey && apiKey) {
        const baseURL = PROVIDER_ENDPOINTS[loadedConfig.provider];
        
        try {
          llmClient = new OpenAI({
            apiKey: apiKey,
            baseURL: baseURL,
          });
        } catch (err) {
          setError(`Failed to initialize ${loadedConfig.provider} client.`);
        }
      } else {
        setError('Unsupported provider or missing API key in configuration.');
      }
    } else {
      setError('Configuration not found. Please run `protoagent configure`.');
    }
  }, []);

  const handleSubmit = async (value: string) => {
    if (!llmClient || !config) {
      setError('AI not configured. Please run `protoagent configure`.');
      return;
    }
    if (value.trim() !== '') {
      const userMessage: Message = { role: 'user', content: value };
      const updatedMessages = [...messages, userMessage];
      setMessages(updatedMessages);
      setInputKey((prev) => prev + 1);
      setLoading(true);

      try {
        const stream = await llmClient.chat.completions.create({
          messages: updatedMessages,
          model: config.model,
          stream: true,
        });

        let assistantResponse = '';
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content || '';
          assistantResponse += content;
          setMessages((prev) => {
            const lastMessage = prev[prev.length - 1];
            if (lastMessage && lastMessage.role === 'assistant') {
              return [
                ...prev.slice(0, prev.length - 1),
                { ...lastMessage, content: assistantResponse },
              ];
            }
            return prev;
          });
        }
      } catch (error: any) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${error.message}` },
        ]);
      } finally {
        setLoading(false);
      }
    }
  };

  const introductoryMessage = [
    <BigText key="welcome-1" text="ProtoAgent" font="tiny" colors={["#09A469"]} />,
    <Text key="welcome-2" italic dimColor>"The prefix "proto-" comes from the Greek word prōtos and is used to denote the beginning stage or the primitive form of something that will later evolve or develop into a more complex version."</Text>,
    <Text key="padding-above-welcome"> </Text>,
    <Text key="welcome-3">Welcome to ProtoAgent, a simple coding agent CLI. </Text>,
    <Text key="padding-above-welcome-2"> </Text>,
    <Text key="welcome-4">ProtoAgent has the core capabilities of the popular coding agents but stripped down to the core functionality to help you understand how coding agents work. Run with `--log-level TRACE` to see what's happening under the hood. </Text>
  ];

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1}>
        {introductoryMessage}
        {error && <Text color="red">{error}</Text>}
        {messages.filter(msg => msg.role !== 'system').map((msg, index) => (
          <React.Fragment key={index}>
            <Text> </Text>
            <Text dimColor={msg.role === 'user'} color={msg.role === 'user' ? 'lightgrey' : 'white'}>
              {msg.role === 'user' ? '> ' : 'Agent: '}{msg.content}
            </Text>
            <Text> </Text>
          </React.Fragment>
        ))}
        {loading && <Text>Agent is thinking...</Text>}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1}>
        <Text color="green">❯ </Text>
        <TextInput
          key={inputKey}
          placeholder="Type your message here..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
```

## Test it out

First, configure ProtoAgent to set up your AI provider:

```bash
npm run dev -- configure
```

You should see the configuration flow:

```
Select an AI Model:
  OpenAI - GPT-5.2
  OpenAI - GPT-5.2 Codex
  OpenAI - GPT-5.1 Codex
  OpenAI - GPT-5.1 Codex Max
❯ OpenAI - GPT-5.1 Codex Mini
  Google Gemini - Gemini 3 Pro Preview
  Google Gemini - Gemini 3 Flash Preview
  Anthropic Claude - Claude Sonnet 4.5
  Anthropic Claude - Claude Haiku 4.5
  Anthropic Claude - Claude Opus 4.5
  Anthropic Claude - Claude Opus 4.6
```

Select your desired provider and model, then enter your API key. Once configured, run ProtoAgent normally:

```bash
npm run dev
```

You should see the ProtoAgent welcome banner and be able to chat with the configured AI model:

```
█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █

"The prefix "proto-" comes from the Greek word prōtos and is used to denote the beginning stage or the
primitive form of something that will later evolve or develop into a more complex version."

Welcome to ProtoAgent, a simple coding agent CLI.

ProtoAgent has the core capabilities of the popular coding agents but stripped down to the core
functionality to help you understand how coding agents work. Run with `--log-level TRACE` to see what's
happening under the hood.

> what is 2 + 2?

Agent: 2 + 2 = 4

❯ Type your message here...
```

## Summary

You now have a fully functional multi-provider AI agent CLI that:

- Supports OpenAI, Google Gemini, and Anthropic Claude through OpenAI SDK compatibility
- Stores configuration securely in OS-specific directories
- Allows users to configure models and API keys through an interactive CLI
- Uses streaming for responsive AI responses
- Provides a rich terminal UI with Ink and React

This completes the ProtoAgent tutorial series. You've built a complete foundation for understanding how coding agents work!

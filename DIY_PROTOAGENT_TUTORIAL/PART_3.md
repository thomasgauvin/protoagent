# ProtoAgent Tutorial Part 3: Configuration Management

This section details how to implement a robust configuration management system for ProtoAgent, allowing users to configure API keys and models directly from the CLI.

## 1. Configuration File Structure and Location

We will store configuration in a JSON file at an OS-specific location:

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

## 2. Install New Dependencies

We'll need new Ink components for user input: `ink-select-input`.

```bash
npm install ink-select-input
```

## 3. Define Model Providers and Details in `src/providers.ts`

To support multiple AI models with specific details like context window and pricing, we'll create a new file `src/providers.ts`. This file will export interfaces for `ModelProvider` and `ModelDetails`, along with an array `SUPPORTED_MODELS` containing data for OpenAI, Google Gemini, and Anthropic Claude models.

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
        id: 'gemini-3-pro',
        name: 'Gemini 3 Pro',
        contextWindow: 1000000,
        pricingPerMillionInput: 2.00,
        pricingPerMillionOutput: 12.00,
      },
      {
        id: 'gemini-3-flash',
        name: 'Gemini 3 Flash',
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

## 4. Extract Configuration UI and Logic to `src/config.tsx`

To centralize all configuration-related interfaces, helper functions, and UI components, we have moved them into `src/config.tsx`. This file now exports the `Config` interface, utility functions (`readConfig`, `writeConfig`, etc.), and the main `ConfigureComponent` along with its sub-components (`InitialLoading`, `ResetPrompt`, `ModelSelection`, `ApiKeyInput`, `ConfigResult`).

Notably, the model selection process has been streamlined: `ProviderSelection` has been removed and replaced with `ModelSelection`. This new component presents a single list where users directly select an AI model, with the provider's name prepended to each model's label for clarity. The `ApiKeyInput` now receives the `selectedProviderId` and `selectedModelId` as props, and the API key input is masked.

Here's the complete content for `src/config.tsx`:

```typescript
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
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

// --- Step Components for ConfigureComponent ---

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
  const [resetInput, setResetInput] = useState('');

  return (
    <Box flexDirection="column">
      <Text>Existing configuration found:</Text>
      <Text>{JSON.stringify(existingConfig, null, 2)}</Text>
      <Text>Do you want to reset and configure a new one? (y/n)</Text>
      <TextInput
        value={resetInput}
        onChange={setResetInput}
        onSubmit={(answer) => {
          if (answer.toLowerCase() === 'y') {
            setStep(2); // Go to model selection
          } else {
            setConfigWritten(false); // Do not reset
            setStep(4); // Exit with no changes
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
      label: `${provider.name} - ${model.name} (Context: ${model.contextWindow} tokens, Cost: $${model.pricingPerMillionInput}/$${model.pricingPerMillionOutput} M tokens)`,
      value: `${provider.id}-${model.id}`,
    })),
  );

  const handleSelect = (item: { value: string; label: string }) => {
    const [providerId, modelId] = item.value.split('-');
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setStep(3); // Go to API key input
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

  const handleApiKeySubmit = () => {
    let isValid = false;
    let credentials: Config['credentials'] = {};

    if (selectedProviderId === 'openai') {
      isValid = apiKey.startsWith('sk-');
      credentials.OPENAI_API_KEY = apiKey;
    } else if (selectedProviderId === 'google') {
      isValid = apiKey.length > 0; // Simple check for now
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
      setApiKey(''); // Clear invalid key
    }
  };

  return (
    <Box flexDirection="column">
      <Text>Enter API Key for {selectedProviderId}:</Text>
      {errorMessage && <Text color="red">{errorMessage}</Text>}
      <TextInput
        value={apiKey}
        onChange={setApiKey}
        placeholder={`Enter your ${selectedProviderId} API key`}
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
```

## 5. Update `src/cli.tsx` to Use Configuration Components

`src/cli.tsx` will now import the `ConfigureComponent` directly from `src/config.tsx` and will no longer contain the individual step components or their internal logic. This significantly simplifies `cli.tsx`.

Here's the updated `src/cli.tsx`:

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
import { ConfigureComponent } from './config.js'; // Import ConfigureComponent

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('A simple CLI tool')
  .version(packageJson.version);

program
  .command('configure')
  .description('Configure AI model settings')
  .action(() => {
    console.log("Starting configuration...");
    render(<ConfigureComponent />);
  });

const options = program.opts();
const args = process.argv.slice(2);

// Check if the first argument is a known command or a help flag
const isCommand = program.commands.some(cmd => cmd.name() === args[0]);
const isHelp = args.includes('-h') || args.includes('--help') || args[0] === 'help';

if (isCommand || isHelp) {
  program.parse(process.argv);
} else {
  // If no command or help is requested, render the main App
  render(<App options={options} />);
}
```

## 6. Update `src/App.tsx` to Use Configuration

`src/App.tsx` remains largely the same, but it now directly imports the `readConfig` function and `Config` interface from `src/config.tsx`.

Here's the updated `src/App.tsx`:

```typescript
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import BigText from 'ink-big-text';
import { OptionValues } from 'commander';
import OpenAI from 'openai';
import { readConfig, Config } from './config.js';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

let openaiClient: OpenAI | null = null;

export const App = (options: OptionValues) => {
  const [config, setConfig] = useState<Config | null>(null);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
  ]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadedConfig = readConfig();
    if (loadedConfig) {
      setConfig(loadedConfig);
      if (loadedConfig.provider === 'openai' && loadedConfig.credentials.OPENAI_API_KEY) {
        openaiClient = new OpenAI({
          apiKey: loadedConfig.credentials.OPENAI_API_KEY,
        });
      } else {
        setError('Unsupported provider or missing API key in configuration.');
      }
    } else {
      setError('Configuration not found. Please run `protoagent configure`.');
    }
  }, []);

  const handleSubmit = async (value: string) => {
    if (!openaiClient || !config) {
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
        const stream = await openaiClient.chat.completions.create({
          messages: updatedMessages,
          model: config.model,
          stream: true,
        });

        let assistantResponse = '';
        setMessages((prev) => [...prev, { role: 'assistant', content: '' }]); // Add empty message for streaming

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
      } catch (err: any) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: `Error: ${err.message}` },
        ]);
      } finally {
        setLoading(false);
      }
    }
  };

  const introductoryMessage = [
    <BigText key="welcome-1" text="ProtoAgent" font="tiny" colors={["#09A469"]} />, // Using ink-big-text for ProtoAgent
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
        
        {loading && <><Text> </Text><Text>Agent is thinking...</Text></>}
      </Box>

      <Text> </Text>
      <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1}>
        <Text color="green"> {`>`} </Text>
        <TextInput
          key={inputKey}
          value={inputText}
          onChange={setInputText}
          placeholder="Type your message here..."
          onSubmit={handleSubmit}
          isDisabled={loading || !openaiClient}
        />
      </Box>
    </Box>
  );
};
```

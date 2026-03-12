# Part 1: Scaffolding

By the end of this part you will have a working terminal app: a Commander-based CLI that launches an Ink TUI with a message area and a text input. No AI yet — just the interactive shell that every later feature will grow inside.

## What you are building

- A TypeScript CLI package (`package.json` with ESM, build scripts)
- A compiled `dist/cli.js` entrypoint
- A Commander-based command parser
- An Ink React app with a title, message list, and input box

## Files to create

| File | Purpose |
|------|---------|
| `package.json` | Node package, scripts, dependencies |
| `tsconfig.json` | TypeScript compiler config |
| `src/cli.tsx` | CLI entrypoint — parses args, renders the Ink app |
| `src/App.tsx` | Main UI component — message list + input |

## Step 1: `package.json`

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

Key points:
- `"type": "module"` enables ESM imports throughout the project
- `"bin": "dist/cli.js"` makes the compiled CLI the executable entrypoint
- `tsx` runs TypeScript directly for development (`npm run dev`)
- `tsc` compiles to `dist/` for production (`npm run build`)

## Step 2: `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

The `"jsx": "react-jsx"` setting tells TypeScript to transform JSX without requiring explicit React imports. This is the modern approach supported in React 17+.

## Step 3: `src/cli.tsx`

This file does three things: reads the package version, creates the Commander program, and renders the Ink app.

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

// Read version from package.json relative to the compiled file location
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .parse(process.argv);

const options = program.opts();

render(<App options={options} />);
```

Note the import path: `./App.js`, not `./App.tsx`. When TypeScript compiles, `.tsx` files become `.js` files in `dist/`, so all imports must reference the compiled extension.

## Step 4: `src/App.tsx`

The first version of `App` is just a terminal chat shell — no AI, no tools. It keeps an array of messages and an input box. When you submit text, it appears in the message area.

```tsx
import React, { useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';

export interface AppProps {
  options?: Record<string, any>;
}

export const App: React.FC<AppProps> = () => {
  const { exit } = useApp();
  const [messages, setMessages] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;

    setMessages((prev) => [...prev, trimmed]);
    setInputText('');
    setInputKey((prev) => prev + 1);
  };

  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <BigText text="ProtoAgent" font="tiny" colors={["#09A469"]} />
      <Text dimColor italic>A simple, hackable coding agent CLI.</Text>
      <Text> </Text>

      {/* Message area */}
      <Box flexDirection="column" flexGrow={1}>
        {messages.map((msg, i) => (
          <Text key={i}>
            <Text color="green" bold>{'> '}</Text>
            <Text>{msg}</Text>
          </Text>
        ))}
      </Box>

      {/* Input */}
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
    </Box>
  );
};
```

The `inputKey` trick forces the `TextInput` to remount and clear its internal state after each submit. Without it, the input field would keep the old text.

## Verification

Install dependencies and build:

```bash
npm install
npm run build
node dist/cli.js --help
```

Then launch the dev version:

```bash
npm run dev
```

You should see:
- The **ProtoAgent** title rendered in large text
- A text input at the bottom
- Submitted messages appear in the message area
- `Ctrl-C` exits the app

## Snapshot

Your project should match `protoagent-tutorial-again-part-1`.

## Pitfalls

- Forgetting `"type": "module"` causes ESM import failures
- Using `"jsx": "react-jsx"` instead of `"jsx": "react"` breaks Ink rendering
- Importing `./App.tsx` instead of `./App.js` from compiled code fails at runtime
- Reading `package.json` from the wrong relative path after compilation

## What comes next

Part 2 adds the OpenAI SDK and streaming — the first time the app actually talks to an AI model. Everything you build after this point grows inside the shell you just created.

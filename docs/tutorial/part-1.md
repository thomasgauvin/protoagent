# Part 1: Scaffolding

Every project starts with scaffolding, and this one's no different. In this part, we'll set up a TypeScript CLI project with [Commander](https://github.com/tj/commander.js) for argument parsing and [Ink](https://github.com/vadimdemedes/ink) for the terminal UI.

By the end, you'll have a runnable `protoagent` command that displays a welcome banner and accepts text input. Not an agent yet — but a solid foundation to build on.

## What you'll build

- A Node.js project with TypeScript and ESM modules
- CLI argument parsing with Commander
- An Ink-based terminal UI with a welcome banner and text input
- A `protoagent` command you can run

## Key concepts

- **Commander** handles CLI arguments and subcommand routing — it's the standard tool for this in the Node.js ecosystem.
- **Ink** is React for the terminal. If you know React, you already know how to build terminal UIs with Ink. Components, state, hooks — it all works the same way.
- **TSX** lets you run TypeScript directly during development without a compile step.

## Getting started

Let's get started. We're going to be scaffolding our project with the necessary tools.

### 1. Initialize the project

Create a folder for our project with `mkdir protoagent`, change directory with `cd protoagent`, run `npm init -y` to initialize a Node.js project. We have the following `package.json` content:

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
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
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

### 2. Install dependencies

We're going to install the necessary packages. [Commander](https://github.com/tj/commander.js) and [Ink](https://github.com/vadimdemedes/ink) will allow us to have a good interface and enable core functionality like copy-paste.

```bash
npm install commander ink react ink-big-text @inkjs/ui
npm install @types/node @types/react ink-testing-library tsx typescript --save-dev
```

### 3. Create the CLI entry point

Create `src/cli.tsx` with `mkdir src` and `touch src/cli.tsx`. The contents should be the following:

```jsx
#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('A simple CLI tool')
  .version(packageJson.version)
  .parse(process.argv);

const options = program.opts();

render(<App options={options} />);
```

### 4. Create the App component

Create `src/App.tsx` with `touch src/App.tsx` and add the following content:

```jsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from '@inkjs/ui';
import BigText from 'ink-big-text';
import { OptionValues } from 'commander';

export const App = (options: OptionValues) => {
  const [messages, setMessages] = useState<string[]>([]);
  const [inputKey, setInputKey] = useState(0);

  const handleSubmit = (value: string) => {
    if (value.trim() !== '') {
      setMessages((prevMessages) => [...prevMessages, value]);
      setInputKey((prev) => prev + 1);
    }
  };

  const introductoryMessage = [
    <BigText key="welcome-1" text="ProtoAgent" font="tiny" colors={["#09A469"]} />, // Using ink-big-text for ProtoAgent
    <Text key="welcome-2" italic dimColor>"The prefix "proto-" comes from the Greek word prōtos and is used to denote the beginning stage or the primitive form of something that will later evolve or develop into a more complex version."</Text>,
    <Text key="padding-above-welcome"> </Text>,
    <Text key="welcome-3" color="green">Welcome to ProtoAgent, a simple coding agent CLI with tool support.</Text>,
    <Text key="padding-above-welcome-2"> </Text>,
    <Text key="welcome-4" color="green">ProtoAgent has the core capabilities of the popular coding agents but stripped down to the core functionality to help you understand how coding agents work.</Text>
  ];

  return (
    <Box flexDirection="column" height="100%">
      <Box flexDirection="column" flexGrow={1} >
        {introductoryMessage}
        {messages.map((msg, index) => (
          <React.Fragment key={index}>
            <Text> </Text>
            <Text dimColor>{'> '}{msg}</Text>
            <Text> </Text>
          </React.Fragment>
        ))}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="green" paddingX={1}>
        <Text color="green"> {`>`} </Text>
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

### 5. Configure TypeScript

Configure TypeScript by creating a `tsconfig.json` file in the root directory.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react",
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

### 6. Test it

Now let's test that everything works. Run the development server:

```bash
npm run dev
```

You should see the `protoagent` welcome banner and be able to type messages:

```
█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █

"The prefix "proto-" comes from the Greek word prōtos and is used to denote the beginning stage or the
primitive form of something that will later evolve or develop into a more complex version."

Welcome to ProtoAgent, a simple coding agent CLI with tool support.

ProtoAgent has the core capabilities of the popular coding agents but stripped down to the core
functionality to help you understand how coding agents work.

> hi

> test

┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  > Type your message here...                                                                             │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Great! You now have a working CLI with a nice terminal UI. In the next part, we'll connect it to an AI API so it can actually respond to your messages.

## Summary

We now have a pretty simple Ink and Commander project that will allow us to have simple command line argument parsing (by Commander) and a rich React-based interface for our CLI.

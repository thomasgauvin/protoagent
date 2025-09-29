# ProtoAgent Tutorial Part 1: Scaffolding

Let's get started. We're going to be scaffolding our project with the necessary tools.

1. Create a folder for our project with `mkdir protoagent`, change directory with `cd protoagent`, run `npm init -y` to initialize a Node.js project. We have the following `package.json` content:

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
    "commander": "^14.0.1",
    "ink": "^6.3.1",
    "ink-big-text": "^2.0.0",
    "ink-text-input": "^6.0.0",
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

2. We're going to install the necessary packages. [`Commander`](https://github.com/tj/commander.js) and [`Ink`](https://github.com/vadimdemedes/ink) will allow us to have a good interface and enable core functionality like copy-paste.

```bash
npm install commander ink react ink-big-text ink-text-input
npm install @types/node @types/react ink-testing-library tsx typescript --save-dev
```

3. Create `src/cli.tsx` with `mkdir src` and `touch src/cli.tsx`. The contents of should be the following:

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

4. Create `src/App.tsx` with `touch src/App.tsx` and add the following content:

```jsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import BigText from 'ink-big-text';
import { OptionValues } from 'commander';

export const App = (options: OptionValues) => {
  const [messages, setMessages] = useState<string[]>([]);
  const [inputText, setInputText] = useState('');

  const handleSubmit = (value: string) => {
    if (value.trim() !== '') {
      setMessages((prevMessages) => [...prevMessages, value]);
      setInputText('');
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
          value={inputText}
          onChange={setInputText}
          placeholder="Type your message here..."
          onSubmit={handleSubmit}
        />
      </Box>
    </Box>
  );
};
```

5. Configure TypeScript by creating a `tsconfig.json` file in the root directory.

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

We now have a pretty simple Ink and Commander project that will allow us to have simple command line argument parsing (by Commander) and a rich React-based interface for our CLI.

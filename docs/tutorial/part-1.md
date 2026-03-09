# Part 1: Scaffolding

Part 1 is still the structural foundation: a Node CLI entrypoint, Commander for argument parsing, and Ink for the terminal UI.

The difference now is that we are treating it as a real rebuild checkpoint.

By the end of this part, you should have a minimal interactive terminal app that matches `protoagent-tutorial-again-part-1`.

## What you are building in this part

You are building the smallest useful shell of ProtoAgent:

- a TypeScript CLI package
- a compiled `dist/cli.js` entrypoint
- a Commander-based command shell
- an Ink app with a message area and input box

No AI yet. No tools yet. Just the terminal shell the rest of the project will grow inside.

## Starting point

Start from a fresh directory.

If you want to compare your result at the end, the target snapshot is:

- `protoagent-tutorial-again-part-1`

## Files to create

Create these files first:

- `package.json`
- `tsconfig.json`
- `src/cli.tsx`
- `src/App.tsx`

## Step 1: Create `package.json`

Use a small Node + TypeScript CLI package with ESM enabled.

Key things to include:

- `"type": "module"`
- `"bin": "dist/cli.js"`
- a `build` script that runs `tsc`
- a `dev` script that runs `tsx src/cli.tsx`
- Ink, Commander, React, and TypeScript dependencies

At this stage, the snapshot uses these package scripts:

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.tsx",
    "build:watch": "tsc --watch"
  }
}
```

And these runtime dependencies:

```json
{
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "commander": "^14.0.3",
    "ink": "^6.7.0",
    "ink-big-text": "^2.0.0",
    "react": "^19.1.1"
  }
}
```

## Step 2: Create `tsconfig.json`

Keep the compiler setup simple and aligned with the staged snapshot.

The stage uses:

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

Later parts evolve this setup, but this is enough for the first stage.

## Step 3: Create `src/cli.tsx`

This file does three things:

1. reads the package version from `package.json`
2. creates the Commander program
3. renders the Ink app

The stage-1 CLI is intentionally tiny. It does not have subcommands yet. It just parses the base program and renders `App`.

Critical details to keep:

- use a `#!/usr/bin/env node` shebang
- read `package.json` relative to the built file location
- import `App` from `./App.js`
- call `render(<App options={options} />)`

That last part is what gives you the clean split between CLI entrypoint and interactive UI.

## Step 4: Create `src/App.tsx`

This first version of `App` is mostly a terminal shell.

It keeps:

- an array of submitted messages
- an `inputKey` so the input resets after submit
- a `handleSubmit()` function that appends the latest message

It renders:

- a `BigText` title
- a short intro
- the message list
- an input box at the bottom

You do not need to overthink this part. The point is to establish the TUI layout that every later feature will build on.

The snapshot version uses a single-column `Box` with:

- a scroll-like content area on top
- a bordered input area on the bottom

## What changed since the earliest version

The original scaffold really was just a chat-shaped terminal app. The current full app is much richer:

- the UI is session-aware
- slash commands are built in
- config can be edited inline or mid-session
- approvals are rendered inline in the same TUI
- the app can resume previous sessions by ID

But none of that changes the basic split you are establishing here.

## Verification

Install dependencies and build the project:

```bash
npm install && npm run build && node dist/cli.js --help
```

Then launch the dev version:

```bash
npm run dev
```

If it worked, you should see:

- the `ProtoAgent` title rendered in the terminal
- a text input prompt at the bottom
- submitted messages appear in the message area

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-1`

## Pitfalls

- forgetting `"type": "module"` and then fighting ESM import issues
- using the wrong JSX setting and getting Ink/React build errors
- importing `./App.tsx` instead of `./App.js` from built code
- reading `package.json` from the wrong relative path after compilation

## Core takeaway

Even in the current codebase, the architecture still starts with the same simple split:

1. parse CLI arguments
2. decide which Ink component to render
3. keep the app stateful and interactive inside `App.tsx`

That separation makes every later feature easier to layer on.

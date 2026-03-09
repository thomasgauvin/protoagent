# Part 3: Configuration Management

Configuration is what turns ProtoAgent from a generic CLI into a usable local tool.

In Part 2, the app only knew how to talk to OpenAI through a single environment variable. In this part, you move that setup into a real persisted config flow.

By the end, your result should match `protoagent-tutorial-again-part-3`.

## What you are building in this part

Starting from Part 2, you are adding:

- a persisted config file on disk
- a provider/model catalog
- a merged runtime provider registry backed by `protoagent.jsonc`
- a standalone `protoagent configure` flow
- provider-specific API key handling
- app startup that reads config before creating the model client

This is the point where ProtoAgent stops feeling like a demo and starts feeling like a local tool you can actually reopen.

## Starting point

Copy your Part 2 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-3`

## Files to create or change

This stage introduces three important files and updates the CLI/UI wiring:

- `src/config.tsx`
- `src/providers.ts`
- `src/cli.tsx`
- `src/App.tsx`

## Step 1: Create the provider catalog in `src/providers.ts`

This file becomes the source of truth for which providers and models the config flow can offer.

The stage snapshot defines:

- `ModelDetails`
- `ModelProvider`
- `BUILTIN_PROVIDERS`
- `getAllProviders()`

At this stage, the provider list already includes:

- OpenAI
- Google Gemini
- Anthropic Claude

Each model carries:

- `id`
- `name`
- `contextWindow`
- `pricingPerMillionInput`
- `pricingPerMillionOutput`

The pricing fields are not used yet in this part, but adding them here keeps the provider catalog useful for later stages.

## Step 2: Create `src/config.tsx`

This file does three jobs at once:

- config file persistence
- the standalone configure UI
- API key resolution against the merged provider registry

The stage-3 snapshot keeps `config.json` intentionally small:

```ts
export interface Config {
  provider: string;
  model: string;
  apiKey?: string;
}
```

The richer extensibility layer lives in `protoagent.jsonc`, which is loaded separately from the persisted selection file.

Also implement helper functions for:

- `getConfigDirectory()`
- `getConfigPath()`
- `ensureConfigDirectory()`
- `readConfig()`
- `writeConfig()`

At this stage, those helpers can stay synchronous and simple.

## Step 3: Add the configure wizard components

The stage snapshot keeps the config wizard inside `src/config.tsx` itself.

It defines a multi-step flow with these components:

- `InitialLoading`
- `ResetPrompt`
- `ModelSelection`
- `ApiKeyInput`
- `ConfigResult`
- `ConfigureComponent`

That means the file is doing a lot, but it also makes the stage easier to follow because all config-related logic is in one place.

The flow is:

1. check whether a config already exists
2. optionally ask whether to reset it
3. choose a provider/model pair
4. enter the provider-specific API key, or skip it if auth already resolves from env/config
5. write the config file and show success

## Step 4: Update `src/cli.tsx`

Now that you have a configure UI, add a real subcommand:

```ts
program
  .command('configure')
  .description('Configure AI model settings')
  .action(() => {
    render(<ConfigureComponent />);
  });
```

The stage snapshot also adds a basic `--log-level` option even though logging is still primitive.

The default command continues to render `App`.

## Step 5: Update `src/App.tsx` to load config before creating the client

This is the most important behavioral change in the part.

Instead of constructing the client directly from `process.env.OPENAI_API_KEY`, the app now:

1. calls `readConfig()` inside `useEffect()`
2. loads merged `protoagent.jsonc`
3. checks the selected provider in the runtime registry
4. resolves auth and base URL
5. creates the `OpenAI` client only after the config is valid

## Step 6: Fail early when config is missing

If no config exists, show an error in the UI like:

```ts
Configuration not found. Please run `protoagent configure`.
```

That might feel a little blunt, but it is the right behavior for this stage.

## Current implementation note

The current main app has moved beyond this exact structure:

- config is flatter
- runtime providers are merged from built-ins plus `protoagent.jsonc`
- API key resolution can fall back to env vars or provider-level config
- setup can happen inline in the main UI

But this stage is still valuable because it introduces the right mental model: config sits between the CLI, provider selection, and client creation.

## Verification

Run the standalone configure flow:

```bash
npm run dev -- configure
```

Complete the prompts, then start the app normally:

```bash
npm run dev
```

If it worked, you should see:

- a config file created under the local ProtoAgent data directory
- the app loading successfully without hardcoded env-only setup
- prompts being sent through the selected provider/model configuration

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-3`

## Pitfalls

- splitting the provider/model value incorrectly when reading the selection result
- writing config but never actually reading it on app startup
- mismatching provider IDs between `providers.ts` and the app logic
- trying to make this stage too elegant instead of matching the staged snapshot clearly

## Core takeaway

Good config handling is not only about saving JSON. Even at this stage it becomes the glue between:

- the CLI
- provider selection
- API key resolution
- model selection
- client construction

That glue is what the rest of the runtime will depend on.

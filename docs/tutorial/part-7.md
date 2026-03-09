# Part 7: System Prompt & Runtime Policy

The system prompt is where ProtoAgent stops being "a model with tools" and becomes "this specific coding agent with this specific workflow."

That matters more than it sounds.

By the end, your project should match `protoagent-tutorial-again-part-7`.

## What you are building in this part

Starting from Part 6, you are moving runtime instructions out of `App.tsx` and into a dedicated prompt builder.

This stage adds:

- `src/system-prompt.ts`
- directory-tree generation
- tool-description generation from the registry
- a stronger workflow policy for the model

## Starting point

Copy your Part 6 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-7`

## Files to create or change

This stage mainly touches:

- `src/system-prompt.ts`
- `src/App.tsx`
- `src/tools/index.ts` indirectly through prompt generation

## Step 1: Create `src/system-prompt.ts`

The staged snapshot introduces a dedicated prompt generator that:

- finds the current working directory and project name
- builds a filtered directory tree
- reads the currently registered tools
- turns tool schemas into readable tool descriptions

That means the prompt is no longer a static string. It becomes a runtime reflection of the actual environment the model is working in.

## Step 2: Add a filtered directory tree

This part introduces a tree builder with a few practical constraints:

- cap depth
- cap entries per directory
- exclude noise like `node_modules`, `.git`, and build output

That is one of those small choices that saves a lot of prompt budget later.

## Step 3: Generate tool descriptions from the registry

Instead of hand-writing tool descriptions again in the prompt, the stage snapshot reads them from `getAllTools()`.

That keeps the model prompt and the actual tool payload aligned.

## Step 4: Move `App.tsx` to use the generated system prompt

This is the main App-side change.

Instead of defining the system prompt inline, the app should call `generateSystemPrompt()` and use that result as the top system message.

That is the same architectural direction the current main app still uses.

## Verification

Run the app:

```bash
npm run dev
```

Then ask something that should cause the model to explore the repo, like:

```text
Explain the structure of this project.
```

If it worked, you should see:

- the model using file tools more deliberately
- answers that reflect the actual project structure
- less generic behavior than the previous stage

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-7`

## Pitfalls

- generating a directory tree that is too large and wastes context
- hardcoding tool descriptions instead of reading the tool registry
- forgetting to update the top system message after adding the prompt generator
- making the prompt say the runtime can do more than the tools actually support

## Core takeaway

The system prompt is not static documentation. It is a runtime-generated contract between the app, the tool layer, and the model.

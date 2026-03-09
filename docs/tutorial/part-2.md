# Part 2: AI Integration

This is the part where the CLI stops being a terminal shell and starts talking to a model.

The earlier version of this chapter explained the idea. This version needs to be concrete enough that you can actually build the stage.

By the end, your app should match `protoagent-tutorial-again-part-2`.

## What you are building in this part

Starting from the Part 1 shell, you are adding:

- the OpenAI SDK
- environment-based API key loading
- a small `Message` structure
- streaming assistant output in the terminal UI
- basic error handling around model calls

This is still deliberately simple. We are not doing provider abstraction or persisted config yet. That comes next.

## Starting point

Copy your Part 1 result and continue from there.

Your target snapshot for this stage is:

- `protoagent-tutorial-again-part-2`

## Files to change

In this part you only need to change:

- `package.json`
- `src/App.tsx`

`src/cli.tsx` stays effectively the same as Part 1.

## Step 1: Add the runtime dependencies

Add these dependencies to `package.json`:

- `openai`
- `dotenv`

The snapshot for this stage keeps the same scripts as Part 1 and adds those packages to the dependency list.

## Step 2: Load environment variables

At the top of `src/App.tsx`, import:

```ts
import OpenAI from 'openai';
import 'dotenv/config';
```

That gives you a low-friction way to load `OPENAI_API_KEY` from the environment or a local `.env` file.

## Step 3: Replace the plain string message list with structured messages

In Part 1, you were just appending strings. Now switch to a typed message array.

Use a simple interface like this:

```ts
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}
```

Initialize state with a single system message:

```ts
const [messages, setMessages] = useState<Message[]>([
  { role: 'system', content: 'You are ProtoAgent, a helpful AI coding assistant.' },
]);
```

This matters because every later part builds on this role-based message model.

## Step 4: Create a basic OpenAI client

For this stage, keep it very direct:

```ts
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
```

That hardcodes this stage to OpenAI and to a single env var. That is okay for now. Provider abstraction and persisted config belong in Part 3.

## Step 5: Turn submit into a streaming model call

Update `handleSubmit()` so it:

1. appends the user message
2. starts a loading state
3. calls `openai.chat.completions.create()` with `stream: true`
4. creates an empty assistant message in state
5. appends each streamed text chunk into that assistant message

The stage snapshot uses model `gpt-4o-mini` and builds the final assistant text incrementally inside the `for await ... of stream` loop.

That streaming loop is the real point of this chapter. Once you have that working, the UI starts to feel like an actual agent shell instead of a prompt/response toy.

## Step 6: Handle failures in-band

Wrap the API call in `try/catch`.

If something fails, append an assistant message like:

```ts
{ role: 'assistant', content: `Error: ${error.message}` }
```

This is not perfect error design, but it is useful at this stage because you can see failures in the same transcript area as everything else.

## Step 7: Keep the UI simple

The visual structure from Part 1 stays mostly intact.

The main UI changes are:

- render user and assistant messages differently
- hide the system message from the visible transcript
- show a simple `Agent is thinking...` loading state while the stream is active

That is enough for now.

## What the current source does later

The current app is much more capable than this stage:

- it supports multiple providers
- it resolves API keys from config or env vars
- it rebuilds clients from provider metadata
- it streams text and tool calls through a separate loop

But the important idea is unchanged from this early stage: the UI reacts to incremental model output instead of waiting for one big blob.

## Verification

Set an API key and run the app:

```bash
OPENAI_API_KEY=your_key_here npm run dev
```

If you prefer a local `.env` file, make sure it contains:

```bash
OPENAI_API_KEY=your_key_here
```

Then ask something simple in the UI.

If it worked, you should see:

- your prompt added to the message list
- a loading state while the request is in flight
- the assistant response stream in incrementally

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-2`

## Pitfalls

- forgetting to add `dotenv/config` and then wondering why `OPENAI_API_KEY` is undefined
- recreating the assistant message on every chunk instead of updating the last one
- rendering the system message in the transcript and cluttering the UI
- using a non-streaming request and missing the whole point of this stage

## Core takeaway

AI integration is not just "call the model." Even this early version already introduces:

- structured message history
- streamed output
- async UI updates
- error handling around model calls

That is the base layer the rest of the agent runtime will build on.

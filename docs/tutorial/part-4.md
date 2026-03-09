# Part 4: The Agentic Loop

This is the core pattern that makes ProtoAgent an agent instead of a chatbot.

Up to Part 3, the app could send prompts and stream text, but it still only had one move: ask the model for text. In this part, you give the runtime a loop that can let the model request tools, consume tool results, and continue reasoning.

By the end, your project should match `protoagent-tutorial-again-part-4`.

## What you are building in this part

Starting from Part 3, you are adding:

- a reusable `runAgenticLoop()` function
- tool definitions and tool handlers
- a minimal tool registry
- event-based communication from the loop back to the UI
- one real built-in tool: `read_file`

This is the moment ProtoAgent starts acting like an agent runtime.

## Starting point

Copy your Part 3 result and build on top of it.

The target snapshot is:

- `protoagent-tutorial-again-part-4`

## Files to create or change

This part introduces the new runtime pieces:

- `src/agentic-loop.ts`
- `src/tools/index.ts`
- `src/tools/read-file.ts`
- `src/App.tsx`

## Step 1: Create `src/agentic-loop.ts`

This file is the heart of the stage.

It defines:

- `Message`
- `ToolCallEvent`
- `AgentEvent`
- `AgentEventHandler`
- `AgenticLoopOptions`
- `ToolDefinition`

It also owns a simple in-memory tool registry through:

- `registerTool()`
- `registerStaticHandler()`
- `getAllTools()`
- `setStaticTools()`
- `getHandler()`

That registry is deliberately basic in this stage. The important thing is that the loop can ask for the current tool definitions and dispatch a tool call by name.

## Step 2: Implement `runAgenticLoop()`

The stage snapshot follows this flow:

1. start with the current message history plus the new user message
2. call the model with the current messages and tools
3. stream both text and tool call fragments
4. reassemble streamed tool calls by index
5. if the model requested tools, execute them and append tool results
6. if the model returned text, emit `done` and return the updated messages

That streamed reassembly step is the first real "agent runtime" detail in the tutorial. Tool calls do not always arrive as one clean complete object. You have to accumulate them.

## Step 3: Add event emission instead of UI logic in the loop

This is one of the most important design decisions in the whole project.

The loop should not render anything directly. Instead it emits events:

- `text_delta`
- `tool_call`
- `tool_result`
- `error`
- `done`

That keeps `src/agentic-loop.ts` responsible for runtime orchestration and `src/App.tsx` responsible for presentation.

Even in the current main app, that separation is still the right shape.

## Step 4: Create the first tool in `src/tools/read-file.ts`

To make the loop tangible, this stage adds one real built-in tool: `read_file`.

The stage snapshot defines:

- a `readFileTool` schema object
- a `readFile()` implementation

This first version already does a few useful things:

- resolves the path against the working directory
- blocks access outside the working directory
- reads the file content
- applies `offset` and `limit`
- returns line-numbered output

It is intentionally minimal, but it is enough to prove the full model -> tool -> result -> model loop.

## Step 5: Register the tool in `src/tools/index.ts`

This stage's `src/tools/index.ts` is tiny on purpose.

It:

- exports a `tools` array containing `readFileTool`
- calls `registerStaticHandler('read_file', ...)`

That is all you need for the first end-to-end tool-enabled loop.

## Step 6: Update `src/App.tsx` to use the agentic loop

This is where the UI wiring changes in an important way.

In the previous part, `App.tsx` talked to the model directly. Now it should:

1. initialize the client as before
2. call `setStaticTools(tools)` after startup
3. keep a `messagesRef` for the authoritative message history
4. call `runAgenticLoop()` instead of making a direct completion request
5. react to loop events to update live UI state

The stage snapshot introduces:

- `currentResponse`
- `toolCalls`
- `messagesRef`

That lets the UI show in-flight text and tool activity without mixing that temporary display state into the authoritative stored message history.

## Step 7: Render tool activity in the UI

The stage UI does not try to be fancy yet.

It just shows:

- streamed assistant text
- a list of tool calls and their statuses
- a small preview of tool results

That is enough to make the loop visible.

## What the current source does later

The current implementation adds a lot more on top of this:

- a cleaner tool registry
- many more tools
- compaction and usage tracking
- retries and richer error handling
- special handling for sub-agents
- abort behavior

But the basic loop never really changes. The model asks for tools, the runtime executes them, and the model continues until it can answer directly.

## Verification

Run the app and ask it to read a file in the current project.

```bash
npm run dev
```

Then try a prompt like:

```text
Read src/App.tsx and tell me what it does.
```

If it worked, you should see:

- a tool call for `read_file`
- a corresponding tool result
- a final assistant answer that uses the file contents

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-4`

## Pitfalls

- appending the user message twice, once in `App.tsx` and again in the loop
- forgetting to append tool results back into message history
- trying to render directly from the loop instead of emitting events
- not reassembling streamed tool call fragments by index

## Core takeaway

The basic loop is still simple:

1. let the model ask for tools
2. execute the tools
3. feed the results back in
4. stop when the model can answer directly

That pattern is the spine of the rest of the project.

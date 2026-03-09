# Part 10: Sessions

Sessions are what make ProtoAgent feel like a workspace instead of a one-shot demo.

Without them, you close the terminal and lose the whole thread: what the agent learned, what files it touched, what plan it was following, which TODO items were done, and what still needed work.

By the end, your project should match `protoagent-tutorial-again-part-10`.

## What you are building in this part

Starting from Part 9, you are adding:

- a persisted session schema
- save/load helpers
- `--session <id>` support in the CLI
- App-side resume behavior

This is the checkpoint where the tool stops forgetting everything when the process exits.

## Starting point

Copy your Part 9 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-10`

## Files to create or change

This stage centers on:

- `src/utils/sessions.ts`
- `src/cli.tsx`
- `src/App.tsx`

In the staged recreation path, this part still sits on top of the first skills checkpoint from Part 9, so `protoagent-tutorial-again-part-10` contains both the Part 9 skill layer and the new session layer.

## Step 1: Create the session model

The staged session layer should persist at least:

- a session ID
- a title
- timestamps
- provider and model
- message history

In `protoagent-tutorial-again-part-10`, the session file is still simple. It stores a flat `messages` array plus a few metadata fields, which is enough to make resume work reliably.

## Step 2: Implement save/load helpers

Add helpers to:

- create a new session
- save a session to disk
- load a session by ID
- list or summarize sessions if needed by the staged design
- derive a title from the first user message

The staged checkpoint writes sessions under `~/.local/share/protoagent/sessions` on Unix-like systems and uses a basic `crypto.randomUUID()` ID.

## Step 3: Add `--session <id>` in `src/cli.tsx`

This is the first visible CLI-side sign that conversation state is now persistent.

In the recreated checkpoint, this is just a new option on the default command path. No fancy session browser yet - just direct resume by ID.

## Step 4: Update `src/App.tsx` to resume sessions

At startup, the app should now:

- load the config
- initialize the client
- load the requested session if one was provided
- otherwise create a new session

It should also save the session after successful turns.

One practical detail from the staged snapshot: the title is generated from the first user message with a simple truncate-to-60-characters heuristic.

## Verification

Build the stage and run it with a session ID once you have created one:

```bash
npm run build && node dist/cli.js --session your-session-id
```

If it worked, you should see:

- prior messages restored into the transcript
- new turns appended and re-saved
- a stable sense of conversation continuity across restarts

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-10`

## Pitfalls

- saving a new session but never reloading it into App state
- not creating the sessions directory before the first save
- invalid session IDs leading to bad file paths later if you harden the implementation
- restoring old messages but not the right top-level runtime state
- generating titles too late or not at all

## Core takeaway

Sessions are not just storage. They are what let a long-running coding task survive real life.

# Part 6: Shell Commands

Sometimes the agent needs to run a command -- `npm test`, `git status`, `grep` for something. But you probably don't want it running `rm -rf /` or `sudo` anything. This part adds a shell tool with a three-tier security model.

## What you'll build

- A `bash` tool that executes shell commands
- A safe-command whitelist (auto-approved), dangerous-command blocklist (blocked), and everything else (asks for approval)
- Session-based approval persistence -- approve a command once, or approve it for the whole session
- The `--dangerously-accept-all` CLI flag

## Key concepts

- **Command classification** -- simple pattern matching to sort commands into safe, dangerous, and needs-approval buckets.
- **Session memory** -- if you approve `npm test` once during a session, you probably don't want to be asked again every time.
- **Timeout handling** -- long-running commands need sensible timeouts so the agent doesn't hang forever.

## The three tiers

The bash tool uses a tiered security model. Every command the agent wants to run falls into exactly one of three buckets:

1. **Hard-blocked** -- the command is outright refused. No override, no flag, no way around it. `rm -rf /` never runs.
2. **Auto-approved** -- the command is known to be safe. `ls`, `git status`, `grep` -- read-only stuff. These run without asking.
3. **Needs approval** -- everything else. The user gets prompted: approve once, approve for the session, or reject.

This is a simple model, and that's the point. You could build something fancier -- sandboxed execution, fine-grained permissions, static analysis of the command -- but for a coding agent that runs on your local machine, three tiers gets you surprisingly far. The dangerous stuff is blocked, the safe stuff is fast, and everything in between gets a human check.

Here's the tool definition in `src/tools/bash.ts`:

```typescript
export const bashTool = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description:
      'Execute a shell command. Safe commands (ls, grep, git status, etc.) run automatically. ' +
      'Other commands require user approval. Some dangerous commands are blocked entirely.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 30000 (30s).' },
      },
      required: ['command'],
    },
  },
};
```

The description tells the LLM what to expect. If a command gets blocked or needs approval, the agent gets an error message back explaining what happened -- it doesn't just silently fail.

## Dangerous commands

The blocklist is deliberately short:

```typescript
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'sudo',
  'su ',
  'chmod 777',
  'dd if=',
  'mkfs',
  'fdisk',
  'format c:',
];
```

The check is straightforward -- lowercase the command and see if it includes any of these strings:

```typescript
function isDangerous(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}
```

You might look at this and think "that's not very thorough." And you'd be right -- an adversarial user could get around it. But we're not defending against adversarial users. We're defending against an LLM that occasionally has bad ideas. The model isn't trying to hack you; it just sometimes reaches for `sudo` when it doesn't need to, or tries to `rm -rf` a directory and gets the path wrong.

Pattern matching catches the common mistakes. That's good enough for this use case. If you wanted something more robust, you'd move to a container-based execution model -- but that's a whole different project.

Note the trailing space in `'su '` -- that's intentional. Without it, you'd block any command containing the letters "su" anywhere, like `suspend` or `supabase`. The space ensures we're matching the actual `su` command.

## Safe commands

The whitelist is the opposite side of the coin -- commands that are safe enough to run without asking:

```typescript
const SAFE_COMMANDS = [
  'ls', 'dir', 'pwd', 'whoami', 'date', 'echo', 'cat', 'head', 'tail',
  'grep', 'rg', 'find', 'wc', 'sort', 'uniq', 'cut', 'awk', 'sed',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote',
  'npm list', 'npm ls', 'yarn list',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
  'which', 'type', 'file', 'tree',
];
```

The matching logic is a little more nuanced than the blocklist. There are two kinds of entries in this list -- single-word commands like `ls` and multi-word commands like `git status` -- and they need different matching strategies:

```typescript
function isSafe(command: string): boolean {
  const trimmed = command.trim();
  const firstWord = trimmed.split(/\s+/)[0];

  return SAFE_COMMANDS.some((safe) => {
    if (safe.includes(' ')) {
      // Multi-word safe command: check prefix (git status works, but git push doesn't)
      return trimmed.startsWith(safe);
    }
    // Single-word: exact match on first word (ls is safe, but lsblk is not)
    return firstWord === safe;
  });
}
```

For single-word entries, we check whether the *first word* of the command matches. So `ls -la /tmp` is safe because the first word is `ls`. We don't just check `startsWith` here, because that would make `lsblk` safe too.

For multi-word entries like `git status`, we check whether the command *starts with* that prefix. So `git status --short` is safe, but `git push --force` is not -- `git push` isn't in the list.

This means `git` by itself is *not* auto-approved. Only specific git subcommands are. The agent can read git state all day long, but anything that mutates the repo -- `git commit`, `git push`, `git checkout` -- goes through the approval flow. Same idea for `npm`: `npm list` is fine, `npm install` needs a human nod.

One thing to notice: `sed` and `awk` are in the safe list. These *can* modify files (with `-i`), so you might argue they shouldn't be auto-approved. It's a judgment call. In practice, the agent uses them for text processing in pipelines, not file mutation, and prompting for every `grep | awk` pipeline would be painful. If this bothers you, pull them out.

## The approval system

When a command isn't blocked and isn't safe, it needs approval. The approval system lives in `src/utils/approval.ts` and is designed to be UI-agnostic -- it doesn't know about Ink, React, or terminals.

Here are the core types:

```typescript
export type ApprovalRequest = {
  id: string;
  type: 'file_write' | 'file_edit' | 'shell_command';
  description: string;
  detail?: string;
};

export type ApprovalResponse = 'approve_once' | 'approve_session' | 'reject';
```

The `type` field is important -- it's not just for display. It's the key used for session-level approvals. More on that in a moment.

The approval system keeps a small amount of state:

```typescript
let dangerouslyAcceptAll = false;
const sessionApprovals = new Set<string>();
let approvalHandler: ((req: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;
```

Three things: a global override flag, a set of approved operation types for the current session, and a callback function that the UI provides. That callback is the key design decision here.

### Why a callback instead of inquirer

You might expect something like `inquirer` or `readline` -- block on stdin, wait for the user to type `y` or `n`. That doesn't work with Ink. Ink owns the terminal. It's rendering React components, managing state, handling input. If you try to grab stdin from underneath it with inquirer, things break.

Instead, the approval system uses dependency injection. The Ink UI registers a handler function at startup:

```typescript
export function setApprovalHandler(
  handler: (req: ApprovalRequest) => Promise<ApprovalResponse>
): void {
  approvalHandler = handler;
}
```

When an approval is needed, the system calls this handler and awaits the Promise. The handler -- which lives in the UI layer -- can show a prompt component, wait for the user to press a key, and resolve the Promise. The approval system never touches the terminal directly.

### The check chain

The `requestApproval` function runs through a chain of checks before actually prompting the user:

```typescript
export async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (dangerouslyAcceptAll) return true;

  const sessionKey = req.type;
  if (sessionApprovals.has(sessionKey)) return true;

  if (!approvalHandler) {
    return true;
  }

  const response = await approvalHandler(req);

  switch (response) {
    case 'approve_once':
      return true;
    case 'approve_session':
      sessionApprovals.add(sessionKey);
      return true;
    case 'reject':
      return false;
  }
}
```

Four steps, in order:

1. If `--dangerously-accept-all` is set, approve everything. No questions asked.
2. If the operation *type* has been session-approved (e.g., `shell_command`), approve it.
3. If there's no handler registered -- meaning we're in a non-interactive context like tests -- auto-approve. This is a pragmatic choice: you don't want your test suite hanging on approval prompts.
4. Otherwise, call the handler and let the UI deal with it.

## Running the command

Once a command is approved (or auto-approved), we actually execute it. The execution uses Node's `spawn` with `shell: true`:

```typescript
const child = spawn(command, [], {
  shell: true,
  cwd: process.cwd(),
  env: { ...process.env },
  stdio: ['pipe', 'pipe', 'pipe'],
});
```

`shell: true` means the command gets interpreted by the system shell -- `/bin/sh` on Unix, `cmd.exe` on Windows. This is what lets the agent run pipelines like `grep -r "TODO" src | wc -l`. Without `shell: true`, you'd need to parse the command yourself and set up the pipes manually.

Output capture is straightforward -- accumulate stdout and stderr as data events come in:

```typescript
child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });
```

### Timeout handling

Long-running commands get a two-stage timeout. First, SIGTERM -- a polite "please stop." If the process is still alive two seconds later, SIGKILL -- no more asking:

```typescript
const timer = setTimeout(() => {
  timedOut = true;
  // SIGTERM gives the process a chance to clean up, then SIGKILL forces termination
  child.kill('SIGTERM');
  setTimeout(() => child.kill('SIGKILL'), 2000);
}, timeoutMs);
```

The default timeout is 30 seconds. The agent can override this per-call with the `timeout_ms` parameter -- useful for something like `npm test` that might legitimately take a while.

When a timeout fires, the agent still gets partial output -- up to 5000 chars of stdout and 2000 chars of stderr. Enough to see what was happening when it died.

### Output truncation

Commands like `cat` on a large file can produce huge output. We cap it at 50,000 characters:

```typescript
const maxLen = 50_000;
const truncatedStdout = stdout.length > maxLen
  ? stdout.slice(0, maxLen) + `\n... (output truncated, ${stdout.length} chars total)`
  : stdout;
```

The truncation message includes the total character count, so the agent knows it's not seeing everything. It can then adjust -- maybe `head -100` instead of `cat`, or `grep` for the specific thing it's looking for.

One subtle detail: the function always `resolve`s, never `reject`s. Even errors and timeouts return a string. This is intentional -- a failed command isn't a crash, it's information. The agent gets the error message, the exit code, the stderr, and it can decide what to do next. Maybe the test failed and it needs to fix something. Maybe the command doesn't exist and it should try an alternative.

## Session memory

When the user approves a command with "approve for session," the approval type gets added to a `Set`:

```typescript
case 'approve_session':
  sessionApprovals.add(sessionKey);
  return true;
```

The session key is `req.type` -- so for shell commands, it's the string `'shell_command'`. This means approving one shell command for the session approves *all* shell commands for the session. That's a broad grant, and it's intentional. If you're working with an agent and you've approved `npm test`, you probably also want `npm run build` to go through without asking. If you don't want that, approve once instead.

The `clearSessionApprovals()` function resets the set. You'd call this when starting a new conversation or resetting the agent state.

Then there's the nuclear option: `--dangerously-accept-all`. It sets a boolean flag that bypasses every approval check -- file writes, file edits, shell commands, everything. The name is deliberately scary. It's useful for demos and for when you trust the agent completely, but it should make you pause before you use it.

Note that even `--dangerously-accept-all` doesn't override the dangerous command blocklist. That's Layer 1 -- the hard block in `runBash` happens *before* the approval check. `sudo` is never going to run, no matter what flags you pass.

## Wiring it up: CLI and UI

The approval handler is registered in `src/App.tsx` during component initialization:

```typescript
useEffect(() => {
  // Register approval handler for the approval system
  setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
    return new Promise((resolve) => {
      setApprovalRequest(req);
      setApprovalResolve(() => resolve);
    });
  });

  // Set dangerously-accept-all flag if passed in options
  if (options.dangerouslyAcceptAll) {
    setDangerouslyAcceptAll(true);
  }
  
  // ... rest of config loading
}, [options.dangerouslyAcceptAll]);
```

The CLI in `src/cli.tsx` offers the flag:

```typescript
program
  .description('A simple coding agent CLI')
  .version(packageJson.version)
  .option('--log-level <level>', 'Set log level (DEBUG, INFO, WARN, ERROR)', 'INFO')
  .option('--dangerously-accept-all', 'Auto-approve all file writes, edits, and shell commands (use with caution)');
```

The approval UI renders a modal with a text input for the user's choice:

```typescript
const renderApprovalModal = () => {
  if (!approvalRequest) return null;

  const handleApprove = (response: ApprovalResponse) => {
    if (approvalResolve) {
      approvalResolve(response);
    }
    setApprovalRequest(null);
    setApprovalResolve(null);
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text bold color="yellow">⚠️  Approval Required</Text>
      <Text> </Text>
      <Text>{approvalRequest.description}</Text>
      {approvalRequest.detail && (
        <Box marginY={0} flexDirection="column" paddingLeft={2}>
          <Text dimColor>{approvalRequest.detail}</Text>
        </Box>
      )}
      <Text> </Text>
      <Text color="green">
        [a] Approve once | [s] Approve for session | [r] Reject
      </Text>
      <TextInput
        placeholder="Choose (a/s/r): "
        onSubmit={(value) => {
          const choice = value.trim().toLowerCase()[0];
          if (choice === 'a') handleApprove('approve_once');
          else if (choice === 's') handleApprove('approve_session');
          else if (choice === 'r') handleApprove('reject');
        }}
        isDisabled={false}
      />
    </Box>
  );
};
```

## Test it out

Run the development server:

```bash
npm run dev
```

Try asking the agent to run a test:

```
> run npm test
```

You should see an approval prompt asking whether to approve the command. You have three choices:

- **[a] Approve once** — runs this one command, but the next unapproved command will prompt again
- **[s] Approve for session** — runs this command and all future shell commands without asking
- **[r] Reject** — blocks this command, agent gets an error and can try something else

Try with the `--dangerously-accept-all` flag to skip all prompts:

```bash
npm run dev -- --dangerously-accept-all
```

Now shell commands run immediately. Try:

```
> npm list
> git status
> ls -la
```

But try to run something dangerous:

```
> sudo rm -rf /
```

Even with `--dangerously-accept-all`, this gets blocked at Layer 1. You'll see:

```
Error: Command blocked for security reasons: "sudo rm -rf /"
```

## Summary

You now have shell command execution with tiered security:

- **Hard-blocked commands** (rm -rf /, sudo, etc.) never run, no matter what
- **Safe commands** (ls, grep, git status, npm list, etc.) run automatically
- **Everything else** requires user approval: once, for the session, or rejected
- **Session memory** means approving once approves the whole category for the session
- **Timeout handling** prevents hung processes
- **Output truncation** prevents flooding the context window
- **Atomic error messages** let the agent recover from failed commands

The agent can now run tests, check git status, list directories, and more -- all under your control.

---

Next up: [Part 7: System Prompt](./part-7.md) -- where we teach the agent who it is, what project it's working in, and how to behave.

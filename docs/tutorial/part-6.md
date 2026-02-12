# Part 6: Shell Commands

Sometimes the agent needs to run a command — `npm test`, `git status`, `grep` for something. But you probably don't want it running `rm -rf /` or `sudo` anything. This part adds a shell tool with a three-tier security model.

## What you'll build

- A `bash` tool that executes shell commands
- A safe-command whitelist (auto-approved), dangerous-command blocklist (blocked), and everything else (asks for approval)
- Session-based approval persistence — approve a command once, or approve it for the whole session
- The `--dangerously-accept-all` CLI flag

## Key concepts

- **Command classification** — simple pattern matching to sort commands into safe, dangerous, and needs-approval buckets.
- **Session memory** — if you approve `npm test` once during a session, you probably don't want to be asked again every time.
- **Timeout handling** — long-running commands need sensible timeouts so the agent doesn't hang forever.

::: warning
This part is not yet written. See the [specification](/reference/spec) for the full design.
:::

# Setting up ProtoAgent with GitHub Copilot

ProtoAgent can use the GitHub Copilot API as a provider. This requires a valid OAuth token from an active Copilot subscription.

## Where the token comes from

If you use OpenCode, it stores a refreshed OAuth token at:

```
~/.local/share/opencode/auth.json
```

The relevant field is `github-copilot.access`:

```json
{
  "github-copilot": {
    "type": "oauth",
    "access": "gho_xxxxxxxxxxxxxxxxxxxx",
    ...
  }
}
```

Open OpenCode once to let it refresh the token if it has expired, then copy the `access` value.

## Config file

Write the following to your user config at `~/.config/protoagent/protoagent.jsonc` (macOS/Linux), replacing `<token>` with the value from `auth.json`:

```jsonc
{
  "providers": {
    "copilot": {
      "name": "GitHub Copilot",
      "baseURL": "https://api.githubcopilot.com",
      "apiKey": "none",
      "headers": {
        "Authorization": "Bearer <token>",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "Editor-Version": "vscode/1.99.3",
        "Editor-Plugin-Version": "copilot-chat/0.26.7"
      },
      "models": {
        "claude-sonnet-4.6": {
          "name": "Claude Sonnet 4.6",
          "contextWindow": 200000,
          "inputPricePerMillion": 3.0,
          "outputPricePerMillion": 15.0
        }
      }
    }
  },
  "mcp": {
    "servers": {}
  }
}
```

## Running as root

When run as root (e.g. `sudo protoagent`), ProtoAgent looks for config in `/root/.config/protoagent/protoagent.jsonc`. The easiest options are:

**Copy the config into root's home:**

```bash
sudo mkdir -p /root/.config/protoagent
sudo cp ~/.config/protoagent/protoagent.jsonc /root/.config/protoagent/protoagent.jsonc
```

**Or use a project-local config** — place `protoagent.jsonc` in `.protoagent/` inside your working directory. ProtoAgent always checks `<cwd>/.protoagent/protoagent.jsonc` first, regardless of which user is running it:

```bash
mkdir -p .protoagent
cp ~/.config/protoagent/protoagent.jsonc .protoagent/protoagent.jsonc
```

## When the token expires

The error `401 unauthorized: token expired` means the OAuth token has rotated. To fix:

1. Open OpenCode — it will refresh the token automatically
2. Copy the new `access` value from `~/.local/share/opencode/auth.json`
3. Update the `Authorization` header in your `protoagent.jsonc`

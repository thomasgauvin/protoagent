# ProtoAgent Worker

ProtoAgent running on Cloudflare Workers with a browser-based terminal UI. Uses Workers AI for inference with daily message quotas.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run locally:**
   ```bash
   npm run dev
   ```

3. **Open in browser:**
   Navigate to `http://localhost:8787`

## Configuration

Create a `.dev.vars` file with your settings:

```bash
# Required - your Cloudflare Account ID
CF_ACCOUNT_ID=your-account-id-here

# Optional - Workers AI model (default: @cf/zai-org/glm-4.7-flash)
MODEL=@cf/zai-org/glm-4.7-flash

# Optional - daily message quota per session (default: 50)
DAILY_MESSAGE_QUOTA=50
```

### Daily Quota

Each session is limited to **50 messages per day** by default. Quotas reset at midnight UTC. Check remaining quota with the `/quota` command.

## Architecture

```
┌─────────────────────────────────────────┐
│  ProtoAgent ASCII Banner (bright green) │
│  Model: Workers AI / glm-4.7-flash      │
│  Quota: 50/50 messages remaining        │
├─────────────────────────────────────────┤
│  Browser (ghostty-web terminal)         │
│  ↕ WebSocket                            │
│  Cloudflare Worker                      │
│  ↕                                      │
│  Durable Object (AgentSession)          │
│  - SQLite persistence                   │
│  - Daily quota tracking                 │
│  - Workers AI inference                 │
└─────────────────────────────────────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear conversation history |
| `/history` | Show message count |
| `/quota` | Show remaining daily quota |

## Features

- **Workers AI**: Uses Cloudflare's edge AI with no API keys needed
- **SQLite Persistence**: Conversation history saved in Durable Object
- **CRT Terminal Aesthetic**: Green monochrome theme matching ProtoAgent docs
- **WebSocket Multi-client**: Multiple browsers can connect to same session

## Credits

Built with [Pi Worker](https://github.com/qaml-ai/pi-worker) - the WebSocket-based agent runtime for Cloudflare Workers.

# @protoagent/tui

OpenTUI-based terminal interface for ProtoAgent.

## Requirements

- **Bun** (required for OpenTUI) - Install from https://bun.sh
- Node.js (for building TypeScript)

## Running

```bash
# Terminal 1: Start the server (Node.js)
cd packages/protoagent-core
npm run dev

# Terminal 2: Start the TUI (requires Bun)
cd packages/protoagent-tui
npm run dev

# Or with API key
bun run dist/cli.js -k $OPENAI_API_KEY
```

## Why Bun?

OpenTUI uses a native Zig core that is compiled for Bun's runtime. It cannot run on Node.js.

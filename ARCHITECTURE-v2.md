# ProtoAgent v2 Architecture

This document describes the new client-server architecture for ProtoAgent, inspired by OpenCode.

## Overview

ProtoAgent v2 splits the application into three distinct packages:

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT LAYER                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  @protoagent/tui                                        │   │
│  │  - OpenTUI-based terminal interface                     │   │
│  │  - Real-time event streaming via SSE                    │   │
│  │  - Keyboard/mouse handling                              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ HTTP + SSE (Server-Sent Events)
┌─────────────────────────────────────────────────────────────────┐
│                       SERVER LAYER                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  @protoagent/core                                       │   │
│  │  ├─ Hono HTTP server                                    │   │
│  │  ├─ SSE event streaming (/events)                       │   │
│  │  ├─ Agent execution engine                              │   │
│  │  ├─ Tool registry (sync + MCP)                          │   │
│  │  ├─ Session management                                  │   │
│  │  └─ Typed event bus (pub/sub)                           │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Key Changes from v1

### 1. Client-Server Separation

The UI (TUI) and core agent logic now run as separate processes:
- **Server** (`@protoagent/core`): Runs the agent loop, tool execution, LLM calls
- **Client** (`@protoagent/tui`): Handles all user interaction, renders the UI

Benefits:
- Multiple clients can connect to the same session (future: web UI, desktop app)
- UI can be restarted without losing agent state
- Headless server mode for CI/automation

### 2. OpenTUI Rendering

Replaced Ink with OpenTUI:
- Native Zig-based rendering core (faster, less flickering)
- Flexbox layout engine (Yoga)
- Better terminal compatibility
- Rich components: ScrollBox, Input, Text with styling

### 3. Parallel Sub-Agents

Sub-agents now execute in parallel:
```typescript
// When model returns multiple tool calls including sub_agent
const regularToolCalls = toolCalls.filter(t => t.name !== 'sub_agent');
const subAgentCalls = toolCalls.filter(t => t.name === 'sub_agent');

// Execute all in parallel
await Promise.all([
  ...regularToolCalls.map(t => executeTool(t)),
  ...subAgentCalls.map(t => runSubAgent(t)),
]);
```

Benefits:
- Faster completion of multi-part tasks
- Independent exploration of different code areas
- Better utilization of API rate limits

### 4. Event-Driven Architecture

Typed event bus for all communication:
```typescript
// Server emits events
eventBus.emit(TextDeltaEvent.create({ sessionId, content: 'Hello' }));
eventBus.emit(ToolCallEvent.create({ sessionId, toolCallId, name, args }));
eventBus.emit(SubAgentCompleteEvent.create({ sessionId, subAgentId, response }));

// Client subscribes via SSE
const events = new EventSource('/events?sessionId=abc123');
events.onmessage = (e) => {
  const event = JSON.parse(e.data);
  updateUI(event);
};
```

## Package Structure

```
packages/
├── protoagent-core/
│   ├── src/
│   │   ├── server/
│   │   │   └── server.ts          # Hono HTTP server + SSE
│   │   ├── agent/
│   │   │   ├── agent-service.ts   # Main agent loop
│   │   │   ├── session-service.ts # Session persistence
│   │   │   └── system-prompt.ts   # Prompt generation
│   │   ├── bus/
│   │   │   ├── bus-event.ts       # Typed event definitions
│   │   │   └── event-bus.ts       # Pub/sub implementation
│   │   ├── tools/
│   │   │   ├── tool-registry.ts   # Tool definitions
│   │   │   ├── file-tools.ts      # File operations
│   │   │   ├── bash-tool.ts       # Shell execution
│   │   │   └── other-tools.ts     # Todos, webfetch
│   │   └── utils/
│   │       └── cost-tracker.ts
│   └── package.json
│
└── protoagent-tui/
    ├── src/
    │   ├── cli.ts                 # Entry point
    │   ├── app.tsx                # OpenTUI app
    │   └── client.ts              # SSE client
    └── package.json
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| GET | `/events` | SSE event stream |
| POST | `/sessions` | Create session |
| GET | `/sessions` | List sessions |
| GET | `/sessions/:id` | Get session |
| DELETE | `/sessions/:id` | Delete session |
| POST | `/agent/run` | Start agent loop |
| POST | `/agent/abort/:id` | Abort session |
| POST | `/tools/:name` | Execute tool directly |

## Event Types

### Agent Events
- `agent.text_delta` — Streaming text from LLM
- `agent.tool_call` — Tool call initiated
- `agent.tool_result` — Tool execution result
- `agent.complete` — Agent loop finished
- `agent.error` — Error occurred

### Sub-Agent Events
- `agent.sub_agent.start` — Sub-agent spawned
- `agent.sub_agent.progress` — Sub-agent tool execution
- `agent.sub_agent.complete` — Sub-agent finished

### Session Events
- `session.created` — New session created
- `session.updated` — Session messages updated

## Running the New Architecture

```bash
# Terminal 1: Start the server
npm run server

# Terminal 2: Run the TUI
npm run tui

# Or directly
npx @protoagent/tui --server http://localhost:3001
```

## Migration from v1

The v1 codebase (src/) remains functional but is considered legacy. To migrate:

1. Install new packages: `npm install`
2. Start server: `npm run server`
3. Use new TUI: `npm run tui`

The old CLI continues to work as a single-process alternative.

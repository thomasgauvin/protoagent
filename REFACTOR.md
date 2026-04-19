# ProtoAgent Web API Refactor

## Overview

Make ProtoAgent accessible via REST API for a web UI. Each deployment serves a **single user** running in its own container. Multi-user scenarios are handled at the infrastructure level (separate containers per user), not in the application code.

## Architecture Principle

**One container = One user = One global state**

This eliminates session isolation complexity. We use the existing global singletons as-designed.

## Simplified Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      PROTOAGENT CONTAINER                    │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│   ┌─────────────┐        ┌─────────────┐        ┌────────┐  │
│   │   Web UI    │        │   Web UI    │        │  CLI   │  │
│   │   (Tab 1)   │        │   (Tab 2)   │        │        │  │
│   └──────┬──────┘        └──────┬──────┘        └───┬────┘  │
│          │                      │                   │       │
│          └──────────────────────┼───────────────────┘       │
│                                 │                           │
│                                 ▼                           │
│                    ┌─────────────────────────┐              │
│                    │     REST API Server     │              │
│                    │      (src/api/)         │              │
│                    └───────────┬─────────────┘              │
│                                │                            │
│                                ▼                            │
│   ┌─────────────────────────────────────────────────────┐  │
│   │              ProtoAgent Core (unchanged)             │  │
│   │                                                      │  │
│   │  • defaultRegistry (global tools)                    │  │
│   │  • defaultMcpManager (global MCP)                    │  │
│   │  • sessions.ts (persistence)                         │  │
│   │  • agentic-loop.ts                                   │  │
│   │  • workflow/manager.ts                               │  │
│   │  • skills.ts                                         │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## State Ownership

### Global (Shared)

- defaultRegistry (all tools)
- defaultMcpManager (MCP connections)
- skills (loaded once)
- providers
- approvalManager

### Per-Session (Conversation)

- messages (conversation history)
- todos
- workflowState
- queuedMessages

## Active Session Pattern

Only one session is active at a time. Starting a new session aborts any running loop in the previous session.

## API Endpoints

### Sessions

- GET /sessions - list all sessions
- POST /sessions - create new session
- GET /sessions/:id - get session (activates it)
- DELETE /sessions/:id - delete session

### Messaging

- POST /sessions/:id/messages - send message, starts agent loop
- GET /sessions/:id/events - SSE stream of agent events
- POST /abort - abort current loop

### Approvals

- GET /approvals - list pending approvals
- POST /approvals/:id - submit approval decision

### Workflow

- GET /workflow - get current workflow state
- POST /workflow - switch workflow type
- POST /workflow/start - start loop workflow
- POST /workflow/stop - stop loop workflow

### TODOs

- GET /todos - get todos for active session
- PUT /todos - update todos

### Skills

- GET /skills - list available skills
- POST /skills/:name/activate - activate skill globally

### MCP

- GET /mcp/status - get MCP connection status
- POST /mcp/reconnect - reconnect all MCP servers

## Implementation Phases

### Phase 1: API Server Scaffold

- Create src/api/server.ts with Hono
- Add SSE support
- Mount routes
- Create src/api/cli.ts entry point

### Phase 2: Session Routes

- GET /sessions (list)
- POST /sessions (create)
- GET /sessions/:id (load)
- DELETE /sessions/:id (delete)
- Active session management

### Phase 3: Messaging

- POST /sessions/:id/messages
- GET /sessions/:id/events (SSE)
- POST /abort
- Event streaming integration

### Phase 4: Approvals

- Refactor approval manager for async
- GET /approvals
- POST /approvals/:id
- approval_required event

### Phase 5: Remaining Routes

- Workflow control
- TODO management
- Skills
- MCP status

## File Structure

```
src/
  api/
    server.ts           # Hono server
    cli.ts              # API server entry
    routes.ts           # Route handlers
    sse.ts              # SSE utilities
    state.ts            # Active session tracking
  
  # Existing code unchanged
  cli.ts
  tui/
  agentic-loop.ts
  sessions.ts
  tools/
  mcp/
  workflow/
  ...
```

## Multi-Container Deployment

For multiple users, deploy multiple containers with separate volumes and API keys.

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Single global state | One user per container |
| One active session | Matches CLI behavior, simplifies abort/SSE |
| Sessions are conversations | Just history persistence, not isolation |
| Shared tools/MCP | All sessions see same capabilities |
| Container-level multi-tenancy | Infrastructure handles user separation |

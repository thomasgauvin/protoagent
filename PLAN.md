# ProtoAgent: Porting Plan

This document lays out the plan for porting `protoagent-coding-agent-cli`
to `protoagent` (Ink-based), and what's missing compared to production
agents (OpenCode, Codex, pi-mono).

---

## Current State

### What already exists in `protoagent` (the new Ink port)

- [x] CLI scaffolding with Commander (`cli.tsx`)
- [x] Ink-based terminal UI with welcome banner and text input (`App.tsx`)
- [x] Streaming chat completions via OpenAI SDK (text-only, no tools)
- [x] Configuration wizard: model selection, API key input, persistence (`config.tsx`)
- [x] Provider definitions with model metadata (`providers.ts`)
- [x] Tutorial docs for Parts 1-3 (`DIY_PROTOAGENT_TUTORIAL/`)

### What exists in `protoagent-coding-agent-cli` (the original) but NOT yet ported

- [ ] **Agentic loop** -- the core tool-use loop (`agentic-loop.ts`)
- [ ] **Tool system** -- 10 tools with registry and dispatcher (`tools/`)
- [ ] **System prompt** -- dynamic prompt with project context and tool descriptions
- [ ] **Cost tracking** -- token estimation, cost calculation, context utilisation
- [ ] **Conversation compaction** -- auto-summarise when context hits 90%
- [ ] **File operation approval** -- user confirmation for writes/edits
- [ ] **Shell command security** -- safe whitelist, dangerous command blocking, session approval
- [ ] **Logger** -- configurable log levels with coloured output
- [ ] **`--dangerously-accept-all` flag**
- [ ] **Retry logic** -- exponential backoff for 429/5xx API errors
- [ ] **TODO tool** -- in-memory task tracking for the agent

---

## Porting Plan (Tutorial Parts)

Each part corresponds to a tutorial chapter. The ordering is designed so
the reader builds up from nothing to a working agent, with each step
producing a runnable program.

### Part 4: The Agentic Loop

**Goal**: Transform the chatbot into an agent by adding tool-calling support.

**What to build**:
1. Create `src/agentic-loop.ts` -- an `AgenticLoop` class (or function) that:
   - Maintains a `messages` array (OpenAI message format)
   - Calls the LLM with `tools` and `tool_choice: 'auto'`
   - Streams the response, accumulating tool call arguments across chunks
   - When tool_calls are present: execute each tool, append results, loop
   - When no tool_calls: display the text response, stop
   - Has a max-iterations safety limit
2. Create `src/tools/index.ts` -- tool registry with a `handleToolCall` dispatcher
3. Start with ONE tool to prove the loop works: `read_file`
4. Wire the loop into `App.tsx` -- replace the direct `openai.chat.completions.create`
   call with the agentic loop
5. Display tool calls and results in the Ink UI (tool name, abbreviated output)

**Key design decision**: The agentic loop should be a plain TypeScript
module, not an Ink component. The Ink component calls into it and uses
React state to render progress. This keeps the core logic testable without
the UI.

**Porting from original**: `agentic-loop.ts` (338 lines), `tools/index.ts`
(121 lines), `tools/read-file.ts`.

**Tutorial content**: Explain the tool-use loop pattern. Show the OpenAI
message format for tool calls. Walk through streaming chunk accumulation.

### Part 5: File Tools

**Goal**: Give the agent the ability to read, write, edit, and search files.

**What to build**:
1. `src/tools/read-file.ts` -- read with offset/limit, path validation
2. `src/tools/write-file.ts` -- create/overwrite with approval
3. `src/tools/edit-file.ts` -- find-and-replace with approval
4. `src/tools/list-directory.ts` -- directory listing
5. `src/tools/search-files.ts` -- recursive text search
6. Path validation utility: resolve path, check it's within `cwd()`, handle symlinks
7. Wire all tools into the registry

**Porting from original**: `tools/read-file.ts`, `tools/write-file.ts`,
`tools/edit-file.ts`, `tools/list-directory.ts`, `tools/search-files.ts`,
`tools/create-directory.ts`, `tools/view-directory-tree.ts`.

**Simplification**: Combine `list_directory`, `create_directory`, and
`view_directory_tree` into fewer tools. The original has 10 tools; we
should aim for ~7 by merging the directory tools.

**Tutorial content**: Explain path security. Show how each tool definition
maps to an OpenAI function schema. Walk through the edit tool's
find-and-replace logic.

### Part 6: Shell Command Execution

**Goal**: Let the agent run shell commands safely.

**What to build**:
1. `src/tools/bash.ts` -- execute commands with:
   - Safe command whitelist (ls, find, grep, git status, cat, etc.)
   - Dangerous command detection (rm -rf, etc.)
   - User approval for non-safe commands
   - Timeout with configurable limit
   - Output capture and truncation
2. Session-based approval: "approve once" vs "approve for session"
3. `--dangerously-accept-all` CLI flag

**Porting from original**: `tools/run-shell-command.ts`,
`utils/file-operations-approval.ts`.

**Tutorial content**: Explain why unrestricted shell access is dangerous.
Walk through the whitelist approach. Show the approval flow.

### Part 7: System Prompt & Project Context

**Goal**: Make the agent aware of the project it's working in.

**What to build**:
1. `src/system-prompt.ts` -- generate a system prompt that includes:
   - Role and behavioural instructions
   - Working directory and project name
   - Filtered directory tree (depth 3, excluding node_modules etc.)
   - Auto-generated tool descriptions from the tool schemas
   - Guidelines for when to use edit vs write, TODO tracking, etc.
2. Call this at agent startup and inject as the system message

**Porting from original**: `config/system-prompt.ts` (317 lines).

**Tutorial content**: Explain why system prompts matter. Show how project
context helps the agent navigate. Discuss prompt engineering trade-offs
(detail vs token cost).

### Part 8: Conversation Compaction & Cost Tracking

**Goal**: Handle long conversations without hitting context limits.

**What to build**:
1. `src/utils/cost-tracker.ts` -- estimate tokens (~4 chars/token), calculate
   cost based on model pricing, track context utilisation
2. `src/utils/conversation-compactor.ts` -- when context hits 90%:
   - Call the LLM with a summary prompt
   - Replace old messages with a compact summary
   - Continue the conversation
3. Display cost and context info after each LLM call

**Porting from original**: `utils/cost-tracker.ts`, `utils/conversation-compactor.ts`.

**Tutorial content**: Explain context windows and why compaction matters.
Show the summarisation prompt. Discuss alternatives (sliding window,
message pruning).

### Part 9: Polish & UI Improvements

**Goal**: Make the tool usable for real work.

**What to build**:
1. Improve Ink UI:
   - Show tool calls with name and status (running/done/error)
   - Show abbreviated tool results
   - Markdown rendering for assistant responses (use `ink-markdown` or a
     simple renderer)
   - Scrollable message history
   - Loading spinner while the agent is thinking
2. Add a `--log-level` CLI flag with configurable verbosity
3. Error recovery: if a tool fails, feed the error to the model
4. Update provider list with current models

**Tutorial content**: Explain the Ink rendering model. Show how to build
custom terminal UI components.

### Part 10: Skills & Session Persistence

**Goal**: Let users customise agent behaviour and persist conversations.

**What to build**:
1. `src/skills.ts` -- a skills loader that:
   - Discovers `.md` files from `.protoagent/skills/` (project-level) and
     `~/.config/protoagent/skills/` (global)
   - Project skills override global skills with the same name
   - Injects skill content into the system prompt
2. `src/sessions.ts` -- session persistence that:
   - Saves the full conversation (messages array) to a JSON file
   - Stores sessions in `~/.local/share/protoagent/sessions/`
   - Auto-generates a title from the first user message
   - Lists, loads, and deletes sessions
3. `--session <id>` CLI flag to resume a session
4. Wire skills into `system-prompt.ts` and sessions into `App.tsx`

**Tutorial content**: Explain how skills customise agent behaviour. Show
the session file format. Walk through save/load lifecycle.

### Part 11: MCP & Sub-agents

**Goal**: Connect external tools and prevent context pollution.

**What to build**:
1. `src/mcp.ts` -- an MCP client that:
   - Reads server config from `.protoagent/mcp.json`
   - Spawns MCP servers as child processes (stdio transport)
   - Discovers tools via `tools/list` and registers them dynamically
   - Calls tools via `tools/call` and returns results
   - Handles server lifecycle (start, stop, reconnect)
2. `src/sub-agent.ts` -- a sub-agent tool that:
   - Spawns an isolated child conversation with its own message history
   - Runs autonomously (no user interaction) with a configurable iteration limit
   - Returns the final result to the parent agent
   - Prevents context pollution by keeping the child's history separate
3. Register both as dynamic tools in the tool registry

**Tutorial content**: Explain the MCP protocol (JSON-RPC over stdio).
Show how sub-agents prevent context pollution. Walk through the child
session lifecycle.

### Part 12: Documentation Site (VitePress)

**Goal**: Create a project landing page and documentation site.

**What to build**:
1. A VitePress site in `docs/` with:
   - Landing page with hero section, feature highlights, and quick-start
   - Guide section covering installation, configuration, tools, skills,
     MCP, sessions, and sub-agents
   - Tutorial section hosting the DIY tutorial parts
   - Reference section with the full spec, architecture overview, and CLI
     reference
2. Sidebar navigation organised by section
3. Dark/light theme support (VitePress default)
4. Deploy configuration (GitHub Pages or similar)

---

## Gap Analysis: What Production Agents Have That ProtoAgent Does Not

### Features We ARE Implementing

These are high-value extensions that we will build into ProtoAgent.

| Feature | Complexity | Found in | Why it matters | Decision rationale |
|---|---|---|---|---|
| **MCP support** | Medium | OpenCode, Codex | Connect external tool servers (databases, APIs, custom tools) without modifying the agent. The protocol is standardised and growing. | High impact, growing ecosystem. See new SPEC section 12. |
| **Session persistence** | Low | All three | Save/load conversation history. Without this, you lose context on restart. | Essential for real-world use. Simple to implement (serialise messages to JSON). See new SPEC section 14. |
| **Sub-agents** | Medium | OpenCode, Codex | Spawn child sessions for independent subtasks. Prevents context pollution -- the parent agent stays focused while the child handles a self-contained task. | Directly addresses context pollution, which is a real problem in long sessions. See new SPEC section 13. |
| **Skills / Reusable prompts** | Low | OpenCode, Codex, pi | Load domain-specific instructions from `.md` files (e.g., "always use pnpm", "follow this code style"). | Low effort, high value. Lets users customise agent behaviour without touching code. See new SPEC section 15. |

### Features We Already Have

| Feature | Status | Notes |
|---|---|---|
| **Permission / Approval system** | Done | File-operation approval (`utils/approval.ts`), shell command whitelist + session approval (`tools/bash.ts`), `--dangerously-accept-all` flag. |

### Features We Are NOT Implementing

These are noted here so a reader knows what to explore next if they want to
extend the project.

| Feature | Complexity | Found in | Why we skip it |
|---|---|---|---|
| **Multi-provider via Vercel AI SDK** | Medium | OpenCode | Unnecessary -- the OpenAI SDK works as a universal client since most providers expose OpenAI-compatible endpoints. Adding the AI SDK would be another layer of indirection for no practical gain in our case. |
| **Better edit strategies** | Medium | OpenCode | OpenCode has 9 fallback strategies for find-and-replace. Worth noting as an upgrade path, but the complexity doesn't fit our educational goal. |
| **Git-based undo** | Medium | OpenCode | Snapshot files before changes using a shadow git repo. Nice safety net but adds significant complexity. |
| **Plugin / Hook system** | Medium | OpenCode, pi | Skills cover the most important use case (custom instructions). A full plugin system is overkill. |
| **Single-shot mode** | Low | pi | Run non-interactively with a single prompt. Useful for CI but not core to the tutorial. |
| **Sandboxing** | High | Codex | OS-level sandboxing (macOS Seatbelt, Linux Landlock). Important for security, but platform-specific and complex. |
| **LSP integration** | High | OpenCode | Run diagnostics after edits. Requires managing LSP server processes. |
| **Session branching** | Medium | pi | Fork conversations like git branches. Interesting but adds complexity beyond our scope. |
| **Web/Desktop UI** | High | OpenCode | Out of scope -- we focus on the CLI. |
| **OpenTelemetry** | Medium | Codex | Overkill for a tutorial project. |

---

## File Structure (Final)

```
protoagent/
├── src/
│   ├── cli.tsx                  # CLI entry point (Commander + Ink)
│   ├── App.tsx                  # Main UI component
│   ├── config.tsx               # Configuration wizard component
│   ├── providers.ts             # Model/provider definitions
│   ├── agentic-loop.ts          # Core agent loop
│   ├── system-prompt.ts         # Dynamic system prompt
│   ├── sub-agent.ts             # Sub-agent spawning (isolated child sessions)
│   ├── sessions.ts              # Session persistence (save/load/list/delete)
│   ├── skills.ts                # Skills loader (.md files for domain instructions)
│   ├── mcp.ts                   # MCP client (connect to external tool servers)
│   ├── tools/
│   │   ├── index.ts             # Tool registry + dispatcher
│   │   ├── read-file.ts         # Read file contents
│   │   ├── write-file.ts        # Create/overwrite files
│   │   ├── edit-file.ts         # Find-and-replace in files
│   │   ├── list-directory.ts    # List directory contents
│   │   ├── search-files.ts      # Recursive text search
│   │   ├── bash.ts              # Shell command execution
│   │   └── todo.ts              # In-memory task tracking
│   └── utils/
│       ├── cost-tracker.ts      # Token/cost estimation
│       ├── compactor.ts         # Conversation compaction
│       ├── approval.ts          # User approval for destructive ops
│       ├── path-validation.ts   # Path security (cwd restriction)
│       └── logger.ts            # Configurable logging
├── .protoagent/
│   ├── mcp.json                 # MCP server configuration (per-project)
│   └── skills/                  # Project-level skill files (.md)
├── DIY_PROTOAGENT_TUTORIAL/
│   ├── PART_1.md                # Scaffolding (done)
│   ├── PART_2.md                # AI integration (done)
│   ├── PART_3.md                # Configuration (done)
│   ├── PART_4.md                # Agentic loop
│   ├── PART_5.md                # File tools
│   ├── PART_6.md                # Shell commands
│   ├── PART_7.md                # System prompt
│   ├── PART_8.md                # Compaction & cost tracking
│   ├── PART_9.md                # Skills & sessions
│   ├── PART_10.md               # MCP & sub-agents
│   └── PART_11.md               # Polish & UI
├── docs/                        # VitePress documentation site
│   ├── .vitepress/
│   │   └── config.ts            # VitePress config (nav, sidebar, theme)
│   ├── index.md                 # Landing page (hero + features)
│   ├── guide/
│   │   ├── getting-started.md   # Installation and first run
│   │   ├── configuration.md     # Provider/model setup
│   │   ├── tools.md             # Built-in tools reference
│   │   ├── skills.md            # Writing and using skills
│   │   ├── mcp.md               # Configuring MCP servers
│   │   ├── sessions.md          # Session persistence
│   │   └── sub-agents.md        # How sub-agents work
│   ├── tutorial/                # Links to / hosts the DIY tutorial parts
│   │   ├── index.md             # Tutorial overview
│   │   ├── part-1.md            # Part 1: Scaffolding
│   │   ├── part-2.md            # Part 2: AI integration
│   │   └── ...                  # Parts 3-11
│   └── reference/
│       ├── spec.md              # Full specification
│       ├── architecture.md      # Architecture overview
│       └── cli.md               # CLI flags and commands
├── package.json
├── tsconfig.json
├── SPEC.md
└── PLAN.md
```

---

## Implementation Order & Dependencies

```
Part 1 (done) ─► Part 2 (done) ─► Part 3 (done)
                                        │
                                        ▼
                                   Part 4: Agentic Loop
                                        │
                                   ┌────┴────┐
                                   ▼         ▼
                              Part 5:    Part 7:
                              File       System
                              Tools      Prompt
                                   │         │
                                   ▼         │
                              Part 6:        │
                              Shell          │
                              Commands       │
                                   │         │
                                   └────┬────┘
                                        ▼
                                   Part 8: Compaction
                                   & Cost Tracking
                                        │
                                        ▼
                                   Part 9: Skills
                                   & Sessions
                                        │
                                        ▼
                                   Part 10: MCP
                                   & Sub-agents
                                        │
                                        ▼
                                   Part 11: Polish & UI
```

Part 4 is the critical path. Once the agentic loop works with a single
tool, Parts 5-7 can be developed somewhat independently. Part 8 depends
on having enough tools to generate long conversations. Parts 9-10 build
on the working agent with new capabilities. Part 11 is final polish.

---

## Key Design Decisions

### 1. Keep the agentic loop as a plain module, not an Ink component

The original uses `process.stdout.write()` directly from the loop. In
the Ink port, the loop should be a pure TypeScript module that emits
events or calls callbacks. The Ink component subscribes to these and
updates React state. This keeps the core logic testable and the UI
swappable.

**How the reference agents do it**:
- OpenCode: the loop (`session/prompt.ts`) writes to storage, and the TUI
  subscribes to Bus events.
- Codex: the loop sends `Event` messages through a channel, and the TUI
  renders from the event stream.
- pi: the `Agent` class has a pub/sub event system; the interactive mode
  subscribes.

### 2. Use the OpenAI SDK directly, not the Vercel AI SDK

The AI SDK would give us multi-provider abstraction, but it's another
layer of indirection that makes the tutorial harder to follow. The OpenAI
SDK is simpler and most providers offer OpenAI-compatible endpoints.

**Trade-off**: This means Anthropic's native API features (extended
thinking, prompt caching) aren't available. The tutorial can note this
as a limitation and point to the AI SDK as an upgrade path.

### 3. Approval via Ink components, not stdin prompts

The original uses `inquirer` prompts for approval, which blocks the
event loop. In the Ink port, approvals should be rendered as Ink
components (e.g., a confirmation dialog) that update state. This is
more work but produces a better UX and is consistent with the
React model.

### 4. Implement MCP, sub-agents, session persistence, and skills

These four features move ProtoAgent from "educational toy" to "genuinely
useful tool" without excessive complexity:

- **MCP**: Connects external tool servers via the standardised protocol.
  Study OpenCode (`packages/opencode/src/mcp/index.ts`) and Codex
  (`codex-rs/core/src/mcp_connection_manager.rs`) before building.
- **Sub-agents**: Spawn isolated child sessions to prevent context
  pollution. Study OpenCode's `TaskTool` (`src/tool/task.ts`) and
  Codex's collab system (`src/tools/handlers/collab.rs`) before building.
- **Session persistence**: Serialise messages to JSON files. Study all
  three reference codebases (simplest: pi's JSONL approach in
  `src/core/session-manager.ts`).
- **Skills**: Load `.md` files as domain-specific instructions. Study
  OpenCode (`src/skill/skill.ts`), Codex (`src/skills/loader.rs`), and
  pi (`src/core/skills.ts`) before building.

### 5. Don't implement sandboxing

OS-level sandboxing is platform-specific and complex. The tutorial
should explain why it matters and point to Codex's implementation as
a reference, but rely on the simpler whitelist + approval approach.

---

## Reference Repositories: Key Takeaways

### OpenCode (`github.com/anomalyco/opencode`)
- **Scale**: ~50k+ lines of TypeScript. Client-server architecture with
  Hono HTTP server, SolidJS TUI, and web/desktop apps.
- **Most relevant pattern**: The tool framework (`Tool.define()` with Zod
  validation, automatic output truncation, context object with abort
  signal and permission checks).
- **Most relevant feature**: The 9 edit fallback strategies. ProtoAgent's
  simple exact-match edit will fail in practice. Worth noting in the
  tutorial.
- **Takeaway**: Production agents need a lot of infrastructure (storage,
  events, sessions, permissions). ProtoAgent deliberately skips all of
  this to stay readable.

### Codex (`github.com/openai/codex`)
- **Scale**: Primary codebase is now Rust (~60 crates). Legacy TypeScript
  version used Ink (our same UI choice).
- **Most relevant pattern**: The `Op`/`Event` submission/event queue
  pattern for decoupling the agent loop from the UI. Clean separation
  of concerns.
- **Most relevant feature**: Sandboxing (Seatbelt on macOS, Landlock on
  Linux). The most thorough security model of the three.
- **Takeaway**: The legacy `codex-cli` TypeScript/Ink codebase is the
  closest architectural reference for ProtoAgent.

### pi-mono (`github.com/badlogic/pi-mono`)
- **Scale**: ~20k+ lines of TypeScript across 7 packages. Clean layered
  architecture (tui → ai → agent-core → coding-agent).
- **Most relevant pattern**: The layered package structure. `pi-ai` is a
  standalone multi-provider LLM client. `pi-agent-core` is a standalone
  agent loop. `pi-coding-agent` is the product that composes them.
  ProtoAgent is simpler (single package) but could learn from this
  separation.
- **Most relevant feature**: The extension system -- tools, commands,
  shortcuts, and UI hooks can be loaded from user files. Also the
  session branching (conversation tree navigation).
- **Takeaway**: pi has the cleanest TypeScript architecture of the three.
  Good reference for how to structure the agent loop and tool system
  in a readable way.

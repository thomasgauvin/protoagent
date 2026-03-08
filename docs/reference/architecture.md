# Architecture

This page is the docs-site companion to the root `ARCHITECTURE.md`.

If you are reading the repo directly, `ARCHITECTURE.md` is the fuller source of truth. This page mirrors its structure in a shorter form.

For the companion feature-and-behavior reference, see `/reference/spec` or the root `SPEC.md`.

## 1. High-level Structure

```text
protoagent CLI
  -> App (Ink)
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools
        -> Dynamic tools from MCP and skills
        -> Special sub-agent execution path
```

At runtime, the user interacts with the Ink app, while the agent loop performs model/tool orchestration and emits events back to the UI.

## 2. Module Map

Main implementation areas:

- `src/cli.tsx`
- `src/App.tsx`
- `src/agentic-loop.ts`
- `src/system-prompt.ts`
- `src/sub-agent.ts`
- `src/config.tsx`
- `src/providers.ts`
- `src/sessions.ts`
- `src/skills.ts`
- `src/mcp.ts`
- `src/tools/index.ts`
- `src/tools/*`
- `src/components/*`
- `src/utils/*`

## 3. Startup Flow

Current startup path:

1. `src/cli.tsx` parses arguments.
2. `App` initializes logging and approval handling.
3. Config is loaded or inline setup is shown.
4. The OpenAI client is created from provider metadata.
5. MCP is initialized, which may register dynamic tools.
6. A saved session is resumed or a new session is created.
7. The initial system prompt is generated.

## 4. Turn Execution Flow

For a normal user message:

1. `App` appends the user message immediately.
2. `runAgenticLoop()` refreshes the system prompt and compacts history if needed.
3. The model streams assistant text and/or tool calls.
4. Tool calls are executed through the tool system, except `sub_agent`, which is handled specially.
5. Tool results are appended to history.
6. The loop repeats until plain assistant text is returned.
7. `App` saves the session and TODO state.

## 5. Message and Session Model

The core app state centers on:

- `completionMessages`
- the current session object
- per-session TODO state
- a live `assistantMessageRef` used during streaming updates

Sessions persist messages, provider/model metadata, timestamps, title, and TODOs.

## 6. Tool Architecture

Static built-ins come from `src/tools/index.ts` and `src/tools/*`.

Dynamic tools can be registered by:

- `src/mcp.ts`
- `src/skills.ts`

`sub_agent` is a special-case tool exposed by the loop rather than the normal registry.

## 7. Safety Model

The current safety model combines:

- path validation for file tools
- approval prompts for writes, edits, and non-safe shell commands
- hard-blocked dangerous shell patterns

Approved shell commands are not sandboxed.

## 8. Skills Architecture

The skills system discovers validated `SKILL.md` directories, may register `activate_skill`, and extends allowed file roots to activated skill directories.

Because skill initialization happens during system-prompt generation, it has runtime side effects on both tool registration and file-access roots.

## 9. MCP Architecture

`src/mcp.ts` reads `.protoagent/mcp.json`, connects stdio or HTTP MCP servers, discovers their tools, and registers them dynamically.

## 10. Sub-Agent Architecture

`src/sub-agent.ts` runs isolated child loops with a fresh prompt and message history. Children use the normal built-in and dynamic tools, but do not recursively expose `sub_agent`.

## 11. Conversation Compaction and Cost Tracking

ProtoAgent estimates token usage, tracks context-window usage, and compacts old conversation history at high utilization while preserving protected skill payloads.

## 12. Terminal UI

`src/App.tsx` is both the visible UI layer and the runtime coordinator for:

- slash commands
- session lifecycle
- approvals
- config flows
- MCP lifecycle
- event-driven rendering

The UI also includes collapsible message boxes, grouped tool rendering, formatted assistant output, and usage display.

## 13. Important Implementation Nuances

Important caveats to keep in mind:

- `App.tsx` is not just presentation
- the system prompt is regenerated repeatedly
- skills initialization mutates runtime state
- `sub_agent` is not part of `getAllTools()`
- some tool failures flow back as tool-result strings rather than thrown errors

## 14. Shutdown and Lifecycle Boundaries

Graceful quit saves the session and shows a resume command. Immediate `Ctrl-C` exits without that quit flow. App cleanup clears approval handlers and closes MCP connections.

## 15. Extension Points

The main extension surfaces are:

- `src/providers.ts`
- `src/tools/*`
- `src/skills.ts`
- `src/mcp.ts`
- `src/sub-agent.ts`
- `src/components/*`

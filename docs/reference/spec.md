# Specification

This is the full technical spec for ProtoAgent — every component, how it works, and why it's designed the way it is.

The complete spec lives in [`SPEC.md`](https://github.com/user/protoagent/blob/main/SPEC.md) in the repo. Here's a quick map of what it covers.

## What's in the spec

1. **Goals** — educational, functional, extensible. Every design decision favours clarity over cleverness.
2. **Architecture** — the layer stack from CLI to tools, how they connect.
3. **The Agentic Loop** — the tool-use loop pattern. This is the heart of the whole thing.
4. **Tool System** — how tools are defined, registered, and dispatched.
5. **Provider & Model Support** — OpenAI SDK as a universal client.
6. **Configuration** — persistent config with an interactive setup wizard.
7. **Terminal UI** — Ink (React for the terminal) and why we chose it.
8. **System Prompt** — dynamic prompt generation with project context and tool descriptions.
9. **Conversation Compaction** — auto-summarise when the context window gets full.
10. **User Approval** — permission controls for destructive operations.
11. **Cost Tracking** — token estimation and API cost display.
12. **MCP Support** — connecting external tool servers via Model Context Protocol.
13. **Sub-agents** — isolated child sessions for self-contained tasks.
14. **Session Persistence** — saving and resuming conversations.
15. **Skills** — domain-specific instructions from markdown files.
16. **Documentation Site** — this VitePress site you're reading.

Each section includes a "before building" note pointing to the specific files in [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/openai/codex), and [Claude Code](https://github.com/anthropics/claude-code) that you should study first. No point reinventing something when you can learn from how production agents do it.

# Build Your Own Coding Agent

I built ProtoAgent because I wanted to understand how coding agents actually work — not at a conceptual level, but at the "I can read every line of code" level. Production agents like [OpenCode](https://github.com/anomalyco/opencode), [Codex](https://github.com/openai/codex), and [pi-mono](https://github.com/badlogic/pi-mono) are impressive, but they're also tens of thousands of lines of code. Hard to learn from when you're starting from scratch.

This tutorial walks you through building the same thing, step by step. Each part produces a runnable program. By the end, you'll have a fully functional coding agent — and more importantly, you'll understand exactly how it works.

## Before you start

You'll need:

- Node.js 18+
- An API key from OpenAI, Google Gemini, or Anthropic
- Basic TypeScript knowledge
- A terminal you're comfortable in

## The parts

### Foundation

These first three parts get you from zero to a working chatbot.

1. **[Scaffolding](/tutorial/part-1)** — Set up a CLI with Commander and an Ink-based terminal UI.
2. **[AI Integration](/tutorial/part-2)** — Connect to the OpenAI API and stream chat completions.
3. **[Configuration](/tutorial/part-3)** — Build a setup wizard for provider and model selection.

### Core agent

This is where the chatbot becomes an agent. The agentic loop is the key — once you understand it, everything else is just adding tools.

4. **[The Agentic Loop](/tutorial/part-4)** — The tool-use loop pattern that powers every coding agent.
5. **[File Tools](/tutorial/part-5)** — Read, write, edit, and search files with path security.
6. **[Shell Commands](/tutorial/part-6)** — Run commands safely with a whitelist and approval system.
7. **[System Prompt](/tutorial/part-7)** — Make the agent aware of the project it's working in.

### Making it useful

These parts take the agent from "works in a demo" to "actually useful day-to-day."

8. **[Compaction & Cost Tracking](/tutorial/part-8)** — Handle long conversations and track API spending.
9. **[Skills & Sessions](/tutorial/part-9)** — Customise behaviour with markdown files. Save and resume conversations.
10. **[MCP & Sub-agents](/tutorial/part-10)** — Connect external tool servers. Spawn isolated child sessions.
11. **[Polish & UI](/tutorial/part-11)** — Final touches that make the difference.

## The philosophy

ProtoAgent is intentionally minimal. The entire source is around 2,000 lines — small enough to read in an afternoon. Every design decision trades features for readability, because the goal isn't to build the best coding agent. It's to understand how they all work.

Production agents have sandboxing, LSP integration, session branching, plugin systems, and more. ProtoAgent skips all of that and focuses on the core mechanics that every agent shares. Once you understand those, extending in any direction is straightforward.

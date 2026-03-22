# AGENTS.md

AGENTS.md is a simple, open format for guiding coding agents. Think of it as a README for agents — a dedicated, predictable place to give AI coding tools the context they need to work on your project.

The format is documented at [https://agents.md](https://agents.md) and supported by many AI coding tools including OpenAI Codex, GitHub Copilot, Cursor, and Aider.

## How ProtoAgent uses AGENTS.md

When ProtoAgent starts, it looks for an `AGENTS.md` file in your working directory and walks up parent directories until it finds one. If found, its contents are injected into the system prompt before the first user message.

The hierarchy works as follows:
- ProtoAgent checks the current working directory first
- Then walks up parent directories (useful for monorepos with nested projects)
- The first `AGENTS.md` found wins
- If no `AGENTS.md` exists, ProtoAgent runs without custom instructions

## What to put in AGENTS.md

AGENTS.md is ideal for project-wide conventions that should always be in the agent's context:

- Build commands (`npm run build`, `make`, etc.)
- Test commands (`npm test`, `pytest`, etc.)
- Code style preferences
- Architecture guidelines
- File organization patterns
- Dependencies and frameworks used

## Example AGENTS.md

```markdown
# Project Instructions

## Build
- Use `npm run build` to compile TypeScript
- Use `npm run dev` for development mode with hot reload

## Testing
- Run `npm test` for unit tests
- Run `npm run test:integration` for integration tests

## Code Style
- Use TypeScript strict mode
- Prefer named exports over default exports
- Use camelCase for variables and functions
- Use PascalCase for types and interfaces

## Architecture
- This is a Node.js CLI tool built with Ink for terminal UI
- Source code lives in `src/` directory
- Tools are organized by domain in `src/tools/`
```

## Relationship to Skills

AGENTS.md and Skills serve different purposes:

| AGENTS.md | Skills (SKILL.md) |
|-----------|-------------------|
| Automatically loaded on startup | Loaded on-demand via `activate_skill` |
| Static project context | Specialized, task-specific instructions |
| Lives at project root | Lives in `.agents/skills/` directories |
| Always included in prompt | Only included when explicitly requested |

Use AGENTS.md for project-wide conventions that should always be available. Use Skills for specialized, reusable instructions that should only be loaded when needed.

See the tutorial for implementing both: [Part 9 - Skills & AGENTS.md](/build-your-own/part-9)

## File location

ProtoAgent only looks for `AGENTS.md` (case-sensitive) in the filesystem hierarchy. It does not support the global `~/.agents/` location that some tools use.

## Specification

The AGENTS.md format is stewarded by the [Agentic AI Foundation](https://agentic.ai/) under the Linux Foundation. See [https://agents.md](https://agents.md) for the full specification.

# Skills

Here's a common problem with coding agents: you want the agent to follow your project's conventions, but it doesn't know about them. It uses npm when you use pnpm. It writes default exports when your codebase uses named exports. It puts tests in a `__tests__` folder when you co-locate them.

Skills fix this. You drop a markdown file into your project, and ProtoAgent reads it as instructions.

## What a skill looks like

A skill is just a `.md` file. Here's an example — say you create `.protoagent/skills/code-style.md`:

```markdown
# Code Style

- Use TypeScript strict mode
- Prefer named exports over default exports
- Use camelCase for variables and functions
- Use PascalCase for types and interfaces
- Always add JSDoc comments to public functions
```

That's it. ProtoAgent reads this on startup and injects it into the system prompt. The agent sees these instructions alongside its core guidelines and follows them.

## Where to put skills

ProtoAgent looks in two places:

1. **Project-level**: `.protoagent/skills/` in your project directory
2. **Global**: `~/.config/protoagent/skills/`

If a project skill and a global skill have the same filename, the project skill wins. This lets you have sensible global defaults that individual projects can override.

## Some ideas

**Package manager** (`.protoagent/skills/package-manager.md`):
```markdown
Always use pnpm for package management. Never use npm or yarn.
Use `pnpm install` to install, `pnpm add` to add dependencies.
```

**Testing conventions** (`.protoagent/skills/testing.md`):
```markdown
This project uses Vitest for testing.
Test files are co-located with source files using the .test.ts suffix.
Always run `pnpm test` after making changes.
```

**API patterns** (`.protoagent/skills/api.md`):
```markdown
All API routes are in src/routes/.
Use Zod for request validation.
Always return proper HTTP status codes — don't just throw 500 for everything.
```

## How it works under the hood

On startup, ProtoAgent scans both skill directories for `.md` files, reads their content, and appends it to the system prompt under a "Skills" section. The filename (minus `.md`) becomes the skill name.

It's intentionally simple. Production agents like OpenCode and Codex have fancier skill systems with frontmatter parsing, dependencies, and on-demand loading. ProtoAgent keeps it to the essentials — file discovery and prompt injection — because that covers 90% of what you actually need.

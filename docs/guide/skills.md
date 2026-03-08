# Skills

Skills let you package project-specific instructions outside the core app so ProtoAgent can follow local conventions without hardcoding them.

## Skill format

A skill lives in its own directory and must contain `SKILL.md`.

Example layout:

```text
.agents/skills/code-style/
└── SKILL.md
```

Example `SKILL.md`:

```markdown
---
name: code-style
description: Follow the project's TypeScript and export conventions.
---

- Use TypeScript strict mode
- Prefer named exports over default exports
- Use camelCase for variables and functions
- Use PascalCase for types and interfaces
```

Current validation rules:

- the file must start with YAML frontmatter
- `name` is required
- `description` is required
- the skill name must be lowercase kebab-case
- the skill directory name must match the skill name exactly

## Discovery locations

ProtoAgent scans these roots for skill directories.

Project roots:

- `.agents/skills/`
- `.protoagent/skills/`

User roots:

- `~/.agents/skills/`
- `~/.protoagent/skills/`
- `~/.config/protoagent/skills/`

If a project skill and user skill share the same name, the later project-level version wins.

## How activation works

ProtoAgent does not inject every skill body into the prompt up front.

Instead it:

1. discovers and validates skills
2. adds a catalog of available skills to the system prompt
3. registers the `activate_skill` tool if at least one skill exists
4. lets the model load the full skill only when needed

That keeps the base prompt smaller while still exposing skills to the model.

## Skill resources

ProtoAgent can list bundled files under these directories inside a skill folder:

- `scripts/`
- `references/`
- `assets/`

The skills system also adds discovered skill directories to the readable path allowlist, so file tools can access those bundled resources safely.

## Supported frontmatter fields

The current loader understands:

- `name`
- `description`
- `compatibility`
- `license`
- `metadata`
- `allowed-tools`

`allowed-tools` is parsed into metadata, but it is not currently enforced as a permission boundary.

## What activation returns

`activate_skill` returns a `<skill_content ...>` block that includes:

- the skill body
- the skill directory
- guidance about resolving relative paths
- an optional `<skill_resources>` listing

The compaction system also preserves activated skill payloads when summarizing long conversations.

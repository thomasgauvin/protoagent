# Skills

Skills are how you give ProtoAgent project-specific instructions without hardcoding those instructions into the app itself.

If you want the agent to follow your code style, your release process, your package-manager preference, or some internal project conventions, this is the mechanism.

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

ProtoAgent scans a few user-level and project-level roots for skills.

Project roots:

- `.agents/skills/`
- `.protoagent/skills/`

User roots:

- `~/.agents/skills/`
- `~/.protoagent/skills/`
- `~/.config/protoagent/skills/`

If a project skill and a user skill share the same name, the project-level version wins.

## How activation works

ProtoAgent does not inject every skill body into the prompt up front.

Instead it:

1. discovers and validates skills
2. adds a catalog of available skills to the system prompt
3. registers the `activate_skill` tool if at least one skill exists
4. lets the model load the full skill only when it actually needs it

That is the whole design in one sentence: keep the base prompt smaller, but still let the model load the detailed instructions on demand.

## Skill resources

ProtoAgent can also list bundled files under these directories inside a skill folder:

- `scripts/`
- `references/`
- `assets/`

The skills system also adds discovered skill directories to the allowed path roots, so those bundled files can be accessed through the normal file tools.

## Supported frontmatter fields

The current loader understands:

- `name`
- `description`
- `compatibility`
- `license`
- `metadata`
- `allowed-tools`

`allowed-tools` is parsed into the dedicated `allowedTools` field, but it is not currently enforced as a permission boundary.

## What activation returns

`activate_skill` returns a `<skill_content ...>` block that includes:

- the skill body
- the skill directory
- guidance about resolving relative paths
- an optional `<skill_resources>` listing

The compaction system also preserves activated skill payloads when summarizing long conversations.

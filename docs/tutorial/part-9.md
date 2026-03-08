# Part 9: Skills & Sessions

This part covers two persistence layers: reusable instructions through skills, and conversation continuity through sessions.

## Skills in the current source

Skills live in directories that contain `SKILL.md`, not loose markdown files.

Discovery and activation live in `src/skills.ts`.

Current roots include:

- `~/.agents/skills/`
- `~/.protoagent/skills/`
- `~/.config/protoagent/skills/`
- `.agents/skills/`
- `.protoagent/skills/`

The loader validates frontmatter, merges collisions by name, and exposes a catalog through the prompt plus `activate_skill`.

## Sessions in the current source

Session persistence lives in `src/sessions.ts`.

Current session data includes:

- a UUID session ID
- title
- timestamps
- provider and model
- `completionMessages`
- persisted TODOs

Sessions are saved under the ProtoAgent data directory and resumed with `--session <id>`.

## Important current details

- session IDs are validated as UUIDs
- file permissions are hardened on non-Windows platforms
- TODOs are persisted with sessions
- titles are generated from the first user message with a simple heuristic

## Core takeaway

Skills shape behavior across tasks. Sessions preserve state across restarts. Together they make ProtoAgent feel like a continuing workspace instead of a stateless demo.

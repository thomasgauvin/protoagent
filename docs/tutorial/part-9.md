# Part 9: Skills

Skills are one of my favorite parts of ProtoAgent because they solve a very practical problem.

Every real project has local conventions. Maybe it uses `pnpm`. Maybe it has a weird deploy process. Maybe the team has strong opinions about tests, naming, or generated files. You could restate that context in every conversation, or you can package it once and let the runtime expose it when needed.

That is what skills do.

By the end, your project should match `protoagent-tutorial-again-part-9`.

## What you are building in this part

Starting from Part 8, you are adding the first staged version of skills support:

- skill discovery from project and user roots
- project-overrides-global merge behavior
- prompt integration for discovered skills
- simple markdown-based skills before the final app's richer layout

This is the point where the runtime starts learning local conventions without hardcoding them into the app itself.

## Starting point

Copy your Part 8 project and continue from there.

Your target snapshot is:

- `protoagent-tutorial-again-part-9`

## Files to create or change

This stage mainly introduces:

- `src/utils/skills.ts`
- `src/system-prompt.ts`
- `src/App.tsx` only if you need to refresh the generated prompt

## Step 1: Add skill discovery

The staged tutorial path introduces skills as markdown-backed entries that the runtime can discover from a few well-known locations.

At minimum, you want the loader to:

- scan project-level and user-level roots
- load markdown files from each skills directory
- merge collisions deterministically, with project skills winning

In `protoagent-tutorial-again-part-9`, the implementation is intentionally simple:

- project skills live in `.protoagent/skills`
- global skills live in `~/.config/protoagent/skills`
- each skill is a single `.md` file
- the filename becomes the skill name

If both locations define the same skill name, the project copy should replace the global one.

## Step 3: Extend the system prompt with a skills catalog

The system prompt should now include the loaded skills directly.

In this checkpoint, you are not building the final app's on-demand `SKILL.md` loader yet. The staged version is more direct: discover markdown files, load their contents, and append them to the prompt so the model can use them immediately.

## Verification

Create a sample skill in one of the scanned locations and run the app:

```bash
npm run dev
```

Then give the agent a task that should clearly benefit from the skill.

For example, create `.protoagent/skills/test-skill.md` with a short project convention.

If it worked, you should see:

- the runtime loading the available skills from the project and global directories
- the agent behaving differently when the skill is relevant

## Resulting snapshot

At the end of this part, your project should match:

- `protoagent-tutorial-again-part-9`

## Pitfalls

- forgetting that this staged checkpoint is file-per-skill, not directory-per-skill
- not resolving project-vs-global collisions predictably
- loading skills but never appending them to the generated system prompt
- trying to jump straight to the final activation model before the staged snapshot supports it

## Core takeaway

Skills are how ProtoAgent starts staying general-purpose without staying generic. The final app makes the system more structured later, but this is the checkpoint where the staged rebuild first learns project-specific behavior from local markdown instructions.

# Plan: Update Docs & Recreate Verification Folders

## Overview
Update all documentation (tutorial, guide, reference) to match the current source code, then recreate the 13 `protoagent-tutorial-again-part-*` verification folders as complete working snapshots (including `node_modules`).

### Key Principle: Full Code Snippets in Tutorial
The tutorial must include **complete, copy-pasteable code** for every file at every stage. A reader should be able to follow the tutorial and recreate the exact project by copying the provided code — no guesswork, no "try this on your own" hints. Each part should show the **full file contents** for every new or modified file.

---

## Phase 1: Deep Diff — Identify All Discrepancies

Before changing anything, do a systematic file-by-file comparison of what the tutorial docs describe vs. what the source code actually contains. Key areas to check:

- **Function signatures** — Have parameters, return types, or names changed?
- **File locations** — Tutorial says `src/utils/skills.ts` but current code is `src/skills.ts` (same for sessions, mcp)
- **Provider catalog** — Tutorial Part 3 references specific models/providers; current `providers.ts` may have different models
- **Tool schemas** — Do tool parameter names/descriptions match?
- **Config paths** — Has the config storage location or schema changed?
- **Error handling** — The agentic loop has extensive error recovery (5-strategy sanitization, retry with backoff) that may not be in the tutorial
- **New features** — runtime-config.ts, file-time.ts, format-message.tsx may be undocumented in tutorial

---

## Phase 2: Rewrite Tutorial Docs (Parts 1–13)

Rewrite each `docs/tutorial/part-*.md` to match the current source code at that checkpoint stage. **Every part must include full code snippets** — the complete file contents for every new or modified file. The reader should be able to copy-paste every code block and end up with a working project at each checkpoint.

Tutorial writing guidelines:
- Show full file contents in fenced code blocks (```typescript / ```json)
- When modifying a file from a previous part, show the **entire updated file**, not just a diff
- Explain the "why" before showing code, but never omit the code itself
- Each part should list: files to create, files to modify, what to run to verify

### Part 1: Scaffolding
- Verify package.json dependencies match
- Verify cli.tsx and App.tsx match the simplified Part 1 versions

### Part 2: AI Integration
- Verify OpenAI client setup matches current patterns
- Check model name references

### Part 3: Configuration Management
- Update provider catalog to match current `providers.ts` (GPT-5.2, Sonnet 4.6, Gemini 3, etc.)
- Verify config schema and paths match current `config.tsx`

### Part 4: Agentic Loop
- Update `agentic-loop.ts` description to match current architecture
- Update tool registry pattern if it has changed
- Update event types if new ones added

### Part 5: Core Tools
- Verify all file tool schemas match current implementations
- Update path-validation if interface changed
- Check edit-file's 5-strategy matching description

### Part 6: Shell Commands & Approvals
- Verify bash tool safety tiers match current blocked/safe/approval lists
- Update approval system description

### Part 7: System Prompt
- Verify system prompt generation matches current `system-prompt.ts`
- Check if skills catalog section is included

### Part 8: Compaction & Cost Tracking
- Verify cost-tracker interface matches
- Check compaction threshold and behavior

### Part 9: Skills
- **Key change:** File moved from `src/utils/skills.ts` → `src/skills.ts`
- Update all references to match current skill discovery, validation, activation flow

### Part 10: Sessions
- **Key change:** File moved from `src/utils/sessions.ts` → `src/sessions.ts`
- Verify session schema matches (todos field, etc.)

### Part 11: MCP Integration
- **Key change:** File moved from `src/utils/mcp.ts` → `src/mcp.ts`
- Verify MCP config schema and connection flow

### Part 12: Sub-agents
- Verify sub-agent tool definition and execution flow

### Part 13: Polish & Rendering
- Update component descriptions
- Verify logger, format-message, runtime-config coverage
- Update slash command list

Also update `docs/tutorial/index.md` if the overview needs changes.

---

## Phase 3: Update Guide Docs

### getting-started.md
- Verify feature list, commands, and flags are current

### configuration.md
- Verify config paths, schema, and API key resolution order
- Check provider override examples

### tools.md
- Verify all tool schemas, parameters, and behaviors match source
- Check bash safety tier lists are current
- Verify webfetch limits and format options

### skills.md
- Verify discovery paths, frontmatter schema, activation flow
- Check resource directory listing

### mcp.md
- Verify server config schema and supported types
- Check tool registration naming convention

### sessions.md
- Verify session schema fields
- Check storage path and persistence details

### sub-agents.md
- Verify sub-agent tool params and execution flow

### webfetch.md
- Create if missing, or verify if exists
- Document formats, limits, and error handling

---

## Phase 4: Update Reference Docs

### spec.md
- Sync with current source code state
- Update file paths, tool lists, feature descriptions

### architecture.md
- Update module map to match current file structure
- Verify startup and turn execution flows
- Update extension points

### cli.md
- Verify flags, commands, and keyboard shortcuts

---

## Phase 5: Recreate Verification Folders

For each part 1–13, create a `protoagent-tutorial-again-part-N` folder containing:
- Complete source code matching that tutorial checkpoint
- `package.json` with correct dependencies for that stage
- `tsconfig.json`
- `node_modules/` (via `npm install`)
- Any config files needed at that stage

### Approach:
1. Start from the tutorial Part 1 code, create a fresh project
2. For each subsequent part, incrementally add the files/changes described in the updated tutorial
3. Run `npm install` in each folder to populate `node_modules`
4. Verify each checkpoint builds cleanly (`npm run build`)

### Delete old folders:
- Remove the old `protoagent-tutorial-part-*` folders (the non-"again" set, parts 1-11)
- The `protoagent-tutorial-again-part-*` folders will be recreated fresh

---

## Execution Order

1. Phase 1 (diff) — read source files alongside tutorial docs
2. Phase 2 (tutorial updates) — update part-by-part
3. Phase 3 (guide updates) — update each guide
4. Phase 4 (reference updates) — update spec, architecture, cli
5. Phase 5 (verification folders) — build from Part 1 through Part 13 incrementally

Estimated scope: ~13 tutorial files, ~8 guide files, ~3 reference files, 13 verification folders.

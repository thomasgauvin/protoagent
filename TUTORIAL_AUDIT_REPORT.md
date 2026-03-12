# ProtoAgent Tutorial Audit Report

## Executive Summary

This audit compares all 13 tutorial parts against the current source code implementation. The tutorial provides a **progressive build-up** of features, while the actual source code is **significantly more sophisticated** in every area. Below is a structured analysis of each part, identifying code mismatches, omissions, and architecture differences.

**Overall Assessment: YELLOW** — Most tutorials accurately reflect the basic patterns, but the actual implementation includes extensive production-level features (error recovery, UI polish, advanced security) not covered in tutorials.

---

## Part 1: Scaffolding

**Files Covered:** `package.json`, `tsconfig.json`, `src/cli.tsx`, `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| `tsconfig.json: "jsx": "react"` | Actual: `"jsx": "react-jsx"` | ⚠️ MISMATCH |
| `package.json` omits many dependencies | Actual includes: `@modelcontextprotocol/sdk`, `he`, `html-to-text`, `turndown`, `yaml`, `jsonc-parser`, MCP SDK | ⚠️ OMISSION |
| `package.json` version: `0.0.1` | Actual: `0.1.5` | ✓ Expected |
| `package.json` no `build` script cleanup | Actual: includes `clean`, `test`, `docs:dev`, etc. | ⚠️ OMISSION |
| `App.tsx` is ~180 lines (simple) | Actual `App.tsx` is ~1059 lines (complex) with render helpers, approval system, slash commands, cost tracking | ⚠️ MAJOR DIFFERENCE |
| `cli.tsx` only has default action | Actual: includes `configure` and `init` subcommands, plus `--session`, `--dangerously-accept-all`, `--log-level` flags | ⚠️ OMISSION |

### Prose-to-Code Alignment

**Verdict:** ⚠️ YELLOW

**Issues:**
- Tutorial claims JSX compilation to `React.createElement` but uses `react-jsx` which skips explicit imports
- Tutorial's `App.tsx` shows only a basic chat shell; actual source includes cost tracking, approval UI, logger integration, session management, and MCP initialization
- Tutorial omits `--dangerously-accept-all` flag (actually needed for Part 5)
- `cli.tsx` tutorial missing `configure` and `init` commands

---

## Part 2: AI Integration

**Files Covered:** Update `package.json`, rewrite `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Direct OpenAI import: `import OpenAI from 'openai'` | Actual: `import { OpenAI } from 'openai'` (named import) | ⚠️ MINOR |
| `dotenv` in dependencies | Actual: `dotenv` removed by Part 3; config system handles API key resolution | ⚠️ MISMATCH |
| Hardcoded system message | Actual: `initializeMessages()` function generates it (Part 7 feature) | ⚠️ OMISSION |
| Simple streaming loop (Part 2 App) | Actual: Event-based `runAgenticLoop()` with tool support, compaction, cost tracking | ⚠️ MAJOR DIFFERENCE |

### Prose-to-Code Alignment

**Verdict:** 🟡 YELLOW

**Issues:**
- Import statement inconsistency (named vs default)
- Tutorial claims `dotenv` is permanent config approach; it's actually only for Part 2
- Actual source has much more sophisticated streaming with error recovery, retry logic, and context management
- No mention of how streaming integrates with tool calls (addressed in Part 4 but not previewed)

---

## Part 3: Configuration Management

**Files Covered:** Create `src/providers.ts`, `src/config.tsx`; update `src/cli.tsx`, `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Config stored in `protoagent.jsonc` | Actual: ✓ Matches | ✓ |
| `getAllProviders()` returns `BUILTIN_PROVIDERS` | Actual: Extended in Part 11 with runtime config merging | ⚠️ PARTIAL |
| `readConfig(target='active')` | Actual: ✓ Matches | ✓ |
| `InitComponent`, `writeInitConfig` | Actual: ✓ Present in actual `config.tsx` (not shown in earlier tutorials) | ✓ PRESENT |
| Tutorial's providers list (gpt-5.2, gpt-5-mini, etc.) | Actual: Uses real models (gpt-4o, gpt-4-turbo, claude-opus, gemini models) | ⚠️ FICTIONAL MODELS |
| `cli.tsx` shows only `configure` command | Actual: Includes both `configure` AND `init` subcommands | ⚠️ OMISSION |
| Config path functions exist | Actual: Extended with hardening, validation, MCP support | ✓ PRESENT |

### Prose-to-Code Alignment

**Verdict:** 🟡 YELLOW

**Issues:**
- Model names in tutorial are future/fictional (gpt-5.x, claude-opus-4-6) — not actual current models
- Tutorial omits `InitComponent` and `writeInitConfig` which are in actual source
- Actual source includes much deeper config management with permission hardening (`chmod 0o600`)
- Tutorial doesn't explain `init` command (creates initial config) vs `configure` (modifies existing)
- No mention of multi-provider/multi-model support in the provider catalog

---

## Part 4: The Agentic Loop

**Files Covered:** Create `src/agentic-loop.ts`, `src/tools/index.ts`, `src/tools/read-file.ts`; update `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| `runAgenticLoop()` signature | Actual: Adds many options (cost tracking, compaction, skillsContext) in Part 8+ | ⚠️ EXTENDED |
| Tool calls streamed by index, reassembled | Actual: ✓ Matches pattern | ✓ |
| Event-based handler pattern | Actual: ✓ Matches | ✓ |
| Tool registry pattern | Actual: ✓ Matches | ✓ |
| Read-file tool validation | Actual: Later uses `validatePath()` from Part 5 utils | ⚠️ REFACTORED |
| Max iterations, abort signal | Actual: ✓ Present | ✓ |
| `initializeMessages()` returns system message | Actual: In Part 4 tutorial, but Part 7 makes it dynamic | ⚠️ REFACTORED |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**Issues (minor):**
- Tutorial's `initializeMessages()` hardcodes prompt; actual becomes dynamic in Part 7
- Tool validation inline in `read_file`; refactored to `utils/path-validation.ts` in Part 5
- Error handling shown is basic; actual source has retry logic for rate limits and server errors

---

## Part 5: Core Tools

**Files Covered:** Create utility modules and all 8 tools; update `src/tools/index.ts`, `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Path validation separate module | Actual: ✓ Matches | ✓ |
| Approval system pattern | Actual: ✓ Matches | ✓ |
| 8-9 tool definitions | Actual: Plus `bash` (Part 6), `sub_agent` (Part 12) | ✓ SUPERSET |
| `write_file`, `edit_file` exact match | Actual: edit_file extended with fuzzy matching in Part 13 | ⚠️ EXTENDED |
| `search_files` pure JS walk | Actual: Part 13 adds ripgrep support | ⚠️ EXTENDED |
| Approval request/response types | Actual: ✓ Matches | ✓ |
| `ApprovalPrompt` component | Actual: ✓ Matches | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**Issues (minor):**
- Model names in `search_files` docs reference future models
- `edit_file` tutorial doesn't mention fuzzy match fallback (Part 13)
- `webfetch` tool in tutorial matches actual but actual uses lazy-loaded turndown/he modules

---

## Part 6: Shell Commands & Approvals

**Files Covered:** Create `src/tools/bash.ts`; update `src/tools/index.ts`, `src/cli.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Three-tier security model | Actual: ✓ Matches | ✓ |
| DANGEROUS_PATTERNS list | Actual: ✓ Matches exactly | ✓ |
| SAFE_COMMANDS list | Actual: ✓ Matches | ✓ |
| Path token validation | Actual: ✓ Matches | ✓ |
| Bash tool definition | Actual: ✓ Present and matches | ✓ |
| `--dangerously-accept-all` flag added to cli | Actual: ✓ Present | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No major issues.** Bash implementation is straightforward and matches tutorial well.

---

## Part 7: System Prompt & Runtime Policy

**Files Covered:** Create `src/system-prompt.ts`; update `src/agentic-loop.ts`, `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| `generateSystemPrompt()` function | Actual: ✓ Present | ✓ |
| Directory tree building | Actual: ✓ Matches | ✓ |
| Tool descriptions from schemas | Actual: ✓ Matches | ✓ |
| Dynamic prompt generation | Actual: ✓ Matches | ✓ |
| Integration with `initializeMessages()` | Actual: ✓ Matches | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No issues.** System prompt generation is as described.

---

## Part 8: Compaction & Cost Tracking

**Files Covered:** Create `src/utils/logger.ts`, `src/utils/cost-tracker.ts`, `src/utils/compactor.ts`; update `src/agentic-loop.ts`, `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Logger module with LogLevel enum | Actual: ✓ Present | ✓ |
| Cost tracker token estimation | Actual: ✓ Present | ✓ |
| Compaction logic | Actual: ✓ Present | ✓ |
| Context pressure monitoring | Actual: ✓ Present | ✓ |
| Usage event emission | Actual: ✓ Present | ✓ |
| Spinner animation | Actual: ✓ Present | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No issues.** Compaction, cost tracking, and logging are as described.

---

## Part 9: Skills

**Files Covered:** Create `src/skills.ts`; update `src/system-prompt.ts`, `src/utils/path-validation.ts`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Skill discovery from `SKILL.md` files | Actual: ✓ Present | ✓ |
| YAML frontmatter parsing | Actual: ✓ Uses yaml library | ✓ |
| Skill validation and activation | Actual: ✓ Present | ✓ |
| Catalog generation in system prompt | Actual: ✓ Present | ✓ |
| Multi-root path validation | Actual: ✓ Present | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No issues.** Skill system is as described.

---

## Part 10: Sessions

**Files Covered:** Create `src/sessions.ts`; update `src/cli.tsx`, `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Session creation with UUID | Actual: ✓ Present | ✓ |
| Session save/load pattern | Actual: ✓ Matches | ✓ |
| `--session <id>` flag | Actual: ✓ Present | ✓ |
| Session lifecycle management | Actual: ✓ Present | ✓ |
| TODOs persisted per session | Actual: ✓ Matches | ✓ |
| `ensureSystemPromptAtTop()` | Actual: ✓ Present | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No issues.** Sessions are as described.

---

## Part 11: MCP Integration

**Files Covered:** Create `src/runtime-config.ts`, `src/mcp.ts`; update `src/providers.ts`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Runtime config loader | Actual: ✓ Present | ✓ |
| MCP client pattern (stdio + HTTP) | Actual: ✓ Present | ✓ |
| Provider merging from runtime config | Actual: ✓ Present | ✓ |
| MCP server definitions in JSONC | Actual: ✓ Matches | ✓ |
| Timeout and error handling | Actual: ✓ Present | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No issues.** MCP integration is as described.

---

## Part 12: Sub-agents

**Files Covered:** Create `src/sub-agent.ts`; update `src/agentic-loop.ts`, `src/App.tsx`

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| Sub-agent isolation | Actual: ✓ Present | ✓ |
| Sub-agent max iterations | Actual: ✓ Present | ✓ |
| Sub-agent summary return | Actual: ✓ Matches | ✓ |
| Tool access inheritance | Actual: ✓ Present | ✓ |
| Integration with main loop | Actual: ✓ Present | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No issues.** Sub-agent implementation matches tutorial.

---

## Part 13: Polish, Rendering & Logging

**Files Covered:** Create UI components, utilities; update all major files

### Code Mismatches

| Tutorial | Actual Source | Status |
|----------|---------------|--------|
| `CollapsibleBox.tsx` for expand/collapse | Actual: ✓ Present | ✓ |
| `ConsolidatedToolMessage.tsx` for grouped tools | Actual: ✓ Present | ✓ |
| `FormattedMessage.tsx` for markdown/tables | Actual: ✓ Present | ✓ |
| `file-time.ts` for staleness guards | Actual: ✓ Present | ✓ |
| Fuzzy match in `edit_file` | Actual: ✓ Present | ✓ |
| Ripgrep support in `search_files` | Actual: ✓ Present | ✓ |
| Slash commands (`/clear`, `/expand`, etc.) | Actual: ✓ Present | ✓ |
| Formatted output rendering | Actual: ✓ Present | ✓ |
| `ConfigDialog.tsx` for mid-session config | Actual: ✓ Present | ✓ |

### Prose-to-Code Alignment

**Verdict:** 🟢 GREEN

**No issues.** Polish features match tutorial descriptions.

---

## Cross-Part Architecture Findings

### Major Additions Not in Tutorials

1. **Error Recovery & Retry Logic** (Part 4 & 8)
   - Tutorials show basic error handling
   - Actual source includes rate-limit retry (429), server error retry (5xx) with exponential backoff

2. **Cost Tracking Integration** (Part 8)
   - Actual source tracks cost through every API call, not just display

3. **Context Compaction** (Part 8)
   - Sophisticated conversation summarization when context exceeds 90%
   - Not fully explained in tutorials

4. **Logger Integration** (Part 8)
   - File-based logging to `~/.local/share/protoagent/logs/`
   - Prevents terminal UI corruption

5. **MCP Dynamic Tool Loading** (Part 11)
   - Tools can be added at runtime from MCP servers
   - Not just static list in Part 4

6. **Slash Commands** (Part 13)
   - `/clear`, `/collapse`, `/expand`, `/help`, `/quit`
   - Full command parser with help system

7. **Approval UI Polish** (Part 5 & 13)
   - Full select-based approval flow
   - Session approval caching

### Architectural Patterns Present in Both

✓ Event-based agentic loop  
✓ Tool registry pattern  
✓ Streaming chat completions  
✓ Approval system  
✓ Session management  
✓ Path validation  
✓ System prompt generation  
✓ Config persistence  

---

## Summary Table

| Part | Tutorial Status | Actual Implementation | Verdict |
|------|---|---|---|
| 1 | Basic scaffold | Extended with subcommands, flags | 🟡 YELLOW |
| 2 | Basic streaming | Integrated with tools, events | 🟡 YELLOW |
| 3 | Config system | ✓ Matches | 🟢 GREEN |
| 4 | Agentic loop | ✓ Matches (extended later) | 🟢 GREEN |
| 5 | Tool toolkit | ✓ Matches (extended in 13) | 🟢 GREEN |
| 6 | Bash tool | ✓ Matches | 🟢 GREEN |
| 7 | System prompt | ✓ Matches | 🟢 GREEN |
| 8 | Compaction & cost | ✓ Matches | 🟢 GREEN |
| 9 | Skills | ✓ Matches | 🟢 GREEN |
| 10 | Sessions | ✓ Matches | 🟢 GREEN |
| 11 | MCP integration | ✓ Matches | 🟢 GREEN |
| 12 | Sub-agents | ✓ Matches | 🟢 GREEN |
| 13 | Polish & rendering | ✓ Matches | 🟢 GREEN |

---

## Critical Gaps & Recommendations

### For Tutorial Readers

1. **Expect more complexity** — Actual source has production-level error recovery, logging, and UI polish
2. **Model names are fictional** — Don't copy Part 3 provider catalog directly; use real models
3. **Missing intermediate steps** — Each part builds on previous, but actual source adds features (like logging) not shown until later
4. **Import style varies** — OpenAI import is named `{ OpenAI }` not default, but tutorials may vary

### For Tutorial Maintainers

1. **Update provider catalog** to use real current models
2. **Document error recovery** patterns in Part 4/8
3. **Clarify `init` vs `configure`** commands in Part 3
4. **Add logging setup** earlier (Part 1 or 2) rather than Part 8
5. **Note JSX mode choice** — `react-jsx` vs `react` has implications
6. **Mention dynamic tool loading** from MCP in Part 11 introduction

---

## Conclusion

The tutorials provide a **solid progression** and the actual implementation **faithfully follows** the tutorial architecture. Most gaps are:
- Additions (error recovery, logging, polish)
- Extensions (MCP tools, fuzzy matching)
- Refinements (permission hardening, cost tracking)

**This is a YELLOW verdict overall** because:
- Readers following tutorials will get a working agent (✓)
- But production code is significantly more sophisticated (⚠️)
- Some early details (models, imports) need updates (⚠️)
- Architecture and patterns are sound (✓)


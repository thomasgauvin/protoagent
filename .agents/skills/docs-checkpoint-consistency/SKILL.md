---
name: docs-checkpoint-consistency
description: Ensures tutorial documentation and build-your-own checkpoints remain consistent when making changes. Performs forward passes (verify changes propagate to later checkpoints) and backward passes (verify features don't leak into earlier parts).
allowed-tools: read_file, write_file, edit_file, list_directory, search_files, bash
---

# Docs and Checkpoint Consistency

This skill helps maintain consistency between the tutorial documentation (`docs/build-your-own/`) and the checkpoint implementations (`protoagent-build-your-own-checkpoints/part-*/`) when making changes.

## When to Use This Skill

Use this skill when:
- Updating tutorial documentation (part-*.md files)
- Modifying checkpoint code (protoagent-build-your-own-checkpoints/part-*/)
- Adding new features that affect multiple tutorial parts
- Refactoring code that exists across multiple checkpoints
- Ensuring changes don't break the tutorial flow

## Core Concepts

### Forward Pass
Verify that changes introduced in an earlier part are carried forward to all later parts.

**Example:** If you add zod validation in part-11, check that:
- part-12 also has zod validation
- part-13 also has zod validation

### Backward Pass  
Verify that features from later parts don't leak into earlier parts where they shouldn't exist.

**Example:** Verify that:
- `sub-agent.ts` only exists in part-12 onwards (not part-11)
- `components/` directory only exists in part-13 (not part-12)
- `logger.ts` usage in runtime-config.ts only starts at part-12

## Step-by-Step Process

### Step 1: Identify the Scope of Changes

Determine:
- Which part introduced the change?
- Which parts should have this change?
- Which parts should NOT have this change?

### Step 2: Perform Forward Pass

For each file modified, check it exists and is consistent in later parts:

```bash
# Example: Checking zod validation in runtime-config.ts
echo "=== Part 11 ===" && grep "import.*zod" protoagent-build-your-own-checkpoints/part-11/src/runtime-config.ts
echo "=== Part 12 ===" && grep "import.*zod" protoagent-build-your-own-checkpoints/part-12/src/runtime-config.ts
echo "=== Part 13 ===" && grep "import.*zod" protoagent-build-your-own-checkpoints/part-13/src/runtime-config.ts
```

Key things to verify:
- File exists in expected parts
- Imports are present
- Key functions/exports are present
- Logic is consistent (may evolve but core behavior preserved)

### Step 3: Perform Backward Pass

Verify features don't exist in parts where they shouldn't:

```bash
# Example: sub-agent.ts should NOT exist before part-12
ls protoagent-build-your-own-checkpoints/part-11/src/sub-agent.ts 2>/dev/null || echo "Correct: not in part-11"
ls protoagent-build-your-own-checkpoints/part-12/src/sub-agent.ts 2>/dev/null && echo "Correct: exists in part-12"

# Example: logger usage should be silent in part-11
grep -c "logger\." protoagent-build-your-own-checkpoints/part-11/src/runtime-config.ts || echo "Should be minimal/none in part-11"
```

### Step 4: Verify Inter-Checkpoint Diffs Match Tutorial

This is critical: The differences between consecutive checkpoints should EXACTLY match what the tutorial teaches in that part. No extra changes, no missing changes.

**Generate a diff between consecutive parts:**
```bash
# Compare part-N with part-(N+1) for the files changed in that part
# Example: part-11 introduces MCP, so check those files
diff -u protoagent-build-your-own-checkpoints/part-10/src/config.tsx \
         protoagent-build-your-own-checkpoints/part-11/src/config.tsx | head -50
```

**Check all files that should have changed:**
```bash
# List all files that differ between two parts
diff -qr protoagent-build-your-own-checkpoints/part-10/ \
            protoagent-build-your-own-checkpoints/part-11/ | grep -v ".git"
```

**What to verify:**
- Only files mentioned in the tutorial should have changed
- Changes should match the code blocks shown in the tutorial
- New files in part-N should be introduced in part-N's tutorial section
- No "surprise" changes that aren't documented

**Red flags:**
- A file changed in the checkpoint but not mentioned in the tutorial
- The diff shows refactors that aren't part of the lesson
- Missing files that should have been added
- Extra dependencies in package.json not mentioned in install instructions

### Step 5: Update Documentation

If the change introduces new concepts:
1. Update the relevant part-*.md file
2. Ensure code blocks match the checkpoint diff exactly
3. Add explanations for new dependencies or patterns
4. Mention if the pattern continues in later parts

### Step 6: Run Tests

Always run tests after modifications:
```bash
npm test
```

## Common Patterns to Check

### Adding a New Dependency
- **Forward pass:** Check package.json in all later parts
- **Backward pass:** Ensure earlier parts don't import from it
- **Docs:** Update install command in the relevant part-*.md

### Adding a New File
- **Forward pass:** File exists in all later parts
- **Backward pass:** File does NOT exist in earlier parts
- **Docs:** Update file listing/structure in tutorial

### Modifying an Existing Function
- **Forward pass:** Function exists with similar signature in later parts
- **Backward pass:** Earlier parts use appropriate simpler version
- **Docs:** Update code examples in tutorial

### Adding Runtime Validation
- **Forward pass:** Validation present in all config loading paths
- **Backward pass:** Earlier parts either lack it or have simpler version
- **Docs:** Explain validation purpose and error messages

## Checklist Template

When updating docs/checkpoints, verify:

- [ ] **Forward Pass**: Change is present in all parts >= introduction part
- [ ] **Backward Pass**: Change is absent in all parts < introduction part  
- [ ] **Inter-Checkpoint Diff**: Only expected files changed between consecutive parts
- [ ] **Package.json**: Dependencies updated in all affected checkpoints
- [ ] **Imports**: All import statements correct in all parts
- [ ] **Exports**: Public API consistent where expected
- [ ] **Documentation**: Tutorial text matches checkpoint code
- [ ] **Tests**: All tests pass after changes

## Example: Adding Zod Validation

**Change introduced in:** part-11

**Forward pass verification:**
```bash
echo "=== Checking zod in runtime-config.ts ==="
for part in part-11 part-12 part-13; do
  echo "$part:"
  grep "import.*zod" protoagent-build-your-own-checkpoints/$part/src/runtime-config.ts
done
```

**Backward pass verification:**
```bash
echo "=== Checking zod NOT in earlier parts ==="
for part in part-3 part-4 part-10; do
  echo "$part:"
  grep "zod" protoagent-build-your-own-checkpoints/$part/src/config.tsx 2>/dev/null || echo "  Correct: not present"
done
```

**Documentation update:**
- Update part-11.md install command to include zod
- Add zod schema definition to runtime-config.ts code block
- Add validation logic to readRuntimeConfigFile code block
- Update imports section to include RuntimeConfigFileSchema

**Inter-checkpoint diff verification:**
```bash
# Only these files should differ between part-10 and part-11:
# - src/runtime-config.ts (new file)
# - src/config.tsx (imports + template update)
# - src/mcp.ts (new file)
# - src/providers.ts (updated)
# - src/App.tsx (updated)
# - package.json (new dependency)
# - part-11.md (tutorial doc - doesn't affect checkpoint)

diff -qr protoagent-build-your-own-checkpoints/part-10/ \
            protoagent-build-your-own-checkpoints/part-11/ | grep -v ".git"
```

If you see unexpected files changing (e.g., `src/agentic-loop.ts`), investigate why.

## Troubleshooting

### Feature appears in wrong part
**Fix:** Remove the feature from the earlier checkpoint, or move the feature introduction to the correct part in docs.

### Missing in later parts
**Fix:** Copy the implementation from the introducing part to all later parts, adapting as needed for context.

### Tests fail after checkpoint changes
**Fix:** Check if the test imports from src/ or uses getInitConfigPath - these may need aliases or the checkpoint may need to export the expected API.

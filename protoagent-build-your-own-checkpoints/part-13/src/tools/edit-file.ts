/**
 * edit_file tool — Find-and-replace in an existing file. Requires approval.
 *
 * Uses a fuzzy match cascade of 5 strategies to find the old_string,
 * tolerating minor whitespace discrepancies from the model.
 * Returns a unified diff on success so the model can verify its edit.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath, getWorkingDirectory } from '../utils/path-validation.js';
import { requestApproval } from '../utils/approval.js';
import { checkReadBefore, recordRead } from '../utils/file-time.js';

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

// ─── Path suggestion helper (mirrors read_file behaviour) ───

async function findSimilarPaths(requestedPath: string): Promise<string[]> {
  const cwd = getWorkingDirectory();
  const segments = requestedPath.split('/').filter(Boolean);
  const MAX_DEPTH = 6;
  const MAX_ENTRIES = 200;
  const MAX_SUGGESTIONS = 3;
  const candidates: string[] = [];

  async function walkSegments(dir: string, segIndex: number, currentPath: string): Promise<void> {
    if (segIndex >= segments.length || segIndex >= MAX_DEPTH || candidates.length >= MAX_SUGGESTIONS) return;
    const targetSegment = segments[segIndex].toLowerCase();
    let entries: string[];
    try {
      entries = (await fs.readdir(dir, { withFileTypes: true })).slice(0, MAX_ENTRIES).map(e => e.name);
    } catch {
      return;
    }
    const isLastSegment = segIndex === segments.length - 1;
    for (const entry of entries) {
      if (candidates.length >= MAX_SUGGESTIONS) break;
      const entryLower = entry.toLowerCase();
      if (!entryLower.includes(targetSegment) && !targetSegment.includes(entryLower)) continue;
      const entryPath = path.join(currentPath, entry);
      const fullPath = path.join(dir, entry);
      if (isLastSegment) {
        try { await fs.stat(fullPath); candidates.push(entryPath); } catch { /* skip */ }
      } else {
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isDirectory()) await walkSegments(fullPath, segIndex + 1, entryPath);
        } catch { /* skip */ }
      }
    }
  }

  await walkSegments(cwd, 0, '');
  return candidates;
}

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
    const searchLines = oldString.split('\n').map(l => l.trim());
    const contentLines = content.split('\n');

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
        return contentLines.slice(i, i + searchLines.length).join('\n');
      }
    }
    return null;
  },
};

/** Strategy 3: Strip common leading indent from both before comparing. */
const indentFlexReplacer: MatchStrategy = {
  name: 'indent-flexible',
  findMatch(content, oldString) {
    const oldLines = oldString.split('\n');
    const commonIndent = getCommonIndent(oldLines);
    if (commonIndent === 0) return null;

    const stripped = oldLines.map(l => l.slice(commonIndent)).join('\n');
    const contentLines = content.split('\n');

    for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
      const fileSlice = contentLines.slice(i, i + oldLines.length);
      const fileCommonIndent = getCommonIndent(fileSlice);
      const fileStripped = fileSlice.map(l => l.slice(fileCommonIndent)).join('\n');

      if (fileStripped === stripped) {
        return fileSlice.join('\n');
      }
    }
    return null;
  },
};

/** Strategy 4: Collapse all whitespace runs to single space before comparing. */
const whitespaceNormReplacer: MatchStrategy = {
  name: 'whitespace-normalized',
  findMatch(content, oldString) {
    const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
    const target = normalize(oldString);
    if (!target) return null;

    const contentLines = content.split('\n');
    const oldLineCount = oldString.split('\n').length;

    // Slide a window of oldLineCount lines across the file
    for (let i = 0; i <= contentLines.length - oldLineCount; i++) {
      const window = contentLines.slice(i, i + oldLineCount).join('\n');
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
 * Count non-overlapping occurrences of `needle` in `haystack`.
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
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

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
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
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

    diffLines.push(`@@ -${ctxBefore + 1},${oldHunkSize} +${ctxBefore + 1},${newHunkSize} @@`);

    // Context before
    for (let k = ctxBefore; k < hunk.oldStart; k++) {
      diffLines.push(` ${oldLines[k]}`);
    }

    // Removed lines
    for (const line of hunk.oldLines) {
      diffLines.push(`-${line}`);
    }

    // Added lines
    for (const line of hunk.newLines) {
      diffLines.push(`+${line}`);
    }

    // Context after
    for (let k = hunk.oldStart + hunk.oldLines.length; k < ctxAfterOld; k++) {
      diffLines.push(` ${oldLines[k]}`);
    }
  }

  if (totalChanged > 50) {
    diffLines.push('... (truncated)');
  }

  return diffLines.join('\n');
}

// ─── Main editFile function ───

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

  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      const suggestions = await findSimilarPaths(filePath);
      let msg = `File not found: '${filePath}'.`;
      if (suggestions.length > 0) {
        msg += ' Did you mean one of these?\n' + suggestions.map(s => `  ${s}`).join('\n');
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

  // Use fuzzy match cascade
  const match = findWithCascade(content, oldString, expectedReplacements);

  if (!match) {
    // Check if we found it with wrong count
    for (const strategy of STRATEGIES) {
      const actual = strategy.findMatch(content, oldString);
      if (actual) {
        const count = countOccurrences(content, actual);
        return `Error: found ${count} occurrence(s) of old_string (via ${strategy.name} match), but expected ${expectedReplacements}. Be more specific or set expected_replacements=${count}.`;
      }
    }

    // Build a per-strategy diagnostic to help the model self-correct without
    // requiring a full re-read. For each strategy, find the closest partial
    // match and report ALL lines where it diverges (not just the first).
    const searchLines = oldString.split('\n');
    const contentLines = content.split('\n');
    const diagnostics: string[] = [];

    for (const strategy of STRATEGIES) {
      // Find the window in the file that shares the most lines with oldString
      let bestWindowStart = -1;
      let bestMatchedLines = 0;

      for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
        let matched = 0;
        for (let j = 0; j < searchLines.length; j++) {
          const fileLine = strategy.name === 'whitespace-normalized'
            ? contentLines[i + j].replace(/\s+/g, ' ').trim()
            : contentLines[i + j].trim();
          const searchLine = strategy.name === 'whitespace-normalized'
            ? searchLines[j].replace(/\s+/g, ' ').trim()
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
            ? fileLine.replace(/\s+/g, ' ').trim()
            : fileLine.trim();
          const searchNorm = strategy.name === 'whitespace-normalized'
            ? searchLine.replace(/\s+/g, ' ').trim()
            : searchLine.trim();
          if (fileNorm !== searchNorm) {
            diffLines.push(
              `    line ${bestWindowStart + j + 1}:\n` +
              `      yours: ${searchLine.trim().slice(0, 120)}\n` +
              `      file:  ${fileLine.trim().slice(0, 120)}`
            );
          }
        }
        const truncNote = diffLines.length === MAX_DIFFS ? `\n    ... (more diffs not shown)` : '';
        diagnostics.push(
          `  ${strategy.name}: ${bestMatchedLines}/${searchLines.length} lines match, ${searchLines.length - bestMatchedLines} differ:\n` +
          diffLines.join('\n') + truncNote
        );
      } else if (bestMatchedLines === 0) {
        diagnostics.push(`  ${strategy.name}: no lines matched — old_string may be from a different file or heavily rewritten`);
      } else {
        diagnostics.push(`  ${strategy.name}: no partial match found`);
      }
    }

    const hint = diagnostics.length > 0
      ? '\nDiagnostics per strategy:\n' + diagnostics.join('\n')
      : '';
    return `Error: old_string not found in ${filePath}.${hint}\nDo NOT retry with a guess. Call read_file on ${filePath} first to get the exact current content, then construct old_string by copying verbatim from the file.`;
  }

  const { actual, strategy, count } = match;

  // Request approval
  const oldPreview = oldString.length > 200 ? oldString.slice(0, 200) + '...' : oldString;
  const newPreview = newString.length > 200 ? newString.slice(0, 200) + '...' : newString;
  const strategyNote = strategy !== 'exact' ? ` [matched via ${strategy}]` : '';

  const approved = await requestApproval({
    id: `edit-${Date.now()}`,
    type: 'file_edit',
    description: `Edit file: ${filePath} (${count} replacement${count > 1 ? 's' : ''})${strategyNote}`,
    detail: `Replace:\n${oldPreview}\n\nWith:\n${newPreview}`,
    sessionId,
    sessionScopeKey: `file_edit:${validated}`,
  });

  if (!approved) {
    return `Operation cancelled: edit to ${filePath} was rejected by user.`;
  }

  // Perform replacement using the actual matched string (not the model's version)
  const newContent = content.split(actual).join(newString);
  const directory = path.dirname(validated);
  const tempPath = path.join(directory, `.protoagent-edit-${process.pid}-${Date.now()}-${path.basename(validated)}`);
  try {
    await fs.writeFile(tempPath, newContent, 'utf8');
    await fs.rename(tempPath, validated);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }

  // Re-read file after write (captures any formatter changes)
  // Also record the read so subsequent edits don't fail the mtime check
  const finalContent = await fs.readFile(validated, 'utf8');
  if (sessionId) {
    recordRead(sessionId, validated);
  }

  // Compute and return unified diff
  const diff = computeUnifiedDiff(content, finalContent, filePath);
  const header = `Successfully edited ${filePath}: ${count} replacement(s) made.`;

  if (diff) {
    return `${header}\n${diff}`;
  }
  return header;
}

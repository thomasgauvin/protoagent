/**
 * format-message.ts — plain TypeScript port of format-message.tsx (no JSX/React).
 *
 * Only exports the text-processing helpers used by the OpenTUI components.
 */

/**
 * Normalize text for transcript display.
 * - Collapses multiple consecutive newlines into a single newline
 * - Trims leading/trailing whitespace
 * - Removes leading whitespace from each line
 * - Returns empty string if text is empty/whitespace only
 */
export function normalizeTranscriptText(text: string): string {
  if (!text || !text.trim()) return ''
  return text
    .replace(/\n{2,}/g, '\n')     // Collapse multiple newlines
    .replace(/^\s+/gm, '')         // Remove leading whitespace from each line
    .trim()                        // Trim overall
}

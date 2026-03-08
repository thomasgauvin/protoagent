/**
 * Parse Markdown-style formatting and convert to ANSI escape codes.
 *
 * Supports:
 * - **bold** → bold text
 * - *italic* → italic text
 * - ***bold italic*** → bold + italic text
 *
 * Returns a string with ANSI escape codes that Ink will render with styling.
 */
export function formatMessage(text: string): string {
  // ANSI escape codes for styling
  const BOLD = '\x1b[1m';
  const ITALIC = '\x1b[3m';
  const RESET = '\x1b[0m';

  let result = text;

  // Strip markdown hashtags (headers)
  result = result.replace(/^#+\s+/gm, '');

  // Replace ***bold italic*** first (to avoid matching ** or * inside)
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}${ITALIC}$1${RESET}`);

  // Replace **bold**
  result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);

  // Replace *italic*
  result = result.replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`);

  return result;
}

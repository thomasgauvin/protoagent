// src/utils/format-message.tsx

export function formatMessage(text: string): string {
  const BOLD = '\x1b[1m';
  const ITALIC = '\x1b[3m';
  const RESET = '\x1b[0m';

  let result = text;

  // Strip markdown hashtags (headers)
  result = result.replace(/^#+\s+/gm, '');

  // Replace ***bold italic*** first
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, `${BOLD}${ITALIC}$1${RESET}`);

  // Replace **bold**
  result = result.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${RESET}`);

  // Replace *italic*
  result = result.replace(/\*(.+?)\*/g, `${ITALIC}$1${RESET}`);

  return result;
}
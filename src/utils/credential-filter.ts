/**
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
  { pattern: /api[_-]?key["\']?\s*[:=]\s*["\']?[a-zA-Z0-9_\-]{20,}/gi, replacement: 'api_key=***REDACTED***' },
  // Bearer tokens
  { pattern: /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/g, replacement: 'Bearer ***REDACTED***' },
  // Authorization headers
  { pattern: /Authorization["\']?\s*:\s*["\']?Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi, replacement: 'Authorization: Bearer ***REDACTED***' },
  // Password patterns
  { pattern: /password["\']?\s*[:=]\s*["\']?[^\s"\']{8,}/gi, replacement: 'password=***REDACTED***' },
  // Secret patterns
  { pattern: /secret["\']?\s*[:=]\s*["\']?[a-zA-Z0-9_\-]{16,}/gi, replacement: 'secret=***REDACTED***' },
  // Token patterns
  { pattern: /token["\']?\s*[:=]\s*["\']?[a-zA-Z0-9_\-\.]{16,}/gi, replacement: 'token=***REDACTED***' },
  // AWS access keys
  { pattern: /AKIA[0-9A-Z]{16}/g, replacement: 'AKIA***REDACTED***' },
  // Private keys (SSH, PEM)
  { pattern: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g, replacement: '***PRIVATE_KEY_REDACTED***' },
];

/**
 * Redact credentials from a string.
 *
 * @param text - The text to redact
 * @returns Text with credentials replaced
 *
 * Example:
 * ```typescript
 * const safe = maskCredentials("Error: API key sk-abc123 failed");
 * // Result: "Error: API key sk-***REDACTED*** failed"
 * ```
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
  return `${redacted.slice(0, half)}... (truncated, ${redacted.length} chars) ...${redacted.slice(-half)}`;
}

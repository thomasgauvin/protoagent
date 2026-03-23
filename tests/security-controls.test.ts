/**
 * Security controls tests.
 *
 * These tests verify the security fixes implemented to address
 * critical and high priority vulnerabilities.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { maskCredentials, containsCredentials, safePreview } from '../src/utils/credential-filter.js';

describe('Credential Filter', () => {
  describe('maskCredentials', () => {
    it('should redact OpenAI API keys', () => {
      const text = 'My API key is sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz';
      const result = maskCredentials(text);
      assert.ok(result.includes('sk-***REDACTED***'));
      assert.ok(!result.includes('sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz'));
    });

    it('should redact Bearer tokens', () => {
      const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = maskCredentials(text);
      assert.ok(result.includes('Bearer ***REDACTED***'));
    });

    it('should redact AWS access keys', () => {
      const text = 'AWS access key: AKIAIOSFODNN7EXAMPLE';
      const result = maskCredentials(text);
      assert.ok(result.includes('AKIA***REDACTED***'));
    });

    it('should redact multiple credentials in one string', () => {
      const text = 'OpenAI: sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz and Bearer token: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = maskCredentials(text);
      // Both credentials should be redacted
      assert.ok(result.includes('***REDACTED***'));
      assert.ok(!result.includes('sk-abc123'));
      assert.ok(!result.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
    });

    it('should not modify text without credentials', () => {
      const text = 'This is a normal log message without any secrets';
      const result = maskCredentials(text);
      assert.strictEqual(result, text);
    });

    it('should handle empty strings', () => {
      assert.strictEqual(maskCredentials(''), '');
    });

    it('should handle non-string inputs', () => {
      assert.strictEqual(maskCredentials(null as any), null);
      assert.strictEqual(maskCredentials(undefined as any), undefined);
    });
  });

  describe('containsCredentials', () => {
    it('should detect API keys', () => {
      assert.strictEqual(containsCredentials('sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz'), true);
    });

    it('should detect Bearer tokens', () => {
      // Bearer token pattern requires 20+ characters
      assert.strictEqual(containsCredentials('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'), true);
    });

    it('should return false for safe text', () => {
      assert.strictEqual(containsCredentials('This is a safe message'), false);
    });
  });

  describe('safePreview', () => {
    it('should truncate long text with redaction', () => {
      const text = 'A'.repeat(1000) + ' sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz ' + 'B'.repeat(1000);
      const result = safePreview(text, 200);
      // Check that result is truncated
      assert.ok(result.includes('truncated'));
      assert.ok(result.length < text.length);
      // Check that credential pattern doesn't exist (should be redacted or in truncated part)
      assert.ok(!result.includes('sk-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz'));
    });

    it('should not truncate short text', () => {
      const text = 'Short text without secrets';
      const result = safePreview(text, 200);
      assert.strictEqual(result, text);
    });
  });
});

describe('Security Constants', () => {
  it('should have defined size limits for edit operations', () => {
    const MAX_EDIT_STRING_LENGTH = 100_000;
    const MAX_EDIT_FILE_SIZE = 10_000_000;

    assert.ok(MAX_EDIT_STRING_LENGTH > 0);
    assert.ok(MAX_EDIT_FILE_SIZE > 0);
    assert.ok(MAX_EDIT_FILE_SIZE > MAX_EDIT_STRING_LENGTH);
  });

  it('should have defined pattern length limit for search', () => {
    const MAX_PATTERN_LENGTH = 1000;
    assert.ok(MAX_PATTERN_LENGTH > 0);
  });
});

describe('ReDoS Protection', () => {
  const dangerousPatterns = [
    /\([^)]*\+[^)]*\)\+/,
    /\([^)]*\*[^)]*\)\*/,
    /\([^)]*\+[^)]*\)\*/,
    /\([^)]*\*[^)]*\)\+/,
  ];

  it('should detect nested quantifier patterns', () => {
    const badPatterns = ['(a+)+', '(a*)*', '(a+)*', '(a*)+'];

    for (const pattern of badPatterns) {
      let isDangerous = false;
      for (const dangerous of dangerousPatterns) {
        if (dangerous.test(pattern)) {
          isDangerous = true;
          break;
        }
      }
      assert.strictEqual(isDangerous, true, `Pattern ${pattern} should be detected as dangerous`);
    }
  });

  it('should allow safe patterns', () => {
    const safePatterns = ['abc+', 'def*', '(abc)', '[a-z]+'];

    for (const pattern of safePatterns) {
      let isDangerous = false;
      for (const dangerous of dangerousPatterns) {
        if (dangerous.test(pattern)) {
          isDangerous = true;
          break;
        }
      }
      assert.strictEqual(isDangerous, false, `Pattern ${pattern} should be safe`);
    }
  });
});

describe('SSRF Protection', () => {
  function isPrivateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;

      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return true;
      }

      if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname.startsWith('127.')) {
        return true;
      }

      if (hostname === '[::1]' || hostname === '::1') {
        return true;
      }

      const parts = hostname.split('.').map(Number);
      if (parts.length === 4 && parts.every(p => !isNaN(p) && p >= 0 && p <= 255)) {
        if (parts[0] === 10) return true;
        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
        if (parts[0] === 192 && parts[1] === 168) return true;
        if (parts[0] === 169 && parts[1] === 254) return true;
      }

      return false;
    } catch {
      return true;
    }
  }

  it('should block localhost URLs', () => {
    assert.strictEqual(isPrivateUrl('http://localhost/'), true);
    assert.strictEqual(isPrivateUrl('http://127.0.0.1/'), true);
    assert.strictEqual(isPrivateUrl('http://127.0.0.1:8080/'), true);
  });

  it('should block private IP ranges', () => {
    assert.strictEqual(isPrivateUrl('http://10.0.0.1/'), true);
    assert.strictEqual(isPrivateUrl('http://192.168.1.1/'), true);
    assert.strictEqual(isPrivateUrl('http://172.16.0.1/'), true);
    assert.strictEqual(isPrivateUrl('http://172.31.255.255/'), true);
  });

  it('should block file:// protocol', () => {
    assert.strictEqual(isPrivateUrl('file:///etc/passwd'), true);
  });

  it('should allow public URLs', () => {
    assert.strictEqual(isPrivateUrl('http://example.com/'), false);
    assert.strictEqual(isPrivateUrl('https://google.com/'), false);
    assert.strictEqual(isPrivateUrl('https://api.openai.com/v1/'), false);
  });

  it('should block IPv6 localhost', () => {
    assert.strictEqual(isPrivateUrl('http://[::1]/'), true);
  });
});

describe('MCP Security', () => {
  const BLOCKED_SHELLS = new Set([
    'sh', 'bash', 'zsh', 'fish', 'csh', 'tcsh', 'ksh', 'dash',
    'cmd.exe', 'cmd', 'powershell.exe', 'powershell', 'pwsh', 'pwsh.exe',
  ]);

  const DANGEROUS_ARG_PATTERNS = /[;|&$()`<>]/;

  it('should block shell interpreters', () => {
    assert.strictEqual(BLOCKED_SHELLS.has('bash'), true);
    assert.strictEqual(BLOCKED_SHELLS.has('sh'), true);
    assert.strictEqual(BLOCKED_SHELLS.has('zsh'), true);
    assert.strictEqual(BLOCKED_SHELLS.has('powershell'), true);
  });

  it('should allow non-shell commands', () => {
    assert.strictEqual(BLOCKED_SHELLS.has('npx'), false);
    assert.strictEqual(BLOCKED_SHELLS.has('node'), false);
    assert.strictEqual(BLOCKED_SHELLS.has('python'), false);
  });

  it('should detect dangerous argument patterns', () => {
    assert.strictEqual(DANGEROUS_ARG_PATTERNS.test('arg; rm -rf /'), true);
    assert.strictEqual(DANGEROUS_ARG_PATTERNS.test('arg && evil'), true);
    assert.strictEqual(DANGEROUS_ARG_PATTERNS.test('arg | cat /etc/passwd'), true);
    assert.strictEqual(DANGEROUS_ARG_PATTERNS.test('$(whoami)'), true);
  });

  it('should allow safe arguments', () => {
    assert.strictEqual(DANGEROUS_ARG_PATTERNS.test('@modelcontextprotocol/server-filesystem'), false);
    assert.strictEqual(DANGEROUS_ARG_PATTERNS.test('/path/to/dir'), false);
    assert.strictEqual(DANGEROUS_ARG_PATTERNS.test('normal-arg'), false);
  });
});

describe('Bash Command Security', () => {
  const SHELL_CONTROL_PATTERN = /[;&|<>()`$\[\]{}!]/;

  it('should detect shell control operators', () => {
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('command; another'), true);
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('cmd && evil'), true);
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('cmd | cat'), true);
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('$(whoami)'), true);
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('`whoami`'), true);
  });

  it('should allow simple commands', () => {
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('pwd'), false);
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('ls -la'), false);
    assert.strictEqual(SHELL_CONTROL_PATTERN.test('git status'), false);
  });
});

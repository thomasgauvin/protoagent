/**
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
      codeBlockStyle: "fenced",  // ```code```, not indented
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
  const match = contentType.match(/charset=([^\s;]+)/i);
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
      `\n\n[Content truncated: ${output.length} characters exceeds ${maxSize} limit]`
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
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join("\n");
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
    return `\`\`\`html\n${html}\n\`\`\``;
  }
}

/**
 * Fetch with redirect limiting
 */
async function fetchWithRedirectLimit(
  url: string,
  signal: AbortSignal,
): Promise<Response> {
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
        continue;
      }
    }

    return response;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

/**
 * Fetch and process a URL
 *
 * @param url - HTTP(S) URL to fetch
 * @param format - Output format: 'text', 'markdown', or 'html'
 * @param timeout - Optional timeout in seconds (default 30, max 120)
 * @param abortSignal - Optional AbortSignal for cancellation
 * @returns Object with output, title, and metadata
 * @throws Error on validation, network, or processing failures
 */
export async function webfetch(
  url: string,
  format: "text" | "markdown" | "html",
  timeout?: number,
  abortSignal?: AbortSignal,
): Promise<{
  output: string;
  title: string;
  metadata: Record<string, unknown>;
}> {
  // Check abort before starting
  if (abortSignal?.aborted) {
    throw new Error("Fetch aborted by user (before execution)");
  }

  // Validate URL
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("Invalid URL format. Must start with http:// or https://");
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(
      `URL too long (${url.length} characters, max ${MAX_URL_LENGTH})`,
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

  // Setup abort controller that respects both timeout and external abortSignal
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  // Link external abortSignal to our controller
  let abortListener: (() => void) | undefined;
  if (abortSignal) {
    abortListener = () => controller.abort();
    abortSignal.addEventListener('abort', abortListener, { once: true });
  }

  try {
    const startTime = Date.now();

    // Fetch with redirect limiting
    const response = await fetchWithRedirectLimit(url, controller.signal);

    // Check HTTP status
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} error: ${response.statusText}`);
    }

    // Validate response size by header
    const contentLength = response.headers.get("content-length");
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(
        `Response too large (exceeds 5MB limit). Content-Length: ${contentLength}`,
      );
    }

    // Get content type
    const contentType = response.headers.get("content-type") ?? "text/plain";

    // Check if content type is text-based
    if (!isTextMimeType(contentType)) {
      throw new Error(
        `Content type '${contentType}' is not supported. Only text-based formats are allowed.`,
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
        `Response too large (exceeds 5MB limit). Size: ${arrayBuffer.byteLength}`,
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
        : `\`\`\`\n${content}\n\`\`\``;
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
    const title = `${url} (${contentType})`;
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
    // Clean up abort listener
    if (abortListener && abortSignal) {
      abortSignal.removeEventListener('abort', abortListener);
    }

    // Handle AbortError (timeout or user cancellation)
    if (error instanceof Error && error.name === "AbortError") {
      // Distinguish between user abort and timeout
      if (abortSignal?.aborted) {
        throw new Error("Fetch aborted by user");
      }
      throw new Error(`Fetch timeout after ${timeoutSeconds} seconds`);
    }

    // Re-throw our errors as-is
    if (error instanceof Error) {
      throw error;
    }

    // Handle unexpected errors
    throw new Error(`Failed to fetch ${url}: ${String(error)}`);
  } finally {
    clearTimeout(timeoutId);
    // Ensure abort listener is always cleaned up
    if (abortListener && abortSignal) {
      abortSignal.removeEventListener('abort', abortListener);
    }
  }
}

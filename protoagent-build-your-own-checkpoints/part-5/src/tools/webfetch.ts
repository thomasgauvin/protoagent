// src/tools/webfetch.ts

// Webfetch tool: Fetches content from URLs and converts to different formats.
// - format='text': Uses html-to-text to strip all markup, returns plain readable text
// - format='markdown': Uses turndown to preserve structure as Markdown
// - format='html': Returns raw HTML as-is
// Features: Timeout control, redirect handling (max 10), size limits (5MB response, 2MB output),
// charset detection, and HTML entity decoding.

import { convert } from 'html-to-text';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 10;
const MAX_URL_LENGTH = 4096;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
  'DNT': '1',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

const TEXT_MIME_TYPES = [
  'text/',
  'application/json',
  'application/xml',
  'application/javascript',
  'application/typescript',
];

// Lazy-loaded Turndown instance
// Lazy-loaded Turndown instance — converts HTML to Markdown
// We lazy-load because Turndown is a CommonJS module; dynamic import keeps our
// ESM output clean without forcing esbuild to bundle everything as CJS.
// Why Turndown? HTML → Markdown preserves document structure (headings, lists,
// links) in a readable format that LLMs handle better than raw HTML markup.
let _turndownService: any = null;
async function getTurndownService(): Promise<any> {
  if (!_turndownService) {
    const { default: TurndownService } = await import('turndown');
    _turndownService = new TurndownService({
      headingStyle: 'atx',       // # Heading, not underlined
      codeBlockStyle: 'fenced',  // ```code```, not indented
      bulletListMarker: '-',
      emDelimiter: '*',
    });
    // Remove noise that doesn't help LLM understanding
    _turndownService.remove(['script', 'style', 'meta', 'link']);
  }
  return _turndownService;
}

// Lazy-loaded 'he' module — decodes HTML entities like &lt; &gt; &amp;
// We lazy-load for the same CJS/ESM reason as Turndown.
// Why 'he'? Browsers and node don't have built-in HTML entity decoding that
// handles the full set (&nbsp;, &#x2713;, named entities, etc.) correctly.
let _he: typeof import('he') | null = null;
async function getHe(): Promise<typeof import('he')> {
  if (!_he) {
    const { default: he } = await import('he');
    _he = he;
  }
  return _he;
}

function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.some((type) => mimeType.includes(type));
}

function detectHTML(content: string, contentType: string): boolean {
  if (contentType.includes('text/html')) return true;
  const trimmed = content.slice(0, 1024).trim().toLowerCase();
  return /^<!doctype html|^<html|^<head|^<body|^<meta/.test(trimmed);
}

function parseCharset(contentType: string): string {
  const match = contentType.match(/charset=([^\s;]+)/i);
  if (match) {
    const charset = match[1].replace(/['"]/g, '');
    try {
      new TextDecoder(charset);
      return charset;
    } catch {
      return 'utf-8';
    }
  }
  return 'utf-8';
}

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

// Define the tool metadata for the LLM
export const webfetchTool = {
  type: 'function' as const,
  function: {
    name: 'webfetch',
    description: 'Fetch and process content from a web URL. Supports text (plain text extraction), markdown (HTML to markdown conversion), or html (raw HTML) output formats.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP(S) URL to fetch (must start with http:// or https://)',
        },
        format: {
          type: 'string',
          enum: ['text', 'markdown', 'html'],
          description: 'Output format: text (plain text), markdown (HTML to markdown), or html (raw HTML)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default 30, min 1, max 120)',
        },
      },
      required: ['url', 'format'],
    },
  },
};

function htmlToText(html: string): string {
  try {
    return convert(html, {
      wordwrap: 120,
      selectors: [
        { selector: 'img', options: { ignoreHref: true } },
        { selector: 'a', options: { ignoreHref: true } },
      ],
    });
  } catch {
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n');
  }
}

async function htmlToMarkdown(html: string): Promise<string> {
  try {
    const turndown = await getTurndownService();
    return turndown.turndown(html);
  } catch {
    return `\`\`\`html\n${html}\n\`\`\``;
  }
}

// Fetch with manual redirect handling (300 HTTP Status codes) to enforce MAX_REDIRECTS limit
async function fetchWithRedirectLimit(url: string, signal: AbortSignal): Promise<Response> {
  let redirectCount = 0;
  let currentUrl = url;

  while (redirectCount < MAX_REDIRECTS) {
    const response = await fetch(currentUrl, {
      signal,
      headers: FETCH_HEADERS,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) {
        redirectCount++;
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
    }

    return response;
  }

  throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

export async function webfetch(
  url: string,
  format: 'text' | 'markdown' | 'html',
  timeout?: number,
): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Invalid URL format. Must start with http:// or https://');
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`URL too long (${url.length} characters, max ${MAX_URL_LENGTH})`);
  }

  const timeoutSeconds = Math.min(timeout ?? 30, 120);
  if (timeoutSeconds < 1) {
    throw new Error('Timeout must be between 1 and 120 seconds');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutSeconds * 1000);

  try {
    const startTime = Date.now();
    const response = await fetchWithRedirectLimit(url, controller.signal);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} error: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (exceeds 5MB limit).`);
    }

    const contentType = response.headers.get('content-type') ?? 'text/plain';

    if (!isTextMimeType(contentType)) {
      throw new Error(`Content type '${contentType}' is not supported.`);
    }

    // Use ArrayBuffer instead of response.text() so we can:
    // 1. Check byte size before decoding (security limit)
    // 2. Decode with the correct charset from Content-Type header
    //    (response.text() always uses UTF-8, which corrupts legacy encodings)
    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      throw new Error(`Response too large (exceeds 5MB limit).`);
    }

    const charset = parseCharset(contentType);
    const decoder = new TextDecoder(charset, { fatal: false });
    const content = decoder.decode(arrayBuffer);
    const isHTML = detectHTML(content, contentType);

    let output: string;
    if (format === 'text') {
      output = isHTML ? htmlToText(content) : content;
    } else if (format === 'markdown') {
      output = isHTML ? await htmlToMarkdown(content) : `\`\`\`\n${content}\n\`\`\``;
    } else {
      output = content;
    }

    if (format !== 'html') {
      const he = await getHe();
      output = he.decode(output);
    }

    output = truncateOutput(output, MAX_OUTPUT_SIZE);

    const fetchTime = Date.now() - startTime;
    return {
      output,
      title: `${url} (${contentType})`,
      metadata: { url, format, contentType, charset, contentLength: arrayBuffer.byteLength, outputLength: output.length, fetchTime },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Fetch timeout after ${timeoutSeconds} seconds`);
    }
    if (error instanceof Error) throw error;
    throw new Error(`Failed to fetch ${url}: ${String(error)}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
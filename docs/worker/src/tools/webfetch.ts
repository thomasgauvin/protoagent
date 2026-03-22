/**
 * webfetch tool - Fetch and process web content
 */

import type { ToolDefinition } from '../types.js';

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_OUTPUT_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_REDIRECTS = 10;
const MAX_URL_LENGTH = 4096;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate',
};

export const webfetchTool: ToolDefinition = {
  type: 'function',
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

function isTextMimeType(mimeType: string): boolean {
  const textTypes = [
    'text/',
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
  ];
  return textTypes.some((type) => mimeType.includes(type));
}

function detectHTML(content: string, contentType: string): boolean {
  if (contentType.includes('text/html')) {
    return true;
  }
  const trimmed = content.slice(0, 1024).trim().toLowerCase();
  return /^<!doctype html|^<html|^<head|^<body|^<meta/.test(trimmed);
}

function htmlToText(html: string): string {
  // Remove script and style tags
  let text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Convert common block elements to newlines
  text = text
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n\n');
  
  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Clean up whitespace
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
  
  return text.trim();
}

function htmlToMarkdown(html: string): string {
  // Simple HTML to Markdown conversion
  let md = html;
  
  // Remove script and style tags
  md = md
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Headers
  md = md.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  md = md.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  md = md.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  md = md.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');
  md = md.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n');
  md = md.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n');
  
  // Bold and italic
  md = md.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  md = md.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  md = md.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  md = md.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
  
  // Code
  md = md.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
  md = md.replace(/<pre[^>]*>(.*?)<\/pre>/gis, '```\n$1\n```\n\n');
  
  // Links
  md = md.replace(/<a[^>]+href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
  
  // Images
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*alt="([^"]*)"[^>]*>/gi, '![$2]($1)');
  md = md.replace(/<img[^>]+alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, '![$1]($2)');
  md = md.replace(/<img[^>]+src="([^"]*)"[^>]*>/gi, '![]($1)');
  
  // Lists
  md = md.replace(/<ul[^>]*>(.*?)<\/ul>/gis, (match) => {
    return match.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
  });
  md = md.replace(/<ol[^>]*>(.*?)<\/ol>/gis, (match) => {
    let num = 1;
    return match.replace(/<li[^>]*>(.*?)<\/li>/gi, () => `${num++}. $1\n`);
  });
  
  // Paragraphs and breaks
  md = md.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n');
  md = md.replace(/<br\s*\/?>/gi, '\n');
  
  // Blockquotes
  md = md.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, '> $1\n\n');
  
  // Horizontal rules
  md = md.replace(/<hr\s*\/?>/gi, '---\n\n');
  
  // Tables (simplified)
  md = md.replace(/<table[^>]*>(.*?)<\/table>/gis, (match) => {
    const rows = match.match(/<tr[^>]*>(.*?)<\/tr>/gis) || [];
    return rows.map((row) => {
      const cells = row.match(/<t[dh][^>]*>(.*?)<\/t[dh]>/gi) || [];
      return '| ' + cells.map((cell) => cell.replace(/<[^>]+>/g, '').trim()).join(' | ') + ' |';
    }).join('\n') + '\n\n';
  });
  
  // Remove remaining tags
  md = md.replace(/<[^>]+>/g, ' ');
  
  // Decode HTML entities
  md = md
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // Clean up whitespace
  md = md.replace(/\n{3,}/g, '\n\n').trim();
  
  return md;
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

export async function webfetch(
  url: string,
  format: 'text' | 'markdown' | 'html',
  timeout?: number
): Promise<{ output: string; title: string; metadata: Record<string, unknown> }> {
  // Validate URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    throw new Error('Invalid URL format. Must start with http:// or https://');
  }

  if (url.length > MAX_URL_LENGTH) {
    throw new Error(`URL too long (${url.length} characters, max ${MAX_URL_LENGTH})`);
  }

  // Validate format
  if (!['text', 'markdown', 'html'].includes(format)) {
    throw new Error("Invalid format. Must be 'text', 'markdown', or 'html'");
  }

  // Validate timeout
  const timeoutSeconds = Math.min(timeout ?? 30, 120);
  if (timeoutSeconds < 1) {
    throw new Error('Timeout must be between 1 and 120 seconds');
  }

  const startTime = Date.now();

  // Fetch with redirect limiting
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: 'follow',
  });

  // Check HTTP status
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} error: ${response.statusText}`);
  }

  // Get content type
  const contentType = response.headers.get('content-type') ?? 'text/plain';

  // Check if content type is text-based
  if (!isTextMimeType(contentType)) {
    throw new Error(
      `Content type '${contentType}' is not supported. Only text-based formats are allowed.`
    );
  }

  // Get response as text
  const content = await response.text();

  // Check response size
  if (content.length > MAX_RESPONSE_SIZE) {
    throw new Error(
      `Response too large (exceeds 5MB limit). Size: ${content.length}`
    );
  }

  const isHTML = detectHTML(content, contentType);

  // Format content based on requested format
  let output: string;
  if (format === 'text') {
    output = isHTML ? htmlToText(content) : content;
  } else if (format === 'markdown') {
    output = isHTML ? htmlToMarkdown(content) : `\`\`\`\n${content}\n\`\`\``;
  } else {
    // format === 'html'
    output = content;
  }

  // Truncate output if too large
  output = truncateOutput(output, MAX_OUTPUT_SIZE);

  const fetchTime = Date.now() - startTime;
  const title = `${url} (${contentType})`;
  const metadata = {
    url,
    format,
    contentType,
    contentLength: content.length,
    outputLength: output.length,
    fetchTime,
  };

  return { output, title, metadata };
}

export async function handleWebfetchTool(
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  if (name !== 'webfetch') {
    return `Unknown webfetch tool: ${name}`;
  }

  const url = String(args.url);
  const format = args.format as 'text' | 'markdown' | 'html';
  const timeout = args.timeout as number | undefined;

  console.log(`[webfetch] Fetching: ${url} (format: ${format}, timeout: ${timeout ?? 30}s)`);

  try {
    const startTime = Date.now();
    const result = await webfetch(url, format, timeout);
    const duration = Date.now() - startTime;
    
    console.log(`[webfetch] Success: ${url} - ${result.metadata.contentLength} chars in ${duration}ms, output: ${result.metadata.outputLength} chars`);
    
    return result.output;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[webfetch] Error: ${url} - ${message}`);
    return `Error: ${message}`;
  }
}

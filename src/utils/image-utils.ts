/**
 * Image utilities for handling image input in conversations.
 *
 * Provides functions to:
 * - Detect image file paths in text
 * - Read images as base64
 * - Convert text + images to OpenAI message content format
 */

import fs from 'node:fs/promises';
import path from 'node:path';

// Supported image extensions
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

// Regex to match image paths in text
// Matches:
// - ./path/to/image.png
// - /absolute/path/image.jpg
// - path/to/image.webp
// - "path/to/image.png" or 'path/to/image.png'
const IMAGE_PATH_REGEX = /(?:["']?)([\w\-./]+\.(?:png|jpg|jpeg|webp|gif))(?:["']?)/gi;

export interface ImageContentPart {
  type: 'image_url';
  image_url: {
    url: string;
    detail?: 'low' | 'high' | 'auto';
  };
}

export interface TextContentPart {
  type: 'text';
  text: string;
}

export type ContentPart = TextContentPart | ImageContentPart;

/**
 * Check if a file extension is a supported image format.
 */
export function isImageFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Get MIME type from file extension.
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  };
  return mimeTypes[ext] || 'image/jpeg';
}

/**
 * Read an image file and return it as a base64 data URL.
 */
export async function imageToDataUrl(filePath: string): Promise<string | null> {
  try {
    // Check if file exists
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return null;

    // Read file as buffer
    const buffer = await fs.readFile(filePath);
    const base64 = buffer.toString('base64');
    const mimeType = getMimeType(filePath);

    return `data:${mimeType};base64,${base64}`;
  } catch (err) {
    return null;
  }
}

/**
 * Parse text input and extract image references.
 *
 * Detects image file paths in the text, reads them as base64,
 * and returns the content in OpenAI's multi-part format.
 *
 * Example:
 * Input: "What's in this image? ./screenshot.png"
 * Output: [
 *   { type: 'text', text: "What's in this image?" },
 *   { type: 'image_url', image_url: { url: 'data:image/png;base64,...' } }
 * ]
 */
export async function parseInputWithImages(text: string): Promise<string | ContentPart[]> {
  // Find all potential image paths
  const matches = [...text.matchAll(IMAGE_PATH_REGEX)];
  const imagePaths: { fullMatch: string; path: string; index: number }[] = [];

  for (const match of matches) {
    const potentialPath = match[1];
    if (isImageFile(potentialPath)) {
      imagePaths.push({
        fullMatch: match[0],
        path: potentialPath,
        index: match.index!,
      });
    }
  }

  // If no images found, return plain text
  if (imagePaths.length === 0) {
    return text;
  }

  // Try to read each image
  const validImages: { path: string; dataUrl: string; index: number }[] = [];
  for (const img of imagePaths) {
    const dataUrl = await imageToDataUrl(img.path);
    if (dataUrl) {
      validImages.push({ path: img.path, dataUrl, index: img.index });
    }
  }

  // If no valid images could be read, return plain text
  if (validImages.length === 0) {
    return text;
  }

  // Build content parts
  const content: ContentPart[] = [];
  let lastIndex = 0;

  for (const img of validImages) {
    // Add text before this image
    const textBefore = text.slice(lastIndex, img.index).trim();
    if (textBefore) {
      content.push({ type: 'text', text: textBefore });
    }

    // Add the image
    content.push({
      type: 'image_url',
      image_url: { url: img.dataUrl, detail: 'auto' },
    });

    // Update lastIndex to after the image path (including any quotes)
    const imgMatch = imagePaths.find(p => p.path === img.path && p.index === img.index);
    if (imgMatch) {
      lastIndex = img.index + imgMatch.fullMatch.length;
    }
  }

  // Add remaining text after last image
  const textAfter = text.slice(lastIndex).trim();
  if (textAfter) {
    content.push({ type: 'text', text: textAfter });
  }

  return content;
}

/**
 * Parse MCP tool result that might contain image data.
 *
 * Some MCP tools return images as base64. This function converts
 * such results into image content parts.
 */
export function parseMcpImageResult(result: any): ContentPart[] | null {
  // Check if result contains image data in common formats
  if (typeof result === 'object' && result !== null) {
    // Handle { type: 'image', data: 'base64...', mimeType: 'image/png' }
    if (result.type === 'image' && result.data) {
      const mimeType = result.mimeType || 'image/png';
      return [{
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${result.data}` },
      }];
    }

    // Handle { image: 'base64...', mimeType: 'image/png' }
    if (result.image && typeof result.image === 'string') {
      const mimeType = result.mimeType || 'image/png';
      return [{
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${result.image}` },
      }];
    }

    // Handle { content: [{ type: 'image', ... }] } format
    if (Array.isArray(result.content)) {
      const parts: ContentPart[] = [];
      for (const item of result.content) {
        if (item.type === 'image' && item.data) {
          const mimeType = item.mimeType || 'image/png';
          parts.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${item.data}` },
          });
        } else if (item.type === 'text' && item.text) {
          parts.push({ type: 'text', text: item.text });
        }
      }
      if (parts.length > 0) return parts;
    }
  }

  return null;
}

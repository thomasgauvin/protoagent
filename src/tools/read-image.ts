/**
 * read_image tool — Read an image file and return it as base64 for vision models.
 *
 * This tool allows the LLM to request image files to be included in the conversation
 * as base64-encoded image data that can be passed to vision-capable models.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { validatePath } from '../utils/path-validation.js';
import { handleFileNotFoundWithSuggestions } from '../utils/path-suggestions.js';

export const readImageTool = {
  type: 'function' as const,
  function: {
    name: 'read_image',
    description: 'Read an image file and return it as base64-encoded data for use with vision models. Supports PNG, JPEG, WEBP, and GIF formats.',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to the image file (relative to working directory).' },
        detail: { type: 'string', enum: ['low', 'high', 'auto'], description: 'Detail level for the image. "low" is faster and cheaper, "high" provides more detail, "auto" lets the model decide. Defaults to "auto".' },
      },
      required: ['file_path'],
    },
  },
};

// Map file extensions to MIME types
const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

// Supported image extensions
const SUPPORTED_EXTENSIONS = Object.keys(MIME_TYPES);

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'image/jpeg';
}

function isSupportedImage(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export interface ImageResult {
  success: boolean;
  mimeType?: string;
  base64?: string;
  dataUrl?: string;
  error?: string;
}

/**
 * Read an image file and return it as base64-encoded data.
 */
export async function readImage(filePath: string, detail: 'low' | 'high' | 'auto' = 'auto'): Promise<ImageResult> {
  // Validate the path
  let validated: string;
  try {
    validated = await validatePath(filePath);
  } catch (err: any) {
    if (err.message?.includes('does not exist') || err.code === 'ENOENT') {
      const suggestion = await handleFileNotFoundWithSuggestions(filePath);
      return { success: false, error: suggestion };
    }
    return { success: false, error: `Error validating path: ${err.message}` };
  }

  // Check if it's a supported image format
  if (!isSupportedImage(validated)) {
    const supported = SUPPORTED_EXTENSIONS.join(', ');
    return {
      success: false,
      error: `Unsupported image format. Supported formats: ${supported}. File: ${filePath}`
    };
  }

  // Read the file as base64
  try {
    const buffer = await fs.readFile(validated);
    const base64 = buffer.toString('base64');
    const mimeType = getMimeType(validated);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    return {
      success: true,
      mimeType,
      base64,
      dataUrl,
    };
  } catch (err: any) {
    return { success: false, error: `Error reading image: ${err.message}` };
  }
}

/**
 * Read an image file and return a string result for the tool handler.
 * On success, returns the data URL. On failure, returns an error message.
 */
export async function readImageForTool(filePath: string, detail: 'low' | 'high' | 'auto' = 'auto'): Promise<string> {
  const result = await readImage(filePath, detail);

  if (!result.success) {
    return result.error || 'Unknown error reading image';
  }

  // Return a JSON string with the image data for the LLM to use
  return JSON.stringify({
    success: true,
    mimeType: result.mimeType,
    dataUrl: result.dataUrl,
    detail,
    note: 'This image data can be included in the conversation. The data URL format is: data:{mimeType};base64,{base64}'
  }, null, 2);
}

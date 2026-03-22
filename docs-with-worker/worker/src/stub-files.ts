/**
 * Stub files loaded from the stub-files/ directory
 * These are embedded at build time and loaded into new sessions
 *
 * TO MODIFY: Edit files in stub-files/ directory, then run:
 *   node scripts/sync-stub-files.mjs
 */

interface StubFile {
  path: string;
  content: string;
}

export const stubFiles: StubFile[] = [
  {
    path: "docs/guide.md",
    content: `# Getting Started Guide

## Your Virtual Workspace

This is a sandboxed filesystem where you can:
- Create and edit files
- Build small projects
- Experiment with code
- Save notes and documentation

## Tips

- Use the AI assistant to help with coding tasks
- Files persist for the lifetime of your session
- Try creating a TODO list to track your work
- Check \`/quota\` to see your daily message limit

## Example Commands

Try asking the AI:
- "Create a React component"
- "Refactor the main.ts file"
- "Search for all TODO comments"
- "Show me the project structure"
`,
  },
  {
    path: "index.html",
    content: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sample Project</title>
    <style>
        body {
            font-family: system-ui, -apple-system, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            line-height: 1.6;
        }
        h1 { color: #333; }
    </style>
</head>
<body>
    <h1>Hello from ProtoAgent!</h1>
    <p>This is a sample HTML file in your virtual workspace.</p>
    <p>Edit this file or create new ones to build your project.</p>
</body>
</html>
`,
  },
  {
    path: "README.md",
    content: `# ProtoAgent Worker

A browser-based AI coding assistant running on Cloudflare Workers.

## Features

- **WebSocket Terminal**: Ghostty-web terminal interface
- **Virtual Filesystem**: SQLite-backed persistent file storage per session
- **AI Tools**: read_file, write_file, edit_file, list_directory, search_files, webfetch
- **Task Management**: todo_read, todo_write for planning

## Available Tools

1. **read_file** - Read file contents with offset/limit
2. **write_file** - Create or overwrite files
3. **edit_file** - Edit by replacing exact text
4. **list_directory** - List files and folders
5. **search_files** - Search across files
6. **webfetch** - Fetch web content
7. **todo_read/todo_write** - Task management

## Getting Started

Type a message to start chatting with the AI assistant!
Try: "Read the README" or "Show me what files exist"
`,
  },
  {
    path: "src/main.ts",
    content: `/**
 * Main entry point for the sample project
 */

export function greet(name: string): string {
  return \`Hello, \$\{name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}

// Example usage
if (import.meta.main) {
  console.log(greet('World'));
  console.log('2 + 3 =', add(2, 3));
}
`,
  },
  {
    path: "src/utils.ts",
    content: `/**
 * Utility functions
 */

export const VERSION = '1.0.0';

export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}
`,
  }
];

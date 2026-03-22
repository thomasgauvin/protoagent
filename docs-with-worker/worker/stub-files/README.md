# ProtoAgent Worker

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

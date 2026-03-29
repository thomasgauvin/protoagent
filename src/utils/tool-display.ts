// Extract the most meaningful detail from tool args based on tool type
export function extractToolDetail(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'read_file':
    case 'write_file':
    case 'edit_file':
      return typeof args.file_path === 'string' ? args.file_path : '';
    case 'list_directory':
      return typeof args.directory_path === 'string' ? args.directory_path : '(current)';
    case 'search_files':
      return typeof args.search_term === 'string' ? `"${args.search_term}"` : '';
    case 'bash':
      if (typeof args.command !== 'string') return '';
      const parts = args.command.split(/\s+/);
      return parts.slice(0, 3).join(' ') + (parts.length > 3 ? '...' : '');
    case 'todo_write':
      return Array.isArray(args.todos) ? `${args.todos.length} task(s)` : '';
    case 'todo_read':
      return 'read';
    case 'webfetch':
      return typeof args.url === 'string' ? new URL(args.url).hostname : '';
    case 'sub_agent':
      return 'nested task...';
    default: {
      // Fallback: first string argument, truncated to 30 chars
      const firstEntry = Object.entries(args).find(([, v]) => typeof v === 'string');
      if (!firstEntry) return '';
      const value = String(firstEntry[1]);
      return value.length > 30 ? value.slice(0, 30) + '...' : value;
    }
  }
}

// Format sub-agent activity: "Sub-agent read_file: src/App.tsx"
export function formatSubAgentActivity(tool: string, args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') {
    return `Sub-agent running ${tool}...`;
  }

  const detail = extractToolDetail(tool, args);
  if (!detail) {
    return `Sub-agent running ${tool}...`;
  }

  return `Sub-agent ${tool.replace(/_/g, ' ')}: ${detail}`;
}

// Format tool activity: "read_file src/App.tsx"
export function formatToolActivity(tool: string, args?: Record<string, unknown>): string {
  if (!args || typeof args !== 'object') {
    return tool;
  }

  const detail = extractToolDetail(tool, args);
  return detail ? `${tool} ${detail}` : tool;
}

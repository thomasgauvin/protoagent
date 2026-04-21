/**
 * Mirror of SLASH_COMMANDS from src/tui/App.ts.
 */
export interface SlashCommand {
  name: string
  description: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/help', description: 'Show all available commands' },
  { name: '/new', description: 'Create a new tab' },
  {
    name: '/manager',
    description: 'Open (or switch to) the Manager Agent tab',
  },
  {
    name: '/session',
    description: 'List, search, and open previous sessions',
  },
  { name: '/pop', description: 'Pop next queued message' },
  { name: '/clear', description: 'Clear the queue' },
  {
    name: '/q',
    description: 'Queue a message to run after current task',
  },
  { name: '/rename', description: 'Rename the current tab' },
  {
    name: '/fork',
    description: 'Fork this chat into a new tab with the same history',
  },
  { name: '/reconnect', description: 'Reconnect all MCP servers' },
  { name: '/loop', description: 'Setup and run a loop workflow' },
  {
    name: '/pin',
    description: 'Pin the current tab to keep it at the top',
  },
  { name: '/unpin', description: 'Unpin the current tab' },
  { name: '/web', description: 'Open the web UI in your browser' },
  { name: '/quit', description: 'Exit ProtoAgent' },
  { name: '/exit', description: 'Alias for /quit' },
]

export const HELP_TEXT = `Commands:
  /help — Show all available commands
  /new — Create a new tab
  /manager — Open (or switch to) the Manager Agent tab
  /session — List, search, and open previous sessions
  /pop — Pop next queued message
  /clear — Clear the queue
  /q — Queue a message to run after current task
  /rename — Rename the current tab
  /fork — Fork this chat into a new tab with the same history
  /reconnect — Reconnect all MCP servers
  /loop — Setup and run a loop workflow
  /pin — Pin the current tab to keep it at the top
  /unpin — Unpin the current tab
  /quit — Exit ProtoAgent
  /exit — Alias for /quit

Session management:
  /session                    List saved sessions
  /session list --page <n>    List page n of sessions
  /session open <id>          Open a session in a new tab
  /session search <query>     Search sessions by title or message content

Workflow commands:
  /loop                       Setup and run a loop workflow

Tab management:
  /pin                        Pin the current tab to keep it at the top
  /unpin                      Unpin the current tab

Message suffix:
  message /q    Queue this message (runs after current completes)
  message /new  Send this message in a new agent (new tab)

Keyboard shortcuts:
  Enter           Send message
  Shift+Enter     Newline
  Tab             Cycle workflow: Bot → Queue → Loop → Cron → Bot
  Esc             Abort running agent task
  Ctrl+T          New tab
  Ctrl+W          Close current tab
  Ctrl+L          Toggle light/dark theme
  Ctrl+1…9        Jump to tab N

Approval prompt shortcuts:
  ← / →          Move selection
  Enter          Confirm
  Esc            Reject
`

/** Case-insensitive prefix match for the slash command menu. */
export function matchSlashCommands(input: string): SlashCommand[] {
  if (!input.startsWith('/')) return []
  const q = input.toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.name.toLowerCase().startsWith(q))
}

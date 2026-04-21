/**
 * Welcome screen (mirrors src/tui/WelcomeScreen.ts). Shown when the active
 * session has no messages yet. Displays the ProtoAgent ASCII logo, a
 * prominent input, and the provider/model/sessionId footer.
 */
import { ChatInput } from './ChatInput'
import { useAppStore } from '@/store/app-store'

const LOGO_LINES = [
  '█▀█ █▀█ █▀█ ▀█▀ █▀█ ▄▀█ █▀▀ █▀▀ █▄ █ ▀█▀',
  '█▀▀ █▀▄ █▄█  █  █▄█ █▀█ █▄█ ██▄ █ ▀█  █ ',
]

export function WelcomeScreen() {
  const session = useAppStore((s) => s.session)
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 px-4 py-8 sm:px-8">
      <pre
        aria-hidden
        className="max-w-full select-none overflow-x-auto font-mono text-[0.6rem] leading-tight text-tui-primary sm:text-xs md:text-sm"
      >
        {LOGO_LINES.join('\n')}
      </pre>

      <div className="w-full max-w-2xl">
        <ChatInput
          autoFocus
          compact
          placeholder="What can I help you build?"
        />
      </div>

      {session && (
        <div className="text-center text-xs text-tui-dim">
          {session.provider} · {session.model}
          {session.id && (
            <>
              {'  '}
              <span className="block sm:inline">{session.id}</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}

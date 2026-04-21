import { cn } from '@/lib/utils'

/**
 * Braille-dot spinner matching the TUI spinner frames. The animation is
 * driven purely by CSS (see `.spinner` rule in index.css).
 */
export function Spinner({ className }: { className?: string }) {
  return <span className={cn('spinner inline-block', className)} aria-hidden />
}

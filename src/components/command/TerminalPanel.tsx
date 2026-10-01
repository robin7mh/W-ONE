import { useRef } from 'react'
import { useTerminalStream } from '@/hooks/useTerminalStream'

/**
 * Hosts the xterm.js surface. Display-only: it prints a banner and streams fake
 * log lines. No shell is attached (no execution). `active` gates the stream so
 * it only runs once the app has booted.
 */
export function TerminalPanel({ active }: { active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminalStream(containerRef, { active })

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {/* subtle scanline over the terminal */}
      <div className="pointer-events-none absolute inset-0 z-10 animate-scan bg-gradient-to-b from-cyan/[0.03] to-transparent" />
      <div ref={containerRef} className="absolute inset-0 px-3 py-2" />
    </div>
  )
}

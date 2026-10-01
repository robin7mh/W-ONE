import { useRef } from 'react'
import { useTerminalStream } from '@/hooks/useTerminalStream'

/**
 * Hosts the xterm.js surface. Display-only: it prints a banner. No shell is
 * attached (no execution).
 */
export function TerminalPanel() {
  const containerRef = useRef<HTMLDivElement>(null)
  useTerminalStream(containerRef)

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      {/* subtle scanline over the terminal */}
      <div className="pointer-events-none absolute inset-0 z-10 animate-scan bg-gradient-to-b from-cyan/[0.03] to-transparent" />
      <div ref={containerRef} className="absolute inset-0 px-3 py-2" />
    </div>
  )
}

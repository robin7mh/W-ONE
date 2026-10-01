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
      <div ref={containerRef} className="absolute inset-0 px-3 py-2" />
    </div>
  )
}

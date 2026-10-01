import { useEffect, useState } from 'react'
import { Minus, Square, Copy, X } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * Custom frameless-window controls. All calls go through the guarded
 * `window.wone` bridge, so in a plain browser (verification) they simply no-op.
 */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    window.wone?.isMaximized().then(setMaximized)
    return window.wone?.onMaximizedChange(setMaximized)
  }, [])

  const btn =
    'no-drag flex h-7 w-9 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary'

  return (
    <div className="no-drag flex items-center gap-0.5">
      <button
        type="button"
        aria-label="Minimize"
        className={cn(btn, 'hover:bg-elevated')}
        onClick={() => window.wone?.minimize()}
      >
        <Minus size={15} strokeWidth={2} />
      </button>
      <button
        type="button"
        aria-label={maximized ? 'Restore' : 'Maximize'}
        className={cn(btn, 'hover:bg-elevated')}
        onClick={() => window.wone?.toggleMaximize()}
      >
        {maximized ? <Copy size={12} strokeWidth={2} /> : <Square size={12} strokeWidth={2} />}
      </button>
      <button
        type="button"
        aria-label="Close"
        className={cn(btn, 'hover:bg-danger/90 hover:text-white')}
        onClick={() => window.wone?.close()}
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  )
}

import { cn } from '@/lib/cn'

/**
 * Decorative HUD corner ticks. Purely visual — absolutely positioned inside a
 * `relative` parent (the Panel). Kept subtle to avoid gaming kitsch.
 */
export function HudFrame({ className }: { className?: string }) {
  const corner = 'absolute h-3 w-3 border-cyan/50'
  return (
    <div className={cn('pointer-events-none absolute inset-0', className)} aria-hidden>
      <span className={cn(corner, 'left-0 top-0 border-l border-t')} />
      <span className={cn(corner, 'right-0 top-0 border-r border-t')} />
      <span className={cn(corner, 'bottom-0 left-0 border-b border-l')} />
      <span className={cn(corner, 'bottom-0 right-0 border-b border-r')} />
    </div>
  )
}

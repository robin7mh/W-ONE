import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * Menus, dropdowns and dialogs that are open right now. The browser's web
 * pages are native views on top of the UI — while anything here is open, the
 * browser shows a still picture of its page instead, so nothing is hidden
 * behind it.
 */
export const useOverlays = create<{ count: number }>(() => ({ count: 0 }))

/** Counts this menu or dialog as open while `open` is true. */
export function useOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return
    useOverlays.setState((s) => ({ count: s.count + 1 }))
    return () => useOverlays.setState((s) => ({ count: s.count - 1 }))
  }, [open])
}

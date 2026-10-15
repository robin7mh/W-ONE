import { isMac } from '@/lib/platform'

/** What the Terminal does itself with a key instead of sending it to the shell. */
export type TerminalAction = 'find' | 'prevCommand' | 'nextCommand' | 'clear'

type Keys = Pick<KeyboardEvent, 'type' | 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>

/**
 * The Terminal's own shortcuts. macOS: ⌘F find, ⌘↑/⌘↓ previous/next command,
 * ⌘K clear (like iTerm). Elsewhere Ctrl alone belongs to the shell (Ctrl+F,
 * Ctrl+K are readline keys), so the same actions sit on Ctrl+Shift.
 */
export function terminalAction(e: Keys, mac = isMac): TerminalAction | undefined {
  if (e.type !== 'keydown' || e.altKey) return undefined
  const mod = mac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey
  if (!mod) return undefined
  const key = e.key.toLowerCase()
  if (key === 'f') return 'find'
  if (key === 'k') return 'clear'
  if (key === 'arrowup') return 'prevCommand'
  if (key === 'arrowdown') return 'nextCommand'
  return undefined
}

/** How the shortcut reads on this platform, for menus and tooltips. */
export function shortcutLabel(action: TerminalAction, mac = isMac): string {
  const key = { find: 'F', clear: 'K', prevCommand: '↑', nextCommand: '↓' }[action]
  return mac ? `⌘${key}` : `Ctrl+Shift+${key}`
}

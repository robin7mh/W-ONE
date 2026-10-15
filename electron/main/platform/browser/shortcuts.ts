import type { ShortcutAction } from '../../services/browser/types'

/** The fields of Electron's `before-input-event` input that decide a shortcut. */
export interface KeyInput {
  type: string
  key: string
  meta: boolean
  control: boolean
  alt: boolean
  shift: boolean
}

/**
 * The browser's keys, as in Chrome — ⌘ on macOS, Ctrl elsewhere. Matched in
 * the main process before a page or the Mindeck UI sees the key, so they work
 * whichever has the focus (and never reach the default menu, whose ⌘R would
 * reload Mindeck itself).
 */
export function matchShortcut(input: KeyInput, mac: boolean): ShortcutAction | null {
  if (input.type !== 'keyDown') return null
  const mod = mac ? input.meta && !input.control : input.control && !input.meta
  const key = input.key.length === 1 ? input.key.toLowerCase() : input.key
  if (input.key === 'F5') return input.shift || mod ? 'hardReload' : 'reload'
  // Ctrl+Tab cycles tabs on every platform.
  if (input.control && key === 'Tab') return input.shift ? 'prevTab' : 'nextTab'
  if (!mac && input.alt && !input.control && !input.meta) {
    if (key === 'ArrowLeft') return 'back'
    if (key === 'ArrowRight') return 'forward'
  }
  if (!mod) return null
  if (input.alt) {
    if (key === 'ArrowRight') return 'nextTab'
    if (key === 'ArrowLeft') return 'prevTab'
    if (mac && (key === 'i' || input.key === 'ˆ')) return 'devtools'
    return null
  }
  if (input.shift) {
    if (key === 't') return 'reopenTab'
    if (key === 'n') return 'newPrivateTab'
    if (key === 'r') return 'hardReload'
    if (!mac && key === 'i') return 'devtools'
    if (key === '+' || key === '=') return 'zoomIn'
    if (key === ']' || key === '}') return 'nextTab'
    if (key === '[' || key === '{') return 'prevTab'
    return null
  }
  const plain: Record<string, ShortcutAction> = {
    t: 'newTab',
    w: 'closeTab',
    l: 'focusOmnibox',
    r: 'reload',
    f: 'find',
    p: 'print',
    '[': 'back',
    ']': 'forward',
    '=': 'zoomIn',
    '+': 'zoomIn',
    '-': 'zoomOut',
    '0': 'zoomReset',
    '9': 'lastTab'
  }
  if (plain[key]) return plain[key]
  if (/^[1-8]$/.test(key)) return `tab${key}` as ShortcutAction
  return null
}

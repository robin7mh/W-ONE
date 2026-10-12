/** One key press of a VS Code keybinding: modifiers plus the key (lower case: `p`, `f5`, `enter`, `/`). */
export interface KeyStroke {
  cmd: boolean
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

/**
 * VS Code's keybinding notation (`cmd+shift+p`, chords `cmd+k cmd+c`) as key
 * strokes; null when it isn't one. `cmd`, `meta` and `win` are the same key
 * (⌘ on a Mac, the Windows key elsewhere).
 */
export function parseKeybinding(binding: string): KeyStroke[] | null {
  const strokes = binding.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!strokes.length || strokes.length > 2) return null
  const parsed = strokes.map((s) => {
    // "ctrl++" — the plus key itself.
    const parts = s.endsWith('++') ? [...s.slice(0, -2).split('+'), '+'] : s.split('+')
    const key = parts.pop()!
    const stroke: KeyStroke = { cmd: false, ctrl: false, shift: false, alt: false, key }
    for (const mod of parts) {
      if (mod === 'cmd' || mod === 'meta' || mod === 'win') stroke.cmd = true
      else if (mod === 'ctrl') stroke.ctrl = true
      else if (mod === 'shift') stroke.shift = true
      else if (mod === 'alt' || mod === 'option') stroke.alt = true
      else return null
    }
    return key ? stroke : null
  })
  return parsed.every(Boolean) ? (parsed as KeyStroke[]) : null
}

const NAMED: Record<string, string> = { ' ': 'space', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right', esc: 'escape' }

/** The key of a keyboard event in VS Code's notation (layout-proof for letters and digits). */
export function eventKey(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1]
  if (letter) return letter.toLowerCase()
  const digit = /^Digit(\d)$/.exec(e.code)?.[1]
  if (digit) return digit
  const key = e.key.toLowerCase()
  return NAMED[key] ?? key
}

/** Whether a keyboard event is this key stroke. */
export function matchesStroke(stroke: KeyStroke, e: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'shiftKey' | 'altKey'>): boolean {
  return e.metaKey === stroke.cmd && e.ctrlKey === stroke.ctrl && e.shiftKey === stroke.shift && e.altKey === stroke.alt && eventKey(e) === stroke.key
}

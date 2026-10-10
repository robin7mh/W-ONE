/** Lines printed during the boot overlay. `t` = ms delay before this line; its text is `t.boot.lines[i]`. */
export interface BootLine {
  t: number
  tone: 'dim' | 'accent' | 'ok'
}

export const BOOT_LINES: BootLine[] = [
  { t: 120, tone: 'accent' },
  { t: 260, tone: 'ok' },
  { t: 200, tone: 'ok' },
  { t: 220, tone: 'ok' },
  { t: 200, tone: 'dim' },
  { t: 240, tone: 'dim' },
  { t: 260, tone: 'dim' },
  { t: 200, tone: 'dim' },
  { t: 260, tone: 'ok' },
  { t: 220, tone: 'accent' }
]

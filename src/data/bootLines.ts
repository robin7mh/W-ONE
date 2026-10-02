/** Lines printed during the boot overlay. `t` = ms delay before this line. */
export interface BootLine {
  t: number
  text: string
  tone: 'dim' | 'accent' | 'ok'
}

export const BOOT_LINES: BootLine[] = [
  { t: 120, text: 'W-ONE KERNEL v0.1.0 — cold start', tone: 'accent' },
  { t: 260, text: 'mounting core services ............ ok', tone: 'ok' },
  { t: 200, text: 'initializing HUD compositor ....... ok', tone: 'ok' },
  { t: 220, text: 'loading design tokens ............. ok', tone: 'ok' },
  { t: 200, text: 'probing system sensors ............ mock', tone: 'dim' },
  { t: 240, text: 'registering agents [CORE·SCOUT·FORGE·VAULT]', tone: 'dim' },
  { t: 260, text: 'memory vault ...................... standby', tone: 'dim' },
  { t: 200, text: 'network link ...................... LOCAL', tone: 'dim' },
  { t: 260, text: 'command interface ................. online', tone: 'ok' },
  { t: 220, text: 'W-ONE COMMAND CENTER READY', tone: 'accent' }
]

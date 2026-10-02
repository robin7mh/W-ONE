/** Zero-padded 2-digit. */
export const pad2 = (n: number): string => n.toString().padStart(2, '0')

/** Format a Date as HH:MM:SS. */
export function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

// Day/month names follow the system language (German → "DO 01 OKT 2026").
const LOCALE = navigator.language
const weekdayFmt = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' })
const monthFmt = new Intl.DateTimeFormat(LOCALE, { month: 'short' })
const noDot = (s: string) => s.replace(/\.$/, '')

/** Format a Date as e.g. "THU 01 OCT 2026" / "DO 01 OKT 2026" (uppercase, technical). */
export function formatDate(d: Date): string {
  return `${noDot(weekdayFmt.format(d))} ${pad2(d.getDate())} ${noDot(monthFmt.format(d))} ${d.getFullYear()}`.toUpperCase()
}

/** Seconds → "HH:MM:SS" uptime string. */
export function formatUptime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

/** Clamp a number into [min, max]. */
export const clamp = (v: number, min = 0, max = 100): number =>
  Math.min(max, Math.max(min, v))

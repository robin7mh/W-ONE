/** Zero-padded 2-digit. */
export const pad2 = (n: number): string => n.toString().padStart(2, '0')

/** Format a Date as HH:MM:SS. */
export function formatTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

/** Format a Date as e.g. "MON 06 JUL 2026" (uppercase, technical). */
export function formatDate(d: Date): string {
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  const months = [
    'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
    'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
  ]
  return `${days[d.getDay()]} ${pad2(d.getDate())} ${months[d.getMonth()]} ${d.getFullYear()}`
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

import { intlLocale, type Dict } from '@/lib/i18n'

/** Time-of-day greeting in the UI language. */
export function greeting(now: Date, t: Dict): string {
  const h = now.getHours()
  if (h >= 5 && h < 11) return t.dashboard.morning
  if (h >= 11 && h < 18) return t.dashboard.day
  if (h >= 18 && h < 23) return t.dashboard.evening
  return t.dashboard.night
}

/** ISO-8601 week number (what German calendars call "KW"). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function longDate(now: Date, locale: string = intlLocale()): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now)
}

import { fileType, type FileType, type FinderEntry } from '@shared/types/finder'
import { intlLocale } from '@/lib/i18n'

/** What an entry is — for its icon, the Kind column and what opening it does. */
export type EntryKind = 'dir' | 'bundle' | FileType

export function entryKind(e: Pick<FinderEntry, 'name' | 'kind' | 'bundle'>): EntryKind {
  if (e.bundle) return 'bundle'
  return e.kind === 'dir' ? 'dir' : fileType(e.name)
}

/** Sizes the way Finder shows them (1 KB = 1000 bytes). */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toLocaleString(intlLocale(), { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`
}

/** "14:03" today, else date and time — short, in the UI's language. */
export function formatModified(ms: number, now: number = Date.now()): string {
  const d = new Date(ms)
  const locale = intlLocale()
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
  if (new Date(now).toDateString() === d.toDateString()) return time
  const sameYear = new Date(now).getFullYear() === d.getFullYear()
  return `${d.toLocaleDateString(locale, { day: '2-digit', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })} ${time}`
}

/** `/Users/me/a b.png` → `/Users/me/a%20b.png` (Windows drives too: `/C%3A/…`). */
function encodePath(path: string): string {
  const posix = path.replace(/\\/g, '/')
  return (posix.startsWith('/') ? '' : '/') + posix.split('/').map(encodeURIComponent).join('/')
}

/** A local file for <img>, <video> and <audio> (the core serves `mindeck-file:` to this window only). */
export function fileUrl(path: string): string {
  return `mindeck-file://local${encodePath(path)}`
}

/** The OS's thumbnail of any file (Quick Look on macOS). */
export function thumbUrl(path: string, size = 256): string {
  return `mindeck-file://thumb${encodePath(path)}?size=${size}`
}

/** A file:// address, for the browser (HTML pages, PDFs). */
export function fileHref(path: string): string {
  return `file://${encodePath(path)}`
}

/** The last part of a path ("/" for the root). */
export function baseName(path: string): string {
  const parts = path.replace(/[\\/]+$/, '').split(/[\\/]/)
  return parts[parts.length - 1] || path
}

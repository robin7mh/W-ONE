/**
 * The dashboard speaks the system language (German or English) — it is the
 * personal surface. The rest of the UI keeps its English technical labels.
 */
const locale = navigator.language
export const isGerman = locale.toLowerCase().startsWith('de')
export const dashLocale = isGerman ? 'de-DE' : locale

const DE = {
  morning: 'Guten Morgen',
  day: 'Guten Tag',
  evening: 'Guten Abend',
  night: 'Gute Nacht',
  week: 'KW',
  cpuHigh: 'CPU stark ausgelastet',
  ramHigh: 'Arbeitsspeicher fast voll',
  diskHigh: 'Festplatte fast voll',
  batteryLow: 'Akku niedrig',
  projects: 'Projekte',
  noProjects: 'Noch keine Projekte',
  addProject: 'Projekt hinzufügen',
  changed: 'mit Änderungen',
  allClean: 'alles committet',
  clean: 'sauber',
  brain: 'Gehirn',
  notes: 'Notizen',
  links: 'Verbindungen',
  noVault: 'Noch nicht eingerichtet',
  setUp: 'Einrichten',
  openGraph: 'Graph öffnen',
  system: 'System',
  allGood: 'Alles im grünen Bereich',
  battery: 'Akku',
  charging: 'lädt',
  loading: 'lädt …',
  ask: 'Frag W-ONE …'
}

type Dict = typeof DE

const EN: Dict = {
  morning: 'Good morning',
  day: 'Good afternoon',
  evening: 'Good evening',
  night: 'Good night',
  week: 'Week',
  cpuHigh: 'CPU under heavy load',
  ramHigh: 'Memory almost full',
  diskHigh: 'Disk almost full',
  batteryLow: 'Battery low',
  projects: 'Projects',
  noProjects: 'No projects yet',
  addProject: 'Add a project',
  changed: 'with changes',
  allClean: 'all committed',
  clean: 'clean',
  brain: 'Brain',
  notes: 'notes',
  links: 'links',
  noVault: 'Not set up yet',
  setUp: 'Set up',
  openGraph: 'Open graph',
  system: 'System',
  allGood: 'All systems nominal',
  battery: 'Battery',
  charging: 'charging',
  loading: 'loading…',
  ask: 'Ask W-ONE…'
}

export const t: Dict = isGerman ? DE : EN

export function greeting(now: Date): string {
  const h = now.getHours()
  if (h >= 5 && h < 11) return t.morning
  if (h >= 11 && h < 18) return t.day
  if (h >= 18 && h < 23) return t.evening
  return t.night
}

/** ISO-8601 week number (what German calendars call "KW"). */
export function isoWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function longDate(now: Date): string {
  return new Intl.DateTimeFormat(dashLocale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(now)
}

/** Reads a theme token (space-separated RGB, see index.css) as `#rrggbb`. */
export function cssRgb(varName: string, fallback: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  if (!raw) return fallback
  const [r, g, b] = raw.split(/\s+/).map(Number)
  if ([r, g, b].some((n) => Number.isNaN(n))) return fallback
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

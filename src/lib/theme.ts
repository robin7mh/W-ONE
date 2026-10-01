import { useState } from 'react'

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'wone.theme'

/** Saved choice, else the OS appearance. Storage may be unavailable — never throw. */
export function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    /* fall through to the OS preference */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

/** Swaps the token set (index.css) — components never branch on the theme. */
export function applyTheme(theme: Theme, persist = false): void {
  document.documentElement.setAttribute('data-theme', theme)
  if (!persist) return
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* choice just won't survive a restart */
  }
}

export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (document.documentElement.getAttribute('data-theme') as Theme | null) ?? 'dark'
  )
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    applyTheme(next, true)
    setTheme(next)
  }
  return [theme, toggle]
}

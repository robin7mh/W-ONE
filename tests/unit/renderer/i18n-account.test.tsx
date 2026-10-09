import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { en } from '@/lib/i18n/en'
import { de } from '@/lib/i18n/de'
import { getT, intlLocale, systemLocale, useLocale } from '@/lib/i18n'
import { LanguageSwitch } from '@/components/ui/LanguageSwitch'
import { AccountView } from '@/features/account/components/AccountView'
import { useSession } from '@/features/session/store'

afterEach(() => {
  act(() => useLocale.setState({ locale: 'en' }))
  localStorage.clear()
})

/** Every key of `a` exists in `b` with the same kind (string / function / array / object). */
function sameShape(a: unknown, b: unknown, path = ''): string[] {
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) return [path]
  if (Array.isArray(a)) return a.length === (b as unknown[]).length ? [] : [path]
  if (a && typeof a === 'object')
    return Object.keys(a).flatMap((k) => sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`))
  return []
}

/** Calls every function in a dictionary with sample arguments; returns what they produced. */
function callAll(node: unknown): string[] {
  if (typeof node === 'function') {
    const fn = node as (...args: unknown[]) => unknown
    const samples: unknown[][] = [[], [1, 'x'], [2, 'y'], [true, undefined], [false, ''], [3, 4, true], [0, 0, false]]
    return samples.map((args) => String(fn(...args)))
  }
  if (node && typeof node === 'object') return Object.values(node).flatMap(callAll)
  return []
}

describe('dictionaries', () => {
  it('German has exactly the shape of English', () => {
    expect(sameShape(en, de)).toEqual([])
    expect(sameShape(de, en)).toEqual([])
  })

  it('every string function produces text in both languages', () => {
    for (const out of [...callAll(en), ...callAll(de)]) expect(out).not.toBe('')
  })
})

describe('locale store', () => {
  it('maps the system language', () => {
    expect(systemLocale('de-AT')).toBe('de')
    expect(systemLocale('en-GB')).toBe('en')
    expect(systemLocale('fr-FR')).toBe('en')
    expect(systemLocale()).toBe('en') // jsdom: en-US
  })

  it('switches, remembers and sets the document language', () => {
    act(() => useLocale.getState().setLocale('de'))
    expect(getT()).toBe(de)
    expect(localStorage.getItem('wone.locale')).toBe('de')
    expect(document.documentElement.lang).toBe('de')
  })

  it('keeps working without storage', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    act(() => useLocale.getState().setLocale('de'))
    expect(useLocale.getState().locale).toBe('de')
  })

  it('starts from the stored choice, else the system language', async () => {
    const load = async () => {
      vi.resetModules()
      return (await import('@/lib/i18n')).useLocale.getState().locale
    }
    localStorage.setItem('wone.locale', 'de')
    expect(await load()).toBe('de')
    localStorage.setItem('wone.locale', 'xx')
    expect(await load()).toBe('en')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(await load()).toBe('en')
  })

  it('picks an Intl locale', () => {
    expect(intlLocale('de')).toBe('de-DE')
    expect(intlLocale('en', 'en-GB')).toBe('en-GB')
    expect(intlLocale('en', 'fr-FR')).toBe('en-US')
    expect(intlLocale()).toBe('en-US')
  })
})

describe('LanguageSwitch', () => {
  it('shows the current language and switches the UI', () => {
    render(<LanguageSwitch />)
    expect(screen.getByRole('radio', { name: 'English' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('radio', { name: 'Deutsch' }))
    expect(useLocale.getState().locale).toBe('de')
    expect(screen.getByRole('radio', { name: 'Deutsch' })).toHaveAttribute('aria-checked', 'true')
  })
})

describe('AccountView', () => {
  const info = { mode: 'desktop' as const, version: '1.0.0', platform: 'darwin', hostname: 'mac', remoteTerminal: false, db: { connected: true } }

  it('shows the account state, the language switch and the linked core', () => {
    act(() => useSession.setState({ info: undefined }))
    render(<AccountView />)
    expect(screen.getByText('Not signed in')).toBeInTheDocument()
    expect(screen.getByText('Connecting…')).toBeInTheDocument()

    act(() => useSession.setState({ info }))
    expect(screen.getByText('Desktop app')).toBeInTheDocument()
    expect(screen.getByText('v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('mac')).toBeInTheDocument()
    expect(screen.getByText('online')).toBeInTheDocument()

    act(() => useSession.setState({ info: { ...info, mode: 'server', db: { connected: false } } }))
    expect(screen.getByText('Server')).toBeInTheDocument()
    expect(screen.getByText('offline')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Deutsch' }))
    expect(screen.getByText('Nicht angemeldet')).toBeInTheDocument()
    expect(screen.getByText('Datenbank')).toBeInTheDocument()
    act(() => useSession.setState({ info: undefined }))
  })
})

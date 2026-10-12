import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, OPEN_CLOUD, settle } from './bridge'
import type { SyncStatus } from '@shared/types/sync'
import { useSync } from '@/features/account/sync'
import { AccountView } from '@/features/account/components/AccountView'
import { useCloud } from '@/features/cloud/store'
import { useLocale } from '@/lib/i18n'
import { DEFAULT_APPEARANCE, toAppearance, useAppearance } from '@/lib/theme'
import { useEditorPrefs } from '@/features/editor/prefs'

const initial = useSync.getState()
const s = () => useSync.getState()
const SIGNED_IN = { ...OPEN_CLOUD, state: 'active', account: { email: 'robin@w-one.test', name: 'Robin' }, license: { plan: 'lifetime', trialLimitSeconds: 1, trialUsedSeconds: 0, trialRemainingSeconds: 1 } }
const status = (over: Partial<SyncStatus> = {}): SyncStatus => ({
  signedIn: true,
  remote: { version: 3, updatedAt: '2026-10-13T00:00:00.000Z', device: 'Studio' },
  local: { version: 3, syncedAt: '2026-10-12T22:00:00.000Z' },
  ...over
})

function bridge(over: Record<string, (p: never) => unknown> = {}) {
  return installBridge({
    'cloud:syncStatus': () => status(),
    'cloud:syncPush': () => status({ local: { version: 4, syncedAt: '2026-10-13T01:00:00.000Z' } }),
    'cloud:syncPull': () => ({ appearance: { mode: 'light', accent: 'nope' }, locale: 'de' }),
    'editor:settings': () => ({ settings: {}, snippets: [] }),
    ...over
  })
}

beforeEach(() => {
  useSync.setState(initial, true)
  useAppearance.getState().reset()
})
afterEach(() => act(() => useLocale.setState({ locale: 'en' })))

describe('appearance from elsewhere', () => {
  it('keeps what it knows, defaults the rest', () => {
    expect(toAppearance({ mode: 'light', accent: 'nope', surface: 'cyber' })).toEqual({ ...DEFAULT_APPEARANCE, mode: 'light', surface: 'cyber' })
    expect(toAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(toAppearance('dark')).toEqual(DEFAULT_APPEARANCE)
  })
})

describe('Settings Sync store', () => {
  it('saves this W-ONE’s look and language with the settings; force goes over a newer copy', async () => {
    const b = bridge()
    useAppearance.getState().update({ mode: 'light' })
    act(() => useLocale.getState().setLocale('de'))
    await s().push()
    expect(b.invoke).toHaveBeenCalledWith('cloud:syncPush', { appearance: { ...DEFAULT_APPEARANCE, mode: 'light' }, locale: 'de', force: undefined })
    expect(s()).toMatchObject({ done: 'pushed', conflict: false, busy: undefined, status: { local: { version: 4 } } })
    await s().push(true)
    expect(b.invoke).toHaveBeenLastCalledWith('cloud:syncPush', expect.objectContaining({ force: true }))
  })

  it('loads the account’s settings and applies look, language and editor settings here', async () => {
    const b = bridge()
    const load = vi.spyOn(useEditorPrefs.getState(), 'load').mockResolvedValue()
    await s().pull()
    expect(useAppearance.getState().appearance).toEqual({ ...DEFAULT_APPEARANCE, mode: 'light' })
    expect(useLocale.getState().locale).toBe('de')
    expect(load).toHaveBeenCalled()
    expect(s()).toMatchObject({ done: 'pulled', status: status() })
    expect(b.invoke).toHaveBeenCalledWith('cloud:syncStatus', undefined)
    // A copy without look or language changes neither.
    bridge({ 'cloud:syncPull': () => ({}) })
    act(() => useLocale.getState().setLocale('en'))
    await s().pull()
    expect(useLocale.getState().locale).toBe('en')
  })

  it('a newer copy elsewhere is a conflict (with who saved it); other failures show', async () => {
    bridge({ 'cloud:syncPush': () => fail('Settings were changed on another device', 'sync_conflict') })
    await s().push()
    expect(s()).toMatchObject({ conflict: true, error: undefined, status: status() })
    bridge({ 'cloud:syncPush': () => fail('W-ONE Cloud is not reachable', 'cloud-unreachable'), 'cloud:syncStatus': () => fail('offline') })
    await s().push()
    expect(s().error).toBe('W-ONE Cloud is not reachable')
    await s().load()
    expect(s().error).toBe('offline')
    s().dismiss()
    expect(s()).toMatchObject({ conflict: false, error: undefined, done: undefined })
  })

  it('sync: the newer side wins — load when the account is ahead, else save', async () => {
    const b = bridge({ 'cloud:syncStatus': () => status({ local: { version: 1, syncedAt: 'x' } }) })
    vi.spyOn(useEditorPrefs.getState(), 'load').mockResolvedValue()
    await s().sync()
    expect(b.invoke).toHaveBeenCalledWith('cloud:syncPull', undefined)
    for (const st of [status(), status({ local: null, remote: null }), undefined]) {
      const next = bridge({ 'cloud:syncStatus': () => (st ? st : fail('offline')) })
      useSync.setState({ status: undefined })
      await s().sync()
      expect(next.invoke).toHaveBeenCalledWith('cloud:syncPush', expect.anything())
    }
    // Nothing synced here yet, but the account has a copy: load it.
    const fresh = bridge({ 'cloud:syncStatus': () => status({ local: null }) })
    await s().sync()
    expect(fresh.invoke).toHaveBeenCalledWith('cloud:syncPull', undefined)
  })
})

describe('Settings Sync in the Profile', () => {
  afterEach(() => act(() => useCloud.setState({ status: null })))

  it('signed out: asks to sign in (and asks the core nothing)', () => {
    const b = bridge()
    act(() => useCloud.setState({ status: { ...OPEN_CLOUD, state: 'signed_out' } as never }))
    render(<AccountView />)
    expect(screen.getByText('Sign in to sync your settings.')).toBeInTheDocument()
    expect(b.invoke).not.toHaveBeenCalledWith('cloud:syncStatus', undefined)
  })

  it('signed in: when this machine and the account last synced; sync, save, load; the outcome', async () => {
    bridge()
    act(() => useCloud.setState({ status: SIGNED_IN as never }))
    render(<AccountView />)
    await act(settle)
    const card = screen.getByText('Settings Sync').closest('section') ?? document.body
    expect(within(card).getByText(/This machine: synced/)).toBeInTheDocument()
    expect(within(card).getByText(/Account: saved .* from Studio/)).toBeInTheDocument()
    const sync = vi.spyOn(useSync.getState(), 'sync').mockResolvedValue()
    const push = vi.spyOn(useSync.getState(), 'push').mockResolvedValue()
    const pull = vi.spyOn(useSync.getState(), 'pull').mockResolvedValue()
    fireEvent.click(within(card).getByRole('button', { name: /^Sync$/ }))
    fireEvent.click(within(card).getByRole('button', { name: /Save to account/ }))
    fireEvent.click(within(card).getByRole('button', { name: /Load from account/ }))
    expect([sync, push, pull].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
    act(() => useSync.setState({ done: 'pushed' }))
    expect(within(card).getByText('Saved to your account.')).toBeInTheDocument()
    act(() => useSync.setState({ done: 'pulled' }))
    expect(within(card).getByText('Loaded from your account.')).toBeInTheDocument()
    act(() => useSync.setState({ error: 'W-ONE Cloud is not reachable', busy: 'push' }))
    expect(within(card).getByRole('alert')).toHaveTextContent('W-ONE Cloud is not reachable')
    expect(within(card).getByRole('button', { name: /^Sync$/ })).toBeDisabled()

    // Nothing anywhere yet: nothing to load.
    act(() => useSync.setState({ busy: undefined, status: status({ remote: null, local: null }) }))
    expect(within(card).getByText('Not synced on this machine yet.')).toBeInTheDocument()
    expect(within(card).getByText('Account: nothing saved yet.')).toBeInTheDocument()
    expect(within(card).getByRole('button', { name: /Load from account/ })).toBeDisabled()
    act(() => useSync.setState({ status: status({ remote: { version: 1, updatedAt: '2026-10-13T00:00:00.000Z', device: null } }) }))
    expect(within(card).getByText(/Account: saved/).textContent).not.toContain('from')
  })

  it('a conflict: load the account’s copy, or keep mine and overwrite it', async () => {
    bridge()
    act(() => useCloud.setState({ status: SIGNED_IN as never }))
    render(<AccountView />)
    await act(settle)
    act(() => useSync.setState({ conflict: true }))
    const ask = screen.getByRole('alertdialog', { name: 'Your account has newer settings from another machine.' })
    const push = vi.spyOn(useSync.getState(), 'push').mockResolvedValue()
    const pull = vi.spyOn(useSync.getState(), 'pull').mockResolvedValue()
    fireEvent.click(within(ask).getByRole('button', { name: /Load from account/ }))
    fireEvent.click(within(ask).getByRole('button', { name: 'Keep mine (overwrite)' }))
    expect(pull).toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith(true)
    expect(screen.queryByRole('button', { name: /^Sync$/ })).toBeNull()
  })
})

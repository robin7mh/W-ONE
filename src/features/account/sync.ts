import { create } from 'zustand'
import { errorMessage, ipc, IpcError } from '@shared/ipc/client'
import type { SyncStatus } from '@shared/types/sync'
import { toAppearance, useAppearance } from '@/lib/theme'
import { useLocale } from '@/lib/i18n'
import { useEditorPrefs } from '@/features/editor/prefs'

interface SyncState {
  status?: SyncStatus
  busy?: 'push' | 'pull'
  /** The account has a newer copy than the one this W-ONE saved from. */
  conflict: boolean
  /** What the last action did. */
  done?: 'pushed' | 'pulled'
  error?: string

  load: () => Promise<void>
  /** Save to the account (force: over a newer copy). */
  push: (force?: boolean) => Promise<void>
  /** Load from the account and apply it here. */
  pull: () => Promise<void>
  /** Newer wins: load when the account has something newer, else save. */
  sync: () => Promise<void>
  dismiss: () => void
}

/** Settings Sync in the Profile: this W-ONE's settings ↔ the W-ONE account. */
export const useSync = create<SyncState>((set, get) => {
  const run = async (busy: 'push' | 'pull', fn: () => Promise<SyncStatus | void>) => {
    set({ busy, error: undefined, done: undefined })
    try {
      const status = await fn()
      set({ conflict: false, done: busy === 'push' ? 'pushed' : 'pulled', ...(status ? { status } : {}) })
      if (!status) await get().load()
    } catch (err) {
      if (err instanceof IpcError && err.code === 'sync_conflict') {
        set({ conflict: true })
        await get().load() // who saved the newer copy, and when
      } else set({ error: errorMessage(err) })
    } finally {
      set({ busy: undefined })
    }
  }

  return {
    conflict: false,

    load: async () => {
      try {
        set({ status: await ipc('cloud:syncStatus') })
      } catch (err) {
        set({ error: errorMessage(err) })
      }
    },

    push: (force) =>
      run('push', () => ipc('cloud:syncPush', { appearance: useAppearance.getState().appearance, locale: useLocale.getState().locale, force: force || undefined })),

    pull: () =>
      run('pull', async () => {
        const ui = await ipc('cloud:syncPull')
        if (ui.appearance) useAppearance.getState().update(toAppearance(ui.appearance))
        if (ui.locale) useLocale.getState().setLocale(ui.locale)
        await useEditorPrefs.getState().load()
      }),

    sync: async () => {
      await get().load()
      const { remote, local } = get().status ?? {}
      if (remote && remote.version > (local?.version ?? 0)) await get().pull()
      else await get().push()
    },

    dismiss: () => set({ conflict: false, error: undefined, done: undefined })
  }
})

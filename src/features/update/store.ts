import { create } from 'zustand'
import { errorMessage, ipc, isDesktop, onEvent } from '@shared/ipc/client'
import type { UpdateStatus } from '@shared/types/server'

interface UpdateState {
  status: UpdateStatus | null
  error: string | null
  /** Loads the status and follows updates (desktop only); returns the unsubscribe. */
  connect: () => () => void
  check: () => Promise<void>
  install: () => Promise<void>
}

/** The desktop app's self-update (packaged builds; `disabled` in dev). */
export const useUpdate = create<UpdateState>((set) => ({
  status: null,
  error: null,

  connect: () => {
    if (!isDesktop()) return () => {}
    ipc('update:status').then(
      (status) => set({ status }),
      () => {}
    )
    return onEvent('update:status', (status) => set({ status, error: null }))
  },

  check: async () => {
    try {
      set({ status: await ipc('update:check'), error: null })
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  },

  install: async () => {
    try {
      await ipc('update:install')
    } catch (err) {
      set({ error: errorMessage(err) })
    }
  }
}))

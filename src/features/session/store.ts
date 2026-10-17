import { create } from 'zustand'
import { errorMessage, ipc, isDesktop, setTransport } from '@shared/ipc/client'
import {
  createRemoteTransport,
  pairDevice,
  probeCore,
  type LinkState,
  type RemoteTransport
} from '@shared/ipc/transport'
import type { AppInfo } from '@shared/types/server'
import { getT } from '@/lib/i18n'

const TOKEN_KEY = 'mindeck.token'
const DEVICE_KEY = 'mindeck.deviceId'

export type SessionStatus = 'checking' | 'unpaired' | 'unreachable' | 'ready'

// The device token is a bearer key to the whole core. A paired browser keeps
// it in localStorage (pairing again needs a fresh code from the core, so
// "stay paired" is the default); on a shared computer the person can choose
// sessionStorage instead: the pairing then ends with the tab.

function read(key: string): string | null {
  try {
    return sessionStorage.getItem(key) ?? localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null, remember = true): void {
  try {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
    if (value !== null) (remember ? localStorage : sessionStorage).setItem(key, value)
  } catch {
    /* storage unavailable — the session just won't survive a reload */
  }
}

/** What outlives signing out: how the app looks and which language it speaks — nothing about the work. */
const KEEP_ON_LOGOUT = new Set(['mindeck.theme', 'mindeck.appearance', 'mindeck.locale'])

/** Signing out forgets this browser's traces: prompt history, drafts, recent files, layouts, paths. */
function forgetBrowserData(): void {
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      const store = storage()
      const keys = Array.from({ length: store.length }, (_, i) => store.key(i)!)
      for (const key of keys) if (key.startsWith('mindeck.') && !KEEP_ON_LOGOUT.has(key)) store.removeItem(key)
    } catch {
      /* storage unavailable — nothing was kept there */
    }
  }
}

/** A readable default name for this browser, e.g. "Chrome · macOS". */
export function defaultDeviceName(ua: string = navigator.userAgent): string {
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Firefox\//.test(ua)
      ? 'Firefox'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser'
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'Web'
  return `${browser} · ${os}`
}

interface SessionState {
  status: SessionStatus
  link: LinkState
  info?: AppInfo
  error?: string
  /** Start: desktop is always ready; a browser checks its stored token. */
  init: () => Promise<void>
  /** `remember: false` keeps the pairing only as long as this tab (sessionStorage). */
  pair: (code: string, name: string, remember?: boolean) => Promise<boolean>
  /** Forget this browser's device (also revokes it on the core) and what it kept locally. */
  logout: () => Promise<void>
}

let transport: RemoteTransport | null = null

/** Same-origin core (the web UI is served by the core it talks to). */
const BASE_URL = ''

export const useSession = create<SessionState>((set, get) => {
  const connect = (token: string) => {
    transport?.close()
    transport = createRemoteTransport({
      baseUrl: BASE_URL,
      token,
      onLinkState: (link) => set({ link }),
      onUnauthorized: () => {
        write(TOKEN_KEY, null)
        transport?.close()
        transport = null
        setTransport(null)
        set({ status: 'unpaired', info: undefined, error: getT().pair.noLongerPaired })
      }
    })
    setTransport(transport)
  }

  const loadInfo = async (): Promise<boolean> => {
    try {
      const info = await ipc('app:info')
      set({ info, status: 'ready', link: 'online', error: undefined })
      return true
    } catch (err) {
      const code = (err as { code?: string }).code
      if (code === 'unauthorized') return false
      set({ status: 'unreachable', error: errorMessage(err) })
      return true
    }
  }

  return {
    status: 'checking',
    link: 'connecting',

    init: async () => {
      if (isDesktop()) {
        set({ status: 'ready', link: 'online' })
        try {
          set({ info: await ipc('app:info') })
        } catch {
          /* info is decorative on the desktop */
        }
        return
      }
      set({ status: 'checking', error: undefined })
      const token = read(TOKEN_KEY)
      if (token) {
        connect(token)
        if (await loadInfo()) return
        // unauthorized → onUnauthorized already reset the session
        return
      }
      const core = await probeCore(BASE_URL)
      set(core ? { status: 'unpaired' } : { status: 'unreachable', error: getT().pair.noCore })
    },

    pair: async (code, name, remember = true) => {
      set({ error: undefined })
      try {
        const result = await pairDevice(BASE_URL, code.trim(), name.trim())
        write(TOKEN_KEY, result.token, remember)
        write(DEVICE_KEY, result.device.id, remember)
        connect(result.token)
        await loadInfo()
        return true
      } catch (err) {
        set({ error: errorMessage(err) })
        return false
      }
    },

    logout: async () => {
      const deviceId = read(DEVICE_KEY)
      if (deviceId && get().status === 'ready') {
        await ipc('server:revokeDevice', { id: deviceId }).catch(() => {})
      }
      write(TOKEN_KEY, null)
      write(DEVICE_KEY, null)
      forgetBrowserData()
      transport?.close()
      transport = null
      setTransport(null)
      set({ status: 'unpaired', info: undefined, error: undefined })
    }
  }
})

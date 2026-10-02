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

const TOKEN_KEY = 'wone.token'
const DEVICE_KEY = 'wone.deviceId'

export type SessionStatus = 'checking' | 'unpaired' | 'unreachable' | 'ready'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage unavailable — the session just won't survive a reload */
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
  pair: (code: string, name: string) => Promise<boolean>
  /** Forget this browser's device (also revokes it on the core). */
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
        set({ status: 'unpaired', info: undefined, error: 'This device is no longer paired' })
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
      set(core ? { status: 'unpaired' } : { status: 'unreachable', error: 'No W-ONE core answered at this address' })
    },

    pair: async (code, name) => {
      set({ error: undefined })
      try {
        const result = await pairDevice(BASE_URL, code.trim(), name.trim())
        write(TOKEN_KEY, result.token)
        write(DEVICE_KEY, result.device.id)
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
      transport?.close()
      transport = null
      setTransport(null)
      set({ status: 'unpaired', info: undefined, error: undefined })
    }
  }
})

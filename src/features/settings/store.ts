import { create } from 'zustand'
import QRCode from 'qrcode'
import { errorMessage, ipc, isDesktop } from '@shared/ipc/client'
import type { Device, PairingCode, ServerConfig, ServerStatus } from '@shared/types/server'
import type { PermissionGrant } from '@shared/types/ai'

/** An address only this computer can open — never a phone. */
export const isLoopback = (url: string): boolean => /\/\/(127\.0\.0\.1|localhost|\[::1\])(?=[:/]|$)/.test(url)

/**
 * The page's own address, when a phone could open it as well: the web UI
 * reached over the network (best there — a core in Docker only knows its
 * container addresses). Never the desktop window: its origin is the app
 * itself (file://, or the dev server on localhost).
 */
function phoneOrigin(origin: string | undefined, desktop: boolean): string | undefined {
  return !desktop && origin && !/^file:|^app:/.test(origin) && !isLoopback(origin) ? origin : undefined
}

/** The URL a phone should open: a reachable page address, else the core's LAN address. */
export function pairingUrl(code: string, urls: string[], origin?: string, desktop = false): string {
  const base = phoneOrigin(origin, desktop) ?? urls.find((u) => !isLoopback(u)) ?? urls[0]
  return `${base.replace(/\/$/, '')}/#pair=${encodeURIComponent(code)}`
}

/** Whether any address a phone could open exists (else the core listens on this computer only). */
export function pairingReachable(urls: string[], origin?: string, desktop = false): boolean {
  return !!phoneOrigin(origin, desktop) || urls.some((u) => !isLoopback(u))
}

type Pairing = PairingCode & { url: string; qr: string; reachable: boolean }

/** QR code and link for a pairing code, from the core's current addresses. */
async function pairingView(code: PairingCode, urls: string[]): Promise<Pairing> {
  const desktop = isDesktop()
  const url = pairingUrl(code.code, urls, location.origin, desktop)
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
  return { ...code, urls, url, qr, reachable: pairingReachable(urls, location.origin, desktop) }
}

interface SettingsState {
  server?: ServerStatus
  devices: Device[]
  grants: PermissionGrant[]
  pairing?: Pairing
  busy: boolean
  error?: string
  load: () => Promise<void>
  configureServer: (patch: Partial<ServerConfig>) => Promise<void>
  createPairing: () => Promise<void>
  closePairing: () => void
  revokeDevice: (id: string) => Promise<void>
  revokeGrant: (agentId: string, toolName: string) => Promise<void>
  clearError: () => void
}

export const useSettings = create<SettingsState>((set, get) => {
  const fail = (err: unknown) => set({ error: errorMessage(err), busy: false })
  return {
    devices: [],
    grants: [],
    busy: false,

    load: async () => {
      try {
        const [server, devices, grants] = await Promise.all([ipc('server:status'), ipc('server:devices'), ipc('permission:grants')])
        set({ server, devices, grants })
      } catch (err) {
        fail(err)
      }
    },

    configureServer: async (patch) => {
      // The switches show the choice at once ("running" still reports the real
      // state); the core's answer settles it, a failure puts the old one back.
      const before = get().server
      set({ busy: true, error: undefined, server: before && { ...before, config: { ...before.config, ...patch } } })
      try {
        const server = await ipc('server:configure', patch)
        set({ server, busy: false })
        // An open pairing follows the new addresses (e.g. the LAN was just switched on).
        const open = get().pairing
        if (open) set({ pairing: await pairingView(open, server.urls) })
      } catch (err) {
        set({ server: before })
        fail(err)
      }
    },

    createPairing: async () => {
      set({ busy: true, error: undefined })
      try {
        const code = await ipc('server:createPairingCode')
        set({ pairing: await pairingView(code, code.urls), busy: false })
      } catch (err) {
        fail(err)
      }
    },

    closePairing: () => {
      set({ pairing: undefined })
      void get().load()
    },

    revokeDevice: async (id) => {
      try {
        await ipc('server:revokeDevice', { id })
        set({ devices: get().devices.filter((d) => d.id !== id) })
      } catch (err) {
        fail(err)
      }
    },

    revokeGrant: async (agentId, toolName) => {
      try {
        await ipc('permission:revoke', { agentId, toolName })
        set({ grants: get().grants.filter((g) => !(g.agentId === agentId && g.toolName === toolName)) })
      } catch (err) {
        fail(err)
      }
    },

    clearError: () => set({ error: undefined })
  }
})

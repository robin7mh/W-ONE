import { create } from 'zustand'
import QRCode from 'qrcode'
import { errorMessage, ipc } from '@shared/ipc/client'
import type { Device, PairingCode, ServerConfig, ServerStatus } from '@shared/types/server'
import type { PermissionGrant } from '@shared/types/ai'

/** The URL a phone should open: the page's own address in a browser, else the best core URL. */
export function pairingUrl(code: string, urls: string[], origin?: string): string {
  const lan = urls.find((u) => !/\/\/(127\.0\.0\.1|localhost)[:/]/.test(u))
  const base = origin && !/^file:|^app:/.test(origin) ? origin : (lan ?? urls[0])
  return `${base.replace(/\/$/, '')}/#pair=${encodeURIComponent(code)}`
}

interface SettingsState {
  server?: ServerStatus
  devices: Device[]
  grants: PermissionGrant[]
  pairing?: PairingCode & { url: string; qr: string }
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
      set({ busy: true, error: undefined })
      try {
        set({ server: await ipc('server:configure', patch), busy: false })
      } catch (err) {
        fail(err)
      }
    },

    createPairing: async () => {
      set({ busy: true, error: undefined })
      try {
        const code = await ipc('server:createPairingCode')
        const url = pairingUrl(code.code, code.urls, location.origin)
        const qr = await QRCode.toString(url, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
        set({ pairing: { ...code, url, qr }, busy: false })
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

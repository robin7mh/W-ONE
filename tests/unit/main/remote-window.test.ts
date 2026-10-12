import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  windows: [] as unknown[],
  openExternal: vi.fn(async () => {}),
  dark: true,
  failLoad: false
}))

vi.mock('electron', async () => {
  const { EventEmitter: Emitter } = await import('node:events')
  class FakeWindow extends Emitter {
    loaded: string[] = []
    scripts: string[] = []
    destroyed = false
    openHandler?: (d: { url: string }) => unknown
    webContents = {
      setWindowOpenHandler: (fn: (d: { url: string }) => unknown) => (this.openHandler = fn),
      executeJavaScript: async (code: string) => void this.scripts.push(code)
    }
    constructor(public opts: Record<string, unknown>) {
      super()
      h.windows.push(this)
    }
    async loadURL(url: string) {
      if (h.failLoad) throw new Error('ERR_CONNECTION_REFUSED')
      this.loaded.push(url)
    }
    isDestroyed() {
      return this.destroyed
    }
    close() {
      this.destroyed = true
      this.emit('closed')
    }
  }
  return {
    app: { getApplicationNameForProtocol: () => '' },
    BrowserWindow: FakeWindow,
    dialog: {},
    nativeTheme: {
      get shouldUseDarkColors() {
        return h.dark
      }
    },
    safeStorage: { isEncryptionAvailable: () => false },
    shell: { openExternal: h.openExternal }
  }
})

import { electronPlatform } from '../../../electron/main/platform/electron'

type Win = EventEmitter & { opts: Record<string, unknown>; loaded: string[]; scripts: string[]; destroyed: boolean; openHandler: (d: { url: string }) => unknown; close: () => void }

describe('remote windows', () => {
  it('a window on the remote core’s web UI, signed in as this desktop; links go to the browser; closing resolves', async () => {
    const remote = electronPlatform.openRemoteWindow!({ title: 'SSH: box', url: 'http://127.0.0.1:5000', token: 'tok', deviceId: 'dev' })
    const win = h.windows.at(-1) as Win
    expect(win.opts).toMatchObject({ title: 'SSH: box', backgroundColor: '#04060b', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    expect(win.opts.webPreferences).not.toHaveProperty('preload')
    await new Promise((r) => setTimeout(r, 0))
    expect(win.loaded).toEqual(['http://127.0.0.1:5000/api/health', 'http://127.0.0.1:5000'])
    expect(win.scripts[0]).toBe(`localStorage.setItem('wone.token', "tok"); localStorage.setItem('wone.deviceId', "dev")`)
    // The page can't rename the window.
    const title = { preventDefault: vi.fn() }
    win.emit('page-title-updated', title)
    expect(title.preventDefault).toHaveBeenCalled()
    expect(win.openHandler({ url: 'https://docs' })).toEqual({ action: 'deny' })
    expect(h.openExternal).toHaveBeenCalledWith('https://docs')
    remote.close()
    await remote.closed
    remote.close() // already gone
    expect(win.destroyed).toBe(true)
  })

  it('light mode; a core that doesn’t answer leaves the window as it is', async () => {
    h.dark = false
    h.failLoad = true
    electronPlatform.openRemoteWindow!({ title: 't', url: 'http://x', token: 't', deviceId: 'd' })
    await new Promise((r) => setTimeout(r, 0))
    const win = h.windows.at(-1) as Win
    expect(win.opts.backgroundColor).toBe('#eef2f7')
    expect(win.loaded).toEqual([])
  })
})

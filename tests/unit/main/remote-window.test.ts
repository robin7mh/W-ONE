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
    navigate?: (e: { preventDefault: () => void }, url: string) => void
    webContents = {
      setWindowOpenHandler: (fn: (d: { url: string }) => unknown) => (this.openHandler = fn),
      on: (_event: 'will-navigate', fn: (e: { preventDefault: () => void }, url: string) => void) => (this.navigate = fn),
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
    clipboard: {},
    ClipboardItem: class {},
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

import { electronPlatform, REMOTE_PARTITION, safeExternal } from '../../../electron/main/platform/electron'

type Win = EventEmitter & {
  opts: Record<string, unknown>
  loaded: string[]
  scripts: string[]
  destroyed: boolean
  openHandler: (d: { url: string }) => unknown
  navigate: (e: { preventDefault: () => void }, url: string) => void
  close: () => void
}

describe('remote windows', () => {
  it('a window on the remote core’s web UI, signed in as this desktop; links go to the browser; closing resolves', async () => {
    const remote = electronPlatform.openRemoteWindow!({ title: 'SSH: box', url: 'http://127.0.0.1:5000', token: 'tok', deviceId: 'dev' })
    const win = h.windows.at(-1) as Win
    expect(win.opts).toMatchObject({
      title: 'SSH: box',
      backgroundColor: '#04060b',
      // Its own profile: the Mindeck UI's session serves mindeck-file:// (local files).
      webPreferences: { partition: REMOTE_PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    expect(win.opts.webPreferences).not.toHaveProperty('preload')
    await new Promise((r) => setTimeout(r, 0))
    expect(win.loaded).toEqual(['http://127.0.0.1:5000/api/health', 'http://127.0.0.1:5000'])
    expect(win.scripts[0]).toBe(`localStorage.setItem('mindeck.token', "tok"); localStorage.setItem('mindeck.deviceId', "dev")`)
    // The page can't rename the window.
    const title = { preventDefault: vi.fn() }
    win.emit('page-title-updated', title)
    expect(title.preventDefault).toHaveBeenCalled()
    expect(win.openHandler({ url: 'https://docs' })).toEqual({ action: 'deny' })
    expect(h.openExternal).toHaveBeenCalledWith('https://docs')
    // Another machine's page never hands the OS a file, a share or another app's link.
    h.openExternal.mockClear()
    for (const link of ['file:///C:/Windows/System32/calc.exe', 'smb://evil/share/x.exe', 'ms-msdt:/id', 'javascript:alert(1)']) {
      expect(win.openHandler({ url: link })).toEqual({ action: 'deny' })
    }
    expect(h.openExternal).not.toHaveBeenCalled()
    // It stays on its core: its own pages load, web links elsewhere go to the system browser, the rest nowhere.
    const nav = (url: string) => {
      const e = { preventDefault: vi.fn() }
      win.navigate(e, url)
      return e.preventDefault.mock.calls.length > 0
    }
    expect(nav('http://127.0.0.1:5000/projects')).toBe(false)
    expect(nav('http://127.0.0.1:50001/')).toBe(true)
    expect(nav('mailto:a@b.c')).toBe(true)
    expect(nav('file:///etc/passwd')).toBe(true)
    expect(h.openExternal.mock.calls).toEqual([['http://127.0.0.1:50001/'], ['mailto:a@b.c']])
    remote.close()
    await remote.closed
    remote.close() // already gone
    expect(win.destroyed).toBe(true)
  })

  it('only web and mail links leave for the OS', () => {
    expect(safeExternal('https://mindeck.de')).toBe(true)
    expect(safeExternal('HTTP://x')).toBe(true)
    expect(safeExternal('mailto:a@b.c')).toBe(true)
    expect(safeExternal('file:///etc/passwd')).toBe(false)
    expect(safeExternal('\\\\evil\\share')).toBe(false)
    expect(safeExternal('vscode://x')).toBe(false)
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

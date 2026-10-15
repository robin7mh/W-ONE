import { describe, expect, it, vi } from 'vitest'
import { Router } from '../../../electron/ipc/router'
import { registerBrowserIpc } from '../../../electron/ipc/browser.ipc'
import { registerFinderIpc } from '../../../electron/ipc/finder.ipc'
import type { BrowserService } from '../../../electron/main/services/browser/BrowserService'
import type { FinderService } from '../../../electron/main/services/finder/FinderService'

/** Any method call answers with its name — enough to see which one ran with what. */
const recorder = () =>
  new Proxy({} as Record<string, ReturnType<typeof vi.fn>>, {
    get: (target, key: string) => (target[key] ??= vi.fn((...args: unknown[]) => ({ called: key, args })))
  })

describe('browser and files channels', () => {
  const ipc = { transport: 'ipc' as const }

  it('reach the browser service with validated payloads — and only from the desktop window', async () => {
    const router = new Router()
    const browser = recorder()
    registerBrowserIpc(router, browser as unknown as BrowserService)
    const calls: [string, unknown, string, unknown[]][] = [
      ['browser:state', undefined, 'state', []],
      ['browser:open', { url: 'example.com', background: true }, 'open', [{ url: 'example.com', background: true }]],
      ['browser:open', undefined, 'open', [{ url: undefined, background: undefined }]],
      ['browser:close', { id: 't' }, 'close', ['t']],
      ['browser:activate', { id: 't' }, 'activate', ['t']],
      ['browser:navigate', { id: 't', input: 'react hooks' }, 'navigate', ['t', 'react hooks']],
      ['browser:go', { id: 't', action: 'back' }, 'go', ['t', 'back']],
      ['browser:update', { id: 't', pinned: true, shared: false }, 'update', ['t', { pinned: true, shared: false }]],
      ['browser:move', { id: 't', index: 2 }, 'move', ['t', 2]],
      ['browser:duplicate', { id: 't' }, 'duplicate', ['t']],
      ['browser:reopen', undefined, 'reopen', []],
      ['browser:zoom', { id: 't', zoom: 'in' }, 'zoom', ['t', 'in']],
      ['browser:find', { id: 't', text: 'x', next: true }, 'find', ['t', 'x', undefined, true]],
      ['browser:findStop', { id: 't' }, 'findStop', ['t']],
      ['browser:tool', { id: 't', tool: 'devtools' }, 'tool', ['t', 'devtools']],
      ['browser:view', { bounds: { x: 1, y: 2, width: 3, height: 4 } }, 'setView', [{ x: 1, y: 2, width: 3, height: 4 }, undefined]],
      ['browser:view', { bounds: null }, 'setView', [null, undefined]],
      ['browser:view', { bounds: null, focused: false }, 'setView', [null, false]],
      ['browser:freeze', undefined, 'freeze', []],
      ['browser:unfreeze', undefined, 'unfreeze', []],
      ['browser:suggest', { text: 'gi' }, 'suggest', ['gi']],
      ['browser:history', { query: 'docs', limit: 5 }, 'historyEntries', ['docs', 5]],
      ['browser:history', undefined, 'historyEntries', [undefined, undefined]],
      ['browser:clearHistory', undefined, 'clearHistory', []],
      ['browser:download', { id: 'd', action: 'reveal' }, 'download', ['d', 'reveal']],
      ['browser:permission', { id: 'p', allow: true, remember: true }, 'permission', ['p', true, true]],
      ['browser:settings', undefined, 'settings', []],
      ['browser:configure', { searchEngine: 'kagi' }, 'configure', [{ searchEngine: 'kagi' }]],
      ['browser:ui', { theme: 'dark', locale: 'de' }, 'setUi', [{ theme: 'dark', locale: 'de' }]]
    ]
    for (const [channel, payload, method, args] of calls) {
      const res = await router.dispatch(channel, payload, ipc)
      expect(res, channel).toEqual({ ok: true, data: { called: method, args } })
    }
    // what the schemas refuse
    expect(await router.dispatch('browser:go', { id: 't', action: 'explode' }, ipc)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await router.dispatch('browser:configure', { searchEngine: 'altavista' }, ipc)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await router.dispatch('browser:view', { bounds: { x: 'a' } }, ipc)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    // a paired phone or browser never reaches the user's tabs
    expect(await router.dispatch('browser:state', undefined, { transport: 'remote' })).toMatchObject({ ok: false, error: { code: 'desktop-only' } })
  })

  it('reach the files service — and refuse names and paths that are no names or paths', async () => {
    const router = new Router()
    const finder = recorder()
    registerFinderIpc(router, finder as unknown as FinderService)
    const calls: [string, unknown, string, unknown[]][] = [
      ['finder:places', undefined, 'places', []],
      ['finder:list', { path: '/Users/me', hidden: true }, 'list', ['/Users/me', true]],
      ['finder:list', undefined, 'list', [undefined, undefined]],
      ['finder:search', { path: '/Users/me', query: ' report ' }, 'search', ['/Users/me', 'report']],
      ['finder:preview', { path: '/a.png' }, 'preview', ['/a.png']],
      ['finder:mkdir', { parent: '/Users/me', name: 'New' }, 'mkdir', ['/Users/me', 'New']],
      ['finder:rename', { path: '/a.txt', name: 'b.txt' }, 'rename', ['/a.txt', 'b.txt']],
      ['finder:trash', { paths: ['/a.txt'] }, 'trash', [['/a.txt']]],
      ['finder:move', { paths: ['/a.txt'], dest: '/b' }, 'move', [['/a.txt'], '/b']],
      ['finder:copy', { paths: ['/a.txt'], dest: '/b' }, 'copy', [['/a.txt'], '/b']],
      ['finder:open', { path: '/a.txt' }, 'open', ['/a.txt']],
      ['finder:reveal', { path: '/a.txt' }, 'reveal', ['/a.txt']]
    ]
    for (const [channel, payload, method, args] of calls) {
      expect(await router.dispatch(channel, payload, ipc), channel).toEqual({ ok: true, data: { called: method, args } })
    }
    expect(await router.dispatch('finder:trash', { paths: [] }, ipc)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await router.dispatch('finder:mkdir', { parent: '/x', name: '   ' }, ipc)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
    expect(await router.dispatch('finder:list', undefined, { transport: 'remote' })).toMatchObject({ ok: false, error: { code: 'desktop-only' } })
  })
})

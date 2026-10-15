import type { Router } from './router'
import type { BrowserService } from '../main/services/browser/BrowserService'

/** Binds the browser:* contract channels (the desktop window's browser) to BrowserService. */
export function registerBrowserIpc(router: Router, browser: BrowserService): void {
  router.register('browser:state', () => browser.state())
  router.register('browser:open', ({ url, background }) => browser.open({ url, background }))
  router.register('browser:close', ({ id }) => browser.close(id))
  router.register('browser:activate', ({ id }) => browser.activate(id))
  router.register('browser:navigate', ({ id, input }) => browser.navigate(id, input))
  router.register('browser:go', ({ id, action }) => browser.go(id, action))
  router.register('browser:update', ({ id, ...patch }) => browser.update(id, patch))
  router.register('browser:move', ({ id, index }) => browser.move(id, index))
  router.register('browser:duplicate', ({ id }) => browser.duplicate(id))
  router.register('browser:reopen', () => browser.reopen())
  router.register('browser:zoom', ({ id, zoom }) => browser.zoom(id, zoom))
  router.register('browser:find', ({ id, text, forward, next }) => browser.find(id, text, forward, next))
  router.register('browser:findStop', ({ id }) => browser.findStop(id))
  router.register('browser:tool', ({ id, tool }) => browser.tool(id, tool))
  router.register('browser:view', ({ bounds }) => browser.setView(bounds))
  router.register('browser:freeze', () => browser.freeze())
  router.register('browser:unfreeze', () => browser.unfreeze())
  router.register('browser:suggest', ({ text }) => browser.suggest(text))
  router.register('browser:history', ({ query, limit }) => browser.historyEntries(query, limit))
  router.register('browser:clearHistory', () => browser.clearHistory())
  router.register('browser:download', ({ id, action }) => browser.download(id, action))
  router.register('browser:permission', ({ id, allow, remember }) => browser.permission(id, allow, remember))
  router.register('browser:settings', () => browser.settings())
  router.register('browser:configure', (patch) => browser.configure(patch))
  router.register('browser:ui', (ui) => browser.setUi(ui))
}

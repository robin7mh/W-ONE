import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { setTransport } from '@shared/ipc/client'

declare global {
  /** media query → matches, read by the matchMedia stub below (tests set entries). */
  var matchMediaMatches: Record<string, boolean>
}

// --- what jsdom lacks ----------------------------------------------------------

/** ResizeObserver: records instances so tests can trigger resize callbacks. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  constructor(public cb: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this)
  }
  observe = vi.fn()
  unobserve = vi.fn()
  disconnect = vi.fn()
  trigger() {
    this.cb([], this as unknown as ResizeObserver)
  }
}
globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
;(globalThis as Record<string, unknown>).FakeResizeObserver = FakeResizeObserver

/** matchMedia: everything false unless a test sets `matchMediaMatches`. */
;(globalThis as Record<string, unknown>).matchMediaMatches = {} as Record<string, boolean>
window.matchMedia = ((query: string) => ({
  matches: !!((globalThis as Record<string, unknown>).matchMediaMatches as Record<string, boolean>)[query],
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn()
})) as typeof window.matchMedia

/** Canvas 2D context: a recorder of calls (jsdom has no canvas). */
HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
  const calls: string[] = []
  const ctx = new Proxy(
    { calls, canvas: this },
    {
      get: (target, key: string) =>
        key in target ? target[key as keyof typeof target] : (...args: unknown[]) => calls.push(`${key}(${args.length})`),
      set: () => true
    }
  )
  return ctx
} as unknown as typeof HTMLCanvasElement.prototype.getContext

afterEach(() => {
  cleanup()
  FakeResizeObserver.instances = []
  ;(globalThis as Record<string, unknown>).matchMediaMatches = {}
  delete (window as { wone?: unknown }).wone
  setTransport(null)
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

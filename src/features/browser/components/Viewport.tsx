import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AlertTriangle, ExternalLink, RotateCw, ServerCrash } from 'lucide-react'
import { ipc } from '@shared/ipc/client'
import type { BrowserTab, ViewBounds } from '@shared/types/browser'
import { internalPage } from '@shared/types/browserData'
import { useT } from '@/lib/i18n'
import { useOverlays } from '@/lib/overlay'
import { useActiveTab, useBrowser } from '../store'
import { hostOf, security } from '../url'
import { NewTabPage } from './NewTabPage'
import { HistoryPage } from './HistoryPage'
import { BookmarksPage } from './BookmarksPage'

/** Net errors that mean "nothing answers there (yet)" — on this machine, a dev server still starting. */
const NOT_UP_YET = new Set([-102, -100, -101, -324, -7, -21])
const RETRY_MS = 2000

const button =
  'flex items-center gap-1.5 rounded-md border border-hud/60 px-3 py-1.5 font-sans text-[12.5px] text-text-secondary transition-colors hover:border-cyan/50 hover:text-cyan'

function ErrorPage({ tab }: { tab: BrowserTab }) {
  const t = useT()
  const error = tab.error!
  const waiting = security(error.url) === 'local' && NOT_UP_YET.has(error.code)
  const retry = () => void useBrowser.getState().run('browser:go', { id: tab.id, action: 'reload' })

  // A local dev server that is not up yet: keep trying, quietly.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(retry, RETRY_MS)
    return () => clearInterval(timer)
  }, [waiting, tab.id])

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-md text-center">
        <AlertTriangle size={28} className={waiting ? 'mx-auto text-amber' : 'mx-auto text-danger'} />
        <h2 className="mt-3 font-sans text-[16px] font-semibold text-text-primary">{t.browser.errorTitle}</h2>
        <p className="mt-1.5 font-sans text-[13px] text-text-secondary">
          {waiting ? t.browser.errorWaiting(hostOf(error.url)) : error.description}
        </p>
        <p className="mt-1 break-all font-mono text-[11px] text-text-muted">
          {error.url} · {error.code}
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={retry} className={button}>
            <RotateCw size={13} className={tab.loading ? 'animate-spin' : ''} /> {t.browser.retry}
          </button>
          {!waiting && (
            <button type="button" onClick={() => void useBrowser.getState().run('browser:tool', { id: tab.id, tool: 'handoff' })} className={button}>
              <ExternalLink size={13} /> {t.browser.openExternal}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CrashPage({ tab }: { tab: BrowserTab }) {
  const t = useT()
  return (
    <div className="flex h-full items-center justify-center p-8 text-center">
      <div>
        <ServerCrash size={28} className="mx-auto text-danger" />
        <h2 className="mt-3 font-sans text-[16px] font-semibold text-text-primary">{t.browser.crashed}</h2>
        <p className="mt-1.5 font-sans text-[13px] text-text-secondary">{t.browser.crashedHint}</p>
        <button type="button" onClick={() => void useBrowser.getState().run('browser:go', { id: tab.id, action: 'reload' })} className={`${button} mx-auto mt-4`}>
          <RotateCw size={13} /> {t.browser.reload}
        </button>
      </div>
    </div>
  )
}

const same = (a: ViewBounds | null, b: ViewBounds | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)

/**
 * Where the page goes. The web view is a native layer on top of the UI: this
 * placeholder reports its place to the core (and null when the module is not
 * on screen); while any menu or dialog of the UI is open, a still picture
 * of the page stands in for the view, so nothing hides behind it.
 */
export function Viewport({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const sent = useRef<ViewBounds | null | undefined>(undefined)
  const tab = useActiveTab()
  const covered = useOverlays((s) => s.count > 0)
  const [shot, setShot] = useState<string | null>(null)
  const own = tab ? internalPage(tab.url) : undefined
  // A web page shows (Mindeck's own pages, the new-tab page and error pages are drawn here instead).
  const page = !!tab?.url && !own && !tab.error && !tab.crashed

  const report = (bounds: ViewBounds | null) => {
    if (sent.current !== undefined && same(sent.current, bounds)) return
    sent.current = bounds
    void ipc('browser:view', { bounds }).catch(() => {})
  }
  const measure = () => {
    const r = ref.current!.getBoundingClientRect()
    report({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
  }

  // Every render may have moved it (bars above it come and go); only real changes go out.
  useLayoutEffect(() => {
    if (active) measure()
  })

  useEffect(() => {
    if (!active) {
      report(null)
      return
    }
    const observer = new ResizeObserver(measure)
    observer.observe(ref.current!)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      report(null)
    }
  }, [active])

  // A menu or dialog over the page: show its picture instead of the live view.
  useEffect(() => {
    if (!active || !covered || !page) return
    let stale = false
    void ipc('browser:freeze')
      .then((img) => !stale && setShot(img))
      .catch(() => {})
    return () => {
      stale = true
      setShot(null)
      void ipc('browser:unfreeze').catch(() => {})
    }
  }, [active, covered, page])

  return (
    <div ref={ref} className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-surface/30" data-testid="browser-viewport">
      {tab && !tab.url && <NewTabPage />}
      {own === 'history' && <HistoryPage />}
      {own === 'bookmarks' && <BookmarksPage />}
      {tab?.error && <ErrorPage tab={tab} />}
      {tab?.crashed && !tab.error && <CrashPage tab={tab} />}
      {shot && <img src={shot} alt="" className="pointer-events-none absolute inset-0 h-full w-full object-fill" />}
    </div>
  )
}

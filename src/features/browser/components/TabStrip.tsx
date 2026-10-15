import { useState, type DragEvent } from 'react'
import { Bot, Boxes, Globe, Loader2, Play, Plus, VenetianMask, Volume2, VolumeX, X } from 'lucide-react'
import type { BrowserTab } from '@shared/types/browser'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { useBrowser } from '../store'

const DRAG_TYPE = 'application/x-mindeck-tab'

function Favicon({ tab }: { tab: BrowserTab }) {
  if (tab.loading) return <Loader2 size={13} className="shrink-0 animate-spin text-cyan" aria-hidden />
  if (tab.favicon) return <img src={tab.favicon} alt="" className="h-3.5 w-3.5 shrink-0 rounded-sm object-contain" draggable={false} />
  return <Globe size={13} className="shrink-0 text-text-muted" aria-hidden />
}

/**
 * The tabs: favicon, title, sound, the agent's mark. Click shows a tab,
 * middle-click or × closes it, right-click opens its native menu, dragging
 * reorders — pinned tabs stay small and first.
 */
export function TabStrip() {
  const t = useT()
  const tabs = useBrowser((s) => s.state.tabs)
  const activeId = useBrowser((s) => s.state.activeId)
  const run = useBrowser((s) => s.run)
  const [dropAt, setDropAt] = useState<string | null>(null)

  const onDrop = (e: DragEvent, target: BrowserTab) => {
    e.preventDefault()
    setDropAt(null)
    const id = e.dataTransfer.getData(DRAG_TYPE)
    if (id && id !== target.id) void run('browser:move', { id, index: tabs.findIndex((x) => x.id === target.id) })
  }

  return (
    <div className="flex h-9 shrink-0 items-end gap-1 border-b border-hud/50 px-2 pt-1.5" onDoubleClick={(e) => e.target === e.currentTarget && void useBrowser.getState().newTab()}>
      <div role="tablist" aria-label={t.browser.title} className="flex min-w-0 items-end gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.id === activeId
          const title = tab.title || (tab.url ? tab.url : t.browser.untitled)
          const agentic = !!tab.openedBy
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              title={agentic ? `${title} — ${t.browser.agentTab(tab.openedBy!)}` : title}
              draggable
              onDragStart={(e) => e.dataTransfer.setData(DRAG_TYPE, tab.id)}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
                e.preventDefault()
                setDropAt(tab.id)
              }}
              onDragLeave={() => setDropAt((d) => (d === tab.id ? null : d))}
              onDrop={(e) => onDrop(e, tab)}
              onClick={() => !active && void run('browser:activate', { id: tab.id })}
              onAuxClick={(e) => e.button === 1 && void run('browser:close', { id: tab.id })}
              onContextMenu={(e) => {
                e.preventDefault()
                void run('browser:tool', { id: tab.id, tool: 'tabMenu' })
              }}
              className={cn(
                'group relative flex h-7 shrink-0 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 transition-colors',
                tab.pinned ? 'w-9 justify-center px-0' : 'w-[clamp(120px,14vw,220px)] pl-2.5 pr-1',
                active ? 'border-hud/70 bg-surface text-text-primary' : 'border-transparent text-text-secondary hover:bg-elevated/40',
                dropAt === tab.id && 'border-cyan/60',
                agentic && 'shadow-[inset_0_2px_0_0_rgb(var(--accent-purple)/0.8)]',
                tab.profile === 'private' && 'bg-purple/[0.08]'
              )}
            >
              <Favicon tab={tab} />
              {tab.profile === 'private' && <VenetianMask size={12} className="shrink-0 text-purple" aria-label={t.browserExtras.privateTab} />}
              {tab.profile === 'agents' && !agentic && <Boxes size={12} className="shrink-0 text-purple" aria-label={t.browserExtras.agentsContainer} />}
              {!tab.pinned && <span className="min-w-0 flex-1 truncate font-sans text-[12px]">{title}</span>}
              {tab.playing && !tab.audible && !tab.muted && !tab.pinned && <Play size={11} className="shrink-0 text-text-muted" aria-label={t.browserExtras.playing} />}
              {agentic && !tab.pinned && <Bot size={12} className="shrink-0 text-purple" aria-label={t.browser.agentTab(tab.openedBy!)} />}
              {(tab.audible || tab.muted) && !tab.pinned && (
                <button
                  type="button"
                  aria-label={tab.muted ? t.browser.unmute : t.browser.mute}
                  title={tab.muted ? t.browser.unmute : t.browser.mute}
                  onClick={(e) => {
                    e.stopPropagation()
                    void run('browser:update', { id: tab.id, muted: !tab.muted })
                  }}
                  className="shrink-0 rounded p-0.5 text-text-muted hover:bg-elevated hover:text-text-primary"
                >
                  {tab.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                </button>
              )}
              {!tab.pinned && (
                <button
                  type="button"
                  aria-label={t.browser.closeTab(title)}
                  onClick={(e) => {
                    e.stopPropagation()
                    void run('browser:close', { id: tab.id })
                  }}
                  className={cn(
                    'shrink-0 rounded p-0.5 text-text-muted transition-opacity hover:bg-elevated hover:text-text-primary',
                    active ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        aria-label={t.browser.newTab}
        title={`${t.browser.newTab} (⌘T)`}
        onClick={() => void useBrowser.getState().newTab()}
        className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-elevated hover:text-cyan"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}

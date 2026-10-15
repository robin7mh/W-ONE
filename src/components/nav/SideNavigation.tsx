import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Columns2, PanelBottom, SquareArrowOutUpRight, UserRound } from 'lucide-react'
import { NAV_ITEMS } from '@/data/navigation'
import type { ModuleId } from '@/types'
import { cn } from '@/lib/cn'
import { useT } from '@/lib/i18n'
import { useOverlay } from '@/lib/overlay'
import { TechLabel } from '@/components/ui/TechLabel'
import { useCloud } from '@/features/cloud/store'
import { macKeys } from '@/features/workspace/keys'
import { dropSides } from '@/features/workspace/layout'
import { useWorkspace } from '@/features/workspace/store'
import { endModuleDrag, startModuleDrag } from '@/features/workspace/drag'

/** Opens a module next to the focused pane: ⌘-click (Ctrl-click elsewhere), or the menu. */
const openBeside = (id: ModuleId) => useWorkspace.getState().openBeside(id)

/** A module's menu (right-click): here, or in a new pane. */
function ModuleMenu({ id, at, onSelect, onClose }: { id: ModuleId; at: { x: number; y: number }; onSelect: (id: ModuleId) => void; onClose: () => void }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  useOverlay(true)
  // In a new pane on the right where the layout has room there, else wherever it goes (openBeside).
  const right = useWorkspace((s) => dropSides(s.layout, s.layout.focus).includes('right'))

  useEffect(() => {
    ref.current!.querySelector<HTMLElement>('[role="menuitem"]')!.focus()
    const onDown = (e: MouseEvent) => !ref.current!.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const run = (fn: () => void) => () => {
    onClose()
    fn()
  }
  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-sans text-[12.5px] text-text-secondary outline-none transition-colors hover:bg-elevated hover:text-text-primary focus:bg-elevated focus:text-text-primary'
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={t.nav[id]}
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
        e.preventDefault()
        const items = [...ref.current!.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        const at = items.indexOf(document.activeElement as HTMLElement)
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus()
      }}
      className="fixed z-[70] min-w-[230px] rounded-lg border border-hud/70 bg-panel/95 p-1 shadow-xl shadow-black/40 backdrop-blur-md"
    >
      <button type="button" role="menuitem" onClick={run(() => onSelect(id))} className={item}>
        <SquareArrowOutUpRight size={13} className="shrink-0" />
        <span className="flex-1">{t.workspace.openHere}</span>
      </button>
      <button type="button" role="menuitem" onClick={run(() => openBeside(id))} className={item}>
        {right ? <Columns2 size={13} className="shrink-0" /> : <PanelBottom size={13} className="shrink-0" />}
        <span className="flex-1">{right ? t.workspace.openRight : t.workspace.openNewPane}</span>
        <span className="font-mono text-[10px] text-text-muted">{t.workspace.modClick(macKeys() ? '⌘' : 'Ctrl')}</span>
      </button>
    </div>
  )
}

/**
 * Left module rail. Collapses to icon-only on narrow widths (labels hidden via
 * the `xl:` breakpoint). The active item (the focused pane's module) is marked
 * in place — nothing slides when you switch modules; modules in the other
 * panes get a dot.
 */
export function SideNavigation({
  active,
  open = [],
  onSelect
}: {
  active: ModuleId
  /** Every module on screen. */
  open?: ModuleId[]
  onSelect: (id: ModuleId) => void
}) {
  const t = useT()
  const profileActive = active === 'account'
  const account = useCloud((s) => s.status?.account)
  const [menu, setMenu] = useState<{ id: ModuleId; x: number; y: number }>()
  const closeMenu = useCallback(() => setMenu(undefined), [])
  const click = (id: ModuleId) => (e: ReactMouseEvent) => {
    // ⌘-click (Ctrl-click on Windows and Linux): next to what is on screen, as a link opens in a new tab.
    if (macKeys() ? e.metaKey : e.ctrlKey) openBeside(id)
    else onSelect(id)
  }
  const contextMenu = (id: ModuleId) => (e: ReactMouseEvent) => {
    e.preventDefault()
    // From the keyboard (the menu key) there is no pointer: below the item.
    const box = e.currentTarget.getBoundingClientRect()
    setMenu({ id, x: e.clientX || box.right, y: e.clientY || box.top })
  }
  return (
    <nav className="flex h-full w-14 shrink-0 flex-col items-stretch gap-1 border-r border-hud/70 bg-surface/40 px-2 py-3 backdrop-blur-sm xl:w-52">
      <TechLabel className="mb-2 hidden px-2 text-text-muted xl:block">{t.nav.modules}</TechLabel>

      {NAV_ITEMS.map((item) => {
        const isActive = item.id === active
        const Icon = item.icon
        const label = t.nav[item.id]
        return (
          <button
            key={item.id}
            type="button"
            onClick={click(item.id)}
            onContextMenu={contextMenu(item.id)}
            draggable
            onDragStart={(e) => startModuleDrag(e, item.id)}
            onDragEnd={endModuleDrag}
            title={label}
            className={cn(
              'group relative flex items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors',
              isActive ? 'text-text-primary' : 'text-text-muted hover:text-text-secondary'
            )}
          >
            {isActive && (
              <span
                className="absolute inset-0 rounded-md border border-cyan/40 bg-cyan/[0.07]"
                style={{ boxShadow: 'inset 0 0 18px rgb(var(--accent-cyan) / 0.10)' }}
              />
            )}
            {/* left accent tick */}
            <span
              className={cn(
                'absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full',
                isActive ? 'bg-cyan opacity-100' : 'bg-transparent opacity-0'
              )}
            />
            <Icon
              size={18}
              strokeWidth={1.8}
              className={cn(
                'relative z-10 shrink-0 transition-colors',
                isActive && 'text-cyan'
              )}
            />
            <span className="relative z-10 hidden flex-1 items-center justify-between xl:flex">
              <span className="font-sans text-[13px] font-medium">{label}</span>
            </span>
            {!isActive && open.includes(item.id) && (
              <span data-testid={`open-${item.id}`} className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-cyan/70 xl:static xl:right-auto xl:top-auto" />
            )}
          </button>
        )
      })}

      {menu && <ModuleMenu id={menu.id} at={menu} onSelect={onSelect} onClose={closeMenu} />}

      {/* Profile: the Mindeck account, licence and language */}
      <button
        type="button"
        onClick={() => onSelect('account')}
        title={t.nav.account}
        aria-label={t.nav.account}
        className={cn(
          'mt-auto flex items-center gap-2.5 rounded-md border px-1.5 py-1.5 text-left transition-colors',
          profileActive
            ? 'border-cyan/40 bg-cyan/[0.07] text-text-primary'
            : 'border-hud/50 bg-surface/40 text-text-muted hover:border-hud-strong/70 hover:text-text-secondary'
        )}
      >
        <span
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border',
            profileActive ? 'border-cyan/50 text-cyan' : 'border-hud/70'
          )}
        >
          <UserRound size={15} strokeWidth={1.8} />
        </span>
        <span className="hidden min-w-0 flex-1 xl:block">
          <span className="block truncate font-sans text-[13px] font-medium text-text-primary">
            {account?.name ?? t.nav.account}
          </span>
          <span className="block truncate font-mono text-[10px] text-text-muted">{account?.email ?? t.nav.notSignedIn}</span>
        </span>
      </button>
    </nav>
  )
}

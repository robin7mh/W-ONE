import { Moon, SunMedium, Wifi, ShieldCheck } from 'lucide-react'
import { Clock } from './Clock'
import { StatusIndicator } from './StatusIndicator'
import { WindowControls } from './WindowControls'
import { TechLabel } from '@/components/ui/TechLabel'
import { StatusDot } from '@/components/ui/StatusDot'
import { formatUptime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { isMac } from '@/lib/platform'
import { useTheme } from '@/lib/theme'

export function TopStatusBar({ uptime, showClock = true }: { uptime: number; showClock?: boolean }) {
  const [theme, toggleTheme] = useTheme()

  return (
    <header
      className={cn(
        'drag-region relative z-20 flex h-12 shrink-0 items-center gap-4 border-b border-hud/70 bg-surface/60 px-3 backdrop-blur-md',
        isMac && 'pl-[88px]' // clear the native traffic lights
      )}
    >
      {/* Logo / codename */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-7 w-7 items-center justify-center rounded-md border border-cyan/40 bg-cyan/5 font-mono text-xs font-bold text-cyan text-glow-cyan">
          W1
        </div>
        <div className="leading-none">
          <div className="font-sans text-[13px] font-semibold tracking-wide text-text-primary">
            W-ONE
          </div>
          <TechLabel className="text-text-muted">Command Center</TechLabel>
        </div>
        <span className="ml-1 hidden items-center gap-1.5 rounded border border-hud/60 bg-surface/60 px-1.5 py-0.5 md:flex">
          <StatusDot tone="ok" />
          <span className="font-mono text-[10px] text-text-secondary">v0.1.0</span>
        </span>
      </div>

      <div className="mx-1 hidden h-5 w-px bg-hud/60 lg:block" />

      {/* Center: clock */}
      <div className="hidden flex-1 justify-center lg:flex">
        {showClock && <Clock />}
      </div>

      {/* Right cluster */}
      <div className="ml-auto flex items-center gap-2 lg:ml-0">
        <div className="hidden items-center gap-2 xl:flex">
          <StatusIndicator label="Mode" value="LOCAL" tone="cyan" />
          <StatusIndicator label="Uptime" value={formatUptime(uptime)} tone="ok" pulse={false} />
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <StatusIndicator label="Link" value="OK" tone="ok" />
        </div>

        {/* quick status glyphs */}
        <div className="hidden items-center gap-1 rounded-md border border-hud/60 bg-surface/50 px-2 py-1 md:flex">
          <ShieldCheck size={14} className="text-green" />
          <Wifi size={14} className="text-cyan" />
        </div>

        <button
          type="button"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          onClick={toggleTheme}
          className="no-drag flex h-7 w-7 items-center justify-center rounded-md border border-hud/60 bg-surface/50 text-text-muted transition-colors hover:border-cyan/50 hover:text-cyan"
        >
          {theme === 'dark' ? <SunMedium size={14} /> : <Moon size={14} />}
        </button>

        {!isMac && (
          <>
            <div className="mx-1 h-5 w-px bg-hud/60" />
            <WindowControls />
          </>
        )}
      </div>
    </header>
  )
}

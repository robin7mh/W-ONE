import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBridge, settle } from './bridge'
import type { SystemSnapshot } from '@shared/types/system'

import { Panel } from '@/components/ui/Panel'
import { StatusDot } from '@/components/ui/StatusDot'
import { TechLabel } from '@/components/ui/TechLabel'
import { GlowBackground } from '@/components/shell/GlowBackground'
import { ModulePlaceholder } from '@/components/shell/ModulePlaceholder'
import { SideNavigation } from '@/components/nav/SideNavigation'
import { WindowControls } from '@/components/topbar/WindowControls'
import { StatusIndicator } from '@/components/topbar/StatusIndicator'
import { Clock } from '@/components/topbar/Clock'
import { RadialGauge } from '@/components/monitor/RadialGauge'
import { Sparkline } from '@/components/monitor/Sparkline'
import { SystemMonitorPanel } from '@/components/monitor/SystemMonitorPanel'
import { BootSequence, BOOT_TOTAL_MS } from '@/components/boot/BootSequence'
import { BottomDashboard } from '@/components/dashboard/BottomDashboard'
import { HudClock } from '@/features/dashboard/components/HudClock'
import { NAV_ITEMS } from '@/data/navigation'
import { BOOT_LINES } from '@/data/bootLines'

afterEach(() => {
  vi.useRealTimers()
})

describe('ui primitives', () => {
  it('Panel renders header parts only when given, corners and flush body', () => {
    const { container, rerender } = render(<Panel>body</Panel>)
    expect(container.querySelector('header')).toBeNull()
    expect(container.querySelector('.p-3')).not.toBeNull()

    rerender(
      <Panel title="T" corners flush className="x" bodyClassName="y">
        body
      </Panel>
    )
    expect(screen.getByText('T')).toBeInTheDocument()
    expect(container.querySelector('[aria-hidden]')).not.toBeNull() // HudFrame
    expect(container.querySelector('.p-3')).toBeNull()

    rerender(<Panel headerRight={<b>R</b>}>body</Panel>)
    expect(screen.getByText('R')).toBeInTheDocument()
    expect(container.querySelector('.tech-label')).toBeNull()
  })

  it('StatusDot tones and pulse; TechLabel tags', () => {
    const { container, rerender } = render(<StatusDot />)
    expect(container.querySelector('.bg-cyan.animate-pulse-dot')).not.toBeNull()
    rerender(<StatusDot tone="error" pulse={false} />)
    expect(container.querySelector('.bg-danger')).not.toBeNull()
    expect(container.querySelector('.animate-pulse-dot')).toBeNull()
    rerender(<TechLabel as="h2">L</TechLabel>)
    expect(container.querySelector('h2.tech-label')).toHaveTextContent('L')
  })

  it('StatusIndicator shows label and value', () => {
    render(<StatusIndicator label="Mode" value="LOCAL" />)
    expect(screen.getByText('Mode')).toBeInTheDocument()
    expect(screen.getByText('LOCAL')).toBeInTheDocument()
  })
})

describe('shell pieces', () => {
  it('GlowBackground and ModulePlaceholder', () => {
    const { container } = render(<GlowBackground />)
    expect(container.querySelector('.hud-grid')).not.toBeNull()
    render(<ModulePlaceholder item={NAV_ITEMS[4]} />)
    expect(screen.getByText('Agents')).toBeInTheDocument()
    expect(screen.getByText(/not yet wired/)).toBeInTheDocument()
  })

  it('SideNavigation marks the active item, tags unready ones and selects', () => {
    const onSelect = vi.fn()
    render(<SideNavigation active="terminal" onSelect={onSelect} />)
    expect(screen.getAllByText('soon')).toHaveLength(NAV_ITEMS.filter((n) => !n.ready).length)
    expect(screen.getByTitle('Terminal').className).toContain('text-text-primary')
    expect(screen.getByTitle('Core').className).toContain('text-text-muted')
    fireEvent.click(screen.getByTitle('Memory'))
    expect(onSelect).toHaveBeenCalledWith('memory')
  })

  it('WindowControls drive the bridge and follow the maximized state', async () => {
    const bridge = installBridge({}, 'win32')
    render(<WindowControls />)
    await act(settle)
    fireEvent.click(screen.getByLabelText('Minimize'))
    fireEvent.click(screen.getByLabelText('Maximize'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(bridge.minimize).toHaveBeenCalled()
    expect(bridge.toggleMaximize).toHaveBeenCalled()
    expect(bridge.close).toHaveBeenCalled()
    act(() => bridge.setMaximized(true))
    expect(screen.getByLabelText('Restore')).toBeInTheDocument()
  })

  it('WindowControls no-op without a bridge', () => {
    render(<WindowControls />)
    fireEvent.click(screen.getByLabelText('Minimize'))
    fireEvent.click(screen.getByLabelText('Maximize'))
    fireEvent.click(screen.getByLabelText('Close'))
    expect(screen.getByLabelText('Maximize')).toBeInTheDocument()
  })

  it('Clock and HudClock show the time', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 2, 7, 8, 9))
    render(<Clock />)
    expect(screen.getByText('07:08:09')).toBeInTheDocument()
    render(<HudClock now={new Date(2026, 0, 2, 7, 8, 9)} />)
    expect(screen.getByLabelText('07:08:09')).toHaveTextContent('07:0809')
  })
})

describe('TopStatusBar', () => {
  const load = async (platform?: string) => {
    if (platform) installBridge({}, platform)
    vi.resetModules()
    return (await import('@/components/topbar/TopStatusBar')).TopStatusBar
  }

  it('on macOS leaves room for the traffic lights and has no custom controls', async () => {
    const TopStatusBar = await load('darwin')
    const { container } = render(<TopStatusBar uptime={61} />)
    await act(settle)
    expect(container.querySelector('header')!.className).toContain('pl-[88px]')
    expect(screen.queryByLabelText('Close')).toBeNull()
    expect(screen.getByText('00:01:01')).toBeInTheDocument()
  })

  it('elsewhere shows window controls; hides the clock on request; toggles the theme', async () => {
    const TopStatusBar = await load()
    const { container } = render(<TopStatusBar uptime={0} showClock={false} />)
    expect(container.querySelector('header')!.className).not.toContain('pl-[88px]')
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Switch to light mode'))
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByLabelText('Switch to dark mode'))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('monitor', () => {
  it('RadialGauge clamps and labels', () => {
    const { container, rerender } = render(<RadialGauge value={150} label="CPU" />)
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.getByText('CPU')).toBeInTheDocument()
    rerender(<RadialGauge value={-3} />)
    expect(container.querySelectorAll('circle')[1].getAttribute('stroke-dasharray')).toMatch(/^0 /)
  })

  it('Sparkline needs two points', () => {
    const { container, rerender } = render(<Sparkline data={[1]} />)
    expect(container.querySelector('path')).toBeNull()
    rerender(<Sparkline data={[0, 50, 200]} />)
    expect(container.querySelectorAll('path')).toHaveLength(2)
  })

  const snap = (over: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
    cpu: { total: 12, cores: [] },
    mem: { usedPct: 40, usedGb: 4, totalGb: 8 },
    disk: { usedPct: 70, mount: '/' },
    net: { rxMbps: 1.25, txMbps: 0.5 },
    battery: { pct: 80, charging: false, hasBattery: true },
    uptimeSec: 90061,
    processes: [{ pid: 7, name: 'node', cpu: 3.21, mem: 120 }],
    ts: 1,
    ...over
  })

  it('SystemMonitorPanel: offline without a bridge', () => {
    render(<SystemMonitorPanel />)
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
    expect(screen.getByText('no data')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('N/A')).toBeInTheDocument()
  })

  it('SystemMonitorPanel: live data, uptime formats, battery states', async () => {
    const bridge = installBridge({ 'system:snapshot': () => snap() })
    render(<SystemMonitorPanel />)
    await act(settle)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByText('1d 1h')).toBeInTheDocument()
    expect(screen.getByText('1.8')).toBeInTheDocument() // network MB/s
    expect(screen.getByText('Battery')).toBeInTheDocument()
    expect(screen.getByText('node')).toBeInTheDocument()
    expect(screen.getByText('3.2')).toBeInTheDocument()

    act(() => bridge.emit('system:tick', snap({ uptimeSec: 3720, battery: { pct: 50, charging: true, hasBattery: true } })))
    expect(screen.getByText('1h 2m')).toBeInTheDocument()
    expect(screen.getByText('Battery ⚡')).toBeInTheDocument()

    act(() => bridge.emit('system:tick', snap({ uptimeSec: 120, processes: [] })))
    expect(screen.getByText('2m')).toBeInTheDocument()
    expect(screen.getByText('sampling…')).toBeInTheDocument()
  })
})

describe('BootSequence', () => {
  it('reveals lines over time, then completes; click skips', () => {
    vi.useFakeTimers()
    const onSkip = vi.fn()
    const { container } = render(<BootSequence onSkip={onSkip} />)
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).not.toBeNull()
    act(() => {
      vi.advanceTimersByTime(BOOT_TOTAL_MS)
    })
    expect(screen.getByText('100%')).toBeInTheDocument()
    expect(screen.getByText(BOOT_LINES[0].text)).toBeInTheDocument()
    expect(container.querySelector('.animate-pulse')).toBeNull()
    fireEvent.click(screen.getByText('click to skip'))
    expect(onSkip).toHaveBeenCalled()
  })
})

describe('BottomDashboard', () => {
  it('starts collapsed, toggles and remembers the choice', () => {
    render(<BottomDashboard />)
    const btn = screen.getByRole('button', { name: /command deck/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText(/Nothing here yet/)).toBeInTheDocument()
    expect(localStorage.getItem('wone.commandDeck.open')).toBe('1')
    fireEvent.click(btn)
    expect(localStorage.getItem('wone.commandDeck.open')).toBe('0')
  })

  it('opens from the saved preference and survives blocked storage', () => {
    localStorage.setItem('wone.commandDeck.open', '1')
    const first = render(<BottomDashboard />)
    expect(screen.getByRole('button', { name: /command deck/i })).toHaveAttribute('aria-expanded', 'true')
    first.unmount()

    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    render(<BottomDashboard />)
    const btn = screen.getByRole('button', { name: /command deck/i })
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
    get.mockRestore()
    set.mockRestore()
  })
})

describe('AppShell', () => {
  it('boots, switches modules, keeps the terminal mounted and counts uptime', async () => {
    vi.doMock('@/features/terminal/components/TerminalView', () => ({ TerminalView: () => <div>TERMINAL</div> }))
    vi.doMock('@/features/dashboard/components/Dashboard', () => ({
      Dashboard: ({ onNavigate }: { onNavigate: (id: string) => void }) => (
        <button onClick={() => onNavigate('projects')}>DASHBOARD</button>
      )
    }))
    vi.doMock('@/features/projects/components/ProjectsView', () => ({ ProjectsView: () => <div>PROJECTS</div> }))
    vi.doMock('@/features/memory/components/MemoryView', () => ({ MemoryView: () => <div>MEMORY</div> }))
    vi.doMock('@/components/monitor/SystemMonitorPanel', () => ({ SystemMonitorPanel: () => <div>MONITOR</div> }))
    vi.resetModules()
    const { AppShell } = await import('@/components/shell/AppShell')

    vi.useFakeTimers()
    render(<AppShell />)
    expect(screen.getByText('click to skip')).toBeInTheDocument()
    fireEvent.click(screen.getByText('click to skip'))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('00:00:02')).toBeInTheDocument() // uptime

    expect(screen.getByText('MONITOR')).toBeInTheDocument()
    fireEvent.click(screen.getByText('DASHBOARD'))
    expect(screen.getByText('PROJECTS')).toBeInTheDocument()

    expect(screen.queryByText('TERMINAL')).toBeNull()
    fireEvent.click(screen.getByTitle('Terminal'))
    expect(screen.getByText('TERMINAL').parentElement!.className).not.toContain('hidden')

    fireEvent.click(screen.getByTitle('Memory'))
    expect(screen.getByText('MEMORY')).toBeInTheDocument()
    expect(screen.queryByText('MONITOR')).toBeNull()
    expect(screen.getByText('TERMINAL').parentElement!.className).toBe('hidden')

    fireEvent.click(screen.getByTitle('Agents'))
    expect(screen.getByText(/not yet wired/)).toBeInTheDocument()

    vi.doUnmock('@/features/terminal/components/TerminalView')
    vi.doUnmock('@/features/dashboard/components/Dashboard')
    vi.doUnmock('@/features/projects/components/ProjectsView')
    vi.doUnmock('@/features/memory/components/MemoryView')
    vi.doUnmock('@/components/monitor/SystemMonitorPanel')
  })
})

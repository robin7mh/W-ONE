import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installBridge, settle } from './bridge'
import type { SystemSnapshot } from '@shared/types/system'

import { Panel } from '@/components/ui/Panel'
import { StatusDot } from '@/components/ui/StatusDot'
import { TechLabel } from '@/components/ui/TechLabel'
import { GlowBackground } from '@/components/shell/GlowBackground'
import { SideNavigation } from '@/components/nav/SideNavigation'
import { WindowControls } from '@/components/topbar/WindowControls'
import { StatusIndicator } from '@/components/topbar/StatusIndicator'
import { Clock } from '@/components/topbar/Clock'
import { RadialGauge } from '@/components/monitor/RadialGauge'
import { Sparkline } from '@/components/monitor/Sparkline'
import { SystemMonitorPanel } from '@/components/monitor/SystemMonitorPanel'
import { BootSequence, BOOT_TOTAL_MS } from '@/components/boot/BootSequence'
import { BottomDashboard } from '@/components/dashboard/BottomDashboard'
import { useAssistant as staticAssistant } from '@/features/agents/store'
import { useAgents as staticAgents } from '@/features/agents/sessions'
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
  it('GlowBackground', () => {
    const { container } = render(<GlowBackground />)
    expect(container.querySelector('.hud-grid')).not.toBeNull()
  })

  it('SideNavigation marks the active item and selects', () => {
    const onSelect = vi.fn()
    render(<SideNavigation active="terminal" onSelect={onSelect} />)
    expect(screen.getAllByRole('button')).toHaveLength(NAV_ITEMS.length)
    expect(screen.getByTitle('Terminal').className).toContain('text-text-primary')
    expect(screen.getByTitle('Core').className).toContain('text-text-muted')
    fireEvent.click(screen.getByTitle('Memory'))
    expect(onSelect).toHaveBeenCalledWith('memory')
  })

  it('SideNavigation shows which core it is linked to', async () => {
    const { useSession } = await import('@/features/session/store')
    useSession.setState({ info: undefined })
    render(<SideNavigation active="core" onSelect={vi.fn()} />)
    expect(screen.getByText('LINKING…')).toBeInTheDocument()
    const info = { mode: 'desktop' as const, version: '1.0.0', platform: 'darwin', hostname: 'mac', remoteTerminal: false, db: { connected: true } }
    act(() => useSession.setState({ info }))
    expect(screen.getByText('DESKTOP · v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('mac · db online')).toBeInTheDocument()
    act(() => useSession.setState({ info: { ...info, mode: 'server', db: { connected: false } } }))
    expect(screen.getByText('SERVER · v1.0.0')).toBeInTheDocument()
    expect(screen.getByText('mac · db offline')).toBeInTheDocument()
    act(() => useSession.setState({ info: undefined }))
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
    const TopStatusBar = await load('linux')
    const { container } = render(<TopStatusBar uptime={0} showClock={false} />)
    expect(container.querySelector('header')!.className).not.toContain('pl-[88px]')
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Switch to light mode'))
    expect(document.documentElement.dataset.theme).toBe('light')
    fireEvent.click(screen.getByLabelText('Switch to dark mode'))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('TopStatusBar in a browser', () => {
  it('shows the remote core, the live link state and a disconnect button', async () => {
    vi.resetModules()
    const { TopStatusBar } = await import('@/components/topbar/TopStatusBar')
    const { useSession } = await import('@/features/session/store')
    const logout = vi.fn(async () => {})
    useSession.setState({ link: 'online', info: { mode: 'server', version: '2.0.0', platform: 'linux', hostname: 'nas', remoteTerminal: false, db: { connected: true } }, logout })
    render(<TopStatusBar uptime={0} />)
    expect(screen.queryByLabelText('Close')).toBeNull()
    expect(screen.getByText('REMOTE · nas')).toBeInTheDocument()
    expect(screen.getByText('v2.0.0')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()
    act(() => useSession.setState({ link: 'connecting', info: undefined }))
    expect(screen.getByText('SYNC')).toBeInTheDocument()
    expect(screen.getByText('REMOTE · core')).toBeInTheDocument()
    act(() => useSession.setState({ link: 'offline' }))
    expect(screen.getByText('DOWN')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Disconnect this browser'))
    expect(logout).toHaveBeenCalled()
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
    expect(screen.getByText('No agent is running')).toBeInTheDocument()
    expect(screen.getByText('No agent activity yet')).toBeInTheDocument()
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

describe('BottomDashboard with live agents', () => {
  it('shows running agents (open / stop), waiting approvals and the activity outcomes', async () => {
    const useAssistant = staticAssistant
    const stop = vi.fn(async () => {})
    const ev = (id: string, type: string, payload: Record<string, unknown> = {}) => ({ id, type, ts: '2026-10-02T08:00:00.000Z', actor: { kind: 'agent' }, payload }) as never
    useAssistant.setState({
      conversations: [
        { id: 'c1', title: 'Plan week', agentId: 'assistant', createdAt: '', updatedAt: '', running: true },
        { id: 'c2', title: 'Idle', agentId: 'assistant', createdAt: '', updatedAt: '', running: false }
      ],
      running: { c1: true },
      pending: [{ id: 'r1' } as never],
      activity: [ev('e1', 'agent.status.updated', { text: 'Thinking' }), ev('e2', 'tool.completed', { summary: 'Read A' })],
      stop
    })
    localStorage.setItem('wone.commandDeck.open', '1')
    const onOpen = vi.fn()
    render(<BottomDashboard onOpenConversation={onOpen} />)
    expect(screen.getByText('1 running')).toBeInTheDocument()
    expect(screen.getByText('1 waiting for approval')).toBeInTheDocument()
    expect(screen.getByText('1 action(s) wait for your approval')).toBeInTheDocument()
    expect(screen.queryByText('Idle')).toBeNull()
    expect(screen.getByText('Done: Read A')).toBeInTheDocument()
    expect(screen.queryByText('Thinking')).toBeNull()
    fireEvent.click(screen.getByText('Plan week'))
    expect(onOpen).toHaveBeenCalledWith('c1')
    fireEvent.click(screen.getByLabelText('Stop Plan week'))
    expect(stop).toHaveBeenCalledWith('c1')
    useAssistant.setState({ conversations: [], running: {}, pending: [], activity: [] })
  })

  it('shows coding agent sessions too: who needs you, open, end', () => {
    const session = (id: string, status: string, terminalId?: string) =>
      ({ id, title: `Session ${id}`, status, terminalId, live: !!terminalId, projectId: 'p', projectName: 'P', kind: 'claude-code', cwd: '/', isolated: false, plan: [], notes: [], createdAt: '', updatedAt: '' }) as never
    const stop = vi.fn(async () => {})
    staticAgents.setState({ sessions: [session('a', 'working', 't1'), session('b', 'approval', 't2'), session('c', 'ended')], stop })
    localStorage.setItem('wone.commandDeck.open', '1')
    const onOpenSession = vi.fn()
    render(<BottomDashboard onOpenSession={onOpenSession} />)
    expect(screen.getByText('2 running')).toBeInTheDocument()
    expect(screen.getByText('1 need you')).toBeInTheDocument()
    expect(screen.getByText('· Needs your approval')).toBeInTheDocument()
    expect(screen.queryByText('Session c')).toBeNull() // ended: not running
    fireEvent.click(screen.getByText('Session a'))
    expect(onOpenSession).toHaveBeenCalledWith('a')
    fireEvent.click(screen.getByLabelText('End Session b'))
    expect(stop).toHaveBeenCalledWith('b')
    staticAgents.setState({ sessions: [] })
  })
})

describe('AppShell', () => {
  it('boots, switches modules, keeps terminal and editor mounted and counts uptime', async () => {
    vi.doMock('@/features/terminal/components/TerminalView', () => ({ TerminalView: () => <div>TERMINAL</div> }))
    vi.doMock('@/features/editor/components/EditorView', () => ({
      EditorView: ({ active, onNavigate }: { active: boolean; onNavigate: (id: string) => void }) => (
        <button onClick={() => onNavigate('projects')}>{active ? 'EDITOR ON' : 'EDITOR OFF'}</button>
      )
    }))
    vi.doMock('@/features/dashboard/components/Dashboard', () => ({
      Dashboard: ({ onNavigate }: { onNavigate: (id: string) => void }) => (
        <button onClick={() => onNavigate('projects')}>DASHBOARD</button>
      )
    }))
    vi.doMock('@/features/projects/components/ProjectsView', () => ({ ProjectsView: () => <div>PROJECTS</div> }))
    vi.doMock('@/features/memory/components/MemoryView', () => ({ MemoryView: () => <div>MEMORY</div> }))
    vi.doMock('@/components/monitor/SystemMonitorPanel', () => ({ SystemMonitorPanel: () => <div>MONITOR</div> }))
    vi.doMock('@/features/agents/components/AgentsView', () => ({
      AgentsView: ({ onOpenNote, onOpenSettings }: { onOpenNote: (p: string) => void; onOpenSettings: () => void }) => (
        <div>
          AGENTS
          <button onClick={() => onOpenNote('Agents/x.md')}>OPEN NOTE</button>
          <button onClick={onOpenSettings}>OPEN SETTINGS</button>
        </div>
      )
    }))
    vi.doMock('@/features/settings/components/SettingsView', () => ({ SettingsView: () => <div>SETTINGS</div> }))
    vi.doMock('@/features/system/components/SystemView', () => ({ SystemView: () => <div>SYSTEM</div> }))
    vi.resetModules()
    const { AppShell } = await import('@/components/shell/AppShell')
    const { useAssistant } = await import('@/features/agents/store')
    const { useAgents } = await import('@/features/agents/sessions')
    const { useMemory } = await import('@/features/memory/store')
    const connect = vi.fn(() => () => {})
    const open = vi.fn(async () => {})
    const agentsConnect = vi.fn(() => () => {})
    const openSession = vi.fn(async () => {})
    const openNote = vi.fn(async () => {})
    useAgents.setState({ connect: agentsConnect, open: openSession })
    useMemory.setState({ open: openNote })
    useAssistant.setState({ connect, open })

    vi.useFakeTimers()
    render(<AppShell />)
    expect(screen.getByText('click to skip')).toBeInTheDocument()
    fireEvent.click(screen.getByText('click to skip'))
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('00:00:02')).toBeInTheDocument() // uptime

    expect(screen.getByText('MONITOR')).toBeInTheDocument() // the rail is Core's
    fireEvent.click(screen.getByText('DASHBOARD'))
    expect(screen.getByText('PROJECTS')).toBeInTheDocument()
    expect(screen.queryByText('MONITOR')).toBeNull()

    expect(screen.queryByText('TERMINAL')).toBeNull()
    fireEvent.click(screen.getByTitle('Terminal'))
    expect(screen.getByText('TERMINAL').parentElement!.className).not.toContain('hidden')
    expect(screen.queryByText('MONITOR')).toBeNull()

    expect(screen.queryByText(/EDITOR/)).toBeNull()
    fireEvent.click(screen.getByTitle('Editor'))
    expect(screen.getByText('EDITOR ON').parentElement!.className).not.toContain('hidden')
    expect(screen.queryByText('MONITOR')).toBeNull()
    expect(screen.getByText('TERMINAL').parentElement!.className).toBe('hidden')
    fireEvent.click(screen.getByTitle('Terminal')) // second visit: both stay mounted
    expect(screen.getByText('EDITOR OFF').parentElement!.className).toBe('hidden')
    fireEvent.click(screen.getByTitle('Editor'))
    fireEvent.click(screen.getByText('EDITOR ON')) // the editor can send you elsewhere
    expect(screen.getByText('PROJECTS')).toBeInTheDocument()

    fireEvent.click(screen.getByTitle('Memory'))
    expect(screen.getByText('MEMORY')).toBeInTheDocument()
    expect(screen.queryByText('MONITOR')).toBeNull()
    expect(screen.getByText('TERMINAL').parentElement!.className).toBe('hidden')

    fireEvent.click(screen.getByTitle('Agents'))
    expect(screen.getByText('AGENTS')).toBeInTheDocument()
    expect(connect).toHaveBeenCalled()
    expect(agentsConnect).toHaveBeenCalled()
    fireEvent.click(screen.getByText('OPEN NOTE')) // a session's note → Memory
    expect(screen.getByText('MEMORY')).toBeInTheDocument()
    expect(openNote).toHaveBeenCalledWith('Agents/x.md')
    fireEvent.click(screen.getByTitle('Agents'))
    fireEvent.click(screen.getByText('OPEN SETTINGS'))
    expect(screen.getByText('SETTINGS')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('System'))
    expect(screen.getByText('SYSTEM')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Settings'))
    expect(screen.getByText('SETTINGS')).toBeInTheDocument()

    // approvals float above modules; the Command Deck jumps into a conversation
    act(() =>
      useAssistant.setState({
        pending: [{ id: 'p1', conversationId: 'c1', agentName: 'Assistant', toolTitle: 'Create note', risk: 'write', summary: 'Create X', reason: '', allowAlways: true } as never],
        conversations: [{ id: 'c1', title: 'Chat one', agentId: 'assistant', createdAt: '', updatedAt: '', running: true }],
        running: { c1: true },
        activeId: 'c1'
      })
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /command deck/i }))
    fireEvent.click(screen.getByText('Chat one'))
    expect(open).toHaveBeenCalledWith('c1')
    expect(screen.getByText('AGENTS')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).toBeNull() // the open chat shows it inline
    expect(useAgents.getState().view).toBe('assistant')
    act(() => useAssistant.setState({ pending: [], conversations: [], running: {}, activeId: undefined }))

    // …and into a coding agent session
    fireEvent.click(screen.getByTitle('Core'))
    act(() =>
      useAgents.setState({
        sessions: [{ id: 's1', title: 'Fix login', status: 'working', live: true, terminalId: 't', projectId: 'p', projectName: 'P', kind: 'claude-code', cwd: '/', isolated: false, plan: [], notes: [], createdAt: '', updatedAt: '' }]
      })
    )
    fireEvent.click(screen.getByText('Fix login'))
    expect(openSession).toHaveBeenCalledWith('s1')
    expect(screen.getByText('AGENTS')).toBeInTheDocument()
    // its approval shows inline in the open session, not as a toast
    act(() =>
      useAssistant.setState({
        pending: [{ id: 'p2', conversationId: 's1', agentName: 'Claude Code', toolTitle: 'Run command', risk: 'execute', summary: 'npm test', reason: '', allowAlways: false } as never]
      })
    )
    expect(screen.getByRole('alertdialog')).toBeInTheDocument() // the session isn't the open one yet
    act(() => useAgents.setState({ view: 'session', activeId: 's1' }))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    act(() => useAssistant.setState({ pending: [] }))
    act(() => useAgents.setState({ sessions: [] }))

    vi.doUnmock('@/features/agents/components/AgentsView')
    vi.doUnmock('@/features/settings/components/SettingsView')
    vi.doUnmock('@/features/system/components/SystemView')
    vi.doUnmock('@/features/terminal/components/TerminalView')
    vi.doUnmock('@/features/editor/components/EditorView')
    vi.doUnmock('@/features/dashboard/components/Dashboard')
    vi.doUnmock('@/features/projects/components/ProjectsView')
    vi.doUnmock('@/features/memory/components/MemoryView')
    vi.doUnmock('@/components/monitor/SystemMonitorPanel')
  })
})

describe('AppShell in a browser without remote shells', () => {
  it('explains instead of opening a terminal', async () => {
    vi.doMock('@/features/terminal/components/TerminalView', () => ({ TerminalView: () => <div>TERMINAL</div> }))
    vi.doMock('@/features/dashboard/components/Dashboard', () => ({ Dashboard: () => <div>DASHBOARD</div> }))
    vi.doMock('@/components/monitor/SystemMonitorPanel', () => ({ SystemMonitorPanel: () => <div>MONITOR</div> }))
    vi.resetModules()
    const { AppShell } = await import('@/components/shell/AppShell')
    const { useSession } = await import('@/features/session/store')
    const { useAssistant } = await import('@/features/agents/store')
    useAssistant.setState({ connect: () => () => {} })
    useSession.setState({ info: { mode: 'server', version: '1', platform: 'linux', hostname: 'nas', remoteTerminal: false, db: { connected: false } } })
    render(<AppShell />)
    fireEvent.click(screen.getByTitle('Terminal'))
    expect(screen.getByText('Remote shells are off')).toBeInTheDocument()
    expect(screen.queryByText('TERMINAL')).toBeNull()
    useSession.setState({ info: undefined })
    vi.doUnmock('@/features/terminal/components/TerminalView')
    vi.doUnmock('@/features/dashboard/components/Dashboard')
    vi.doUnmock('@/components/monitor/SystemMonitorPanel')
  })
})

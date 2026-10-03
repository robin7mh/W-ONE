import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fail, installBridge, installRemote, settle } from './bridge'
import type { ServerStatus } from '@shared/types/server'
import type { SystemSnapshot } from '@shared/types/system'
import type { ProjectContext } from '@shared/types/context'
import { pairingUrl, useSettings } from '@/features/settings/store'
import { SettingsView } from '@/features/settings/components/SettingsView'
import { SystemView } from '@/features/system/components/SystemView'
import { ContextSection } from '@/features/projects/components/ContextSection'
import { useContextStore } from '@/features/context/store'
import { useAssistant } from '@/features/agents/store'
import { useSession } from '@/features/session/store'
import { codeFromHash, PairScreen } from '@/features/session/components/PairScreen'

const initialSettings = useSettings.getState()
const initialAssistant = useAssistant.getState()
beforeEach(() => {
  useSettings.setState(initialSettings, true)
  useAssistant.setState(initialAssistant, true)
  useContextStore.setState({ byProject: {} })
})

const server = (over: Partial<ServerStatus> = {}): ServerStatus => ({
  config: { enabled: true, lan: false, port: 7420, remoteTerminal: false },
  running: true,
  urls: ['http://127.0.0.1:7420'],
  configurable: true,
  ...over
})

function settingsCore(over: Record<string, (p: never) => unknown> = {}) {
  return {
    'server:status': () => server(),
    'server:devices': () => [
      { id: 'd1', name: 'Pixel Phone', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() },
      { id: 'd2', name: 'Chrome · macOS', createdAt: new Date().toISOString() }
    ],
    'permission:grants': () => [{ agentId: 'assistant', toolName: 'memory_create_note', createdAt: '' }],
    'server:configure': (patch: Record<string, unknown>) => server({ config: { ...server().config, ...patch } as never }),
    'server:createPairingCode': () => ({ code: 'ABCD-EFGH', expiresAt: '', urls: ['http://127.0.0.1:7420', 'http://192.168.1.9:7420'] }),
    'server:revokeDevice': () => undefined,
    'permission:revoke': () => undefined,
    'memory:status': () => ({ root: '/v', defaultRoot: '/v', name: 'W-ONE', isDefault: true, exists: true, noteCount: 3, graphStyle: { mode: 'colorful', color: 'cyan' } }),
    'memory:pickVault': () => ({ root: '/picked', defaultRoot: '/v', name: 'picked', isDefault: false, exists: false, noteCount: 0, graphStyle: { mode: 'colorful', color: 'cyan' } }),
    'memory:setVault': ({ path }: { path: string }) => ({ root: path, defaultRoot: '/v', name: 'x', isDefault: false, exists: true, noteCount: 1, graphStyle: { mode: 'colorful', color: 'cyan' } }),
    'fs:dirs': () => ({ path: '/srv/notes', parent: '/srv', home: '/root', dirs: [] }),
    'ai:setKey': () => ({ configured: true, source: 'stored', keyHint: 'NEW1', settings: { model: 'claude-opus-5-5', effort: 'high' } }),
    'ai:clearKey': () => ({ configured: false, source: null, settings: { model: 'claude-opus-5-5', effort: 'high' } }),
    'ai:configure': (p: Record<string, unknown>) => ({ configured: true, source: 'stored', keyHint: 'NEW1', settings: { model: 'claude-opus-5-5', effort: 'high', ...p } }),
    ...over
  }
}

describe('settings store', () => {
  it('builds the pairing URL a phone can open', () => {
    expect(pairingUrl('AB CD', ['http://127.0.0.1:7420', 'http://192.168.1.9:7420'])).toBe('http://192.168.1.9:7420/#pair=AB%20CD')
    expect(pairingUrl('X', ['http://127.0.0.1:7420'])).toBe('http://127.0.0.1:7420/#pair=X')
    expect(pairingUrl('X', ['http://127.0.0.1:7420'], 'http://nas.local:7420/')).toBe('http://nas.local:7420/#pair=X')
    expect(pairingUrl('X', ['http://127.0.0.1:7420'], 'file://')).toBe('http://127.0.0.1:7420/#pair=X')
  })

  it('server switches move at once; the core settles them, a failure puts them back', async () => {
    let answer!: (ok: boolean) => void
    installBridge(
      settingsCore({
        'server:configure': () =>
          new Promise((resolve, reject) => (answer = (ok) => (ok ? resolve({ ...server(), running: false, config: { ...server().config, enabled: false } }) : reject(new Error('port busy')))))
      })
    )
    const s = () => useSettings.getState()
    let pending = s().configureServer({ enabled: false }) // nothing loaded yet: nothing to move early
    expect(s().server).toBeUndefined()
    answer(false)
    await pending
    expect(s().server).toBeUndefined()
    await s().load()

    pending = s().configureServer({ enabled: false })
    expect(s().server).toMatchObject({ running: true, config: { enabled: false } }) // the switch moved, the state is real
    expect(s().busy).toBe(true)
    answer(true)
    await pending
    expect(s().server).toMatchObject({ running: false, config: { enabled: false } })

    useSettings.setState({ server: server() })
    pending = s().configureServer({ enabled: false })
    answer(false)
    await pending
    expect(s().server?.config.enabled).toBe(true)
    expect(s()).toMatchObject({ busy: false, error: 'port busy' })
  })

  it('loads, configures, pairs (with a QR code), revokes; reports failures', async () => {
    installBridge(settingsCore())
    const s = () => useSettings.getState()
    await s().load()
    expect(s().devices).toHaveLength(2)
    expect(s().grants).toHaveLength(1)
    await s().configureServer({ lan: true })
    expect(s().server?.config.lan).toBe(true)
    await s().createPairing()
    expect(s().pairing).toMatchObject({ code: 'ABCD-EFGH', url: expect.stringContaining('#pair=ABCD-EFGH') })
    expect(s().pairing!.qr).toContain('<svg')
    s().closePairing()
    expect(s().pairing).toBeUndefined()
    await settle() // closing reloads the device list
    await s().revokeDevice('d1')
    expect(s().devices.map((d) => d.id)).toEqual(['d2'])
    await s().revokeGrant('assistant', 'memory_create_note')
    expect(s().grants).toEqual([])

    installBridge(
      Object.fromEntries(
        ['server:status', 'server:configure', 'server:createPairingCode', 'server:revokeDevice', 'permission:revoke'].map((ch) => [ch, () => fail(`${ch} failed`)])
      )
    )
    for (const [run, text] of [
      [() => s().load(), 'server:status failed'],
      [() => s().configureServer({}), 'server:configure failed'],
      [() => s().createPairing(), 'server:createPairingCode failed'],
      [() => s().revokeDevice('x'), 'server:revokeDevice failed'],
      [() => s().revokeGrant('a', 't'), 'permission:revoke failed']
    ] as const) {
      await run()
      expect(s()).toMatchObject({ error: text, busy: false })
    }
    s().clearError()
    expect(s().error).toBeUndefined()
  })
})

describe('SettingsView', () => {
  it('desktop: AI key + model, server toggles, pairing, devices, grants, vault, about', async () => {
    installBridge(settingsCore())
    localStorage.setItem('wone.deviceId', 'd2')
    useAssistant.setState({ status: { configured: true, source: 'stored', keyHint: 'ABCD', settings: { model: 'claude-opus-5-5', effort: 'high' } } })
    useSession.setState({ info: { mode: 'desktop', version: '1.2.3', platform: 'darwin', hostname: 'mac', remoteTerminal: false, db: { connected: true, schema: 1 } } })
    render(<SettingsView />)
    await act(settle)

    // AI
    expect(screen.getByText('Anthropic key stored · …ABCD')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('New API key'), { target: { value: 'sk-new' } })
    fireEvent.click(screen.getByText('Save'))
    await act(settle)
    expect(screen.getByText('Anthropic key stored · …NEW1')).toBeInTheDocument()
    expect(screen.getByLabelText('New API key')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Effort'), { target: { value: 'low' } })
    await act(settle)
    expect(useAssistant.getState().status?.settings.effort).toBe('low')
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'claude-sonnet-5-5' } })
    await act(settle)
    fireEvent.click(screen.getByLabelText('Remove key'))
    await act(settle)
    expect(screen.getByText('No API key yet')).toBeInTheDocument()

    // server
    expect(screen.getByText('API server running')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Reachable on the local network'))
    await act(settle)
    expect(useSettings.getState().server?.config.lan).toBe(true)
    fireEvent.click(screen.getByLabelText('Allow remote shells'))
    fireEvent.click(screen.getByLabelText('Run the API server'))
    await act(settle)
    const port = screen.getByLabelText('Port')
    fireEvent.change(port, { target: { value: '80' } })
    fireEvent.blur(port) // below 1024: ignored
    fireEvent.change(port, { target: { value: '7421' } })
    fireEvent.blur(port)
    await act(settle)

    // pairing + devices
    act(() => useSettings.setState({ server: server() }))
    fireEvent.click(screen.getByText('Pair a device'))
    await act(settle)
    expect(screen.getByText('ABCD-EFGH')).toBeInTheDocument()
    expect(screen.getByLabelText('Pairing QR code').innerHTML).toContain('<svg')
    fireEvent.click(screen.getByLabelText('Close pairing'))
    expect(screen.queryByText('ABCD-EFGH')).toBeNull()
    await act(settle)
    expect(screen.getByText('this browser')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Revoke Pixel Phone'))
    await act(settle)
    expect(screen.queryByText('Pixel Phone')).toBeNull()

    // grants
    expect(screen.getByText('assistant → memory_create_note')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Revoke assistant memory_create_note'))
    await act(settle)
    expect(screen.getByText('No standing permissions')).toBeInTheDocument()

    // vault (desktop: native picker)
    expect(screen.getByText('/v')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Choose folder…'))
    await act(settle)
    expect(screen.getByText('/picked')).toBeInTheDocument()
    expect(screen.getByText(/Not created yet · custom folder/)).toBeInTheDocument()

    // about
    expect(screen.getByText('Desktop app')).toBeInTheDocument()
    expect(screen.getByText('Postgres · schema v1')).toBeInTheDocument()
    expect(screen.getByText('Desktop window')).toBeInTheDocument()
    useSession.setState({ info: undefined })
  })

  it('in a browser: server settings are read-only, vault via folder browser, errors show', async () => {
    installRemote(
      settingsCore({
        'server:status': () => server({ configurable: false, running: false, error: 'EADDRINUSE', config: { enabled: true, lan: true, port: 7420, remoteTerminal: true } }),
        'server:devices': () => [],
        'memory:setVault': () => fail('That folder does not exist')
      })
    )
    useAssistant.setState({ status: { configured: true, source: 'env', keyHint: '9999', settings: { model: 'claude-opus-5-5', effort: 'high' } }, error: 'ai problem' })
    useSession.setState({ info: { mode: 'server', version: '1', platform: 'linux', hostname: 'nas', remoteTerminal: true, db: { connected: false } } })
    render(<SettingsView />)
    await act(settle)
    expect(screen.getByText('Anthropic key from the environment · …9999')).toBeInTheDocument()
    expect(screen.queryByLabelText('New API key')).toBeNull()
    expect(screen.getByText('API server off')).toBeInTheDocument()
    expect(screen.getByText('EADDRINUSE')).toBeInTheDocument()
    expect(screen.getByText(/configured through its environment/)).toBeInTheDocument()
    expect(screen.getByText(/Remote shells: allowed/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Port')).toBeNull()
    expect(screen.getByText('No devices paired')).toBeInTheDocument()
    expect(screen.getByText('Pair a device').closest('button')).toBeDisabled()
    expect(screen.getByText('Server')).toBeInTheDocument()
    expect(screen.getByText('not connected — npm run db:up')).toBeInTheDocument()
    expect(screen.getByText('Browser (paired)')).toBeInTheDocument()

    expect(screen.getByText('ai problem')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(useAssistant.getState().error).toBeUndefined()

    fireEvent.click(screen.getByText('Choose folder…'))
    fireEvent.click(await screen.findByText('Use as vault'))
    await act(settle)
    expect(screen.getByText('That folder does not exist')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Choose folder…'))
    fireEvent.click(await screen.findByLabelText('Close'))
    useSession.setState({ info: undefined })
  })

  it('desktop server settings without a configurable server, vault errors and storage failures', async () => {
    installBridge(settingsCore({ 'server:status': () => server({ configurable: false }), 'memory:status': () => fail('vault down'), 'memory:pickVault': () => null }))
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    useAssistant.setState({ status: undefined })
    render(<SettingsView />)
    await act(settle)
    expect(screen.getByText('No API key yet')).toBeInTheDocument()
    expect(screen.getByText(/configured through its environment/)).toBeInTheDocument()
    expect(screen.getByText('vault down')).toBeInTheDocument()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Choose folder…')) // cancelled native picker
    await act(settle)
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    get.mockRestore()
    act(() => useSettings.setState({ server: server({ configurable: true }) }))
    expect(screen.getByLabelText('Port')).toBeInTheDocument()
  })

  it('desktop without editable config: read-only hint names the desktop app', async () => {
    installRemote(settingsCore({ 'server:status': () => server({ configurable: true }) }))
    render(<SettingsView />)
    await act(settle)
    expect(screen.getByText(/can only be changed in the desktop app/)).toBeInTheDocument()
    act(() => useSettings.setState({ error: 'settings broke' }))
    expect(screen.getByText('settings broke')).toBeInTheDocument()
  })
})

describe('SystemView', () => {
  const snap = (over: Partial<SystemSnapshot> = {}): SystemSnapshot => ({
    cpu: { total: 42, cores: [10, 90, 0, 150] },
    mem: { usedPct: 50, usedGb: 8, totalGb: 16 },
    disk: { usedPct: 70, mount: '/' },
    net: { rxMbps: 1.5, txMbps: 0.25 },
    battery: { pct: 80, charging: true, hasBattery: true },
    uptimeSec: 7200,
    processes: [
      { pid: 1, name: 'node', cpu: 60.4, mem: 120.2 },
      { pid: 2, name: 'idle', cpu: 0.1, mem: 1 }
    ],
    ts: 1,
    ...over
  })

  it('offline without a core; live numbers, cores, processes and battery states', async () => {
    const { unmount } = render(<SystemView />)
    expect(screen.getByText('OFFLINE')).toBeInTheDocument()
    expect(screen.getByText('No data yet')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    unmount()

    const bridge = installBridge({ 'system:snapshot': () => snap() })
    render(<SystemView />)
    await act(settle)
    expect(screen.getByText('LIVE')).toBeInTheDocument()
    expect(screen.getByText('4 cores')).toBeInTheDocument()
    expect(screen.getByText('8.0 / 16.0 GB')).toBeInTheDocument()
    expect(screen.getByText('↓ 1.50 · ↑ 0.25 MB/s')).toBeInTheDocument()
    expect(screen.getByText('charging')).toBeInTheDocument()
    expect(screen.getByText('60.4').className).toContain('text-amber')
    expect(screen.getByLabelText('Per-core load').children).toHaveLength(4)
    act(() => bridge.emit('system:tick', snap({ battery: { pct: 50, charging: false, hasBattery: true }, cpu: { total: 1, cores: [] } })))
    expect(screen.getByText('on battery')).toBeInTheDocument()
    expect(screen.queryByLabelText('Per-core load')).toBeNull()
    act(() => bridge.emit('system:tick', snap({ battery: { pct: 0, charging: false, hasBattery: false } })))
    expect(screen.getByText('no battery')).toBeInTheDocument()
    expect(screen.getByText('N/A')).toBeInTheDocument()
  })
})

describe('ContextSection', () => {
  const ctx = (over: Partial<ProjectContext> = {}): ProjectContext => ({
    projectId: 'p1',
    indexedAt: new Date().toISOString(),
    fileCount: 12,
    dirCount: 3,
    truncated: true,
    tree: [],
    languages: [],
    frameworks: [],
    dependencies: [
      { name: 'react', version: '18', dev: false },
      { name: 'vitest', version: '3', dev: true }
    ],
    configFiles: [{ name: 'tsconfig.json', kind: 'TypeScript' }],
    todos: Array.from({ length: 10 }, (_, i) => ({ file: `f${i}.ts`, line: i + 1, kind: i === 0 ? ('FIXME' as const) : ('TODO' as const), text: `item ${i}` })),
    readme: { title: 'Demo', sections: ['Intro', 'Usage'] },
    ...over
  })

  it('analyzes, shows structure, TODOs (open in editor on desktop), reindexes with progress', async () => {
    let resolveIndex!: (c: ProjectContext) => void
    const bridge = installBridge({
      'context:get': () => null,
      'context:reindex': () => new Promise((r) => (resolveIndex = r)),
      'projects:openFile': () => undefined
    })
    render(<ContextSection projectId="p1" />)
    await act(settle)
    expect(screen.getByText(/Not analyzed yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Analyze project'))
    expect(screen.getByText('Scanning…')).toBeInTheDocument()
    act(() => bridge.emit('context:progress', { projectId: 'p1', filesScanned: 40, done: false }))
    expect(screen.getByText('Scanning · 40 files')).toBeInTheDocument()
    await act(async () => resolveIndex(ctx()))
    expect(screen.getByText('12 files · 3 folders · scan truncated')).toBeInTheDocument()
    expect(screen.getByText('Demo')).toBeInTheDocument()
    expect(screen.getByText('tsconfig.json')).toBeInTheDocument()
    expect(screen.getByText(/1 runtime · 1 dev/)).toBeInTheDocument()
    expect(screen.getByText('FIXME')).toBeInTheDocument()
    expect(screen.queryByText('item 9')).toBeNull()
    fireEvent.click(screen.getByText('Show all 10'))
    expect(screen.getByText('item 9')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Show fewer'))
    fireEvent.click(screen.getByText('f0.ts:1'))
    expect(bridge.invoke).toHaveBeenCalledWith('projects:openFile', { id: 'p1', file: 'f0.ts', line: 1 })
    expect(screen.getByText('Reindex')).toBeInTheDocument()
  })

  it('in a browser TODOs are plain text; minimal contexts and errors with retry', async () => {
    installRemote({ 'context:get': () => ({ ...ctx(), readme: { sections: [] }, configFiles: [], dependencies: [], todos: [{ file: 'a.ts', line: 2, kind: 'HACK', text: 'x' }], truncated: false }) })
    render(<ContextSection projectId="p2" />)
    await act(settle)
    expect(screen.getByText('a.ts:2').tagName).toBe('SPAN')
    expect(screen.getByText('12 files · 3 folders')).toBeInTheDocument()
    expect(screen.queryByText(/Dependencies/)).toBeNull()

    const failing = installRemote({ 'context:get': () => fail('scan broke') })
    render(<ContextSection projectId="p3" />)
    await act(settle)
    expect(screen.getByText(/scan broke/)).toBeInTheDocument()
    failing.routes['context:get'] = (() => null) as never
    fireEvent.click(screen.getByText('retry'))
    await act(settle)
    expect(screen.getByText(/Not analyzed yet/)).toBeInTheDocument()
    act(() => useContextStore.setState({ byProject: { p3: { loading: true, indexing: false } } }))
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    act(() => useContextStore.setState({ byProject: { p3: { loading: false, indexing: false, context: ctx({ readme: { title: 'T', sections: [] }, dependencies: [{ name: 'd', version: '1', dev: true }] }) } } }))
    expect(screen.getByText('T')).toBeInTheDocument()
    expect(screen.getByText(/0 runtime · 1 dev/)).toBeInTheDocument()
  })
})

describe('pairing link from the QR code', () => {
  it('prefills the code from #pair= and removes it from the URL', () => {
    history.replaceState(null, '', '/#pair=abcd-efgh')
    expect(codeFromHash()).toBe('ABCD-EFGH')
    expect(location.hash).toBe('')
    expect(codeFromHash()).toBe('')
    history.replaceState(null, '', '/#pair=wxyz2345')
    render(<PairScreen />)
    expect(screen.getByLabelText('Pairing code')).toHaveValue('WXYZ-2345')
  })
})

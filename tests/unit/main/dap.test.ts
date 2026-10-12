import { EventEmitter } from 'node:events'
import { createServer, type Server } from 'node:net'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'
import { tempDir } from './helpers'
import { FrameReader, frame } from '../../../electron/main/services/lsp/LspClient'
import { DapClient, DapSession, type DapTransport } from '../../../electron/main/services/debug/Dap'
import { socketTransport, spawnInShell, startAdapter, stdioTransport, type Spawn } from '../../../electron/main/services/debug/adapters'
import { DebugService } from '../../../electron/main/services/debug/DebugService'
import type { DebugOutput, DebugSession } from '@shared/types/debug'

type Req = { seq: number; type: string; command: string; arguments?: Record<string, unknown> }
type Handler = (args: never, adapter: FakeAdapter) => unknown

/** A scripted debug adapter on an in-memory transport. */
class FakeAdapter {
  received: Req[] = []
  private readonly toClient = new PassThrough()
  private closeFns: (() => void)[] = []
  closed = false
  transport: DapTransport
  constructor(public handlers: Record<string, Handler> = {}) {
    const reader = new FrameReader((m) => void this.receive(m as Req))
    this.transport = {
      write: (data) => reader.push(data),
      onData: (fn) => void this.toClient.on('data', fn),
      onClose: (fn) => void this.closeFns.push(fn),
      close: () => {
        this.closed = true
        this.closeFns.forEach((f) => f())
      }
    }
  }
  private async receive(m: Req) {
    this.received.push(m)
    if (m.type !== 'request') return
    const handler = this.handlers[m.command] ?? (() => ({}))
    try {
      this.send({ seq: 0, type: 'response', request_seq: m.seq, command: m.command, success: true, body: await handler(m.arguments as never, this) })
    } catch (err) {
      this.send({ seq: 0, type: 'response', request_seq: m.seq, command: m.command, success: false, message: (err as Error).message || undefined })
    }
  }
  send(msg: unknown) {
    this.toClient.write(frame(msg))
  }
  event(event: string, body?: unknown) {
    this.send({ seq: 0, type: 'event', event, body })
  }
  commands() {
    return this.received.filter((m) => m.type === 'request').map((m) => m.command)
  }
}

const tick = (ms = 15) => new Promise((r) => setTimeout(r, ms))

describe('DapClient', () => {
  it('requests, failures, events, the adapter’s own requests, timeouts and closing', async () => {
    const adapter = new FakeAdapter({ ok: () => ({ fine: true }), bare: () => undefined, bad: () => Promise.reject(new Error('nope')), silent: () => Promise.reject(new Error('')), hang: () => new Promise(() => {}) })
    const client = new DapClient(adapter.transport, 30)
    expect(await client.request('ok', { a: 1 })).toEqual({ fine: true })
    expect(await client.request('bare')).toEqual({})
    await expect(client.request('bad')).rejects.toMatchObject({ code: 'debug', message: 'nope' })
    await expect(client.request('silent')).rejects.toMatchObject({ message: 'silent failed' })
    await expect(client.request('hang')).rejects.toMatchObject({ code: 'debug-timeout' })
    const events: unknown[] = []
    client.on('stopped', (b) => events.push(b))
    adapter.event('stopped', { reason: 'x' })
    adapter.event('stopped')
    adapter.event('other', {})
    adapter.send({ seq: 0, type: 'response', request_seq: 999, success: true })
    adapter.send({ seq: 7, type: 'request', command: 'runInTerminal', arguments: {} })
    await tick()
    expect(events).toEqual([{ reason: 'x' }, {}])
    expect(adapter.received.find((m) => m.type === 'response')).toMatchObject({ request_seq: 7, success: false, message: 'Not supported by W-ONE' })

    const pending = client.request('hang', undefined, 10_000)
    let closed = 0
    client.on('close', () => (closed += 1))
    client.close()
    await expect(pending).rejects.toMatchObject({ code: 'debug-closed' })
    await expect(client.request('ok')).rejects.toMatchObject({ code: 'debug-closed' })
    client.close()
    expect(closed).toBe(1)
    expect(adapter.closed).toBe(true)
  })
})

function session(handlers: Record<string, Handler> = {}) {
  const adapter = new FakeAdapter({
    initialize: () => ({ exceptionBreakpointFilters: [{ filter: 'uncaught', default: true }, { filter: 'raised' }] }),
    launch: (_a, ad) => {
      setTimeout(() => ad.event('initialized'), 5)
      return {}
    },
    threads: () => ({ threads: [{ id: 1 }] }),
    stackTrace: () => ({
      stackFrames: [
        { id: 10, name: 'add', line: 2, column: 5, source: { path: '/root/app.py' } },
        { id: 11, name: '<module>', line: 7, column: 1, source: { path: '/usr/lib/python/runpy.py' } },
        { id: 12, name: 'native', line: 0, column: 0 }
      ]
    }),
    scopes: (a: { frameId: number }) => ({ scopes: a.frameId === 10 ? [{ name: 'Locals', variablesReference: 4 }, { name: 'Empty', variablesReference: 0 }] : [] }),
    variables: () => ({ variables: [{ name: 'a', value: '2', type: 'int', variablesReference: 0 }, { name: 'user', value: "{'n': 1}", variablesReference: 9 }] }),
    evaluate: (a: { expression: string }) => (a.expression === 'bad' ? Promise.reject(new Error('NameError')) : { result: '20', type: 'int', variablesReference: 0 }),
    ...handlers
  })
  const sessions: DebugSession[] = []
  const output: DebugOutput[] = []
  let killed = 0
  const dap = new DapSession(new DapClient(adapter.transport), { adapterID: 'debugpy', arguments: { program: '/root/app.py' }, kill: () => (killed += 1) }, {
    projectId: 'p',
    program: 'app.py',
    root: '/root',
    publish: (c, p) => (c === 'debug:session' ? sessions.push(p as DebugSession) : output.push(p as DebugOutput))
  })
  return { adapter, dap, sessions, output, killed: () => killed, last: () => sessions[sessions.length - 1] }
}

describe('DapSession', () => {
  it('the handshake: launch, breakpoints, exception filters, configurationDone — then stops, frames, variables', async () => {
    const s = session()
    await s.dap.start([{ path: 'app.py', line: 2 }, { path: 'app.py', line: 5 }, { path: 'lib/x.py', line: 1 }], true)
    expect(s.adapter.commands()).toEqual(['initialize', 'launch', 'setBreakpoints', 'setBreakpoints', 'setExceptionBreakpoints', 'configurationDone'])
    const init = s.adapter.received.find((m) => m.command === 'initialize')!.arguments
    expect(init).toMatchObject({ adapterID: 'debugpy', linesStartAt1: true, columnsStartAt1: true })
    expect(s.adapter.received.find((m) => m.command === 'launch')!.arguments).toEqual({ program: '/root/app.py', stopOnEntry: true })
    const bps = s.adapter.received.filter((m) => m.command === 'setBreakpoints').map((m) => m.arguments)
    expect(bps).toEqual([
      { source: { path: '/root/app.py' }, breakpoints: [{ line: 2 }, { line: 5 }] },
      { source: { path: '/root/lib/x.py' }, breakpoints: [{ line: 1 }] }
    ])
    expect(s.adapter.received.find((m) => m.command === 'setExceptionBreakpoints')!.arguments).toEqual({ filters: ['uncaught'] })
    expect(s.last().status).toBe('running')

    s.adapter.event('output', { category: 'stdout', output: 'hi\n' })
    s.adapter.event('output', { category: 'stderr', output: 'warn\n' })
    s.adapter.event('output', { category: 'console', output: 'note\n' })
    s.adapter.event('output', { category: 'telemetry', output: '{}' })
    s.adapter.event('stopped', { reason: 'breakpoint', threadId: 1 })
    await tick(40)
    expect(s.output.map((o) => `${o.stream}:${o.text}`)).toEqual(['stdout:hi\n', 'stderr:warn\n', 'info:note\n'])
    expect(s.last()).toMatchObject({ status: 'paused', reason: 'breakpoint', exception: undefined })
    expect(s.last().frames.map((f) => [f.id, f.name, f.path, f.url, f.line])).toEqual([
      ['10', 'add', 'app.py', '/root/app.py', 2],
      ['11', '<module>', undefined, '/usr/lib/python/runpy.py', 7],
      ['12', 'native', undefined, '', 0]
    ])
    expect(s.last().frames[0].scopes).toEqual([{ type: 'Locals', objectId: '4' }, { type: 'Empty', objectId: undefined }])
    expect(await s.dap.variables('4')).toEqual([
      { name: 'a', value: '2', type: 'int', objectId: undefined },
      { name: 'user', value: "{'n': 1}", type: 'value', objectId: '9' }
    ])
    expect(await s.dap.evaluate('a * 10', '10')).toEqual({ name: 'a * 10', value: '20', type: 'int', objectId: undefined })
    expect(await s.dap.evaluate('bad')).toEqual({ name: 'bad', value: 'NameError', type: 'error' })
    expect(s.adapter.received.filter((m) => m.command === 'evaluate').map((m) => m.arguments!.frameId)).toEqual([10, undefined])

    for (const action of ['continue', 'pause', 'stepOver', 'stepInto', 'stepOut'] as const) await s.dap.control(action)
    expect(s.adapter.commands().slice(-5)).toEqual(['continue', 'pause', 'next', 'stepIn', 'stepOut'])
    expect(s.adapter.received.at(-1)!.arguments).toEqual({ threadId: 1 })

    // Breakpoints change: the file that has none now is cleared.
    await s.dap.setBreakpoints([{ path: 'app.py', line: 9 }])
    expect(s.adapter.received.filter((m) => m.command === 'setBreakpoints').slice(-2).map((m) => m.arguments)).toEqual([
      { source: { path: '/root/app.py' }, breakpoints: [{ line: 9 }] },
      { source: { path: '/root/lib/x.py' }, breakpoints: [] }
    ])

    s.adapter.event('continued', {})
    await tick()
    expect(s.last().status).toBe('running')
    s.adapter.event('stopped', { reason: 'exception', description: 'ZeroDivisionError', threadId: 1 })
    await tick(40)
    expect(s.last()).toMatchObject({ reason: 'exception', exception: 'ZeroDivisionError' })
    s.adapter.event('exited', { exitCode: 3 })
    s.adapter.event('terminated', {})
    await tick()
    expect(s.last()).toMatchObject({ status: 'exited', exitCode: 3, frames: [] })
    expect(s.output.at(-1)).toMatchObject({ stream: 'info', text: 'exit 3\n' })
    expect(s.killed()).toBe(1)
    await s.dap.stop() // already over
    expect(s.adapter.commands()).not.toContain('disconnect')
  })

  it('stops without a thread from the event, frames that can’t be listed, a failing breakpoint', async () => {
    const s = session({
      launch: (_a, ad) => (setTimeout(() => ad.event('initialized'), 5), {}),
      threads: () => Promise.reject(new Error('no threads')),
      stackTrace: () => Promise.reject(new Error('gone')),
      setBreakpoints: () => Promise.reject(new Error('bad file')),
      initialize: () => ({})
    })
    await s.dap.start([{ path: 'a.py', line: 1 }], false)
    expect(s.adapter.received.find((m) => m.command === 'setExceptionBreakpoints')!.arguments).toEqual({ filters: [] })
    s.adapter.event('stopped', { reason: 'pause', text: 'Paused' })
    await tick(40)
    expect(s.last()).toMatchObject({ status: 'paused', frames: [] })
    await expect(s.dap.control('pause')).rejects.toMatchObject({ code: 'debug' })
  })

  it('pause before any stop asks for the threads; many frames load scopes only at the top', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i, name: `f${i}`, line: 1, column: 1, source: i === 1 ? { name: '<string>' } : { path: `/root/f${i}.py` } }))
    const s = session({ stackTrace: () => ({ stackFrames: many }), scopes: (a: { frameId: number }) => (a.frameId === 2 ? {} : { scopes: [{ name: 'Locals', variablesReference: 1 }] }) })
    await s.dap.start([], false)
    await s.dap.control('pause')
    expect(s.adapter.received.at(-1)).toMatchObject({ command: 'pause', arguments: { threadId: 1 } })
    s.adapter.event('stopped', { reason: 'pause' })
    await tick(60)
    expect(s.last().frames.filter((f) => f.scopes.length)).toHaveLength(19)
    expect(s.last().frames[1]).toMatchObject({ url: '<string>', path: undefined })
    await s.dap.stop()
    expect(s.adapter.commands()).toContain('disconnect')
    expect(s.last().status).toBe('exited')
    expect(s.output.at(-1)!.text).toBe('exit -\n')
  })

  it('a launch the adapter refuses ends the session with the reason; the adapter going away ends it too', async () => {
    const refused = session({ launch: () => Promise.reject(new Error('No module named debugpy')) })
    await expect(refused.dap.start([], false)).rejects.toMatchObject({ message: 'No module named debugpy' })
    expect(refused.last()).toMatchObject({ status: 'exited', error: 'No module named debugpy' })

    const gone = session()
    await gone.dap.start([], false)
    gone.adapter.transport.close()
    expect(gone.last().status).toBe('exited')
    gone.dap.dispose()

    const failed = session()
    failed.dap.fail('spawn python3 ENOENT')
    expect(failed.last()).toMatchObject({ status: 'exited', error: 'spawn python3 ENOENT' })
  })
})

/** A stand-in child process for adapter starts. */
class FakeProc extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  killed = 0
  kill() {
    this.killed += 1
    return true
  }
}

describe('starting debug adapters', () => {
  const servers: Server[] = []
  afterEach(() => servers.splice(0).forEach((s) => s.close()))

  it('Python: debugpy through the project’s interpreter, over stdio', async () => {
    const root = await tempDir()
    const proc = new FakeProc()
    const calls: Parameters<Spawn>[] = []
    const run: Spawn = (...args) => (calls.push(args), proc as never)
    const { transport, launch } = await startAdapter('python', { root, program: join(root, 'app.py'), args: ['-v'], debugger: '/tools/debugpy', output: () => {} }, run)
    expect(calls[0]).toEqual(['python3', ['-m', 'debugpy.adapter'], root, { PYTHONPATH: '/tools/debugpy' }])
    expect(launch).toMatchObject({ adapterID: 'debugpy', arguments: { type: 'python', program: join(root, 'app.py'), args: ['-v'], python: ['python3'], console: 'internalConsole' } })
    const got: string[] = []
    transport.onData((d) => got.push(d.toString()))
    let closed = false
    transport.onClose(() => (closed = true))
    proc.stdout.write('x')
    let written = ''
    proc.stdin.on('data', (d: Buffer) => (written += d.toString()))
    transport.write(Buffer.from('y'))
    await tick()
    expect([got.join(''), written]).toEqual(['x', 'y'])
    proc.emit('exit')
    expect(closed).toBe(true)
    transport.close()
    launch.kill()
    expect(proc.killed).toBe(2)
  })

  it('Go: Delve’s DAP server on a local port; its later output is the program’s', async () => {
    const server = createServer((socket) => socket.on('data', (d) => socket.write(d)))
    servers.push(server)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const proc = new FakeProc()
    const out: string[] = []
    const started = startAdapter('go', { root: '/r', program: '/r/cmd/main.go', args: [], debugger: '/go/bin/dlv', output: (s, t) => out.push(`${s}:${t}`) }, (cmd, args) => {
      expect([cmd, args]).toEqual(['/go/bin/dlv', ['dap', '--listen=127.0.0.1:0']])
      return proc as never
    })
    proc.stderr.write('warming up\n')
    proc.stdout.write(`DAP server listening at: 127.0.0.1:${port}\n`)
    const { transport, launch } = await started
    expect(launch).toMatchObject({ adapterID: 'go', arguments: { mode: 'debug', program: '/r/cmd' } })
    proc.stdout.write('program says hi\n')
    const echoed = new Promise<string>((r) => transport.onData((d) => r(d.toString())))
    transport.write(Buffer.from('ping'))
    expect(await echoed).toBe('ping')
    let closed = false
    transport.onClose(() => (closed = true))
    transport.close()
    await tick()
    expect(closed).toBe(true)
    expect(out).toEqual(['stderr:warming up\n', 'stdout:program says hi\n'])
    launch.kill()
    expect(proc.killed).toBe(1)
  })

  it('Go: Delve that never listens, or can’t start, or a port nobody answers', async () => {
    const quits = new FakeProc()
    const a = startAdapter('go', { root: '/r', program: '/r/m.go', args: [], debugger: 'dlv', output: () => {} }, () => quits as never)
    quits.stdout.write('some text\n')
    quits.emit('exit')
    await expect(a).rejects.toMatchObject({ message: 'Delve did not start' })

    const broken = new FakeProc()
    const b = startAdapter('go', { root: '/r', program: '/r/m.go', args: [], debugger: 'dlv', output: () => {} }, () => broken as never)
    broken.emit('error', new Error('spawn dlv ENOENT'))
    await expect(b).rejects.toMatchObject({ message: 'spawn dlv ENOENT' })

    const closedPort = new FakeProc()
    const c = startAdapter('go', { root: '/r', program: '/r/m.go', args: [], debugger: 'dlv', output: () => {} }, () => closedPort as never)
    closedPort.stdout.write('DAP server listening at: 127.0.0.1:1\n')
    await expect(c).rejects.toMatchObject({ code: 'ECONNREFUSED' })
    closedPort.emit('exit') // after it listened: nothing more to reject
  })

  it('spawnInShell runs through the user’s shell with extra environment; socket transports', async () => {
    const proc = spawnInShell('node', ['-e', 'process.stdout.write(process.env.WONE_X)'], await tempDir(), { WONE_X: 'yes' })
    let out = ''
    proc.stdout!.on('data', (d: Buffer) => (out += d.toString()))
    await new Promise((r) => proc.on('exit', r))
    expect(out).toBe('yes')
    const plain = spawnInShell('true', [], await tempDir())
    await new Promise((r) => plain.on('exit', r))
    expect(typeof socketTransport).toBe('function')
    expect(typeof stdioTransport).toBe('function')
  }, 20_000)
})

describe('DebugService: Python and Go through their debuggers', () => {
  async function service(debuggerPath: string | undefined, adapter = new FakeAdapter({ launch: (_a, ad) => (setTimeout(() => ad.event('initialized'), 5), {}) })) {
    const root = await tempDir()
    await writeFile(join(root, 'app.py'), '')
    await writeFile(join(root, 'a.js'), '')
    const sessions: DebugSession[] = []
    const output: DebugOutput[] = []
    let ctxOutput!: (s: 'stdout' | 'stderr', t: string) => void
    const svc = new DebugService({
      resolveRoot: () => root,
      publish: (c, p) => (c === 'debug:session' ? sessions.push(p as DebugSession) : output.push(p as DebugOutput)),
      tools: { locate: async () => debuggerPath },
      adapter: async (language, ctx) => {
        expect(language).toBe('python')
        ctxOutput = ctx.output
        ctx.output('stdout', 'before the session') // dropped: no session yet
        return { transport: adapter.transport, launch: { adapterID: 'debugpy', arguments: {}, kill: () => {} } }
      },
      launch: () => new FakeProc() as never
    })
    return { svc, adapter, sessions, output, emit: (s: 'stdout' | 'stderr', t: string) => ctxOutput(s, t), last: () => sessions[sessions.length - 1] }
  }

  it('a missing debugger says where to get one', async () => {
    const { svc } = await service(undefined)
    await expect(svc.start({ projectId: 'p', program: 'app.py', breakpoints: [] })).rejects.toMatchObject({ code: 'debugger-missing', message: expect.stringContaining('Python') })
    const none = new DebugService({ resolveRoot: () => '/', publish: () => {} })
    await expect(none.start({ projectId: 'p', program: 'x.py', breakpoints: [] })).rejects.toBeTruthy()
  })

  it('runs, controls and stops a Python program; a Node program afterwards takes over', async () => {
    const t = await service('/tools/debugpy')
    const started = await t.svc.start({ projectId: 'p', program: 'app.py', breakpoints: [{ path: 'app.py', line: 1 }], stopOnEntry: true })
    expect(started.status).toBe('starting')
    await tick(40)
    expect(t.svc.session()?.status).toBe('running')
    t.emit('stdout', 'program output')
    expect(t.output).toEqual([{ sessionId: started.id, stream: 'stdout', text: 'program output' }])
    await t.svc.control('stepOver')
    expect(await t.svc.variables('3')).toEqual([])
    expect(await t.svc.evaluate('x')).toMatchObject({ name: 'x' })
    await t.svc.setBreakpoints('p', [{ path: 'app.py', line: 2 }])
    await t.svc.setBreakpoints('other', [])
    expect(t.adapter.received.filter((m) => m.command === 'setBreakpoints')).toHaveLength(2)
    await t.svc.stop()
    expect(t.svc.session()?.status).toBe('exited')
    await t.svc.setBreakpoints('p', [])
    await expect(t.svc.control('continue')).rejects.toMatchObject({ code: 'debug-not-running' })
    await expect(t.svc.variables('1')).rejects.toMatchObject({ code: 'debug-not-running' })
    await expect(t.svc.evaluate('1')).rejects.toMatchObject({ code: 'debug-not-running' })
    t.svc.dispose()

    // Node runs on its own inspector again.
    await t.svc.start({ projectId: 'p', program: 'a.js', breakpoints: [] })
    expect(t.svc.session()?.program).toBe('a.js')
    t.svc.dispose()
  })

  it('Go through Delve (a stand-in here), started the way the app does it', async () => {
    const root = await tempDir()
    await writeFile(join(root, 'main.go'), 'package main\n')
    const sessions: DebugSession[] = []
    const output: DebugOutput[] = []
    const svc = new DebugService({
      resolveRoot: () => root,
      publish: (c, p) => (c === 'debug:session' ? sessions.push(p as DebugSession) : output.push(p as DebugOutput)),
      tools: { locate: async () => join(__dirname, 'fixtures', 'fake-dlv.mjs') }
    })
    await svc.start({ projectId: 'p', program: 'main.go', breakpoints: [] })
    for (let i = 0; i < 200 && sessions.at(-1)?.status !== 'exited'; i += 1) await tick(20)
    expect(sessions.at(-1)).toMatchObject({ status: 'exited', exitCode: 0 })
    expect(output.map((o) => o.text).join('')).toContain('hello from go')
    svc.dispose()
  }, 20_000)

  it('a launch that fails ends the session with the reason', async () => {
    const t = await service('/tools/debugpy', new FakeAdapter({ launch: () => Promise.reject(new Error('cannot run')) }))
    await t.svc.start({ projectId: 'p', program: 'app.py', breakpoints: [] })
    await tick(40)
    expect(t.last()).toMatchObject({ status: 'exited', error: 'cannot run' })
  })
})

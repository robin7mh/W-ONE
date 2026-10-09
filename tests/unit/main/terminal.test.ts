import { mkdtemp, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tempDir, tick } from './helpers'

type FakePty = {
  pid: number
  file: string
  args: string[]
  opts: { cwd: string; cols: number; rows: number; env: Record<string, string> }
  write: ReturnType<typeof vi.fn>
  resize: ReturnType<typeof vi.fn>
  kill: ReturnType<typeof vi.fn>
  data: (d: string) => void
  exit: (code: number) => void
}
const h = vi.hoisted(() => ({
  ptys: [] as FakePty[],
  /** What node-pty reports as the foreground process ('' = the shell itself). */
  foreground: '' as string | Error,
  userShell: '/bin/zsh' as string | undefined | Error,
  missing: new Set<string>()
}))
vi.mock('node-pty', () => ({
  spawn: (file: string, args: string[], opts: FakePty['opts']) => {
    let onData: (d: string) => void = () => {}
    let onExit: (e: { exitCode: number }) => void = () => {}
    const pty: FakePty = {
      pid: h.ptys.length + 100,
      file,
      args,
      opts,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(() => onExit({ exitCode: 0 })),
      data: (d) => onData(d),
      exit: (code) => onExit({ exitCode: code })
    }
    h.ptys.push(pty)
    return {
      ...pty,
      get process() {
        if (h.foreground instanceof Error) throw h.foreground
        return h.foreground || file.split('/').pop()
      },
      onData: (cb: typeof onData) => (onData = cb),
      onExit: (cb: typeof onExit) => (onExit = cb)
    }
  }
}))
vi.mock('node:os', async (orig) => {
  const actual = await orig<typeof import('node:os')>()
  return {
    ...actual,
    userInfo: () => {
      if (h.userShell instanceof Error) throw h.userShell
      return { ...actual.userInfo(), shell: h.userShell }
    }
  }
})
vi.mock('node:fs', async (orig) => {
  const actual = await orig<typeof import('node:fs')>()
  // The default shells "exist" on every runner (CI images ship without zsh).
  const shells = new Set(['/bin/zsh', '/bin/bash'])
  return { ...actual, existsSync: (p: string) => !h.missing.has(p) && (shells.has(p) || actual.existsSync(p)) }
})

import { TerminalService } from '../../../electron/main/services/terminal/TerminalService'

const realPlatform = process.platform
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p })

let emit: ReturnType<typeof vi.fn>
let svc: TerminalService
let projectDir: string

beforeEach(async () => {
  h.ptys.length = 0
  h.foreground = ''
  h.userShell = '/bin/zsh'
  h.missing.clear()
  emit = vi.fn()
  projectDir = await tempDir()
  svc = new TerminalService({
    emit,
    resolveProject: (id) => (id === 'p1' ? { name: 'demo', path: projectDir } : undefined)
  })
})
afterEach(() => {
  setPlatform(realPlatform)
  svc.killAll()
})
const pty = () => h.ptys[h.ptys.length - 1]

describe('TerminalService.create', () => {
  it('starts the login shell in Home with a cleaned environment', async () => {
    process.env.ELECTRON_RUN_AS_NODE = '1'
    process.env.npm_config_x = 'y'
    process.env.VITE_X = 'z'
    process.env.INIT_CWD = '/x'
    // markers of a Claude Code session W-ONE was started from (CLAUDE_CODE_*, CLAUDECODE, …)
    const claude = ['CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT']
    for (const k of claude) process.env[k] = '1'
    process.env.CLAUDE_CONFIG_DIR = '/kept'
    const info = await svc.create({ cols: 100, rows: 30 })
    delete process.env.ELECTRON_RUN_AS_NODE
    delete process.env.npm_config_x
    delete process.env.VITE_X
    delete process.env.INIT_CWD
    for (const k of [...claude, 'CLAUDE_CONFIG_DIR']) delete process.env[k]
    expect(info).toMatchObject({ title: '~', cwd: homedir(), cwdLabel: '~', shell: 'zsh', projectId: undefined })
    expect(pty().args).toEqual(['-l'])
    expect(pty().opts).toMatchObject({ cwd: homedir(), cols: 100, rows: 30 })
    const env = pty().opts.env
    expect(env).toMatchObject({ TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'W-ONE' })
    for (const k of ['ELECTRON_RUN_AS_NODE', 'npm_config_x', 'VITE_X', 'INIT_CWD', 'NODE_ENV', ...claude]) expect(env).not.toHaveProperty(k)
    expect(env.CLAUDE_CONFIG_DIR).toBe('/kept') // the user's own Claude settings stay
    expect(env.LANG).toBeTruthy()
  })

  it('opens in a project with a ~-shortened label, clamping odd sizes', async () => {
    const info = await svc.create({ projectId: 'p1', cols: 99999, rows: Number.NaN })
    expect(info).toMatchObject({ title: 'demo', cwd: projectDir, projectId: 'p1' })
    expect(pty().opts).toMatchObject({ cols: 1000, rows: 24 })
    expect(info.cwdLabel).toBe(projectDir.startsWith(homedir()) ? `~${projectDir.slice(homedir().length)}` : projectDir)
  })

  it('labels folders under Home with ~', async () => {
    const svc2 = new TerminalService({ emit, resolveProject: () => ({ name: 'h', path: join(homedir()) }) })
    expect((await svc2.create({ projectId: 'any' })).cwdLabel).toBe('~')
    const under = await mkdtemp(join(homedir(), '.wone-test-'))
    const inHome = new TerminalService({ emit, resolveProject: () => ({ name: 'u', path: under }) })
    expect((await inHome.create({ projectId: 'any' })).cwdLabel).toBe(`~${under.slice(homedir().length)}`)
    inHome.killAll()
    await rm(under, { recursive: true, force: true })
    const sub = new TerminalService({ emit, resolveProject: () => ({ name: 's', path: join(homedir(), '..') }) })
    expect((await sub.create({ projectId: 'any' })).cwdLabel).toBe(join(homedir(), '..'))
    svc2.killAll()
    sub.killAll()
  })

  it('rejects unknown projects, missing folders and too many sessions', async () => {
    await expect(svc.create({ projectId: 'nope' })).rejects.toMatchObject({ code: 'not-found' })
    const gone = new TerminalService({ emit, resolveProject: () => ({ name: 'x', path: join(projectDir, 'missing') }) })
    await expect(gone.create({ projectId: 'x' })).rejects.toMatchObject({ code: 'not-found' })
    for (let i = 0; i < 12; i += 1) await svc.create(undefined as never)
    await expect(svc.create({})).rejects.toMatchObject({ code: 'limit' })
  })

  it('picks the shell per platform and falls back when it is missing', async () => {
    setPlatform('win32')
    await svc.create({})
    expect(pty()).toMatchObject({ file: 'powershell.exe', args: ['-NoLogo'] })
    expect(svc.list().at(-1)!.shell).toBe('powershell')

    setPlatform('darwin')
    h.userShell = undefined
    const savedShell = process.env.SHELL
    delete process.env.SHELL
    await svc.create({})
    expect(pty().file).toBe('/bin/zsh')

    setPlatform('linux')
    h.userShell = new Error('no passwd')
    await svc.create({})
    expect(pty().file).toBe('/bin/bash')

    process.env.SHELL = '/usr/local/bin/fish'
    h.missing.add('/usr/local/bin/fish')
    await svc.create({})
    expect(pty().file).toBe('/bin/sh')
    if (savedShell === undefined) delete process.env.SHELL
    else process.env.SHELL = savedShell
  })
})

describe('TerminalService sessions', () => {
  it('batches output per frame, keeps bounded scrollback and supports attach', async () => {
    const { id } = await svc.create({})
    pty().data('hel')
    pty().data('lo')
    expect(emit).not.toHaveBeenCalled()
    await tick(20)
    expect(emit).toHaveBeenCalledWith('terminal:data', { id, data: 'hello', end: 5 })

    pty().data('!')
    expect(svc.attach(id)).toEqual({ info: expect.objectContaining({ id }), buffer: 'hello!', end: 6 }) // attach flushes
    expect(svc.attach(id).end).toBe(6) // nothing pending
    pty().data('x'.repeat(300 * 1024))
    expect(svc.attach(id).buffer).toHaveLength(256 * 1024)
  })

  it('writes and resizes (with clamping), rejecting bad input', async () => {
    const { id } = await svc.create({})
    svc.write(id, 'ls\r')
    expect(pty().write).toHaveBeenCalledWith('ls\r')
    expect(() => svc.write(id, 5 as never)).toThrow('Invalid terminal input')
    expect(() => svc.write(id, 'x'.repeat(1024 * 1024 + 1))).toThrow('Invalid terminal input')
    svc.resize(id, 1, 0)
    expect(pty().resize).toHaveBeenCalledWith(2, 1)
    pty().resize.mockImplementationOnce(() => {
      throw new Error('exited')
    })
    expect(() => svc.resize(id, 80, 24)).not.toThrow()
    expect(() => svc.write('nope', 'x')).toThrow('Terminal session has ended')
  })

  it('reports exits (flushing pending output) and forgets the session', async () => {
    const { id } = await svc.create({})
    pty().data('bye')
    pty().exit(3)
    expect(emit.mock.calls).toEqual([
      ['terminal:data', { id, data: 'bye', end: 3 }],
      ['terminal:exit', { id, exitCode: 3 }]
    ])
    expect(svc.list()).toEqual([])
    svc.kill(id) // unknown → no-op
  })

  it('lists what runs in each shell: nothing at the prompt, else the program', async () => {
    const { id } = await svc.create({})
    expect(svc.list()[0]).not.toHaveProperty('running') // zsh waits at its prompt
    h.foreground = 'node'
    expect(svc.list()[0]).toMatchObject({ id, running: 'node' })
    h.foreground = '-zsh' // a login shell's process name
    expect(svc.list()[0].running).toBeUndefined()
    h.foreground = new Error('closed')
    expect(svc.list()[0].running).toBeUndefined()
  })

  it('kill and killAll end sessions, clearing pending timers', async () => {
    const a = await svc.create({})
    await svc.create({})
    svc.kill(a.id)
    expect(svc.list()).toHaveLength(1)
    pty().data('pending')
    svc.killAll()
    expect(svc.list()).toEqual([])
    svc.killAll() // idempotent
  })
})

describe('TerminalService.spawnProgram (agents)', () => {
  it('runs a program through the login shell with extra env; hidden from the terminal tabs', async () => {
    const onExit = vi.fn()
    const info = await svc.spawnProgram({
      title: 'Claude Code',
      cwd: projectDir,
      command: { file: 'claude', args: ['--session-id', 'abc', '--settings', '{"a":"it\'s"}'] },
      env: { WONE_HOOK_TOKEN: 't' },
      projectId: 'p1',
      onExit
    })
    expect(info).toMatchObject({ kind: 'agent', title: 'Claude Code', projectId: 'p1', shell: 'zsh' })
    expect(pty().file).toBe('/bin/zsh')
    expect(pty().args).toEqual(['-lc', `exec claude --session-id abc --settings '{"a":"it'\\''s"}'`])
    expect(pty().opts.env).toMatchObject({ WONE_HOOK_TOKEN: 't', TERM_PROGRAM: 'W-ONE' })
    expect(svc.list()).toEqual([]) // the Terminal module only lists shells
    expect(svc.attach(info.id).info.id).toBe(info.id) // but views can attach to it
    await svc.create({})
    expect(svc.list()).toHaveLength(1)

    pty().exit(0) // the shell tab — no agent callback
    h.ptys[0].exit(2)
    expect(onExit).toHaveBeenCalledOnce()
    expect(onExit).toHaveBeenCalledWith(2)
  })

  it('on Windows starts the program directly', async () => {
    setPlatform('win32')
    await svc.spawnProgram({ title: 'x', cwd: projectDir, command: { file: 'claude.exe', args: ['--a b'] } })
    expect(pty().file).toBe('claude.exe')
    expect(pty().args).toEqual(['--a b'])
  })

  it('refuses a missing folder', async () => {
    await expect(svc.spawnProgram({ title: 'x', cwd: join(projectDir, 'nope'), command: { file: 'claude', args: [] } })).rejects.toMatchObject({
      code: 'not-found'
    })
  })
})

describe('shellQuote', () => {
  it('leaves plain words, quotes everything else', async () => {
    const { shellQuote } = await import('../../../electron/main/services/terminal/TerminalService')
    expect(shellQuote('--session-id')).toBe('--session-id')
    expect(shellQuote('/a/b.c:1,2=3@x%y+z')).toBe('/a/b.c:1,2=3@x%y+z')
    expect(shellQuote('')).toBe("''")
    expect(shellQuote('a b')).toBe("'a b'")
    expect(shellQuote("it's $HOME")).toBe(`'it'\\''s $HOME'`)
  })
})

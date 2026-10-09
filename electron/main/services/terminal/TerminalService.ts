import { spawn, type IPty } from 'node-pty'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { basename, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { TerminalAttach, TerminalData, TerminalExit, TerminalInfo } from '@shared/types/terminal'

const MAX_SESSIONS = 12
const BUFFER_LIMIT = 256 * 1024 // chars of scrollback kept for re-attaching views
const FLUSH_MS = 8 // batch PTY output into ~frame-sized IPC messages
const MAX_WRITE = 1024 * 1024

interface Session {
  info: TerminalInfo
  pty: IPty
  pending: string
  timer?: NodeJS.Timeout
  buffer: string
  end: number
}

type Emit = {
  (channel: 'terminal:data', payload: TerminalData): void
  (channel: 'terminal:exit', payload: TerminalExit): void
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const clamp = (n: unknown, min: number, max: number, fallback: number) =>
  typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback

/** The user's login shell — what Terminal.app would start. */
export function shellCommand(): { file: string; args: string[] } {
  if (process.platform === 'win32') return { file: 'powershell.exe', args: ['-NoLogo'] }
  let file = ''
  try {
    file = userInfo().shell ?? ''
  } catch {
    /* no passwd entry */
  }
  file ||= process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  if (!existsSync(file)) file = '/bin/sh'
  // Login shell: apps launched from the Dock get a minimal PATH; -l restores
  // the user's real environment (Homebrew, nvm, …) from their profile.
  return { file, args: ['-l'] }
}

/** POSIX single-quoting: the word reaches the program exactly as given. */
export function shellQuote(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}

/** A program started like from the user's terminal (login shell → real PATH). */
function viaLoginShell(command: { file: string; args: string[] }): { file: string; args: string[] } {
  if (process.platform === 'win32') return command
  const shell = shellCommand().file
  return { file: shell, args: ['-lc', `exec ${[command.file, ...command.args].map(shellQuote).join(' ')}`] }
}

/**
 * The user's own environment, minus what W-ONE's dev tooling injected:
 * ELECTRON_RUN_AS_NODE alone would break any Electron app started from here,
 * and the markers of a Claude Code session W-ONE may have been launched from
 * would make a `claude` started here think it is that session's child.
 */
export function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  // process.env values are always strings at runtime (assigning undefined stores 'undefined').
  for (const [key, value] of Object.entries(process.env) as [string, string][]) {
    if (/^(ELECTRON_|VITE_|npm_)/i.test(key) || key === 'INIT_CWD' || key === 'NODE_ENV') continue
    if (/^(CLAUDE_CODE_|CLAUDE_AGENT_SDK)/.test(key) || key === 'CLAUDECODE' || key === 'CLAUDE_PID' || key === 'CLAUDE_EFFORT') continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'W-ONE'
  env.LANG ||= 'en_US.UTF-8'
  return env
}

/**
 * Interactive shells for the user (phase PT). Distinct from agent command
 * execution (§8.1): the renderer can only send keystrokes and sizes — which
 * binary runs, and where, is decided here. Output is batched per frame and a
 * bounded scrollback is kept so a view can re-attach after a reload.
 */
export class TerminalService {
  private readonly sessions = new Map<string, Session>()

  constructor(
    private readonly opts: {
      emit: Emit
      /** Project id → name/path (ProjectService); undefined if unknown. */
      resolveProject: (id: string) => { name: string; path: string } | undefined
    }
  ) {}

  async create(req: { projectId?: string; cols?: number; rows?: number }): Promise<TerminalInfo> {
    const project = req?.projectId ? this.opts.resolveProject(req.projectId) : undefined
    if (req?.projectId && !project) throw coded('not-found', 'Project not found')
    return this.start({
      title: project?.name ?? '~',
      cwd: project?.path ?? homedir(),
      command: shellCommand(),
      projectId: project ? req.projectId : undefined,
      cols: req?.cols,
      rows: req?.rows
    })
  }

  /**
   * Core-internal (never an IPC channel): run a program — a coding agent — in
   * a PTY, started through the user's login shell so it finds what their own
   * terminal would. The renderer can watch and type into it like any session.
   */
  async spawnProgram(req: {
    title: string
    cwd: string
    command: { file: string; args: string[] }
    env?: Record<string, string>
    projectId?: string
    cols?: number
    rows?: number
    onExit?: (exitCode: number) => void
  }): Promise<TerminalInfo> {
    return this.start({ ...req, command: viaLoginShell(req.command), kind: 'agent' })
  }

  private async start(req: {
    title: string
    cwd: string
    command: { file: string; args: string[] }
    env?: Record<string, string>
    projectId?: string
    cols?: number
    rows?: number
    kind?: 'agent'
    onExit?: (exitCode: number) => void
  }): Promise<TerminalInfo> {
    if (this.sessions.size >= MAX_SESSIONS) throw coded('limit', `At most ${MAX_SESSIONS} terminals`)
    const { cwd, command } = req
    if (!(await stat(cwd).then((s) => s.isDirectory(), () => false))) {
      throw coded('not-found', `Folder not found: ${cwd}`)
    }

    const pty = spawn(command.file, command.args, {
      name: 'xterm-256color',
      cols: clamp(req.cols, 2, 1000, 80),
      rows: clamp(req.rows, 1, 500, 24),
      cwd,
      env: { ...shellEnv(), ...req.env }
    })

    const home = homedir()
    const info: TerminalInfo = {
      id: randomUUID(),
      title: req.title,
      cwd,
      cwdLabel: cwd === home ? '~' : cwd.startsWith(home + sep) ? `~${cwd.slice(home.length)}` : cwd,
      shell: basename(command.file).replace(/\.exe$/i, ''),
      projectId: req.projectId,
      createdAt: new Date().toISOString(),
      ...(req.kind ? { kind: req.kind } : {})
    }
    const session: Session = { info, pty, pending: '', buffer: '', end: 0 }
    pty.onData((data) => this.push(session, data))
    pty.onExit(({ exitCode }) => {
      this.flush(session)
      this.sessions.delete(info.id)
      this.opts.emit('terminal:exit', { id: info.id, exitCode })
      req.onExit?.(exitCode)
    })
    this.sessions.set(info.id, session)
    return info
  }

  /** The Terminal module's tabs — agent PTYs live in the Agents module. */
  list(): TerminalInfo[] {
    return [...this.sessions.values()].map((s) => s.info).filter((i) => i.kind !== 'agent')
  }

  attach(id: string): TerminalAttach {
    const s = this.require(id)
    this.flush(s)
    return { info: s.info, buffer: s.buffer, end: s.end }
  }

  write(id: string, data: string): void {
    if (typeof data !== 'string' || data.length > MAX_WRITE) throw coded('bad-input', 'Invalid terminal input')
    this.require(id).pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.require(id)
    try {
      s.pty.resize(clamp(cols, 2, 1000, 80), clamp(rows, 1, 500, 24))
    } catch {
      /* the process may have exited between the check and the resize */
    }
  }

  kill(id: string): void {
    this.sessions.get(id)?.pty.kill()
  }

  /** Window closed or app quitting: no shell outlives its window. */
  killAll(): void {
    for (const s of this.sessions.values()) {
      if (s.timer) clearTimeout(s.timer)
      s.pty.kill()
    }
    this.sessions.clear()
  }

  private require(id: string): Session {
    const s = this.sessions.get(id)
    if (!s) throw coded('not-found', 'Terminal session has ended')
    return s
  }

  private push(s: Session, data: string): void {
    s.pending += data
    s.timer ??= setTimeout(() => this.flush(s), FLUSH_MS)
  }

  private flush(s: Session): void {
    if (s.timer) clearTimeout(s.timer)
    s.timer = undefined
    if (!s.pending) return
    const data = s.pending
    s.pending = ''
    s.end += data.length
    s.buffer = (s.buffer + data).slice(-BUFFER_LIMIT)
    this.opts.emit('terminal:data', { id: s.info.id, data, end: s.end })
  }
}

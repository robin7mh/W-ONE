import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { LANGUAGES, type LanguageStatus, type ToolProgress, type ToolState } from '@shared/types/languages'
import { loginShellProbe, type Probe } from '../agents/detect'
import { shellCommand, shellEnv } from '../terminal/TerminalService'
import { shellArgs } from '../../lib/shellArgs'
import { CATALOG, type ToolSpec } from './catalog'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

export type Part = 'server' | 'debugger'

/** Run a command line in the user's login shell, line by line; resolves with the exit code. */
export type Runner = (commandLine: string, cwd: string, onLine: (line: string) => void) => Promise<number>

export const loginShellRunner: Runner = (commandLine, cwd, onLine) =>
  new Promise((resolve) => {
    const { file } = shellCommand()
    const proc = spawn(file, shellArgs(commandLine, process.platform, false), { cwd, env: shellEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    // Each stream keeps its own unfinished line.
    const rest = { out: '', err: '' }
    const feed = (stream: 'out' | 'err') => (d: Buffer) => {
      const lines = (rest[stream] + d.toString()).split(/\r?\n/)
      rest[stream] = lines.pop()!
      lines.filter(Boolean).forEach(onLine)
    }
    proc.stdout.on('data', feed('out'))
    proc.stderr.on('data', feed('err'))
    proc.on('error', (err) => {
      onLine(err.message)
      resolve(127)
    })
    proc.on('close', (code) => {
      for (const line of [rest.out, rest.err]) if (line) onLine(line)
      resolve(code ?? 1)
    })
  })

/** At most this many lines of a failed install go into its error. */
const TAIL = 12

export interface ToolsOptions {
  /** W-ONE's own tools folder (npm packages, debugpy, jdtls workspaces). */
  dir: string
  probe?: Probe
  run?: Runner
  publish?: (progress: ToolProgress) => void
}

/**
 * Language servers and debuggers on this machine: what is there (asked of
 * the user's login shell, so Homebrew, nvm, GOPATH and friends count), and
 * installing what is missing — only when the user asks, from Settings.
 */
export class ToolsService {
  /** `id:part` → path ('' = not there). Filled by status(), cleared by installs. */
  private found = new Map<string, string>()
  private installing = new Set<string>()

  constructor(private readonly opts: ToolsOptions) {}

  get dir(): string {
    return this.opts.dir
  }

  /** Every language with the state of its server and debugger — one shell round trip. */
  async status(): Promise<LanguageStatus[]> {
    const lines: string[] = []
    const requires = new Set<string>()
    for (const lang of LANGUAGES) {
      const entry = CATALOG[lang.id]
      for (const [part, spec] of this.parts(entry)) {
        lines.push(`printf '%s\\t%s\\n' ${lang.id}:${part} "$(${spec.locate(this.opts.dir)} | head -n1)"`)
        if (spec.install) requires.add(spec.install.requires)
      }
    }
    for (const r of requires) lines.push(`printf '%s\\t%s\\n' has:${r} "$(command -v ${r} 2>/dev/null)"`)
    const out = await (this.opts.probe ?? loginShellProbe)(lines.join('\n')).catch(() => '')
    const values = new Map(
      out
        .split('\n')
        .filter((l) => l.includes('\t'))
        .map((l) => l.split('\t') as [string, string])
    )
    for (const [key, value] of values) if (!key.startsWith('has:')) this.found.set(key, value.trim())

    return LANGUAGES.map((lang) => {
      const entry = CATALOG[lang.id]
      const state = (part: Part, spec: ToolSpec): ToolState => {
        if (this.found.get(`${lang.id}:${part}`)) return { name: spec.name, state: 'ready' }
        if (!spec.install) return { name: spec.name, state: 'manual' }
        const command = spec.install.command(this.opts.dir)
        const has = !!values.get(`has:${spec.install.requires}`)?.trim()
        return { name: spec.name, state: has ? 'missing' : 'toolchain', requires: spec.install.requires, command }
      }
      return { id: lang.id, name: lang.name, server: state('server', entry.server), debugger: entry.debugger && state('debugger', entry.debugger) }
    })
  }

  /** Where a language's server or debugger is; undefined when it isn't installed. */
  async locate(id: string, part: Part): Promise<string | undefined> {
    const key = `${id}:${part}`
    if (!this.found.has(key)) {
      const spec = part === 'server' ? CATALOG[id]?.server : CATALOG[id]?.debugger
      if (!spec) return undefined
      const out = await (this.opts.probe ?? loginShellProbe)(spec.locate(this.opts.dir)).catch(() => '')
      this.found.set(key, out.split('\n')[0].trim())
    }
    return this.found.get(key) || undefined
  }

  /** Install a language's server or debugger; its output streams as `tools:progress`. */
  async install(id: string, part: Part): Promise<LanguageStatus> {
    const spec = part === 'server' ? CATALOG[id]?.server : CATALOG[id]?.debugger
    if (!spec?.install) throw coded('not-installable', `Nothing to install for ${id} (${part})`)
    const key = `${id}:${part}`
    if (this.installing.has(key)) throw coded('busy', `${spec.name} is being installed already`)
    this.installing.add(key)
    const tail: string[] = []
    try {
      await mkdir(this.opts.dir, { recursive: true })
      const command = spec.install.command(this.opts.dir)
      this.opts.publish?.({ id, part, line: `$ ${command}` })
      const code = await (this.opts.run ?? loginShellRunner)(command, this.opts.dir, (line) => {
        tail.push(line)
        if (tail.length > TAIL) tail.shift()
        this.opts.publish?.({ id, part, line })
      })
      if (code !== 0) throw coded('install-failed', tail.join('\n') || `${spec.name}: exit ${code}`)
    } finally {
      this.installing.delete(key)
      this.found.delete(key)
    }
    return (await this.status()).find((l) => l.id === id)!
  }

  private parts(entry: (typeof CATALOG)[string]): [Part, ToolSpec][] {
    return entry.debugger ? [['server', entry.server], ['debugger', entry.debugger]] : [['server', entry.server]]
  }
}

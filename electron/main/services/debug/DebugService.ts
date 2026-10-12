import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import WebSocket from 'ws'
import type { DebugAction, DebugBreakpoint, DebugFrame, DebugOutput, DebugSession, DebugVariable } from '@shared/types/debug'
import { confine } from '../../lib/confine'
import { shellCommand, shellEnv, shellQuote } from '../terminal/TerminalService'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** A V8 inspector connection: Chrome DevTools Protocol requests and events. */
export interface Cdp {
  send<T = unknown>(method: string, params?: object): Promise<T>
  on(event: string, fn: (params: never) => void): void
  close(): void
}

/** Talk CDP over the inspector's WebSocket. */
export function connectCdp(url: string): Promise<Cdp> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    let seq = 0
    const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
    const handlers = new Map<string, ((params: never) => void)[]>()
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: never }
      if (msg.id !== undefined) {
        const p = pending.get(msg.id)
        pending.delete(msg.id)
        if (msg.error) p?.reject(coded('debug', msg.error.message))
        else p?.resolve(msg.result)
      } else handlers.get(msg.method!)?.forEach((fn) => fn(msg.params!))
    })
    ws.on('close', () => {
      for (const p of pending.values()) p.reject(coded('debug-closed', 'The debugger disconnected'))
      pending.clear()
      handlers.get('close')?.forEach((fn) => fn(undefined as never))
    })
    ws.on('error', reject)
    ws.on('open', () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            if (ws.readyState !== WebSocket.OPEN) return rej(coded('debug-closed', 'The debugger disconnected'))
            seq += 1
            pending.set(seq, { resolve: res as (v: unknown) => void, reject: rej })
            ws.send(JSON.stringify({ id: seq, method, params }))
          }),
        on: (event, fn) => handlers.set(event, [...(handlers.get(event) ?? []), fn]),
        close: () => ws.close()
      })
    )
  })
}

/** `node` with these arguments as the user's shell would start it (their PATH: Homebrew, nvm, …). */
export function nodeCommand(args: string[], platform: NodeJS.Platform = process.platform): { file: string; args: string[] } {
  const { file } = shellCommand()
  if (platform === 'win32') return { file, args: ['-NoLogo', '-Command', `node ${args.map(shellQuote).join(' ')}`] }
  return { file, args: ['-lc', `exec node ${args.map(shellQuote).join(' ')}`] }
}

/** Start `node` like the user's terminal would. */
export function launchNode(args: string[], cwd: string): ChildProcess {
  const command = nodeCommand(args)
  return spawn(command.file, command.args, { cwd, env: shellEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
}

/** What V8 calls a value (RemoteObject), as the debug console shows it. */
type Remote = { type: string; subtype?: string; value?: unknown; description?: string; objectId?: string; unserializableValue?: string }
export function describe(o: Remote): string {
  if (o.type === 'undefined') return 'undefined'
  if (o.unserializableValue) return o.unserializableValue
  if (o.type === 'string') return JSON.stringify(o.value)
  if (o.subtype === 'null') return 'null'
  if (o.description !== undefined) return o.description
  return String(o.value)
}
const variable = (name: string, o: Remote): DebugVariable => ({
  name,
  value: describe(o),
  type: o.subtype ?? o.type,
  objectId: o.objectId && o.subtype !== 'null' ? o.objectId : undefined
})

/** Inspector chatter on stderr that isn't the program's. */
const NOISE = /^(Debugger listening on|Debugger attached\.|Waiting for the debugger to disconnect|For help, see: https:\/\/nodejs\.org)/

const MAX_PROPERTIES = 500

interface Running {
  session: DebugSession
  root: string
  proc: ChildProcess
  cdp?: Cdp
  stopOnEntry: boolean
  started: boolean
  scripts: Map<string, string>
  breakpointIds: string[]
}

export interface DebugOptions {
  resolveRoot: (projectId: string) => string | undefined
  publish: (channel: 'debug:session' | 'debug:output', payload: DebugSession | DebugOutput) => void
  launch?: (args: string[], cwd: string) => ChildProcess
  connect?: (url: string) => Promise<Cdp>
}

/**
 * Run & Debug for Node.js: starts a project's program under the inspector
 * (paused before its first line), sets the editor's breakpoints, and then
 * drives it — continue, pause, step, the call stack with its scopes,
 * variables on demand and expressions evaluated in a frame. One session at
 * a time; its state and output go to every client as events.
 */
export class DebugService {
  private current?: Running

  constructor(private readonly opts: DebugOptions) {}

  session(): DebugSession | null {
    return this.current?.session ?? null
  }

  async start(req: { projectId: string; program: string; args?: string[]; stopOnEntry?: boolean; breakpoints: DebugBreakpoint[] }): Promise<DebugSession> {
    await this.stop()
    const configured = this.opts.resolveRoot(req.projectId)
    if (!configured) throw coded('not-found', `Unknown project: ${req.projectId}`)
    const root = await realpath(configured)
    const program = await confine(root, req.program)
    // TypeScript runs as is: Node strips the types (positions stay, so breakpoints match). Default from Node 22.18 on.
    const ts = /\.[cm]?ts$/.test(program) ? ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'] : []
    const proc = (this.opts.launch ?? launchNode)(['--inspect-brk=127.0.0.1:0', ...ts, program, ...(req.args ?? [])], root)
    const run: Running = {
      session: { id: randomUUID(), projectId: req.projectId, program: req.program, status: 'starting', frames: [] },
      root,
      proc,
      stopOnEntry: !!req.stopOnEntry,
      started: false,
      scripts: new Map(),
      breakpointIds: []
    }
    this.current = run
    const output = (stream: DebugOutput['stream'], text: string) => this.opts.publish('debug:output', { sessionId: run.session.id, stream, text })

    proc.stdout!.on('data', (d: Buffer) => output('stdout', d.toString()))
    let errBuffer = ''
    proc.stderr!.on('data', (d: Buffer) => {
      errBuffer += d.toString()
      const lines = errBuffer.split('\n')
      errBuffer = lines.pop()!
      for (const line of lines) {
        const url = /Debugger listening on (ws:\/\/\S+)/.exec(line)?.[1]
        if (url) void this.attach(run, url, req.breakpoints)
        // The program ended: let the inspector go, so the process can exit.
        if (line.startsWith('Waiting for the debugger to disconnect')) run.cdp?.close()
        if (!NOISE.test(line)) output('stderr', `${line}\n`)
      }
    })
    proc.on('error', (err) => this.update(run, { status: 'exited', error: err.message, frames: [] }))
    proc.on('exit', (code) => {
      if (errBuffer && !NOISE.test(errBuffer)) output('stderr', errBuffer)
      run.cdp?.close()
      this.update(run, { status: 'exited', exitCode: code, frames: [], reason: undefined })
      output('info', `exit ${code}\n`)
    })
    this.publish(run)
    return run.session
  }

  async stop(): Promise<void> {
    const run = this.current
    if (!run || run.session.status === 'exited') return
    run.cdp?.close()
    run.proc.kill()
    await new Promise<void>((resolve) => {
      if (run.proc.exitCode !== null || run.proc.signalCode !== null) return resolve()
      run.proc.once('exit', () => resolve())
    })
  }

  async control(action: DebugAction): Promise<void> {
    const cdp = this.cdp()
    const method = { continue: 'Debugger.resume', pause: 'Debugger.pause', stepOver: 'Debugger.stepOver', stepInto: 'Debugger.stepInto', stepOut: 'Debugger.stepOut' }[action]
    await cdp.send(method)
  }

  /** The editor's breakpoints changed: the running program gets exactly these. */
  async setBreakpoints(projectId: string, breakpoints: DebugBreakpoint[]): Promise<void> {
    const run = this.current
    if (!run?.cdp || run.session.projectId !== projectId || run.session.status === 'exited') return
    await this.applyBreakpoints(run, breakpoints)
  }

  async variables(objectId: string): Promise<DebugVariable[]> {
    const { result } = await this.cdp().send<{ result: { name: string; value?: Remote; get?: Remote }[] }>('Runtime.getProperties', {
      objectId,
      ownProperties: true,
      generatePreview: false
    })
    return result
      .filter((p) => p.value || p.get)
      .slice(0, MAX_PROPERTIES)
      .map((p) => (p.value ? variable(p.name, p.value) : { name: p.name, value: '(getter)', type: 'accessor' }))
  }

  /** An expression in a call frame (paused), else in the program's global scope. */
  async evaluate(expression: string, frameId?: string): Promise<DebugVariable> {
    const cdp = this.cdp()
    const { result, exceptionDetails } = await cdp.send<{ result: Remote; exceptionDetails?: { exception?: Remote; text: string } }>(
      frameId ? 'Debugger.evaluateOnCallFrame' : 'Runtime.evaluate',
      frameId ? { callFrameId: frameId, expression, generatePreview: false } : { expression, generatePreview: false }
    )
    if (exceptionDetails) return { name: expression, value: exceptionDetails.exception ? describe(exceptionDetails.exception) : exceptionDetails.text, type: 'error' }
    return variable(expression, result)
  }

  dispose(): void {
    const run = this.current
    if (!run) return
    run.cdp?.close()
    run.proc.kill()
  }

  // --- helpers ---

  private cdp(): Cdp {
    const cdp = this.current?.cdp
    if (!cdp || this.current!.session.status === 'exited') throw coded('debug-not-running', 'No program is being debugged')
    return cdp
  }

  private async attach(run: Running, url: string, breakpoints: DebugBreakpoint[]): Promise<void> {
    let cdp: Cdp
    try {
      cdp = await (this.opts.connect ?? connectCdp)(url)
    } catch (err) {
      return this.update(run, { error: (err as Error).message })
    }
    run.cdp = cdp
    cdp.on('Debugger.scriptParsed', (p: { scriptId: string; url: string }) => run.scripts.set(p.scriptId, p.url))
    cdp.on('Debugger.paused', (p: PausedEvent) => void this.paused(run, p))
    cdp.on('Debugger.resumed', () => this.update(run, { status: 'running', frames: [], reason: undefined, exception: undefined }))
    await cdp.send('Runtime.enable')
    await cdp.send('Debugger.enable')
    await cdp.send('Debugger.setPauseOnExceptions', { state: 'uncaught' })
    await this.applyBreakpoints(run, breakpoints)
    await cdp.send('Runtime.runIfWaitingForDebugger')
  }

  private async applyBreakpoints(run: Running, breakpoints: DebugBreakpoint[]): Promise<void> {
    const cdp = run.cdp!
    await Promise.all(run.breakpointIds.map((breakpointId) => cdp.send('Debugger.removeBreakpoint', { breakpointId }).catch(() => {})))
    run.breakpointIds = []
    for (const bp of breakpoints) {
      const abs = await confine(run.root, bp.path).catch(() => null)
      if (!abs) continue
      const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // CommonJS reports plain paths, ES modules file URLs.
      const urlRegex = `^(${esc(pathToFileURL(abs).href)}|${esc(abs)})$`
      const set = await cdp.send<{ breakpointId: string }>('Debugger.setBreakpointByUrl', { urlRegex, lineNumber: bp.line - 1, columnNumber: 0 }).catch(() => null)
      if (set) run.breakpointIds.push(set.breakpointId)
    }
  }

  private async paused(run: Running, p: PausedEvent): Promise<void> {
    // --inspect-brk stops before the first line: go on unless asked to stop there.
    if (!run.started) {
      run.started = true
      if (!run.stopOnEntry) return void (await run.cdp!.send('Debugger.resume').catch(() => {}))
    }
    const frames = p.callFrames.map((f): DebugFrame => {
      const url = f.url || run.scripts.get(f.location.scriptId) || ''
      return {
        id: f.callFrameId,
        name: f.functionName || '(anonymous)',
        path: this.projectPath(run.root, url),
        url,
        line: f.location.lineNumber + 1,
        column: (f.location.columnNumber ?? 0) + 1,
        scopes: f.scopeChain.map((s) => ({ type: s.type, name: s.name, objectId: s.object.objectId }))
      }
    })
    this.update(run, {
      status: 'paused',
      reason: p.hitBreakpoints?.length ? 'breakpoint' : p.reason === 'other' ? 'step' : p.reason,
      exception: p.reason === 'exception' && p.data ? describe(p.data) : undefined,
      frames
    })
  }

  /** The project file behind a script URL, if it is one. */
  private projectPath(root: string, url: string): string | undefined {
    let abs: string
    if (url.startsWith('file://')) abs = fileURLToPath(url)
    else if (isAbsolute(url)) abs = url
    else return undefined
    const rel = relative(root, abs)
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : undefined
  }

  private update(run: Running, patch: Partial<DebugSession>): void {
    run.session = { ...run.session, ...patch }
    this.publish(run)
  }

  private publish(run: Running): void {
    this.opts.publish('debug:session', run.session)
  }
}

interface PausedEvent {
  reason: string
  data?: Remote
  hitBreakpoints?: string[]
  callFrames: {
    callFrameId: string
    functionName: string
    url?: string
    location: { scriptId: string; lineNumber: number; columnNumber?: number }
    scopeChain: { type: string; name?: string; object: { objectId?: string } }[]
  }[]
}

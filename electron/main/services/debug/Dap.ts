import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import type { DebugAction, DebugBreakpoint, DebugFrame, DebugOutput, DebugSession, DebugVariable } from '@shared/types/debug'
import { frame, FrameReader } from '../lsp/LspClient'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** A byte stream to a debug adapter: its stdio, or a TCP socket. */
export interface DapTransport {
  write(data: Buffer): void
  onData(fn: (chunk: Buffer) => void): void
  onClose(fn: () => void): void
  close(): void
}

interface Message {
  seq: number
  type: 'request' | 'response' | 'event'
  command?: string
  request_seq?: number
  success?: boolean
  message?: string
  body?: unknown
  event?: string
}

const REQUEST_TIMEOUT_MS = 30_000

/**
 * The Debug Adapter Protocol — what VS Code speaks with every debugger
 * (debugpy, Delve, CodeLLDB, …): requests with responses, events, and the
 * adapter's own requests (answered "not supported").
 */
export class DapClient {
  private seq = 0
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly handlers = new Map<string, ((body: never) => void)[]>()
  private open = true

  constructor(
    private readonly transport: DapTransport,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {
    const reader = new FrameReader((msg) => this.handle(msg as Message))
    transport.onData((chunk) => reader.push(chunk))
    transport.onClose(() => this.closed())
  }

  request<T = unknown>(command: string, args?: unknown, timeoutMs = this.timeoutMs): Promise<T> {
    if (!this.open) return Promise.reject(coded('debug-closed', 'The debugger disconnected'))
    const seq = ++this.seq
    const answer = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq)
        reject(coded('debug-timeout', `The debugger did not answer ${command}`))
      }, timeoutMs)
      this.pending.set(seq, {
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v as T)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        }
      })
    })
    this.transport.write(frame({ seq, type: 'request', command, arguments: args }))
    return answer
  }

  on(event: string, fn: (body: never) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn])
  }

  close(): void {
    this.transport.close()
    this.closed()
  }

  private handle(msg: Message): void {
    if (msg.type === 'response') {
      const waiting = this.pending.get(msg.request_seq!)
      if (!waiting) return
      this.pending.delete(msg.request_seq!)
      if (msg.success) waiting.resolve(msg.body ?? {})
      else waiting.reject(coded('debug', msg.message ?? `${msg.command} failed`))
      return
    }
    if (msg.type === 'event') return this.handlers.get(msg.event!)?.forEach((fn) => fn((msg.body ?? {}) as never))
    // The adapter asks something of the editor (runInTerminal, startDebugging): not supported here.
    this.transport.write(frame({ seq: ++this.seq, type: 'response', request_seq: msg.seq, command: msg.command, success: false, message: 'Not supported by W-ONE' }))
  }

  private closed(): void {
    if (!this.open) return
    this.open = false
    for (const p of this.pending.values()) p.reject(coded('debug-closed', 'The debugger disconnected'))
    this.pending.clear()
    this.handlers.get('close')?.forEach((fn) => fn(undefined as never))
  }
}

/** What a language's adapter needs to run a program. */
export interface DapLaunch {
  /** The adapter's id (`python`, `go`). */
  adapterID: string
  /** The `launch` request's arguments. */
  arguments: Record<string, unknown>
  /** Ends the adapter process (and so the program). */
  kill: () => void
}

type StackFrame = { id: number; name: string; line: number; column: number; source?: { path?: string; name?: string } }
type Scope = { name: string; variablesReference: number }
type Variable = { name: string; value: string; type?: string; variablesReference: number }

/** Top frames whose scopes load right away (the others when selected — not needed by the editor so far). */
const SCOPED_FRAMES = 20
const MAX_VARIABLES = 500

export interface DapSessionOptions {
  projectId: string
  program: string
  root: string
  publish: (channel: 'debug:session' | 'debug:output', payload: DebugSession | DebugOutput) => void
}

/**
 * One program under a debug adapter — the same session, frames, variables
 * and controls the editor shows for Node, from any language's debugger.
 */
export class DapSession {
  session: DebugSession
  private thread?: number
  private files = new Set<string>()
  private exitCode?: number

  constructor(
    private readonly client: DapClient,
    private readonly launch: DapLaunch,
    private readonly opts: DapSessionOptions
  ) {
    this.session = { id: randomUUID(), projectId: opts.projectId, program: opts.program, status: 'starting', frames: [] }
  }

  /** initialize → launch → (initialized) breakpoints, exception filters → configurationDone. */
  async start(breakpoints: DebugBreakpoint[], stopOnEntry: boolean): Promise<void> {
    const c = this.client
    c.on('output', (b: { category?: string; output: string }) => {
      if (b.category === 'telemetry') return
      this.output(b.category === 'stderr' ? 'stderr' : b.category === 'stdout' ? 'stdout' : 'info', b.output)
    })
    c.on('stopped', (b: { reason: string; threadId?: number; description?: string; text?: string }) => void this.stopped(b))
    c.on('continued', () => this.update({ status: 'running', frames: [], reason: undefined, exception: undefined }))
    c.on('exited', (b: { exitCode: number }) => (this.exitCode = b.exitCode))
    c.on('terminated', () => this.end())
    c.on('close', () => this.end())

    const caps = await c.request<{ exceptionBreakpointFilters?: { filter: string; default?: boolean }[] }>('initialize', {
      clientID: 'w-one',
      clientName: 'W-ONE',
      adapterID: this.launch.adapterID,
      linesStartAt1: true,
      columnsStartAt1: true,
      pathFormat: 'path',
      supportsVariableType: true,
      supportsRunInTerminalRequest: false
    })
    const initialized = new Promise<void>((resolve) => c.on('initialized', () => resolve()))
    const launched = c.request('launch', { ...this.launch.arguments, stopOnEntry })
    launched.catch((err: Error) => this.update({ status: 'exited', error: err.message, frames: [] }))
    await Promise.race([initialized, launched])
    await this.setBreakpoints(breakpoints)
    await c.request('setExceptionBreakpoints', { filters: (caps.exceptionBreakpointFilters ?? []).filter((f) => f.default).map((f) => f.filter) })
    await c.request('configurationDone')
    if (this.session.status === 'starting') this.update({ status: 'running' })
  }

  async control(action: DebugAction): Promise<void> {
    const threadId = this.thread ?? (await this.client.request<{ threads?: { id: number }[] }>('threads')).threads?.[0]?.id
    const command = { continue: 'continue', pause: 'pause', stepOver: 'next', stepInto: 'stepIn', stepOut: 'stepOut' }[action]
    await this.client.request(command, { threadId })
  }

  /** Exactly these breakpoints — files that had some and have none now are cleared too. */
  async setBreakpoints(breakpoints: DebugBreakpoint[]): Promise<void> {
    const byFile = new Map<string, number[]>([...this.files].map((f) => [f, []]))
    for (const bp of breakpoints) byFile.set(bp.path, [...(byFile.get(bp.path) ?? []), bp.line])
    this.files = new Set(breakpoints.map((b) => b.path))
    await Promise.all(
      [...byFile].map(([path, lines]) =>
        this.client.request('setBreakpoints', { source: { path: `${this.opts.root}/${path}` }, breakpoints: lines.map((line) => ({ line })) }).catch(() => {})
      )
    )
  }

  async variables(objectId: string): Promise<DebugVariable[]> {
    const { variables = [] } = await this.client.request<{ variables?: Variable[] }>('variables', { variablesReference: Number(objectId) })
    return variables.slice(0, MAX_VARIABLES).map((v) => this.variable(v.name, v.value, v.type, v.variablesReference))
  }

  async evaluate(expression: string, frameId?: string): Promise<DebugVariable> {
    try {
      const r = await this.client.request<{ result: string; type?: string; variablesReference: number }>('evaluate', {
        expression,
        frameId: frameId === undefined ? undefined : Number(frameId),
        context: 'repl'
      })
      return this.variable(expression, r.result, r.type, r.variablesReference)
    } catch (err) {
      return { name: expression, value: (err as Error).message, type: 'error' }
    }
  }

  async stop(): Promise<void> {
    if (this.session.status === 'exited') return
    await this.client.request('disconnect', { terminateDebuggee: true }, 3000).catch(() => {})
    this.client.close()
    this.launch.kill()
    this.end()
  }

  dispose(): void {
    this.client.close()
    this.launch.kill()
  }

  /** Starting failed (the adapter refused the program, …): the session ends with the reason. */
  fail(message: string): void {
    this.update({ error: message })
    this.end()
  }

  // --- helpers ---

  private variable(name: string, value: string, type: string | undefined, ref: number): DebugVariable {
    return { name, value, type: type || 'value', objectId: ref > 0 ? String(ref) : undefined }
  }

  private async stopped(b: { reason: string; threadId?: number; description?: string; text?: string }): Promise<void> {
    if (b.threadId !== undefined) this.thread = b.threadId
    const threadId = this.thread ?? (await this.client.request<{ threads?: { id: number }[] }>('threads').catch(() => ({ threads: [] }))).threads?.[0]?.id
    const { stackFrames = [] } = await this.client.request<{ stackFrames?: StackFrame[] }>('stackTrace', { threadId, levels: 50 }).catch(() => ({ stackFrames: [] }))
    const frames = await Promise.all(
      stackFrames.map(async (f, i): Promise<DebugFrame> => {
        const scopes =
          i < SCOPED_FRAMES ? ((await this.client.request<{ scopes?: Scope[] }>('scopes', { frameId: f.id }).catch(() => ({ scopes: [] }))).scopes ?? []) : []
        return {
          id: String(f.id),
          name: f.name,
          path: this.projectPath(f.source?.path),
          url: f.source?.path ?? f.source?.name ?? '',
          line: f.line,
          column: f.column,
          scopes: scopes.map((s) => ({ type: s.name, objectId: s.variablesReference > 0 ? String(s.variablesReference) : undefined }))
        }
      })
    )
    this.update({ status: 'paused', reason: b.reason, exception: b.reason === 'exception' ? (b.text ?? b.description) : undefined, frames })
  }

  private projectPath(path: string | undefined): string | undefined {
    if (!path || !isAbsolute(path)) return undefined
    const rel = relative(this.opts.root, path)
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : undefined
  }

  private end(): void {
    if (this.session.status === 'exited') return
    this.update({ status: 'exited', exitCode: this.exitCode ?? null, frames: [], reason: undefined })
    this.output('info', `exit ${this.exitCode ?? '-'}\n`)
    this.client.close()
    this.launch.kill()
  }

  private output(stream: DebugOutput['stream'], text: string): void {
    this.opts.publish('debug:output', { sessionId: this.session.id, stream, text })
  }

  private update(patch: Partial<DebugSession>): void {
    this.session = { ...this.session, ...patch }
    this.opts.publish('debug:session', this.session)
  }
}

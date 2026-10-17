import {
  CHANNEL_ACCESS,
  type IpcChannel,
  type IpcChannels,
  type IpcResult
} from '@shared/ipc/contract'
import { parseRequest } from '@shared/ipc/schemas'
import type { DeviceRole } from '@shared/types/server'

/** Who is calling: the desktop window over IPC, or a paired remote client (and its role). */
export interface CallContext {
  transport: 'ipc' | 'remote'
  deviceId?: string
  role?: DeviceRole
}

export type Handler<K extends IpcChannel> = (
  req: IpcChannels[K]['request'],
  ctx: CallContext
) => Promise<IpcChannels[K]['response']> | IpcChannels[K]['response']

type AnyHandler = (req: unknown, ctx: CallContext) => unknown

function fail(code: string, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

/**
 * The one dispatch point for every contract channel — used by the desktop IPC
 * bridge and by the HTTP API alike. Per call it checks, in order: the channel
 * exists, Mindeck is licensed (or the channel is license-free), the caller's
 * transport and role may use it (CHANNEL_ACCESS), the payload matches its
 * schema, a remote call passes the guard (shared folders); then runs the
 * handler (a remote call's answer trimmed to what the device may see) and
 * wraps the result in IpcResult. Errors never escape as throws.
 */
export interface RouterOptions {
  remoteTerminal: () => boolean
  /** License gate: false → the channel is refused until Mindeck is licensed. */
  licensed?: (channel: IpcChannel) => boolean
  /** Checks a remote call's validated payload (throws a coded error to refuse it). */
  guard?: (channel: IpcChannel, payload: unknown, ctx: CallContext) => Promise<void> | void
  /** A remote call's answer as the device may see it (lists trimmed to its projects). */
  shape?: (channel: IpcChannel, data: unknown, ctx: CallContext) => Promise<unknown> | unknown
}

export class Router {
  private readonly handlers = new Map<IpcChannel, AnyHandler>()

  constructor(private readonly opts: RouterOptions = { remoteTerminal: () => false }) {}

  register<K extends IpcChannel>(channel: K, handler: Handler<K>): void {
    this.handlers.set(channel, handler as AnyHandler)
  }

  has(channel: string): channel is IpcChannel {
    return this.handlers.has(channel as IpcChannel)
  }

  async dispatch(channel: string, payload: unknown, ctx: CallContext): Promise<IpcResult<unknown>> {
    const handler = this.handlers.get(channel as IpcChannel)
    if (!handler) return fail('unknown-channel', `Unknown channel: ${channel}`)
    const key = channel as IpcChannel

    if (this.opts.licensed && !this.opts.licensed(key)) {
      return fail('license-required', 'Mindeck needs a license — sign in under Profile')
    }

    if (ctx.transport === 'remote') {
      const access = CHANNEL_ACCESS[key]
      if (access === 'desktop') {
        return fail('desktop-only', `${channel} is only available in the Mindeck desktop app`)
      }
      if (access === 'terminal' && !this.opts.remoteTerminal()) {
        return fail('remote-terminal-disabled', 'Remote shells are disabled on this Mindeck core')
      }
      if (access === 'admin' && ctx.role !== 'admin') {
        return fail('admin-only', `${channel} needs a device with the admin role (or the Mindeck desktop app)`)
      }
      if (access === 'trusted' && ctx.role !== 'admin' && !this.opts.remoteTerminal()) {
        return fail('remote-terminal-disabled', `${channel} needs remote shells on this Mindeck core, or a device with the admin role`)
      }
    }

    const parsed = parseRequest(key, payload)
    if (!parsed.ok) return fail('bad-request', parsed.message)

    try {
      if (ctx.transport !== 'remote') return { ok: true, data: await handler(parsed.data, ctx) }
      await this.opts.guard?.(key, parsed.data, ctx)
      const data = await handler(parsed.data, ctx)
      return { ok: true, data: this.opts.shape ? await this.opts.shape(key, data, ctx) : data }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      return fail(e?.code ?? 'error', e?.message ?? String(err))
    }
  }
}

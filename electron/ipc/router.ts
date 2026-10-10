import {
  CHANNEL_ACCESS,
  type IpcChannel,
  type IpcChannels,
  type IpcResult
} from '@shared/ipc/contract'
import { parseRequest } from '@shared/ipc/schemas'

/** Who is calling: the desktop window over IPC, or a paired remote client. */
export interface CallContext {
  transport: 'ipc' | 'remote'
  deviceId?: string
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
 * exists, W-ONE is licensed (or the channel is license-free), the caller's
 * transport may use it (CHANNEL_ACCESS), the payload
 * matches its schema; then runs the handler and wraps the result in IpcResult.
 * Errors never escape as throws.
 */
export interface RouterOptions {
  remoteTerminal: () => boolean
  /** License gate: false → the channel is refused until W-ONE is licensed. */
  licensed?: (channel: IpcChannel) => boolean
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
      return fail('license-required', 'W-ONE needs a license — sign in under Profile')
    }

    if (ctx.transport === 'remote') {
      const access = CHANNEL_ACCESS[key]
      if (access === 'desktop') {
        return fail('desktop-only', `${channel} is only available in the W-ONE desktop app`)
      }
      if (access === 'terminal' && !this.opts.remoteTerminal()) {
        return fail('remote-terminal-disabled', 'Remote shells are disabled on this W-ONE core')
      }
    }

    const parsed = parseRequest(key, payload)
    if (!parsed.ok) return fail('bad-request', parsed.message)

    try {
      return { ok: true, data: await handler(parsed.data, ctx) }
    } catch (err) {
      const e = err as { code?: string; message?: string }
      return fail(e?.code ?? 'error', e?.message ?? String(err))
    }
  }
}

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https'
import { X509Certificate, randomUUID } from 'node:crypto'
import { createServer as createNetServer, isIP, type Server as NetServer, type Socket } from 'node:net'
import { hostname as osHostname } from 'node:os'
import type { TLSSocket } from 'node:tls'
import { readFile, realpath, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type WebSocket } from 'ws'
import { DESKTOP_EVENTS, TERMINAL_EVENTS, type IpcEvent } from '@shared/ipc/contract'
import { EVENTS_PROTOCOL, TOKEN_PROTOCOL_PREFIX } from '@shared/ipc/transport'
import type { PermissionRequest } from '@shared/types/ai'
import type { CoreMode } from '@shared/types/server'
import type { Router } from '../../ipc/router'
import type { EventHub } from '../core/EventHub'
import type { AuthService } from '../services/auth/AuthService'
import type { TlsCredentials } from './Certificates'

const MAX_BODY = 8 * 1024 * 1024
/** A pairing request (before anyone is known) holds a code and a name. */
const MAX_PAIR_BODY = 16 * 1024
const PAIR_WINDOW_MS = 10 * 60_000
const PAIR_MAX_FAILURES = 10
/** Addresses whose failed pairings are remembered at most — the oldest give way. */
const PAIR_MAX_TRACKED = 1000
/** Open connections at most (a phone, a browser or two — never thousands). */
const MAX_CONNECTIONS = 512
const HEARTBEAT_MS = 30_000
/** The first byte of a TLS handshake: the connection speaks HTTPS. */
const TLS_HANDSHAKE = 0x16
/** A connection that sends nothing is dropped after this long. */
const FIRST_BYTE_MS = 10_000
/** A well-formed Host header (name or IP, optional port). */
const HOST = /^([a-z0-9.-]+|\[[0-9a-f:.]+\])(:\d{1,5})?$/i

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
}

/** Same policy as index.html, enforced as a header for the served web UI. */
const CSP =
  "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin'
}

/** Remote clients get system ticks while connected; these are no-ops for them. */
const REMOTE_NOOP = new Set(['system:subscribe', 'system:unsubscribe'])

export interface HttpServerOptions {
  router: Router
  hub: EventHub
  auth: AuthService
  mode: CoreMode
  version: string
  /** Built web UI to serve at `/` (optional — API-only without it). */
  webRoot?: string
  remoteTerminal: () => boolean
  /** Connected WebSocket clients changed (drives remote telemetry sampling). */
  onClients?: (count: number) => void
  /** A push event as devices may see it (RemoteScope): itself, trimmed, or null — none of theirs. */
  scope?: (channel: IpcEvent, payload: unknown) => Promise<unknown>
  /**
   * More names the core answers to besides its addresses, `localhost`, the
   * machine's name and its certificate's (`MINDECK_ALLOWED_HOSTS`): a reverse
   * proxy's domain, `.example.com` for its subdomains, `*` for any.
   */
  allowedHosts?: string[]
  /** The machine's name (tests pass their own). */
  hostname?: () => string
}

/** `MINDECK_ALLOWED_HOSTS=mindeck.example.com,.ts.net` → the names, trimmed. */
export function allowedHostsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.MINDECK_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
}

/** Events meant for one device only (`device`): search results and inline edits are its own. */
const TARGETED: readonly IpcEvent[] = ['search:progress', 'ai:inlineDelta']

interface Client {
  ws: WebSocket
  deviceId: string
  alive: boolean
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
  }
}

/** A URL part decoded — broken percent-encoding is the client's mistake (400), not the core's. */
function decoded(part: string): string {
  try {
    return decodeURIComponent(part)
  } catch {
    throw new HttpError(400, 'bad-url', 'The URL is not validly encoded')
  }
}

/** An unexpected failure: the details (paths, user names) go to the log, the client gets a reference to quote. */
function internal(err: unknown): HttpError {
  const ref = randomUUID().slice(0, 8)
  console.error(`[server] request failed (ref ${ref}):`, err)
  return new HttpError(500, 'error', `Something went wrong on the Mindeck core (ref ${ref})`)
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  })
  res.end(json)
}

function bearer(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization
  if (header?.startsWith('Bearer ')) return header.slice(7).trim()
  return undefined
}

/**
 * The events socket's token: offered as a subprotocol (`mindeck.bearer.<token>`),
 * so it never lands in a URL (where proxy and access logs keep it). The old
 * `?token=` query is no longer read: the web UI and the app stopped using it.
 */
function socketToken(req: IncomingMessage): string | null {
  const offered = String(req.headers['sec-websocket-protocol'] ?? '')
    .split(',')
    .map((p) => p.trim())
    .find((p) => p.startsWith(TOKEN_PROTOCOL_PREFIX))
  return offered ? offered.slice(TOKEN_PROTOCOL_PREFIX.length) : null
}

function clientIp(req: IncomingMessage): string {
  return String(req.socket.remoteAddress)
}

/** This computer itself (IPv4, IPv6 or IPv4-mapped loopback). */
export function isLoopbackAddress(ip: string): boolean {
  return /^(127\.|::ffff:127\.)/.test(ip) || ip === '::1'
}

/**
 * A proxy on this computer (nginx, Caddy, `kubectl port-forward` with a
 * sidecar …) passes requests on: they come from 127.0.0.1, but they are not
 * this computer's — never trusted like it (plain HTTP, one shared rate limit).
 */
function proxied(req: IncomingMessage): boolean {
  return ['x-forwarded-for', 'x-real-ip', 'forwarded'].some((h) => req.headers[h] !== undefined)
}

/** The rate-limit bucket of an address: IPv6 by its /64 (one LAN host may take as many addresses as it likes), IPv4 as it is. */
export function addressBucket(ip: string): string {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (mapped) return mapped[1]
  if (isIP(ip) !== 6) return ip
  const [head, tail] = ip.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups = tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
  return `${groups
    .slice(0, 4)
    .map((g) => parseInt(g, 16).toString(16))
    .join(':')}::/64`
}

/** Whose failed pairings a request counts as: its address — behind a proxy here, the one the proxy passes on. */
function rateKey(req: IncomingMessage): string {
  const ip = clientIp(req)
  if (!isLoopbackAddress(ip) || !proxied(req)) return addressBucket(ip)
  const hop = String(req.headers['x-forwarded-for'] ?? req.headers['x-real-ip'] ?? '')
    .split(',')
    .pop()!
    .trim()
  return `proxied:${addressBucket(hop)}`
}

/** The DNS names a certificate is for (`*.example.com` → `.example.com`). */
function certificateNames(cert: string): string[] {
  return (new X509Certificate(cert).subjectAltName ?? '')
    .split(/,\s*/)
    .filter((e) => e.startsWith('DNS:'))
    .map((e) => e.slice(4).toLowerCase().replace(/^\*\./, '.'))
}

const encrypted = (req: IncomingMessage) => (req.socket as TLSSocket).encrypted === true

async function readJson(req: IncomingMessage, limit = MAX_BODY): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new HttpError(413, 'too-large', 'Request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  if (!text) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'bad-json', 'Request body is not valid JSON')
  }
}

/**
 * The Mindeck core over the network — one server for the web UI and the mobile
 * app. Same contract as the desktop IPC, same Router (validation + access
 * rules), authenticated with per-device bearer tokens:
 *
 *   GET  /api/health           liveness (public; the version for paired devices)
 *   POST /api/pair             { code, name } → { token, device } (public, rate limited)
 *   POST /api/rpc/<channel>    payload → IpcResult (Bearer token)
 *   WS   /api/events           push events as { channel, payload } (token as subprotocol)
 *   GET  /*                    the built web UI (single-page app)
 *
 * No cookies and no CORS: credentials are explicit headers, so cross-site
 * requests cannot ride on a session. Only requests for the core's own names
 * are answered (`hostAllowed`): DNS rebinding gets `403 host-not-allowed`.
 *
 * With TLS credentials, one port speaks both: HTTPS (and WSS) for everyone,
 * plain HTTP only for this computer itself (127.0.0.1 — the local web UI,
 * health checks). The network gets no answer in the clear: a page request is
 * sent to the HTTPS address, anything else (a token, a pairing code) is refused.
 */
export class HttpServer {
  /** The listening socket; it hands each connection to `web` or `secure`. */
  private server?: NetServer
  private web?: Server
  private secure?: HttpsServer
  private tls?: TlsCredentials
  private readonly sockets = new Set<Socket>()
  private readonly wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    // Answer with Mindeck's own protocol — never echo the token one.
    handleProtocols: (offered) => (offered.has(EVENTS_PROTOCOL) ? EVENTS_PROTOCOL : false)
  })
  private readonly clients = new Set<Client>()
  private readonly pairFailures = new Map<string, number[]>()
  /** The names in the certificate the server presents. */
  private certNames: string[] = []
  private heartbeat?: NodeJS.Timeout
  /** Scoped events leave in the order they came (a slow check never lets a later one overtake). */
  private outbox: Promise<void> = Promise.resolve()
  private unsubscribe?: () => void

  constructor(private readonly opts: HttpServerOptions) {}

  get clientCount(): number {
    return this.clients.size
  }

  /** Listen on `host:port` — with `tls`, HTTPS (and HTTP for this computer only). */
  async listen(host: string, port: number, tls?: TlsCredentials): Promise<void> {
    const serve = <T extends Server | HttpsServer>(server: T): T => {
      server.on('request', (req, res) => void this.handle(req, res))
      server.on('upgrade', (req, socket, head) => void this.upgrade(req, socket, head))
      return server
    }
    const web = serve(createServer())
    const secure = tls ? serve(createHttpsServer({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2' })) : undefined
    const server = createNetServer((socket) => this.accept(socket, web, secure))
    server.maxConnections = MAX_CONNECTIONS
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(port, host, () => {
        server.off('error', reject)
        resolveListen()
      })
    })
    // They never listen themselves: this starts their request and header timeouts all the same.
    for (const s of [web, secure]) s?.emit('listening')
    Object.assign(this, { server, web, secure, tls, certNames: tls ? certificateNames(tls.cert) : [] })
    this.unsubscribe = this.opts.hub.subscribe((channel, payload) => this.push(channel, payload))
    this.heartbeat = setInterval(() => this.sweep(), HEARTBEAT_MS)
  }

  /** The bound port (useful with port 0 in tests). */
  get port(): number {
    const addr = this.server?.address()
    return addr && typeof addr === 'object' ? addr.port : 0
  }

  /** A renewed certificate: new connections get it, open ones keep theirs. */
  setTls(tls: TlsCredentials): void {
    if (!this.secure) return
    this.secure.setSecureContext({ cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2' })
    this.tls = tls
    this.certNames = certificateNames(tls.cert)
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    this.unsubscribe?.()
    this.unsubscribe = undefined
    for (const client of [...this.clients]) client.ws.terminate()
    this.clients.clear()
    this.opts.onClients?.(0)
    const server = this.server
    this.server = undefined
    if (!server) return
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    for (const s of [this.web, this.secure]) s?.close()
    this.web = this.secure = this.tls = undefined
    await new Promise<void>((r) => server.close(() => r()))
  }

  /** A new connection: HTTPS when it opens with a TLS handshake, else plain HTTP. */
  private accept(socket: Socket, web: Server, secure?: HttpsServer): void {
    this.sockets.add(socket)
    socket.once('close', () => this.sockets.delete(socket))
    socket.on('error', () => socket.destroy())
    if (!secure) return void web.emit('connection', socket)
    socket.setTimeout(FIRST_BYTE_MS, () => socket.destroy())
    socket.once('data', (chunk: Buffer) => {
      socket.setTimeout(0)
      socket.pause()
      socket.unshift(chunk)
      ;(chunk[0] === TLS_HANDSHAKE ? secure : web).emit('connection', socket)
      process.nextTick(() => socket.resume())
    })
  }

  /** Plain HTTP while the server speaks HTTPS: only this computer may use it (not a proxy on it). */
  private refusesPlain(req: IncomingMessage): boolean {
    return !!this.secure && !encrypted(req) && (!isLoopbackAddress(clientIp(req)) || proxied(req))
  }

  /**
   * DNS rebinding: a web page that points its own name at this computer
   * still sends that name as Host. Answered are IP addresses, `localhost`,
   * the machine's name (and `<name>.local`), the certificate's names and
   * the allowed hosts — nothing else.
   */
  private hostAllowed(req: IncomingMessage): boolean {
    const m = HOST.exec(String(req.headers.host ?? ''))
    if (!m) return false
    const name = m[1].replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase()
    if (isIP(name) || name === 'localhost' || name.endsWith('.localhost')) return true
    // macOS names itself `Studio-Mac.local`, a router's DNS `studio-mac.fritz.box`: the bare name counts too.
    const machine = (this.opts.hostname ?? osHostname)().toLowerCase()
    const bare = machine.split('.')[0]
    const names = [machine, bare, `${bare}.local`, ...this.certNames, ...(this.opts.allowedHosts ?? []).map((h) => h.toLowerCase())]
    return names.some((h) => h === '*' || h === name || (h.startsWith('.') && name.endsWith(h)))
  }

  /** Drop every live connection of a revoked device. */
  disconnectDevice(deviceId: string): void {
    for (const client of [...this.clients]) {
      if (client.deviceId === deviceId) client.ws.close(4401, 'revoked')
    }
  }

  // --- HTTP ---

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.hostAllowed(req)) {
      return send(res, 403, { ok: false, error: { code: 'host-not-allowed', message: 'This Mindeck core does not answer to that name — add it to MINDECK_ALLOWED_HOSTS' } })
    }
    if (this.refusesPlain(req)) return this.toHttps(req, res)
    // HSTS only for a certificate a browser trusts: with a self-signed one it would turn the
    // warning a person can click through (after comparing the fingerprint) into a dead end.
    if (encrypted(req) && this.tls && !this.tls.selfSigned) res.setHeader('Strict-Transport-Security', 'max-age=31536000')
    try {
      const url = new URL(req.url as string, 'http://local')
      const path = url.pathname
      if (path === '/api/health' && req.method === 'GET') {
        // The version only for paired devices: to anyone else it says which known bugs to try.
        const paired = !!(await this.opts.auth.verify(bearer(req)))
        return send(res, 200, { ok: true, name: 'Mindeck', mode: this.opts.mode, ...(paired ? { version: this.opts.version } : {}) })
      }
      if (path === '/api/pair' && req.method === 'POST') return await this.pair(req, res)
      if (path.startsWith('/api/rpc/') && req.method === 'POST') return await this.rpc(req, res, path.slice(9))
      if (path.startsWith('/api/')) throw new HttpError(404, 'not-found', 'No such endpoint')
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method', 'Method not allowed')
      return await this.serveStatic(path, res)
    } catch (err) {
      const e = err instanceof HttpError ? err : internal(err)
      send(res, e.status, { ok: false, error: { code: e.code, message: e.message } })
    }
  }

  /** A page goes to its HTTPS address; a call (with a token or a code) is refused, never answered in the clear. */
  private toHttps(req: IncomingMessage, res: ServerResponse): void {
    // The Host is one of the core's own names here (hostAllowed): fit for a redirect.
    if (req.method === 'GET' || req.method === 'HEAD') {
      res.writeHead(308, { ...SECURITY_HEADERS, Location: `https://${req.headers.host}${req.url}`, 'Cache-Control': 'no-store' })
      return void res.end()
    }
    send(res, 403, { ok: false, error: { code: 'https-required', message: 'This Mindeck core accepts the network over HTTPS only — use https://' } })
  }

  private async pair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const key = rateKey(req)
    const now = Date.now()
    const recent = (this.pairFailures.get(key) ?? []).filter((t) => now - t < PAIR_WINDOW_MS)
    if (recent.length >= PAIR_MAX_FAILURES) {
      throw new HttpError(429, 'rate-limited', 'Too many failed pairing attempts — try again later')
    }
    const body = (await readJson(req, MAX_PAIR_BODY)) as { code?: unknown; name?: unknown } | undefined
    try {
      const result = await this.opts.auth.pair(String(body?.code ?? ''), String(body?.name ?? ''))
      this.pairFailures.delete(key)
      // Over HTTPS the device learns the certificate to pin from here on.
      const fingerprint = encrypted(req) ? this.tls?.fingerprint : undefined
      send(res, 200, { ok: true, data: fingerprint ? { ...result, fingerprint } : result })
    } catch (err) {
      // Kept in order of the last failure; past the limit the oldest address is forgotten.
      this.pairFailures.delete(key)
      this.pairFailures.set(key, [...recent, now])
      if (this.pairFailures.size > PAIR_MAX_TRACKED) this.pairFailures.delete(this.pairFailures.keys().next().value!)
      throw new HttpError(401, 'bad-code', (err as Error).message)
    }
  }

  private async rpc(req: IncomingMessage, res: ServerResponse, channel: string): Promise<void> {
    const device = await this.opts.auth.verify(bearer(req))
    if (!device) throw new HttpError(401, 'unauthorized', 'Missing or invalid device token')
    const payload = await readJson(req)
    if (REMOTE_NOOP.has(channel)) return send(res, 200, { ok: true })
    const result = await this.opts.router.dispatch(decoded(channel), payload, {
      transport: 'remote',
      deviceId: device.id,
      role: device.role
    })
    send(res, 200, result)
  }

  private async serveStatic(path: string, res: ServerResponse): Promise<void> {
    const root = this.opts.webRoot
    if (!root) throw new HttpError(404, 'not-found', 'This Mindeck core serves no web UI')
    const rootReal = await realpath(root).catch(() => {
      throw new HttpError(404, 'not-found', 'Web UI not built')
    })
    let file = resolve(rootReal, '.' + decoded(path))
    const inside = file === rootReal || file.startsWith(rootReal + sep)
    const info = inside ? await stat(file).catch(() => null) : null
    if (!info?.isFile()) file = join(rootReal, 'index.html') // SPA fallback
    const body = await readFile(file).catch(() => {
      throw new HttpError(404, 'not-found', 'Web UI not built')
    })
    const isAsset = /[\\/]assets[\\/]/.test(file)
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Content-Security-Policy': CSP
    })
    res.end(body)
  }

  // --- WebSocket ---

  private async upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (!this.hostAllowed(req) || this.refusesPlain(req)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const url = new URL(req.url as string, 'http://local')
    const device = url.pathname === '/api/events' ? await this.opts.auth.verify(socketToken(req)) : null
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      const client: Client = { ws, deviceId: device.id, alive: true }
      this.clients.add(client)
      this.opts.onClients?.(this.clients.size)
      ws.on('pong', () => (client.alive = true))
      ws.on('close', () => {
        if (this.clients.delete(client)) this.opts.onClients?.(this.clients.size)
      })
      ws.on('error', () => ws.terminate())
      ws.send(JSON.stringify({ channel: 'hello', payload: { deviceId: device.id, role: device.role } }))
    })
  }

  private push(channel: IpcEvent, payload: unknown): void {
    if (!this.clients.size || DESKTOP_EVENTS.includes(channel)) return
    if (TERMINAL_EVENTS.includes(channel) && !this.opts.remoteTerminal()) return
    const scope = this.opts.scope
    if (!scope) return this.deliver(channel, payload)
    this.outbox = this.outbox.then(async () => {
      try {
        const shown = await scope(channel, payload)
        if (shown !== null) this.deliver(channel, shown)
      } catch (err) {
        // What can't be checked is not sent.
        console.error(`[server] not sending ${channel}:`, err)
      }
    })
  }

  private deliver(channel: IpcEvent, payload: unknown): void {
    // "Always allow" is only ever given at the desktop: devices are not offered it.
    const shown = channel === 'permission:request' ? { ...(payload as PermissionRequest), allowAlways: false } : payload
    // Search results (file contents) and inline edits go only to the device that asked (the desktop's to none).
    const only = TARGETED.includes(channel) ? ((payload as { device?: string }).device ?? null) : undefined
    const message = JSON.stringify({ channel, payload: shown })
    for (const client of this.clients) {
      if (only !== undefined && client.deviceId !== only) continue
      if (client.ws.readyState === client.ws.OPEN) client.ws.send(message)
    }
  }

  private sweep(): void {
    // Forget failed pairing attempts that left the rate-limit window.
    const now = Date.now()
    for (const [ip, times] of this.pairFailures) {
      if (times.every((t) => now - t >= PAIR_WINDOW_MS)) this.pairFailures.delete(ip)
    }
    for (const client of [...this.clients]) {
      if (!client.alive) {
        client.ws.terminate()
        continue
      }
      client.alive = false
      client.ws.ping()
    }
  }
}

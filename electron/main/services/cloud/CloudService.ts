import { randomUUID, type KeyObject } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  USABLE_STATES,
  type CloudAccount,
  type CloudLicense,
  type CloudStatus,
  type LicenseState
} from '@shared/types/cloud'
import type { SecretStore } from '../ai/SecretStore'
import { parsePublicKey, verifyEntitlement, type EntitlementClaims } from './entitlement'

/** The session token's name in the secret store (keychain on desktop). */
export const SESSION_SECRET = 'cloud.session'

const TICK_MS = 10_000
/** Pause after a failed call, and between re-checks while the cloud says no. */
const RETRY_MS = 30_000
/** A trial lease is renewed this long before it ends (it lasts 90 s). */
const RENEW_BEFORE_MS = 45_000
/** Lifetime: refreshed now and then (refunds, revocations), else valid offline. */
const LIFETIME_REFRESH_MS = 15 * 60_000

export interface CloudServiceOptions {
  baseUrl: string
  /** Entitlement key; without it the key is fetched from the cloud (and remembered). */
  publicKey?: string
  enforced: boolean
  /** How this core signs in: the desktop app, or a headless server/Docker core. */
  client: 'desktop' | 'server'
  version: string
  deviceName: string
  platform: string
  /** ~/Mindeck/data/cloud.json — account, last entitlement, install id. */
  file: string
  secrets: Pick<SecretStore, 'get' | 'set'>
  /** Someone is at this machine (desktop: not idle). Absent on a headless server. */
  isUserActive?: () => boolean
  onStatus: (status: CloudStatus) => void
  fetch?: typeof fetch
  now?: () => number
  /** A core run by the desktop app elsewhere: no sign-in of its own, it adopts the desktop's entitlement. */
  follower?: boolean
}

interface Persisted {
  installId: string
  account: CloudAccount | null
  license: CloudLicense | null
  entitlement: string | null
  publicKey: string | null
  webUrl: string | null
}

interface ApiUser {
  email: string
  name: string | null
}
interface ApiLicense {
  plan: 'trial' | 'lifetime'
  trial: { limitSeconds: number; usedSeconds: number; remainingSeconds: number }
}
interface AuthResponse {
  user: ApiUser
  license: ApiLicense
  session: { token: string }
}
interface HeartbeatResponse {
  license: ApiLicense
  entitlement: { token: string } | null
}
interface Meta {
  entitlementPublicKey: string
  webUrl: string
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

const toAccount = (u: ApiUser): CloudAccount => ({ email: u.email, name: u.name })
const toLicense = (l: ApiLicense): CloudLicense => ({
  plan: l.plan,
  trialLimitSeconds: l.trial.limitSeconds,
  trialUsedSeconds: l.trial.usedSeconds,
  trialRemainingSeconds: l.trial.remainingSeconds
})

/**
 * The license state from what the core knows. A fresh entitlement decides;
 * an active lease that ran out stays usable while the cloud is reachable
 * (nobody was using Mindeck, or the renewal is on its way); without the cloud
 * and without a valid entitlement, Mindeck waits.
 */
export function deriveState(i: {
  signedIn: boolean
  claims: EntitlementClaims | null
  now: number
  online: boolean
}): LicenseState {
  if (!i.signedIn) return 'signed_out'
  const c = i.claims
  if (c && !c.active) return c.reason === 'email_unverified' ? 'email_unverified' : 'trial_expired'
  if (c && c.exp * 1000 > i.now) return 'active'
  if (!i.online) return 'offline'
  return c ? 'paused' : 'checking'
}

/**
 * The core's link to Mindeck Cloud: sign-in, the trial heartbeat and the signed
 * entitlement that says whether Mindeck may run. The session token lives in the
 * secret store; the rest in cloud.json, so a lifetime license keeps working
 * offline after a restart.
 */
export class CloudService {
  private data: Persisted = {
    installId: '',
    account: null,
    license: null,
    entitlement: null,
    publicKey: null,
    webUrl: null
  }
  private claims: EntitlementClaims | null = null
  private key: KeyObject | null = null
  private online = true
  private error: string | null = null
  private lastAttempt = 0
  private lastSuccess = 0
  private remoteClients = 0
  private remoteSessions = 0
  private beating: Promise<void> | null = null
  private timer?: ReturnType<typeof setInterval>
  private lastEmitted = ''
  private readonly fetch: typeof fetch
  private readonly now: () => number

  constructor(private readonly opts: CloudServiceOptions) {
    this.fetch = opts.fetch ?? globalThis.fetch
    this.now = opts.now ?? Date.now
  }

  /** Loads the remembered account and entitlement; the first heartbeat runs in the background. */
  async init(): Promise<void> {
    this.data = { ...this.data, ...(await this.load()) }
    if (!this.data.installId) {
      this.data.installId = randomUUID()
      await this.save()
    }
    this.key = this.publicKey()
    this.claims = this.data.entitlement && this.key ? verifyEntitlement(this.data.entitlement, this.key) : null
    // A follower only ever hears from the desktop (cloud:adopt).
    if (this.opts.follower) return this.emit()
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref?.()
    void this.tick()
  }

  dispose(): void {
    clearInterval(this.timer)
  }

  status(): CloudStatus {
    const state = deriveState({
      signedIn: !!this.data.account,
      claims: this.claims,
      now: this.now(),
      // A follower never hears from the cloud: an entitlement that ran out locks it until the desktop hands over a new one.
      online: this.online && !this.opts.follower
    })
    return {
      enforced: this.opts.enforced,
      allowed: !this.opts.enforced || USABLE_STATES.includes(state),
      state,
      account: this.data.account,
      license: this.data.license,
      validUntil: this.claims ? new Date(this.claims.exp * 1000).toISOString() : null,
      online: this.online,
      webUrl: this.data.webUrl,
      error: this.error
    }
  }

  /** Paired devices connected right now — someone uses Mindeck through them. */
  setRemoteClients(count: number): void {
    this.remoteClients = count
  }

  /** Remote windows (SSH, Dev Containers) open right now — Mindeck is in use there, on this license. */
  setRemoteSessions(count: number): void {
    this.remoteSessions = count
  }

  /** Someone is using Mindeck: at this machine, through a connected device, or in a remote window. */
  private inUse(): boolean {
    return this.remoteClients > 0 || this.remoteSessions > 0 || (this.opts.isUserActive?.() ?? false)
  }

  /** May Mindeck be used right now? (The Router asks before every licensed call.) */
  allowed(): boolean {
    return this.status().allowed
  }

  async login(req: { email: string; password: string }): Promise<CloudStatus> {
    const res = await this.call<AuthResponse>('POST', '/v1/auth/login', { ...req, ...this.client() }, false)
    await this.signedIn(res)
    return this.status()
  }

  async register(req: { email: string; password: string; name?: string; locale: 'de' | 'en' }): Promise<CloudStatus> {
    const res = await this.call<AuthResponse>('POST', '/v1/auth/register', { ...req, ...this.client() }, false)
    await this.signedIn(res)
    return this.status()
  }

  async logout(): Promise<CloudStatus> {
    if (this.data.account) await this.call('POST', '/v1/auth/logout', {}).catch(() => {})
    await this.forget(null)
    return this.status()
  }

  /** Re-reads the account and renews the entitlement now ("check again"). */
  async refresh(): Promise<CloudStatus> {
    if (!this.data.account) return this.status()
    try {
      const me = await this.call<{ user: ApiUser; license: ApiLicense }>('GET', '/v1/me')
      this.data.account = toAccount(me.user)
      this.data.license = toLicense(me.license)
      await this.save()
    } catch (err) {
      this.note(err)
    }
    // Still signed in (the cloud may just have ended the session or disabled the account)?
    if (this.data.account) await this.beat()
    return this.status()
  }

  async resendVerification(): Promise<void> {
    await this.call('POST', '/v1/auth/resend-verification', {})
  }

  async forgotPassword(req: { email: string }): Promise<void> {
    await this.call('POST', '/v1/auth/forgot-password', req, false)
  }

  /** A Stripe Checkout for this account; the client opens the URL in a browser. */
  /** The entitlement a follower core (Remote-SSH, Dev Container) takes over — none while it isn't valid. */
  entitlement(): { token: string; account: CloudAccount } | null {
    const { entitlement, account } = this.data
    return entitlement && account && this.claims?.active && this.claims.exp * 1000 > this.now() ? { token: entitlement, account } : null
  }

  /** Follower: take the desktop's entitlement over (it must verify with Mindeck Cloud's key). */
  async adopt(token: string, account: CloudAccount): Promise<CloudStatus> {
    if (!this.opts.follower) throw coded('not-follower', 'This core signs in itself')
    if (!this.key) await this.ensureMeta().catch(() => {})
    const claims = this.key ? verifyEntitlement(token, this.key) : null
    if (!claims) throw coded('bad-entitlement', 'This entitlement cannot be verified')
    this.claims = claims
    this.data = { ...this.data, account, entitlement: token, license: null }
    this.error = null
    await this.save()
    this.emit()
    return this.status()
  }

  /** Signed in to a Mindeck account (the session may still turn out expired). */
  isSignedIn(): boolean {
    return !!this.data.account
  }

  /** An authenticated request to Mindeck Cloud's API (Settings Sync …). */
  api<T = unknown>(method: 'GET' | 'PUT' | 'DELETE', path: string, body?: object): Promise<T> {
    return this.call<T>(method, path, body)
  }

  async checkout(): Promise<{ url: string }> {
    const res = await this.call<{ url: string }>('POST', '/v1/billing/checkout', {})
    return { url: res.url }
  }

  // ── heartbeat ──────────────────────────────────────────────────────────

  /** Runs every 10 s: renews the entitlement when it is due, else re-checks the state. */
  async tick(): Promise<void> {
    if (this.data.account && this.due()) await this.beat()
    else this.emit()
  }

  private due(): boolean {
    const now = this.now()
    const rested = now - this.lastAttempt >= RETRY_MS
    const c = this.claims
    if (!c || !c.active) return rested
    if (c.plan === 'lifetime') return rested && now - this.lastSuccess >= LIFETIME_REFRESH_MS
    // Trial: only while someone uses Mindeck — that is what the 7 hours count.
    return c.exp * 1000 - now <= RENEW_BEFORE_MS && this.inUse() && (this.online || rested)
  }

  private beat(): Promise<void> {
    this.beating ??= (async () => {
      this.lastAttempt = this.now()
      try {
        await this.ensureMeta()
        const res = await this.call<HeartbeatResponse>('POST', '/v1/license/heartbeat', {
          appVersion: this.opts.version
        })
        this.data.license = toLicense(res.license)
        if (res.entitlement) {
          const claims = this.key ? verifyEntitlement(res.entitlement.token, this.key) : null
          if (!claims) throw coded('bad-entitlement', 'Mindeck Cloud sent an entitlement this core cannot verify')
          this.claims = claims
          this.data.entitlement = res.entitlement.token
        }
        await this.save()
        this.lastSuccess = this.now()
        this.error = null
      } catch (err) {
        this.note(err)
      } finally {
        this.beating = null
        this.emit()
      }
    })()
    return this.beating
  }

  // ── internals ──────────────────────────────────────────────────────────

  private client() {
    return {
      client: this.opts.client,
      device: {
        installId: this.data.installId,
        name: this.opts.deviceName,
        platform: this.opts.platform,
        appVersion: this.opts.version
      }
    }
  }

  private async signedIn(res: AuthResponse): Promise<void> {
    await this.opts.secrets.set(SESSION_SECRET, res.session.token)
    this.data.account = toAccount(res.user)
    this.data.license = toLicense(res.license)
    this.data.entitlement = null
    this.claims = null
    this.error = null
    await this.save()
    await this.beat()
  }

  /** Signed out (by choice, or the cloud no longer knows the session). */
  private async forget(error: string | null): Promise<void> {
    await this.opts.secrets.set(SESSION_SECRET, null)
    this.data = { ...this.data, account: null, license: null, entitlement: null }
    this.claims = null
    this.error = error
    await this.save()
    this.emit()
  }

  private note(err: unknown): void {
    this.error = (err as { code?: string }).code ?? 'error'
  }

  private publicKey(): KeyObject | null {
    const pem = this.opts.publicKey ?? this.data.publicKey
    if (!pem) return null
    try {
      return parsePublicKey(pem)
    } catch {
      return null
    }
  }

  /** The website URL and (unless built in) the entitlement key, once per run. */
  private async ensureMeta(): Promise<void> {
    if (this.key && this.data.webUrl) return
    const meta = await this.call<Meta>('GET', '/v1/meta', undefined, false)
    this.data.webUrl = meta.webUrl
    if (!this.opts.publicKey) this.data.publicKey = meta.entitlementPublicKey
    this.key = this.publicKey()
    await this.save()
  }

  private async call<T = unknown>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: object, auth = true): Promise<T> {
    const headers: Record<string, string> = {}
    if (body) headers['content-type'] = 'application/json'
    if (auth) {
      const token = await this.opts.secrets.get(SESSION_SECRET)
      if (!token) {
        await this.forget('session_expired')
        throw coded('session_expired', 'Please sign in again')
      }
      headers.authorization = `Bearer ${token}`
    }
    let res: Response
    try {
      res = await this.fetch(`${this.opts.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15_000)
      })
    } catch {
      this.online = false
      throw coded('cloud-unreachable', 'Mindeck Cloud is not reachable')
    }
    this.online = true
    const data = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } }
    if (res.ok) return data as T
    let code = data.error?.code ?? `http-${res.status}`
    if (auth && (res.status === 401 || code === 'account_disabled')) {
      // The cloud no longer accepts this session: sign out, and say why.
      code = res.status === 401 ? 'session_expired' : code
      await this.forget(code)
    }
    throw coded(code, data.error?.message ?? res.statusText)
  }

  private emit(): void {
    const status = this.status()
    const key = JSON.stringify(status)
    if (key === this.lastEmitted) return
    this.lastEmitted = key
    this.opts.onStatus(status)
  }

  private async load(): Promise<Partial<Persisted>> {
    try {
      const parsed = JSON.parse(await readFile(this.opts.file, 'utf8')) as Partial<Persisted>
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.opts.file), { recursive: true })
    const tmp = `${this.opts.file}.tmp`
    await writeFile(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 })
    await rename(tmp, this.opts.file)
  }
}

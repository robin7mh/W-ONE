// The Mindeck account as a core sees it: signed in with Mindeck Cloud, the trial
// clock and the lifetime license. The cloud decides; the core keeps a signed
// entitlement so it can check offline.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export type LicensePlan = 'trial' | 'lifetime'

/**
 * - `active`           licensed: trial time left, or lifetime (also offline, with
 *                      the lifetime license's offline certificate)
 * - `paused`           an active lease ran out while nobody used Mindeck —
 *                      renewed on the next heartbeat, so it stays usable. A
 *                      trial's only for 2 h once renewing it failed (cloud 5xx).
 * - `signed_out`       no Mindeck account on this core
 * - `checking`         signed in, waiting for the cloud's first answer
 * - `email_unverified` the trial starts once the email address is confirmed
 * - `trial_expired`    the 7 hours are used up
 * - `offline`          the cloud is unreachable and no valid entitlement is held
 */
export type LicenseState =
  | 'active'
  | 'paused'
  | 'signed_out'
  | 'checking'
  | 'email_unverified'
  | 'trial_expired'
  | 'offline'

/** States in which Mindeck may be used. */
export const USABLE_STATES: readonly LicenseState[] = ['active', 'paused']

export interface CloudAccount {
  email: string
  name: string | null
}

export interface CloudLicense {
  plan: LicensePlan
  trialLimitSeconds: number
  trialUsedSeconds: number
  trialRemainingSeconds: number
}

export interface CloudStatus {
  /** This core requires a license (packaged app / production server). Dev runs don't. */
  enforced: boolean
  /** Mindeck may be used right now. */
  allowed: boolean
  state: LicenseState
  account: CloudAccount | null
  license: CloudLicense | null
  /** End of the current entitlement (trial lease, lifetime offline window or certificate), ISO time. */
  validUntil: string | null
  /** The last call to the cloud went through. */
  online: boolean
  /** The Mindeck website (create account, buy, manage) — known once the cloud answered. */
  webUrl: string | null
  /** Code of the last cloud error (the UI translates it). */
  error: string | null
}

/** Channels that work without a license: everything the sign-in screen needs, app updates and the desktop app's diagnostics. */
export function isLicenseFree(channel: string): boolean {
  return channel.startsWith('cloud:') || channel.startsWith('update:') || channel.startsWith('desktop:') || channel === 'app:info'
}

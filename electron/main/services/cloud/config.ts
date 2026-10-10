// Release builds bake the cloud's address and entitlement key in at build
// time: WONE_CLOUD_URL / WONE_CLOUD_KEY → `define` (electron.vite.config.ts,
// vite.server.config.ts). Absent in dev and tests.
declare const __WONE_CLOUD_URL__: string | undefined
declare const __WONE_CLOUD_KEY__: string | undefined

/** `npm run dev` in W-ONE-Cloud. */
export const DEV_CLOUD_URL = 'http://localhost:8080'

export interface CloudConfig {
  url: string
  /** Entitlement public key; without one the core fetches it from the cloud. */
  publicKey?: string
  /** Whether W-ONE needs a license to run here. */
  enforced: boolean
}

export function bakedCloud(): { url?: string; key?: string } {
  return {
    url: typeof __WONE_CLOUD_URL__ === 'string' && __WONE_CLOUD_URL__ ? __WONE_CLOUD_URL__ : undefined,
    key: typeof __WONE_CLOUD_KEY__ === 'string' && __WONE_CLOUD_KEY__ ? __WONE_CLOUD_KEY__ : undefined
  }
}

/**
 * Where this core finds W-ONE Cloud and whether a license is required.
 * `release` = the packaged desktop app or the production server image: always
 * enforced, always the baked-in cloud. Dev and test runs are open by default
 * (`WONE_LICENSE=required` turns the gate on) and may point elsewhere via
 * WONE_CLOUD_URL / WONE_CLOUD_KEY.
 */
export function cloudConfig(release: boolean, env: NodeJS.ProcessEnv = process.env, baked = bakedCloud()): CloudConfig {
  const url = (release ? baked.url : env.WONE_CLOUD_URL || baked.url) || DEV_CLOUD_URL
  const publicKey = release ? baked.key : env.WONE_CLOUD_KEY || baked.key
  return {
    url: url.replace(/\/+$/, ''),
    ...(publicKey ? { publicKey } : {}),
    enforced: release || env.WONE_LICENSE === 'required'
  }
}

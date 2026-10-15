// Release builds bake the cloud's address and entitlement key in at build
// time: MINDECK_CLOUD_URL / MINDECK_CLOUD_KEY → `define` (electron.vite.config.ts,
// vite.server.config.ts). Absent in dev and tests.
declare const __MINDECK_CLOUD_URL__: string | undefined
declare const __MINDECK_CLOUD_KEY__: string | undefined

/** `npm run dev` in mindeck-cloud. */
export const DEV_CLOUD_URL = 'http://localhost:8080'

export interface CloudConfig {
  url: string
  /** Entitlement public key; without one the core fetches it from the cloud. */
  publicKey?: string
  /** Whether Mindeck needs a license to run here. */
  enforced: boolean
  /**
   * A core the desktop app runs on another machine (Remote-SSH, Dev Container):
   * it doesn't sign in itself but takes the desktop's signed entitlement over.
   */
  follower?: boolean
}

export function bakedCloud(): { url?: string; key?: string } {
  return {
    url: typeof __MINDECK_CLOUD_URL__ === 'string' && __MINDECK_CLOUD_URL__ ? __MINDECK_CLOUD_URL__ : undefined,
    key: typeof __MINDECK_CLOUD_KEY__ === 'string' && __MINDECK_CLOUD_KEY__ ? __MINDECK_CLOUD_KEY__ : undefined
  }
}

/**
 * A release build: one with Mindeck Cloud baked in. Decided when it is built —
 * no variable at run time can turn a release into an unlicensed dev core.
 */
export function isReleaseBuild(baked = bakedCloud()): boolean {
  return !!baked.url
}

/**
 * The `define`s that bake Mindeck Cloud into a build (vite.server.config.ts).
 * A cloud without its entitlement key is refused: the core would otherwise
 * trust whatever key the network hands it on the first start.
 */
export function cloudDefines(env: NodeJS.ProcessEnv = process.env): { __MINDECK_CLOUD_URL__: string; __MINDECK_CLOUD_KEY__: string } {
  const url = env.MINDECK_CLOUD_URL ?? ''
  const key = env.MINDECK_CLOUD_KEY ?? ''
  if (url && !key) throw new Error('MINDECK_CLOUD_URL is set without MINDECK_CLOUD_KEY: a release build needs the entitlement key built in')
  return { __MINDECK_CLOUD_URL__: JSON.stringify(url), __MINDECK_CLOUD_KEY__: JSON.stringify(key) }
}

/**
 * Where this core finds Mindeck Cloud and whether a license is required.
 * `release` = the packaged desktop app or a server built with the cloud baked in: always
 * enforced, always the baked-in cloud. Dev and test runs are open by default
 * (`MINDECK_LICENSE=required` turns the gate on) and may point elsewhere via
 * MINDECK_CLOUD_URL / MINDECK_CLOUD_KEY.
 */
export function cloudConfig(release: boolean, env: NodeJS.ProcessEnv = process.env, baked = bakedCloud()): CloudConfig {
  const url = (release ? baked.url : env.MINDECK_CLOUD_URL || baked.url) || DEV_CLOUD_URL
  const publicKey = release ? baked.key : env.MINDECK_CLOUD_KEY || baked.key
  return {
    url: url.replace(/\/+$/, ''),
    ...(publicKey ? { publicKey } : {}),
    enforced: release || env.MINDECK_LICENSE === 'required' || env.MINDECK_LICENSE === 'follower',
    ...(env.MINDECK_LICENSE === 'follower' ? { follower: true } : {})
  }
}

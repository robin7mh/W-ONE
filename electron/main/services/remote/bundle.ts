import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Where release builds publish the server packages (next to the app's own release). */
export const RELEASES = 'https://github.com/robin7mh/W-ONE/releases/download'

export interface BundleOptions {
  version: string
  /** Downloaded packages: <dataDir>/remote. */
  dir: string
  /** Packages `npm run remote:bundle` built (dev runs). */
  devDir?: string
  fetch?: typeof fetch
}

/** The server package for an architecture: built locally, downloaded before, or downloaded now. */
export async function remoteBundle(arch: 'x64' | 'arm64', opts: BundleOptions): Promise<string> {
  const name = `wone-server-${opts.version}-linux-${arch}.tar.gz`
  for (const dir of [opts.dir, opts.devDir]) if (dir && existsSync(join(dir, name))) return join(dir, name)
  const { fetch: get } = { fetch: globalThis.fetch, ...opts }
  const res = await get(`${RELEASES}/v${opts.version}/${name}`)
  if (!res.ok || !res.body) throw coded('remote-bundle', `No W-ONE server package for linux-${arch} (HTTP ${res.status}) — dev: npm run remote:bundle`)
  await mkdir(opts.dir, { recursive: true })
  const file = join(opts.dir, name)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(`${file}.part`))
  await rename(`${file}.part`, file)
  return file
}

/** `remoteBundle` with the options bound — what RemoteService asks for a package. */
export const bundleSource =
  (opts: BundleOptions) =>
  (arch: 'x64' | 'arm64'): Promise<string> =>
    remoteBundle(arch, opts)

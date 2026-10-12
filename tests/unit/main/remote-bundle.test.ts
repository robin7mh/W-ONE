import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from './helpers'
import { bundleSource, RELEASES, remoteBundle } from '../../../electron/main/services/remote/bundle'

describe('the server package', () => {
  it('found where it was downloaded before, or where `npm run remote:bundle` put it', async () => {
    const dir = await tempDir()
    const dev = await tempDir()
    const name = 'wone-server-1.0.0-linux-arm64.tar.gz'
    await writeFile(join(dev, name), 'dev')
    const fetch = vi.fn()
    expect(await remoteBundle('arm64', { version: '1.0.0', dir, devDir: dev, fetch })).toBe(join(dev, name))
    await writeFile(join(dir, name), 'downloaded')
    expect(await bundleSource({ version: '1.0.0', dir, devDir: dev, fetch })('arm64')).toBe(join(dir, name))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('otherwise downloaded from the release (once); a missing one says how to build it', async () => {
    const dir = join(await tempDir(), 'remote')
    const fetch = vi.fn(async () => new Response('TARBALL', { status: 200 }))
    const file = await remoteBundle('x64', { version: '2.0.0', dir, fetch })
    expect(fetch).toHaveBeenCalledWith(`${RELEASES}/v2.0.0/wone-server-2.0.0-linux-x64.tar.gz`)
    expect(await readFile(file, 'utf8')).toBe('TARBALL')
    const missing = vi.fn(async () => new Response('nope', { status: 404 }))
    await expect(remoteBundle('arm64', { version: '2.0.0', dir, fetch: missing })).rejects.toMatchObject({ code: 'remote-bundle', message: expect.stringContaining('HTTP 404') })
    const empty = vi.fn(async () => ({ ok: true, status: 200, body: null }) as unknown as Response)
    await expect(remoteBundle('arm64', { version: '2.0.0', dir, fetch: empty })).rejects.toMatchObject({ code: 'remote-bundle' })
  })
})

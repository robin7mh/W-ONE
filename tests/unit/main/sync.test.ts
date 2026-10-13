import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './helpers'
import { SyncService } from '../../../electron/main/services/cloud/SyncService'
import type { AppSettings } from '@shared/types/settings'

/** A Mindeck account's sync endpoint in memory (with the server's version check). */
function account(signedIn = true) {
  let copy: { version: number; data: Record<string, unknown>; updatedAt: string; device: { id: string; name: string | null } | null } | null = null
  const calls: string[] = []
  const cloud = {
    isSignedIn: () => signedIn,
    api: async <T>(method: string, _path: string, body?: { data: Record<string, unknown>; baseVersion: number }): Promise<T> => {
      calls.push(method)
      if (method === 'GET') return { sync: copy } as T
      if ((copy?.version ?? 0) !== body!.baseVersion) throw Object.assign(new Error('Settings were changed on another device'), { code: 'sync_conflict' })
      copy = { version: body!.baseVersion + 1, data: body!.data, updatedAt: '2026-10-13T00:00:00.000Z', device: { id: 'd', name: 'Studio' } }
      return { sync: copy } as T
    }
  }
  return { cloud, calls, copy: () => copy, set: (c: typeof copy) => void (copy = c) }
}

async function machine(cloud: ReturnType<typeof account>['cloud'], initial: AppSettings = {}, snippets?: string) {
  const dir = await tempDir('mindeck-sync-')
  const snippetsFile = join(dir, 'snippets.json')
  if (snippets !== undefined) await writeFile(snippetsFile, snippets)
  let settings: AppSettings = { ...initial }
  const store = { get: () => ({ ...settings }), update: async (patch: Partial<AppSettings>) => (settings = { ...settings, ...patch }) }
  const svc = new SyncService({ cloud, settings: store, snippetsFile, now: () => new Date('2026-10-13T12:00:00Z') })
  return { svc, settings: () => settings, snippetsFile }
}

describe('Settings Sync', () => {
  it('signed out: a status that says so; saving and loading need the account', async () => {
    const a = account(false)
    const m = await machine(a.cloud)
    expect(await m.svc.status()).toEqual({ signedIn: false, remote: null, local: null })
    await expect(m.svc.push({})).rejects.toMatchObject({ code: 'session_expired' })
    await expect(m.svc.pull()).rejects.toMatchObject({ code: 'session_expired' })
    expect(a.calls).toEqual([])
  })

  it('one machine saves its editor settings, snippets, look and language; another loads them', async () => {
    const a = account()
    const first = await machine(a.cloud, { editor: { fontSize: 15, keybindings: [{ key: 'cmd+k', command: 'x' }] } }, '[{"prefix":"rafce","body":"x","languages":["javascript"]}]')
    expect(await first.svc.status()).toEqual({ signedIn: true, remote: null, local: null })
    const status = await first.svc.push({ appearance: { mode: 'light' }, locale: 'en' })
    expect(status).toEqual({ signedIn: true, remote: { version: 1, updatedAt: '2026-10-13T00:00:00.000Z', device: 'Studio' }, local: { version: 1, syncedAt: '2026-10-13T12:00:00.000Z' } })
    expect(a.copy()!.data).toEqual({ schema: 1, editor: { fontSize: 15, keybindings: [{ key: 'cmd+k', command: 'x' }] }, snippets: [{ prefix: 'rafce', body: 'x', languages: ['javascript'] }], appearance: { mode: 'light' }, locale: 'en' })
    // Saving again goes on from there.
    await first.svc.push({})
    expect(a.copy()!.version).toBe(2)

    const second = await machine(a.cloud, { vaultRoot: '/v' })
    expect(await second.svc.pull()).toEqual({ appearance: undefined, locale: undefined })
    expect(second.settings()).toMatchObject({ vaultRoot: '/v', editor: { fontSize: 15 }, sync: { version: 2 } })
    expect(JSON.parse(await readFile(second.snippetsFile, 'utf8'))).toHaveLength(1)
  })

  it('saving over a copy changed elsewhere is a conflict — unless forced; nothing to load says so', async () => {
    const a = account()
    const m = await machine(a.cloud)
    await expect(m.svc.pull()).rejects.toMatchObject({ code: 'sync-empty' })
    a.set({ version: 4, data: { schema: 1 }, updatedAt: 'x', device: null })
    await expect(m.svc.push({})).rejects.toMatchObject({ code: 'sync_conflict' })
    expect((await m.svc.push({ locale: 'de' }, true)).local).toMatchObject({ version: 5 })
    expect((await m.svc.status()).remote).toMatchObject({ device: 'Studio' })
    // A copy without a device (removed since), and loading one without editor settings or snippets.
    a.set({ version: 6, data: { schema: 1, locale: 'de' }, updatedAt: 'x', device: null })
    expect((await m.svc.status()).remote).toMatchObject({ device: null })
    expect(await m.svc.pull()).toEqual({ appearance: undefined, locale: 'de' })
    expect(m.settings().editor).toBeUndefined()
    // Forcing with nothing in the account starts at version 1.
    a.set(null)
    expect((await m.svc.push({}, true)).local).toMatchObject({ version: 1 })
  })

  it('snippets that aren’t a list (or are broken) go up as none', async () => {
    for (const text of ['{"not": "a list"}', '{broken']) {
      const a = account()
      const m = await machine(a.cloud, {}, text)
      await m.svc.push({})
      expect(a.copy()!.data.snippets).toEqual([])
    }
    // The real clock stamps the sync.
    let saved: AppSettings = {}
    const real = new SyncService({ cloud: account().cloud, settings: { get: () => saved, update: async (p) => (saved = { ...saved, ...p }) }, snippetsFile: '/nowhere/snippets.json' })
    await real.push({})
    expect(Date.parse(saved.sync!.syncedAt)).toBeGreaterThan(0)
  })
})

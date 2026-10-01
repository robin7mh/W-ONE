import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { EventBus, NoopEventSink, type EventSink } from '../../../electron/main/services/events/EventBus'
import { SettingsService } from '../../../electron/main/services/settings/SettingsService'
import { ProjectRegistry } from '../../../electron/main/services/projects/registry'
import { ContextStore } from '../../../electron/main/services/context/contextStore'
import { MIGRATIONS } from '../../../electron/main/services/db/migrations'
import { EVENT_CATALOG } from '@shared/types/events'
import type { Project } from '@shared/types/project'
import type { ProjectContext } from '@shared/types/context'
import { tempDir } from './helpers'

describe('EventBus', () => {
  it('fills defaults, notifies typed and wildcard listeners, persists and broadcasts', () => {
    const persist = vi.fn()
    const broadcast = vi.fn()
    const bus = new EventBus({ sink: { persist }, broadcast })
    const typed = vi.fn()
    const any = vi.fn()
    bus.subscribe('app.started', typed)
    bus.subscribe('*', any)

    const event = bus.emit('app.started')
    expect(event).toMatchObject({ type: 'app.started', actor: { kind: 'system' }, payload: {} })
    expect(event.id).toMatch(/[0-9a-f-]{36}/)
    expect(typed).toHaveBeenCalledWith(event)
    expect(any).toHaveBeenCalledWith(event)
    expect(persist).toHaveBeenCalledWith(event, 'activity')
    expect(broadcast).toHaveBeenCalledWith(event)
  })

  it('keeps explicit input and works without a broadcast hook', () => {
    const bus = new EventBus({ sink: new NoopEventSink() })
    const event = bus.emit('db.migrated', {
      actor: { kind: 'user', id: 'u1' },
      subject: { kind: 'project', id: 'p1' },
      projectId: 'p1',
      payload: { to: 3 }
    })
    expect(event).toMatchObject({ actor: { kind: 'user', id: 'u1' }, projectId: 'p1', payload: { to: 3 } })
  })

  it('isolates failing listeners and sinks, and unsubscribes', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sink: EventSink = {
      persist: () => {
        throw new Error('disk full')
      }
    }
    const bus = new EventBus({ sink })
    const bad = vi.fn(() => {
      throw new Error('boom')
    })
    const good = vi.fn()
    const off = bus.subscribe('app.started', bad)
    bus.subscribe('app.started', good)

    bus.emit('app.started')
    expect(good).toHaveBeenCalledTimes(1)
    expect(errors).toHaveBeenCalledTimes(2) // listener + sink

    off()
    bus.emit('app.started')
    expect(bad).toHaveBeenCalledTimes(1)
  })

  it('never persists ephemeral events', () => {
    const persist = vi.fn()
    const catalog = EVENT_CATALOG as Record<string, string>
    const original = catalog['app.started']
    catalog['app.started'] = 'ephemeral'
    try {
      new EventBus({ sink: { persist } }).emit('app.started')
      expect(persist).not.toHaveBeenCalled()
    } finally {
      catalog['app.started'] = original
    }
  })
})

describe('SettingsService', () => {
  it('starts empty, persists updates atomically and reloads them', async () => {
    const dir = await tempDir()
    const file = join(dir, 'nested', 'settings.json')
    const s = new SettingsService(file)
    await s.init()
    await s.init() // idempotent
    expect(s.get()).toEqual({})

    expect(await s.update({ vaultRoot: '/v' })).toEqual({ vaultRoot: '/v' })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ version: 1, settings: { vaultRoot: '/v' } })

    const again = new SettingsService(file)
    await again.init()
    expect(again.get()).toEqual({ vaultRoot: '/v' })
  })

  it('falls back to defaults on corrupt or settings-less files', async () => {
    const dir = await tempDir()
    const corrupt = join(dir, 'a.json')
    await writeFile(corrupt, '{nope')
    const a = new SettingsService(corrupt)
    await a.init()
    expect(a.get()).toEqual({})

    const empty = join(dir, 'b.json')
    await writeFile(empty, JSON.stringify({ version: 1 }))
    const b = new SettingsService(empty)
    await b.init()
    expect(b.get()).toEqual({})
  })
})

describe('ProjectRegistry', () => {
  const project = (id: string, path = `/p/${id}`): Project => ({
    id,
    name: id,
    path,
    addedAt: 'a',
    lastSeenAt: 'b'
  })

  it('loads, upserts, finds and removes with atomic persistence', async () => {
    const dir = await tempDir()
    const reg = new ProjectRegistry(join(dir, 'data'))
    await reg.load()
    await reg.load() // idempotent
    expect(reg.all()).toEqual([])

    await reg.upsert(project('a'))
    await reg.upsert(project('b'))
    await reg.upsert({ ...project('a'), name: 'renamed' })
    expect(reg.all().map((p) => p.name)).toEqual(['renamed', 'b'])
    expect(reg.get('b')?.id).toBe('b')
    expect(reg.findByPath('/p/b')?.id).toBe('b')
    expect(reg.get('zzz')).toBeUndefined()

    await reg.remove('a')
    const reloaded = new ProjectRegistry(join(dir, 'data'))
    await reloaded.load()
    expect(reloaded.all().map((p) => p.id)).toEqual(['b'])
  })

  it('treats corrupt or malformed files as empty', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'projects.json'), JSON.stringify({ projects: 'nope' }))
    const reg = new ProjectRegistry(dir)
    await reg.load()
    expect(reg.all()).toEqual([])

    await writeFile(join(dir, 'projects.json'), 'garbage')
    const reg2 = new ProjectRegistry(dir)
    await reg2.load()
    expect(reg2.all()).toEqual([])
  })
})

describe('ContextStore', () => {
  it('returns null when missing and round-trips saved context', async () => {
    const dir = await tempDir()
    const store = new ContextStore(dir)
    expect(await store.get('p1')).toBeNull()
    const ctx = { projectId: 'p1', generatedAt: 'now' } as unknown as ProjectContext
    expect(await store.save(ctx)).toBe(ctx)
    expect(await store.get('p1')).toEqual(ctx)
    await mkdir(join(dir, 'context'), { recursive: true })
  })
})

describe('migrations', () => {
  it('starts with no domain migrations (P2B adds the first)', () => {
    expect(MIGRATIONS).toEqual([])
  })
})

import { request } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { tick } from './helpers'
import { LocalAgentServer, type LocalHandlers } from '../../../electron/main/services/agents/LocalAgentServer'

let server: LocalAgentServer | undefined
afterEach(async () => {
  await server?.close()
  server = undefined
})

async function start(handlers: Partial<LocalHandlers> = {}) {
  const h: LocalHandlers = {
    hook: vi.fn(async (_id, body) => ({ echo: body })),
    mcp: vi.fn(async (_id, body) => ({ jsonrpc: '2.0', id: 1, result: body })),
    ...handlers
  }
  server = new LocalAgentServer(h)
  await server.start()
  await server.start() // idempotent
  return { h, s: server }
}

/** Raw request, so tests can forge Host/Origin and stream odd bodies. */
function raw(port: number, opts: { method?: string; path: string; headers?: Record<string, string>; body?: string; setHost?: boolean }) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: opts.method ?? 'POST', path: opts.path, headers: opts.headers, setHost: opts.setHost }, (res) => {
      let body = ''
      res.on('data', (d) => (body += d))
      res.on('end', () => resolve({ status: res.statusCode!, body }))
    })
    req.on('error', reject)
    req.end(opts.body)
  })
}

describe('LocalAgentServer', () => {
  it('routes hooks and MCP per session with its token', async () => {
    const { h, s } = await start({ mcp: vi.fn(async (_id, body) => ((body as { id?: number }).id ? { ok: 1 } : undefined)) })
    const token = s.register('sess-1')
    expect(s.port).toBeGreaterThan(0)
    expect(s.url('hooks', 'sess-1')).toBe(`http://127.0.0.1:${s.port}/hooks/sess-1`)
    const post = (route: 'hooks' | 'mcp', body: unknown, auth = `Bearer ${token}`) =>
      fetch(s.url(route, 'sess-1'), { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

    const hook = await post('hooks', { hook_event_name: 'Stop' })
    expect(hook.status).toBe(200)
    expect(await hook.json()).toEqual({ echo: { hook_event_name: 'Stop' } })
    expect(h.hook).toHaveBeenCalledWith('sess-1', { hook_event_name: 'Stop' }, expect.any(AbortSignal))

    expect((await post('mcp', { jsonrpc: '2.0', id: 1, method: 'ping' })).status).toBe(200)
    expect((await post('mcp', { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)

    expect((await post('hooks', {}, 'Bearer wrong')).status).toBe(401)
    expect((await post('hooks', {}, `Bearer ${token}x`)).status).toBe(401)
    expect((await post('hooks', {}, '')).status).toBe(401)
    s.unregister('sess-1')
    expect((await post('hooks', {})).status).toBe(401)
  })

  it('answers 204 when a hook has no decision, 500 when the handler fails', async () => {
    const { s } = await start({
      hook: vi.fn(async (_id, body) => {
        if ((body as { fail?: boolean }).fail) throw new Error('boom')
        return undefined
      })
    })
    const token = s.register('a')
    const post = (body: unknown) => fetch(s.url('hooks', 'a'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
    expect((await post({})).status).toBe(204)
    const failed = await post({ fail: true })
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'boom' })
  })

  it('refuses foreign hosts and origins, wrong paths and methods, bad bodies', async () => {
    const { s } = await start()
    const token = s.register('a')
    const auth = { Authorization: `Bearer ${token}` }
    const port = s.port
    expect((await raw(port, { path: '/hooks/a', headers: { ...auth, Host: 'evil.example:80' }, body: '{}' })).status).toBe(403)
    expect((await raw(port, { path: '/hooks/a', headers: { ...auth, Origin: 'https://evil.example' }, body: '{}' })).status).toBe(403)
    expect((await raw(port, { path: '/hooks/a', headers: { ...auth, Origin: `http://localhost:${port}` }, body: '{}' })).status).toBe(200)
    expect((await raw(port, { path: '/hooks/a', headers: auth, body: '{}', setHost: false })).status).toBe(400) // no Host: Node itself refuses
    expect((await raw(port, { path: '/hooks/a', body: '{}' })).status).toBe(401) // no Authorization header
    expect((await raw(port, { path: '/nope/a', headers: auth, body: '{}' })).status).toBe(404)
    expect((await raw(port, { path: '/hooks/a?x=1', method: 'GET', headers: auth })).status).toBe(405)
    expect((await raw(port, { path: '/hooks/a', headers: auth, body: '{not json' })).status).toBe(400)
    const big = await raw(port, { path: '/hooks/a', headers: auth, body: 'x'.repeat(17 * 1024 * 1024) }).catch((e: Error) => ({ status: 0, body: e.message }))
    expect([413, 0]).toContain(big.status) // the socket may close before the answer arrives
  })

  it('aborts a waiting hook when the agent hangs up', async () => {
    let seen: AbortSignal | undefined
    const { s } = await start({
      hook: (_id, _body, signal) =>
        new Promise((resolve) => {
          seen = signal
          signal.addEventListener('abort', () => resolve({ late: true }))
        })
    })
    const token = s.register('a')
    const ctrl = new AbortController()
    const pending = fetch(s.url('hooks', 'a'), { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}', signal: ctrl.signal }).catch(() => 'aborted')
    while (!seen) await tick(5)
    ctrl.abort()
    expect(await pending).toBe('aborted')
    await tick(20)
    expect(seen.aborted).toBe(true)
  })

  it('reports port 0 before start and closes idempotently', async () => {
    const s = new LocalAgentServer({ hook: vi.fn(), mcp: vi.fn() })
    expect(s.port).toBe(0)
    await s.close()
  })
})

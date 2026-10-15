import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../../../electron/main/services/ai/tools/registry'
import { createMcpHandler, MEMORY_TOOLS } from '../../../electron/main/services/agents/mcp'
import type { ToolDefinition } from '../../../electron/main/services/ai/tools/types'

const tool = (name: string, run: ToolDefinition<{ q: string }>['run']): ToolDefinition<never> =>
  ({ name, title: name, description: `${name} tool`, risk: 'read', schema: z.object({ q: z.string() }), summarize: () => name, run }) as never

describe('Mindeck MCP server', () => {
  const runs = vi.fn(async ({ q }: { q: string }, ctx: { projectId?: string }) => `found ${q} in ${ctx.projectId}`)
  const registry = new ToolRegistry([
    tool('memory_search', runs),
    tool('memory_read', async () => {
      throw new Error('note not found')
    }),
    tool('shell_run', async () => 'never offered')
  ])
  const handle = createMcpHandler(registry, '1.2.3', ['memory_search', 'memory_read'])
  const onCall = vi.fn()
  const ctx = { projectId: 'p1', onCall }
  const rpc = (method: string, params?: Record<string, unknown>) => handle(ctx, { jsonrpc: '2.0', id: 1, method, params })

  it('initializes, pings and ignores notifications', async () => {
    expect(await rpc('initialize', { protocolVersion: '2025-03-26' })).toMatchObject({
      jsonrpc: '2.0',
      id: 1,
      result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mindeck', version: '1.2.3' } }
    })
    expect(await rpc('initialize')).toMatchObject({ result: { protocolVersion: '2025-06-18' } })
    expect(await rpc('ping')).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect(await handle(ctx, { jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined()
  })

  it('lists only the offered tools with JSON Schema inputs', async () => {
    const res = (await rpc('tools/list')) as { result: { tools: { name: string; inputSchema: { properties: object } }[] } }
    expect(res.result.tools.map((t) => t.name)).toEqual(['memory_search', 'memory_read'])
    expect(res.result.tools[0].inputSchema.properties).toHaveProperty('q')
  })

  it('calls tools in the session project; errors come back as tool errors', async () => {
    expect(await rpc('tools/call', { name: 'memory_search', arguments: { q: 'auth' } })).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'found auth in p1' }] }
    })
    expect(onCall).toHaveBeenCalledWith('memory_search', { q: 'auth' })
    expect(await rpc('tools/call', { name: 'memory_search' })).toMatchObject({ result: { isError: true } }) // invalid input
    expect(await rpc('tools/call', { name: 'memory_read', arguments: { q: 'x' } })).toMatchObject({
      result: { content: [{ text: 'note not found' }], isError: true }
    })
    expect(await rpc('tools/call', { name: 'shell_run', arguments: { q: 'rm' } })).toMatchObject({ error: { code: -32602 } })
    expect(await rpc('tools/call')).toMatchObject({ error: { code: -32602, message: 'Unknown tool: undefined' } })
  })

  it('rejects malformed messages and unknown methods', async () => {
    expect(await handle(ctx, null)).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } })
    expect(await handle(ctx, { jsonrpc: '1.0', id: 3, method: 'ping' })).toMatchObject({ id: 3, error: { code: -32600 } })
    expect(await handle(ctx, { jsonrpc: '2.0', id: 4 })).toMatchObject({ error: { code: -32600 } })
    expect(await rpc('resources/list')).toMatchObject({ error: { code: -32601 } })
  })

  it('works without a call observer and defaults to the memory tool set', async () => {
    const plain = createMcpHandler(registry, '1')
    expect(await plain({ projectId: 'p' }, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'memory_search', arguments: { q: 'x' } } })).toMatchObject({
      result: { content: [{ text: 'found x in p' }] }
    })
    expect(MEMORY_TOOLS).toContain('project_context')
  })
})

describe('Mindeck MCP server · pictures and who calls', () => {
  it('passes the calling agent on and returns images where a tool has them', async () => {
    const seen = vi.fn()
    const shot = {
      ...(tool('browser_screenshot', async () => 'text only') as object),
      runContent: async (_input: unknown, ctx: { agent?: string }) => {
        seen(ctx.agent)
        return [
          { type: 'text', text: 'Shop — http://localhost:5173/' },
          { type: 'image', data: 'cG5n', mimeType: 'image/png' }
        ]
      }
    } as unknown as ToolDefinition<never>
    const handle = createMcpHandler(new ToolRegistry([shot]), '1.0.0', ['browser_screenshot'])
    const res = await handle({ projectId: 'p1', agent: 'Claude Code' }, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'browser_screenshot', arguments: { q: '' } } })
    expect(res).toEqual({
      jsonrpc: '2.0',
      id: 9,
      result: { content: [{ type: 'text', text: 'Shop — http://localhost:5173/' }, { type: 'image', data: 'cG5n', mimeType: 'image/png' }] }
    })
    expect(seen).toHaveBeenCalledWith('Claude Code')
  })
})


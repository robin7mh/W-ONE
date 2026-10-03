import type { ToolRegistry } from '../ai/tools/registry'

/** W-ONE's memory, offered to every coding agent: the vault and the session's project. */
export const MEMORY_TOOLS = ['memory_search', 'memory_read', 'memory_list', 'memory_create_note', 'memory_append', 'project_context']

const PROTOCOL = '2025-06-18'

const INSTRUCTIONS =
  "W-ONE is the user's workspace and memory. Its vault holds project knowledge, decisions and journals of earlier agent sessions. " +
  'Search it before larger changes, and record decisions worth keeping.'

interface JsonRpc {
  jsonrpc?: string
  id?: string | number | null
  method?: string
  params?: Record<string, unknown>
}

export interface McpSessionContext {
  projectId: string
  /** A tool ran (to show which notes the agent used). */
  onCall?: (tool: string, input: Record<string, unknown>) => void
}

const error = (id: JsonRpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/**
 * A minimal, stateless MCP server (JSON-RPC over Streamable HTTP, plain JSON
 * answers): `initialize`, `ping`, `tools/list`, `tools/call`. The tools are
 * the assistant's own built-ins; the agent asks the user before write tools
 * run (Claude Code → PermissionRequest hook → W-ONE approval).
 */
export function createMcpHandler(registry: ToolRegistry, version: string, names: string[] = MEMORY_TOOLS) {
  return async (ctx: McpSessionContext, message: unknown): Promise<unknown> => {
    const msg = (message ?? {}) as JsonRpc
    if (typeof message !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
      return error(msg.id, -32600, 'Invalid JSON-RPC request')
    }
    if (msg.id === undefined) return undefined // a notification: nothing to answer
    const ok = (result: unknown) => ({ jsonrpc: '2.0', id: msg.id, result })

    switch (msg.method) {
      case 'initialize':
        return ok({
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'w-one', version },
          instructions: INSTRUCTIONS
        })
      case 'ping':
        return ok({})
      case 'tools/list':
        return ok({ tools: registry.forModel(names).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) })
      case 'tools/call': {
        const name = String(msg.params?.name)
        const tool = names.includes(name) ? registry.get(name) : undefined
        if (!tool) return error(msg.id, -32602, `Unknown tool: ${name}`)
        const input = (msg.params?.arguments ?? {}) as Record<string, unknown>
        const parsed = registry.parse(tool, input)
        if (!parsed.ok) return ok({ content: [{ type: 'text', text: parsed.message }], isError: true })
        try {
          const text = await tool.run(parsed.data, { projectId: ctx.projectId, signal: new AbortController().signal })
          ctx.onCall?.(name, input)
          return ok({ content: [{ type: 'text', text }] })
        } catch (err) {
          return ok({ content: [{ type: 'text', text: (err as Error).message }], isError: true })
        }
      }
      default:
        return error(msg.id, -32601, `Method not found: ${msg.method}`)
    }
  }
}

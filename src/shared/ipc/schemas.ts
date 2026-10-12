// Runtime validation for every request payload (MASTERPLAN §D: Zod at the
// boundary). The desktop IPC and the network API both validate here before a
// handler runs — over the network the payload is untrusted input.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

import { z } from 'zod'
import { GRAPH_COLORS } from '@shared/types/memory'
import { EFFORTS } from '@shared/types/ai'
import type { IpcChannel, IpcChannels } from './contract'

const id = z.string().min(1).max(200)
const path = z.string().min(1).max(4096)
const notePath = z.string().min(1).max(1024)
const title = z.string().max(500)
const text = (max: number) => z.string().max(max)
const none = z.void()
const email = z.string().trim().min(3).max(254)

const pos = z.object({ line: z.number().int().min(1), offset: z.number().int().min(1) })
const at = z.object({ projectId: id, path, line: z.number().int().min(1), offset: z.number().int().min(1) })

const breakpoint = z.object({ path, line: z.number().int().min(1) })

type Schemas = { [K in IpcChannel]: z.ZodType<IpcChannels[K]['request']> }

/** Request schema per channel. Unknown object keys are stripped. */
export const REQUEST_SCHEMAS: Schemas = {
  'projects:list': none,
  'projects:pickFolder': none,
  'projects:add': z.object({ path }),
  'projects:remove': z.object({ id }),
  'projects:refresh': z.object({ id }),
  'projects:pull': z.object({ id }),
  'projects:openInEditor': z.object({ id }),
  'projects:githubDesktop': none,
  'projects:openInGitHubDesktop': z.object({ id }),
  'projects:openFile': z.object({ id, file: path, line: z.number().int().min(0).optional() }),

  'system:subscribe': none,
  'system:unsubscribe': none,
  'system:snapshot': none,
  'system:user': none,

  'context:get': z.object({ projectId: id }),
  'context:reindex': z.object({ projectId: id }),

  'memory:status': none,
  'memory:createVault': none,
  'memory:pickVault': none,
  'memory:list': none,
  'memory:read': z.object({ path: notePath }),
  'memory:write': z.object({ path: notePath, raw: text(6 * 1024 * 1024) }),
  'memory:create': z.object({ title, folder: text(1024).optional() }),
  'memory:trash': z.object({ path: notePath }),
  'memory:graph': none,
  'memory:search': z.object({ query: text(1000) }),
  'memory:setGraphStyle': z.object({ mode: z.enum(['colorful', 'single']), color: z.enum(GRAPH_COLORS) }),
  'memory:reveal': none,
  'memory:folders': none,
  'memory:writeBody': z.object({ path: notePath, body: text(6 * 1024 * 1024) }),
  'memory:createFolder': z.object({ parent: text(1024), name: title }),
  'memory:rename': z.object({ path: notePath, title }),
  'memory:move': z.object({ path: notePath, folder: text(1024) }),
  'memory:moveFolder': z.object({ folder: text(1024), into: text(1024) }),
  'memory:link': z.object({ from: notePath, to: notePath }),
  'memory:unlink': z.object({ from: notePath, to: notePath }),
  'memory:setVault': z.object({ path }),

  'terminal:create': z
    .object({ projectId: id.optional(), cols: z.number().optional(), rows: z.number().optional() })
    .optional()
    .transform((v) => v ?? {}),
  'terminal:list': none,
  'terminal:attach': z.object({ id }),
  'terminal:write': z.object({ id, data: text(1024 * 1024) }),
  'terminal:resize': z.object({ id, cols: z.number(), rows: z.number() }),
  'terminal:kill': z.object({ id }),

  'files:list': z.object({ projectId: id, dir: text(4096).optional() }),
  'files:read': z.object({ projectId: id, path }),
  'files:stat': z.object({ projectId: id, paths: z.array(path).max(200) }),
  'files:write': z.object({ projectId: id, path, content: text(6 * 1024 * 1024), expectedMtime: z.number().optional() }),
  'files:create': z.object({ projectId: id, path, kind: z.enum(['file', 'dir']) }),
  'files:rename': z.object({ projectId: id, from: path, to: path }),
  'files:delete': z.object({ projectId: id, path }),

  'scm:status': z.object({ projectId: id }),
  'scm:init': z.object({ projectId: id }),
  'scm:stage': z.object({ projectId: id, paths: z.array(path).min(1).max(5000) }),
  'scm:unstage': z.object({ projectId: id, paths: z.array(path).min(1).max(5000) }),
  'scm:discard': z.object({ projectId: id, paths: z.array(path).min(1).max(5000) }),
  'scm:commit': z.object({ projectId: id, message: text(20_000), amend: z.boolean().optional(), all: z.boolean().optional() }),
  'scm:fetch': z.object({ projectId: id }),
  'scm:pull': z.object({ projectId: id }),
  'scm:push': z.object({ projectId: id }),
  'scm:branches': z.object({ projectId: id }),
  'scm:checkout': z.object({ projectId: id, name: z.string().min(1).max(250) }),
  'scm:createBranch': z.object({ projectId: id, name: z.string().min(1).max(250) }),
  'scm:log': z.object({ projectId: id, limit: z.number().int().min(1).max(2000).optional() }),
  'scm:show': z.object({ projectId: id, hash: z.string().regex(/^[0-9a-f]{4,40}$/i) }),
  'scm:diff': z.object({
    projectId: id,
    path,
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('unstaged') }),
      z.object({ kind: z.literal('staged') }),
      z.object({ kind: z.literal('commit'), hash: z.string().regex(/^[0-9a-f]{4,40}$/i), from: path.optional() })
    ])
  }),
  'scm:original': z.object({ projectId: id, path }),
  'scm:files': z.object({ projectId: id }),
  'scm:search': z.object({ projectId: id, query: text(500), regex: z.boolean().optional(), caseSensitive: z.boolean().optional() }),

  'lsp:open': z.object({ projectId: id, path, text: text(6 * 1024 * 1024) }),
  'lsp:change': z.object({ projectId: id, path, text: text(6 * 1024 * 1024) }),
  'lsp:close': z.object({ projectId: id, path }),
  'lsp:diagnostics': z.object({ projectId: id, paths: z.array(path).max(200) }),
  'lsp:hover': at,
  'lsp:completions': at.extend({ trigger: z.string().max(2).optional() }),
  'lsp:completionDetails': at.extend({ name: z.string().max(1000), source: z.string().max(4096).optional(), data: z.unknown().optional() }),
  'lsp:definition': at,
  'lsp:references': at,
  'lsp:rename': at.extend({ newName: z.string().min(1).max(1000) }),
  'lsp:signature': at,
  'lsp:codeFixes': z.object({ projectId: id, path, range: z.object({ start: pos, end: pos }), errorCodes: z.array(z.number().int()).max(100) }),

  'debug:start': z.object({
    projectId: id,
    program: path,
    args: z.array(text(4096)).max(100).optional(),
    stopOnEntry: z.boolean().optional(),
    breakpoints: z.array(breakpoint).max(1000)
  }),
  'debug:stop': none,
  'debug:session': none,
  'debug:control': z.object({ action: z.enum(['continue', 'pause', 'stepOver', 'stepInto', 'stepOut']) }),
  'debug:setBreakpoints': z.object({ projectId: id, breakpoints: z.array(breakpoint).max(1000) }),
  'debug:variables': z.object({ objectId: z.string().min(1).max(500) }),
  'debug:evaluate': z.object({ expression: text(10_000), frameId: z.string().max(500).optional() }),

  'app:info': none,
  'fs:dirs': z
    .object({ path: path.optional() })
    .optional()
    .transform((v) => v ?? {}),

  'server:status': none,
  'server:configure': z.object({
    enabled: z.boolean().optional(),
    lan: z.boolean().optional(),
    port: z.number().int().min(1024).max(65535).optional(),
    remoteTerminal: z.boolean().optional()
  }),
  'server:createPairingCode': none,
  'server:devices': none,
  'server:revokeDevice': z.object({ id }),

  'ai:status': none,
  'ai:setKey': z.object({ key: z.string().min(1).max(500) }),
  'ai:clearKey': none,
  'ai:configure': z.object({ model: z.string().min(1).max(100).optional(), effort: z.enum(EFFORTS).optional() }),
  'ai:agents': none,
  'ai:tools': none,
  'ai:conversations': none,
  'ai:conversation': z.object({ id }),
  'ai:send': z.object({
    conversationId: id.optional(),
    agentId: id.optional(),
    projectId: id.optional(),
    text: z.string().trim().min(1).max(100_000)
  }),
  'ai:cancel': z.object({ conversationId: id }),
  'ai:deleteConversation': z.object({ id }),
  'ai:runs': z
    .object({ limit: z.number().int().min(1).max(200).optional() })
    .optional()
    .transform((v) => v ?? {}),

  'permission:pending': none,
  'permission:respond': z.object({ id, decision: z.enum(['once', 'always', 'deny']) }),
  'permission:grants': none,
  'permission:revoke': z.object({ agentId: id, toolName: id }),

  'agents:detect': none,
  'agents:list': none,
  'agents:get': z.object({ id }),
  'agents:create': z.object({
    kind: z.enum(['claude-code', 'codex', 'gemini']),
    projectId: id,
    title: text(200).optional(),
    isolated: z.boolean().optional(),
    prompt: text(100_000).optional()
  }),
  'agents:send': z.object({ id, text: z.string().min(1).max(100_000) }),
  'agents:interrupt': z.object({ id }),
  'agents:stop': z.object({ id }),
  'agents:resume': z.object({ id }),
  'agents:remove': z.object({ id }),
  'agents:changes': z.object({ id }),
  'agents:branch': z.object({ id }),
  'agents:diff': z.object({ id, path }),
  'agents:accept': z.object({ id }),
  'agents:discard': z.object({ id }),
  'agents:rename': z.object({ id, title: z.string().trim().min(1).max(200) }),
  'agents:shell': z.object({ id }),
  'agents:openInEditor': z.object({ id }),

  'cloud:status': none,
  'cloud:login': z.object({ email, password: z.string().min(1).max(200) }),
  'cloud:register': z.object({
    email,
    password: z.string().min(10).max(200),
    name: z.string().trim().min(1).max(100).optional(),
    locale: z.enum(['de', 'en'])
  }),
  'cloud:logout': none,
  'cloud:refresh': none,
  'cloud:resendVerification': none,
  'cloud:forgotPassword': z.object({ email }),
  'cloud:checkout': none,

  'update:status': none,
  'update:check': none,
  'update:install': none,

  'events:recent': z
    .object({ limit: z.number().int().min(1).max(500).optional(), conversationId: id.optional() })
    .optional()
    .transform((v) => v ?? {})
}

/**
 * Validates a request. `void` channels accept undefined/null (a JSON body of
 * `null` from a remote client). Returns the parsed payload or a readable error.
 */
export function parseRequest<K extends IpcChannel>(
  channel: K,
  payload: unknown
): { ok: true; data: IpcChannels[K]['request'] } | { ok: false; message: string } {
  const res = REQUEST_SCHEMAS[channel].safeParse(payload === null ? undefined : payload)
  if (res.success) return { ok: true, data: res.data as IpcChannels[K]['request'] }
  const issue = res.error.issues[0]
  const where = issue.path.length ? `${issue.path.join('.')}: ` : ''
  return { ok: false, message: `Invalid request for ${channel} — ${where}${issue.message}` }
}

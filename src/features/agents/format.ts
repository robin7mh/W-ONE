import type { WoneEvent } from '@shared/types/events'

/** "just now", "5 min ago", "3 h ago", else a short date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso))
  if (diff < 45_000) return 'just now'
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} h ago`
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })
}

export type Tone = 'cyan' | 'ok' | 'warn' | 'error' | 'muted'

interface P {
  agent?: string
  goal?: string
  tool?: string
  summary?: string
  error?: string
  status?: string
  text?: string
  decision?: string
  reason?: string
  iterations?: number
  outputTokens?: number
  title?: string
  code?: number
}

/** One line per event for the activity timeline — what happened, in plain words. */
export function describeEvent(e: WoneEvent): { text: string; tone: Tone } {
  const p = (e.payload ?? {}) as P
  switch (e.type) {
    case 'agent.started':
      return { text: `${p.agent ?? 'Agent'} started: ${p.goal ?? ''}`.trim(), tone: 'cyan' }
    case 'agent.status.updated':
      return { text: p.text ?? 'Working', tone: 'muted' }
    case 'agent.completed':
      return { text: `Run completed · ${p.iterations ?? 0} steps · ${p.outputTokens ?? 0} tokens out`, tone: 'ok' }
    case 'agent.failed':
      return { text: `Run ${p.status === 'timeout' ? 'timed out' : 'failed'}${p.error ? `: ${p.error}` : ''}`, tone: 'error' }
    case 'agent.cancelled':
      return { text: 'Run cancelled', tone: 'warn' }
    case 'tool.started':
      return { text: p.summary ?? `Tool ${p.tool}`, tone: 'cyan' }
    case 'tool.completed':
      return { text: `Done: ${p.summary ?? p.tool}`, tone: 'ok' }
    case 'tool.failed':
      return { text: `Failed: ${p.summary ?? p.tool}${p.error ? ` — ${p.error}` : ''}`, tone: 'error' }
    case 'tool.denied':
      return { text: `Blocked: ${p.summary ?? p.tool}${p.reason && p.reason !== 'user' ? ` (${p.reason})` : ''}`, tone: 'warn' }
    case 'permission.requested':
      return { text: `Approval requested: ${p.summary ?? p.tool}`, tone: 'warn' }
    case 'permission.granted':
      return { text: `Approved (${p.decision === 'always' ? 'always' : 'once'}): ${p.tool}`, tone: 'ok' }
    case 'permission.denied':
      return { text: `Denied: ${p.tool}`, tone: 'error' }
    case 'db.migrated':
      return { text: 'Database schema updated', tone: 'muted' }
    case 'session.started':
      return { text: `${p.agent ?? 'Agent'} started: ${p.title ?? ''}`.trim(), tone: 'cyan' }
    case 'session.ended':
      return { text: `Session ended${p.code ? ` (exit code ${p.code})` : ''}`, tone: p.code ? 'warn' : 'muted' }
    default:
      return { text: e.type, tone: 'muted' }
  }
}

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

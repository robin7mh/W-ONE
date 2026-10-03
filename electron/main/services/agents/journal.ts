import type { ChatMessage } from '@shared/types/ai'
import type { AgentSession, FileChange } from '@shared/types/agents'

const AGENT_NAMES: Record<AgentSession['kind'], string> = { 'claude-code': 'Claude Code', codex: 'Codex', gemini: 'Gemini CLI' }

const pad = (n: number) => String(n).padStart(2, '0')

/** "2026-10-03 1542 Fix login" — sorts by time in the vault, local clock. */
export function journalTitle(session: Pick<AgentSession, 'createdAt' | 'title'>): string {
  const d = new Date(session.createdAt)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())} ${session.title}`
}

const texts = (messages: ChatMessage[], role: ChatMessage['role']) =>
  messages.filter((m) => m.role === role).flatMap((m) => m.parts.flatMap((p) => (p.type === 'text' && p.text.trim() ? [p.text.trim()] : [])))

/**
 * The session's journal in the vault: what was asked, what came out, which
 * files changed and what is still open — so the next agent (any vendor) can
 * pick up where this one stopped. Null while there is nothing to record.
 */
export function journalBody(session: AgentSession, messages: ChatMessage[], changes: FileChange[]): string | null {
  const asked = texts(messages, 'user')
  if (!asked.length) return null
  const answers = texts(messages, 'assistant')
  const open = session.plan.filter((p) => !p.done)
  const lines = [
    `**Agent:** ${AGENT_NAMES[session.kind]} · **Projekt:** ${session.projectName} · **Ordner:** \`${session.cwd}\`${session.branch ? ` (Branch \`${session.branch}\`)` : ''}`,
    '',
    '## Auftrag',
    '',
    ...asked.map((t, i) => (i === 0 ? t : `- ${t.split('\n')[0]}`)),
    '',
    '## Ergebnis',
    '',
    answers.length ? answers[answers.length - 1] : '_(noch keine Antwort)_',
    '',
    '## Geänderte Dateien',
    '',
    ...(changes.length ? changes.map((c) => `- \`${c.path}\` (${c.status === 'added' ? 'neu' : c.status === 'deleted' ? 'gelöscht' : `+${c.added} −${c.removed}`})`) : ['_(keine)_'])
  ]
  if (open.length) lines.push('', '## Offen', '', ...open.map((p) => `- [ ] ${p.text}`))
  return `${lines.join('\n')}\n`
}

interface JournalVault {
  status(): Promise<{ exists: boolean }>
  create(title: string, folder?: string): Promise<{ path: string }>
  writeBody(path: string, body: string): Promise<{ path: string }>
}

/**
 * Writes a session journal into the vault: rewrites its note when it still
 * exists, else creates one (also when the user deleted it). Without a vault
 * there is no journal — W-ONE never creates a vault on its own.
 */
export function vaultJournal(vault: JournalVault) {
  return async (folder: string, title: string, path: string | undefined, body: string): Promise<string | undefined> => {
    if (!(await vault.status()).exists) return undefined
    if (path) {
      const kept = await vault.writeBody(path, body).catch(() => null)
      if (kept) return kept.path
    }
    const note = await vault.create(title, folder)
    await vault.writeBody(note.path, body)
    return note.path
  }
}

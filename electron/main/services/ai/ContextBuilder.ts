import type { Project } from '@shared/types/project'
import type { ProjectContext } from '@shared/types/context'
import type { SearchHit, VaultStatus } from '@shared/types/memory'

const BUDGET = 12_000

export interface ContextDeps {
  user(): Promise<{ name: string }>
  projects(): Project[]
  projectContext(id: string): Promise<ProjectContext | null>
  vaultStatus(): Promise<VaultStatus>
  search(query: string): Promise<SearchHit[]>
  now?: () => Date
}

/**
 * The context engine (architecture §6): assembles what the model should know
 * for this turn — time, user, the active project's structure and matching
 * memory notes — most valuable first, under a hard character budget. Purely
 * deterministic; nothing here calls a model. Rendered as one <context> block
 * in the user turn so the cached system prompt and history stay stable.
 */
export class ContextBuilder {
  constructor(private readonly deps: ContextDeps) {}

  async build(query: string, projectId?: string): Promise<string> {
    const sections: string[] = []
    const now = (this.deps.now ?? (() => new Date()))()
    const user = await this.deps.user().catch(() => ({ name: '' }))
    sections.push(
      `Now: ${now.toISOString()} (${Intl.DateTimeFormat().resolvedOptions().timeZone})${user.name ? ` · User: ${user.name}` : ''}`
    )

    const project = projectId ? this.deps.projects().find((p) => p.id === projectId) : undefined
    if (project) sections.push(await this.projectSection(project))

    const vault = await this.deps.vaultStatus().catch(() => null)
    if (vault?.exists) {
      const hits = await this.deps.search(query.slice(0, 200)).catch(() => [] as SearchHit[])
      const lines = hits.slice(0, 6).map((h) => `- ${h.path}: ${h.snippet}`)
      sections.push(
        `Memory vault "${vault.name}" (${vault.noteCount} notes)${lines.length ? `. Notes matching the message:\n${lines.join('\n')}` : ' — no note matches this message.'}`
      )
    } else {
      sections.push('Memory vault: not set up yet.')
    }

    let text = sections.join('\n\n')
    if (text.length > BUDGET) text = `${text.slice(0, BUDGET)}\n… [context truncated]`
    return `<context>\n${text}\n</context>`
  }

  private async projectSection(p: Project): Promise<string> {
    const git = p.git?.isRepo
      ? `git ${p.git.branch ?? 'detached'}${p.git.dirty ? ', uncommitted changes' : ''}${p.git.lastCommit ? `, last commit "${p.git.lastCommit.subject}"` : ''}`
      : 'no git'
    const stack = [...(p.stack?.languages ?? []), ...(p.stack?.frameworks ?? [])].join(', ')
    const lines = [`Active project: ${p.name} (id ${p.id}) at ${p.path} — ${git}${stack ? `; stack: ${stack}` : ''}`]
    const ctx = await this.deps.projectContext(p.id).catch(() => null)
    if (ctx) {
      lines.push(`Indexed ${ctx.fileCount} files; ${ctx.todos.length} TODO markers${ctx.readme?.title ? `; README "${ctx.readme.title}"` : ''}`)
      if (ctx.packageJson?.scripts.length) lines.push(`Scripts: ${ctx.packageJson.scripts.join(', ')}`)
    } else {
      lines.push('Not indexed yet — the project_context tool builds an overview.')
    }
    return lines.join('\n')
  }
}

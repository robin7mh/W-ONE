import type { AgentRun } from '@shared/types/ai'
import type { Queryable } from '../events/EventLog'

const MAX_LIMIT = 200

function fromRow(r: Record<string, unknown>): AgentRun {
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    conversationId: String(r.conversation_id),
    goal: String(r.goal),
    ...(r.project_id ? { projectId: String(r.project_id) } : {}),
    model: String(r.model),
    status: r.status as AgentRun['status'],
    startedAt: new Date(r.started_at as string).toISOString(),
    ...(r.ended_at ? { endedAt: new Date(r.ended_at as string).toISOString() } : {}),
    iterations: Number(r.iterations),
    inputTokens: Number(r.input_tokens),
    outputTokens: Number(r.output_tokens),
    ...(r.error ? { error: String(r.error) } : {})
  }
}

/**
 * Agent runs (architecture §7): kept in memory for the live view and written
 * to the Postgres `agent_runs` table when a database is attached.
 */
export class RunStore {
  private readonly runs = new Map<string, AgentRun>()
  private db: Queryable | null = null

  constructor(private readonly capacity = 200) {}

  attach(db: Queryable | null): void {
    this.db = db
  }

  /** Insert or update; storage errors are logged, never thrown into the run. */
  async save(run: AgentRun): Promise<void> {
    this.runs.delete(run.id)
    this.runs.set(run.id, { ...run })
    while (this.runs.size > this.capacity) this.runs.delete(this.runs.keys().next().value as string)
    if (!this.db) return
    try {
      await this.db.query(
        `INSERT INTO agent_runs (id, agent_id, conversation_id, goal, project_id, model, status, started_at, ended_at, iterations, input_tokens, output_tokens, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, ended_at = EXCLUDED.ended_at, iterations = EXCLUDED.iterations,
           input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens, error = EXCLUDED.error, model = EXCLUDED.model`,
        [
          run.id,
          run.agentId,
          run.conversationId,
          run.goal,
          run.projectId ?? null,
          run.model,
          run.status,
          run.startedAt,
          run.endedAt ?? null,
          run.iterations,
          run.inputTokens,
          run.outputTokens,
          run.error ?? null
        ]
      )
    } catch (err) {
      console.warn(`[runs] could not store run ${run.id}: ${(err as Error).message}`)
    }
  }

  /** Newest first; from the database when attached. */
  async list(limit = 50): Promise<AgentRun[]> {
    const n = Math.max(1, Math.min(MAX_LIMIT, Math.floor(limit)))
    if (this.db) {
      try {
        return (await this.db.query('SELECT * FROM agent_runs ORDER BY started_at DESC LIMIT $1', [n])).map(fromRow)
      } catch (err) {
        console.warn(`[runs] history query failed, using memory: ${(err as Error).message}`)
      }
    }
    return [...this.runs.values()].reverse().slice(0, n)
  }
}

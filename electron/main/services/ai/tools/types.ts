import type { z } from 'zod'
import type { ToolRisk } from '@shared/types/ai'

/** What a tool may use — injected, so tools never reach for fs/child_process themselves. */
export interface ToolContext {
  /** Project the conversation is scoped to, if any. */
  projectId?: string
  signal: AbortSignal
}

/**
 * A tool the agents can call (architecture §8). Tools call existing services
 * — every capability exists exactly once. Write/execute tools carry a
 * required `reason` the user sees in the approval prompt.
 */
export interface ToolDefinition<I = unknown> {
  name: string
  title: string
  description: string
  risk: ToolRisk
  schema: z.ZodType<I>
  /** JSON Schema sent to the model (generated from `schema`). */
  inputSchema?: Record<string, unknown>
  /** Plain-words summary for the approval prompt and the activity log. */
  summarize(input: I): string
  run(input: I, ctx: ToolContext): Promise<string>
}

import { z } from 'zod'
import type { ToolInfo } from '@shared/types/ai'
import type { LlmTool } from '../llm'
import type { ToolDefinition } from './types'

/**
 * The one list of tools agents can call (architecture §8): JSON Schema for
 * the model, runtime validation of whatever the model sends back.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition<never>>()

  constructor(tools: ToolDefinition<never>[]) {
    for (const t of tools) this.tools.set(t.name, t)
  }

  get(name: string): ToolDefinition<never> | undefined {
    return this.tools.get(name)
  }

  info(): ToolInfo[] {
    return [...this.tools.values()].map(({ name, title, description, risk }) => ({ name, title, description, risk }))
  }

  /** Model-facing definitions for the given names (unknown names are skipped). */
  forModel(names: string[]): LlmTool[] {
    return names.flatMap((name) => {
      const t = this.tools.get(name)
      if (!t) return []
      const schema = t.inputSchema ?? (z.toJSONSchema(t.schema as z.ZodType) as Record<string, unknown>)
      const { $schema: _drop, ...inputSchema } = schema
      return [{ name: t.name, description: t.description, inputSchema }]
    })
  }

  /** Validates model output against the tool's schema. */
  parse(tool: ToolDefinition<never>, input: unknown): { ok: true; data: never } | { ok: false; message: string } {
    const res = (tool.schema as z.ZodType).safeParse(input)
    if (res.success) return { ok: true, data: res.data as never }
    const issue = res.error.issues[0]
    return { ok: false, message: `Invalid input for ${tool.name}: ${issue.path.join('.') || 'input'} — ${issue.message}` }
  }
}

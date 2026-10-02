// Provider-neutral model interface (architecture §6.1). The assistant, the
// context engine and the agent runtime only know these types; a provider
// adapter translates them to and from its wire format. Nothing outside the
// adapter imports a provider SDK.

import type { Effort } from '@shared/types/ai'

export type LlmBlock =
  | { type: 'text'; text: string; raw?: unknown }
  | { type: 'tool_call'; id: string; name: string; input: unknown; raw?: unknown }
  | { type: 'tool_result'; callId: string; content: string; isError?: boolean }
  /** A provider block replayed unchanged (reasoning, server tools, markers). */
  | { type: 'opaque'; data: unknown }

export interface LlmMessage {
  role: 'user' | 'assistant'
  blocks: LlmBlock[]
}

export interface LlmTool {
  name: string
  description: string
  /** JSON Schema of the input object. */
  inputSchema: Record<string, unknown>
}

export interface LlmRequest {
  model: string
  effort: Effort
  system: string
  messages: LlmMessage[]
  tools: LlmTool[]
  /** Provider-hosted web search + fetch. */
  webTools: boolean
  maxTokens: number
  signal?: AbortSignal
}

export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'pause_turn' | 'other'

/** A tool the provider ran itself (web search/fetch), for display only. */
export interface ServerToolCall {
  id: string
  name: string
  input: unknown
  output?: string
}

export interface LlmTurn {
  message: LlmMessage
  stopReason: StopReason
  /** The model that actually answered (may be a fallback model). */
  model: string
  usage: { inputTokens: number; outputTokens: number }
  serverTools: ServerToolCall[]
}

export interface LlmProvider {
  /** One model turn, streaming visible text through `onText`. */
  stream(req: LlmRequest, onText: (text: string) => void): Promise<LlmTurn>
}

/** Error with a machine-readable code that crosses the IPC boundary. */
export function aiError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

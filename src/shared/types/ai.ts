// The assistant and its agents (architecture §6–§9): models, conversations,
// tool calls and permission requests as every client sees them.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export interface ModelOption {
  id: string
  label: string
  note: string
}

/** Models the assistant offers. The first one is the default. */
export const MODELS: readonly ModelOption[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'Most capable · default' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'Faster · lower cost' }
]

export interface AiSettings {
  model: string
  effort: Effort
}

export const DEFAULT_AI_SETTINGS: AiSettings = { model: 'claude-opus-5-5', effort: 'high' }

export interface AiStatus {
  /** An API key is available. */
  configured: boolean
  /** Where the key comes from: the environment wins over the stored one. */
  source: 'env' | 'stored' | null
  /** Last four characters, for recognition only. */
  keyHint?: string
  settings: AiSettings
}

// --- tools & permissions ------------------------------------------------------

/** read: no side effects · write: changes data · execute: runs commands. */
export type ToolRisk = 'read' | 'write' | 'execute'

export interface ToolInfo {
  name: string
  title: string
  description: string
  risk: ToolRisk
}

export interface AgentInfo {
  id: string
  name: string
  description: string
  /** Tool names this agent may call (allowlist). */
  tools: string[]
  /** Uses Anthropic-hosted web search/fetch. */
  web: boolean
}

export type ToolCallStatus = 'pending' | 'awaiting-approval' | 'running' | 'done' | 'error' | 'denied'

export interface ToolCallPart {
  type: 'tool'
  id: string
  name: string
  title: string
  risk: ToolRisk
  input: unknown
  status: ToolCallStatus
  /** Result text (truncated for display). */
  output?: string
  /** Pending approval, if any. */
  requestId?: string
  /** Executed on Anthropic's servers (web search/fetch). */
  server?: boolean
}

export type ChatPart = { type: 'text'; text: string } | ToolCallPart

export type ChatRole = 'user' | 'assistant'
export type ChatStatus = 'streaming' | 'done' | 'error' | 'cancelled'

export interface ChatMessage {
  id: string
  role: ChatRole
  parts: ChatPart[]
  createdAt: string
  status: ChatStatus
  error?: string
  model?: string
  usage?: { inputTokens: number; outputTokens: number }
}

export interface ConversationSummary {
  id: string
  title: string
  agentId: string
  projectId?: string
  createdAt: string
  updatedAt: string
  /** A run is in progress. */
  running: boolean
}

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[]
}

export type RunStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout'

export interface AgentRun {
  id: string
  agentId: string
  conversationId: string
  goal: string
  projectId?: string
  model: string
  status: RunStatus
  startedAt: string
  endedAt?: string
  iterations: number
  inputTokens: number
  outputTokens: number
  error?: string
}

export type ApprovalDecision = 'once' | 'always' | 'deny'

export interface PermissionRequest {
  id: string
  runId: string
  conversationId: string
  agentId: string
  agentName: string
  toolName: string
  toolTitle: string
  risk: ToolRisk
  /** What exactly will happen, in plain words. */
  summary: string
  /** Why the agent wants it (from the agent). */
  reason: string
  input: unknown
  /** "Always allow" is offered for write tools only, never for execute. */
  allowAlways: boolean
  createdAt: string
}

export interface PermissionGrant {
  agentId: string
  toolName: string
  createdAt: string
}

/** Streaming text for the message currently being written. */
export interface AiDelta {
  conversationId: string
  messageId: string
  text: string
}

/** A message changed structurally (new part, tool status, finished). */
export interface AiMessageUpdate {
  conversationId: string
  message: ChatMessage
  running: boolean
}

export interface SendRequest {
  conversationId?: string
  agentId?: string
  projectId?: string
  text: string
}

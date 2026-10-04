// The agent cockpit: coding agents the user already has (Claude Code, Codex,
// Gemini CLI) run as their own programs; W-ONE shows each session as a chat
// with tool cards, approvals, the changes it made and what it remembered.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

import type { ChatMessage } from './ai'

export type AgentKind = 'claude-code' | 'codex' | 'gemini'

/** What the core found on this machine for one agent. */
export interface AgentAvailability {
  kind: AgentKind
  name: string
  installed: boolean
  version?: string
  /** Signed in (where the CLI can tell), and how — e.g. "Pro plan", "API key". */
  signedIn?: boolean
  account?: string
  /** W-ONE can run it as a session (installed + an integration exists). */
  ready: boolean
  /** What to do when it isn't ready. */
  hint?: string
}

/**
 * starting → working ⇄ approval → idle (waiting for the user's next message);
 * waiting = the agent asked for input; ended = process gone (can be resumed).
 */
export type SessionStatus = 'starting' | 'working' | 'approval' | 'waiting' | 'idle' | 'ended' | 'error'

export interface PlanItem {
  id: string
  text: string
  done: boolean
}

export interface FileChange {
  path: string
  status: 'added' | 'modified' | 'deleted'
  added: number
  removed: number
}

export interface AgentSession {
  id: string
  kind: AgentKind
  projectId: string
  projectName: string
  title: string
  /** Where the agent works: the project, or its own worktree. */
  cwd: string
  isolated: boolean
  worktree?: string
  branch?: string
  /** The project's repo page (GitHub, GitLab, …) from its `origin` remote. */
  repoUrl?: string
  status: SessionStatus
  /** The agent's process is running (messages can be sent). */
  live: boolean
  /** The PTY running the agent (Claude Code), for "Terminal ▸" — ACP agents have none. */
  terminalId?: string
  plan: PlanItem[]
  /** Vault notes the agent read or wrote through W-ONE's memory tools. */
  notes: string[]
  /** The session's journal note in the vault. */
  journal?: string
  createdAt: string
  updatedAt: string
  error?: string
}

export interface AgentSessionDetail extends AgentSession {
  messages: ChatMessage[]
}

export interface CreateSessionRequest {
  kind: AgentKind
  projectId: string
  title?: string
  /** Own git worktree (parallel work) instead of the project folder. */
  isolated?: boolean
  /** First message, sent once the agent is up. */
  prompt?: string
}

export interface AgentMessageUpdate {
  sessionId: string
  message: ChatMessage
}

export interface FileDiff {
  path: string
  original: string
  modified: string
}

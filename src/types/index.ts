import type { LucideIcon } from 'lucide-react'

export type ModuleId =
  | 'core'
  | 'terminal'
  | 'projects'
  | 'memory'
  | 'agents'
  | 'system'
  | 'settings'

export interface NavItem {
  id: ModuleId
  label: string
  icon: LucideIcon
  /** Modules that are not yet built get a subtle "soon" marker. */
  ready: boolean
}

export type AgentState = 'online' | 'standby' | 'idle' | 'offline'

export interface Agent {
  id: string
  name: string
  role: string
  state: AgentState
  icon: LucideIcon
  /** 0..1 load indicator for the mini bar. */
  load: number
}

export type EventLevel = 'info' | 'ok' | 'warn' | 'error'

export interface SystemEvent {
  id: string
  time: string
  level: EventLevel
  source: string
  message: string
}

export interface CommandEntry {
  id: string
  time: string
  command: string
  status: 'done' | 'active' | 'queued'
}

export interface ProcessRow {
  pid: number
  name: string
  cpu: number
  mem: number
}

export interface QuickAction {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  accent?: 'cyan' | 'blue' | 'purple' | 'amber'
}

export type MetricKind = 'cpu' | 'ram' | 'disk' | 'network' | 'battery'

export interface MetricSample {
  /** current value, 0..100 (percent) or absolute for network */
  value: number
  /** rolling history for the sparkline */
  history: number[]
}

export type Metrics = Record<MetricKind, MetricSample>

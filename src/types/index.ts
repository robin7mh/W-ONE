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
}

export interface ProcessRow {
  pid: number
  name: string
  cpu: number
  mem: number
}

export type MetricKind = 'cpu' | 'ram' | 'disk' | 'network' | 'battery'

export interface MetricSample {
  /** current value, 0..100 (percent) or absolute for network */
  value: number
  /** rolling history for the sparkline */
  history: number[]
}

export type Metrics = Record<MetricKind, MetricSample>

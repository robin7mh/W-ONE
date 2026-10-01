import { Play, ScanLine, Save, Radio, Sparkles, Power } from 'lucide-react'
import type { QuickAction } from '@/types'

/** Decorative-only in this phase — each button just logs / pulses. */
export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'run', label: 'New Objective', hint: '⌘N', icon: Sparkles, accent: 'cyan' },
  { id: 'scan', label: 'Scan Context', hint: '⌘K', icon: ScanLine, accent: 'blue' },
  { id: 'session', label: 'Snapshot', hint: '⌘S', icon: Save, accent: 'purple' },
  { id: 'link', label: 'Go Remote', hint: '⌘L', icon: Radio, accent: 'amber' },
  { id: 'boot', label: 'Restart Core', hint: '⌘R', icon: Play, accent: 'cyan' },
  { id: 'halt', label: 'Standby', hint: '⌘.', icon: Power, accent: 'blue' }
]

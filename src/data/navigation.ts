import {
  LayoutDashboard,
  TerminalSquare,
  FolderGit2,
  BrainCircuit,
  Bot,
  Cpu,
  Settings2
} from 'lucide-react'
import type { NavItem } from '@/types'

export const NAV_ITEMS: NavItem[] = [
  { id: 'core', label: 'Core', icon: LayoutDashboard, ready: true },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare, ready: true },
  { id: 'projects', label: 'Projects', icon: FolderGit2, ready: true },
  { id: 'memory', label: 'Memory', icon: BrainCircuit, ready: false },
  { id: 'agents', label: 'Agents', icon: Bot, ready: false },
  { id: 'system', label: 'System', icon: Cpu, ready: false },
  { id: 'settings', label: 'Settings', icon: Settings2, ready: false }
]

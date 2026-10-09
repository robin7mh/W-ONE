import {
  LayoutDashboard,
  Code2,
  TerminalSquare,
  FolderGit2,
  BrainCircuit,
  Bot,
  Cpu,
  Settings2
} from 'lucide-react'
import type { NavItem } from '@/types'

export const NAV_ITEMS: NavItem[] = [
  { id: 'core', label: 'Core', icon: LayoutDashboard },
  { id: 'editor', label: 'Editor', icon: Code2 },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'projects', label: 'Projects', icon: FolderGit2 },
  { id: 'memory', label: 'Memory', icon: BrainCircuit },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'system', label: 'System', icon: Cpu },
  { id: 'settings', label: 'Settings', icon: Settings2 }
]

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
  { id: 'core', icon: LayoutDashboard },
  { id: 'editor', icon: Code2 },
  { id: 'terminal', icon: TerminalSquare },
  { id: 'projects', icon: FolderGit2 },
  { id: 'memory', icon: BrainCircuit },
  { id: 'agents', icon: Bot },
  { id: 'system', icon: Cpu },
  { id: 'settings', icon: Settings2 }
]

import { Compass, Code2, Database, Shield } from 'lucide-react'
import type { Agent } from '@/types'

/**
 * Placeholder roster for the future multi-agent system. All agents sit in
 * standby/idle in the UI-only phase — wiring them to a real orchestrator is a
 * later step (see README → Future integration).
 */
export const MOCK_AGENTS: Agent[] = [
  { id: 'core', name: 'CORE', role: 'Orchestrator', state: 'online', icon: Shield, load: 0.32 },
  { id: 'research', name: 'SCOUT', role: 'Research', state: 'standby', icon: Compass, load: 0.08 },
  { id: 'coder', name: 'FORGE', role: 'Code', state: 'standby', icon: Code2, load: 0.0 },
  { id: 'memory', name: 'VAULT', role: 'Memory', state: 'idle', icon: Database, load: 0.14 }
]

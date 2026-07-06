import type { CommandEntry } from '@/types'

// Recent-commands mock still drives the CommandTimeline card (real command
// history arrives in a later phase). Live process data now comes from the
// System Monitor's telemetry stream, not from here.
export const RECENT_COMMANDS: CommandEntry[] = [
  { id: 'c1', time: '14:42', command: 'core.status --verbose', status: 'done' },
  { id: 'c2', time: '14:42', command: 'vault.mount ~/obsidian', status: 'done' },
  { id: 'c3', time: '14:41', command: 'agents.list --state', status: 'done' },
  { id: 'c4', time: '14:43', command: 'objective.plan "index vault"', status: 'active' },
  { id: 'c5', time: '—', command: 'net.link --remote', status: 'queued' }
]

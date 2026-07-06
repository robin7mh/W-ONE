import type { ProcessRow, CommandEntry } from '@/types'

export const MOCK_PROCESSES: ProcessRow[] = [
  { pid: 1042, name: 'w-one-core', cpu: 12.4, mem: 340 },
  { pid: 2231, name: 'renderer', cpu: 8.1, mem: 512 },
  { pid: 884, name: 'vault-index', cpu: 3.6, mem: 156 },
  { pid: 3390, name: 'net-bridge', cpu: 1.2, mem: 64 },
  { pid: 4517, name: 'scheduler', cpu: 0.6, mem: 48 }
]

export const RECENT_COMMANDS: CommandEntry[] = [
  { id: 'c1', time: '14:42', command: 'core.status --verbose', status: 'done' },
  { id: 'c2', time: '14:42', command: 'vault.mount ~/obsidian', status: 'done' },
  { id: 'c3', time: '14:41', command: 'agents.list --state', status: 'done' },
  { id: 'c4', time: '14:43', command: 'objective.plan "index vault"', status: 'active' },
  { id: 'c5', time: '—', command: 'net.link --remote', status: 'queued' }
]

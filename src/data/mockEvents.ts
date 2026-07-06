import type { SystemEvent } from '@/types'

export const MOCK_EVENTS: SystemEvent[] = [
  { id: 'e1', time: '14:42:07', level: 'ok', source: 'CORE', message: 'Session handshake complete' },
  { id: 'e2', time: '14:41:55', level: 'info', source: 'NET', message: 'Local mode active — no outbound link' },
  { id: 'e3', time: '14:41:40', level: 'ok', source: 'VAULT', message: 'Memory index mounted (read-only)' },
  { id: 'e4', time: '14:41:22', level: 'warn', source: 'SYS', message: 'Thermal envelope at 68% — nominal' },
  { id: 'e5', time: '14:40:58', level: 'info', source: 'FORGE', message: 'Code agent registered in standby' },
  { id: 'e6', time: '14:40:31', level: 'ok', source: 'CORE', message: 'Boot sequence verified' }
]

/** Pool of events the EventLog periodically prepends to feel alive. */
export const EVENT_POOL: Omit<SystemEvent, 'id' | 'time'>[] = [
  { level: 'info', source: 'NET', message: 'Heartbeat ok — latency 3ms' },
  { level: 'ok', source: 'VAULT', message: 'Context snapshot cached' },
  { level: 'info', source: 'CORE', message: 'Idle scheduler tick' },
  { level: 'warn', source: 'SYS', message: 'Memory pressure rising — 61%' },
  { level: 'ok', source: 'SCOUT', message: 'Watchlist unchanged' },
  { level: 'info', source: 'FORGE', message: 'Awaiting objective assignment' }
]

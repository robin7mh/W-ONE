// Shared system-telemetry types (main collectors → renderer). Natural units, so
// the renderer formats for display rather than reversing arbitrary scaling.

export interface ProcessInfo {
  pid: number
  name: string
  cpu: number // percent
  mem: number // MB (resident)
}

export interface SystemSnapshot {
  cpu: { total: number; cores: number[] } // percent
  mem: { usedPct: number; usedGb: number; totalGb: number }
  disk: { usedPct: number; mount: string }
  net: { rxMbps: number; txMbps: number } // MB/s
  battery: { pct: number; charging: boolean; hasBattery: boolean }
  uptimeSec: number
  processes: ProcessInfo[] // top by CPU
  ts: number // epoch ms
}

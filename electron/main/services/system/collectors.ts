import si from 'systeminformation'
import type { ProcessInfo, SystemSnapshot } from '@shared/types/system'

const r1 = (n: number) => Math.round(n * 10) / 10
const clampPct = (n: number) => Math.max(0, Math.min(100, n))

async function cpu(): Promise<SystemSnapshot['cpu']> {
  const load = await si.currentLoad()
  return {
    total: clampPct(r1(load.currentLoad)),
    cores: load.cpus.map((c) => clampPct(r1(c.load)))
  }
}

async function mem(): Promise<SystemSnapshot['mem']> {
  const m = await si.mem()
  // `active` excludes cache/buffers → closest to what Activity Monitor shows.
  const used = m.active || m.used
  return {
    usedPct: clampPct(r1((used / m.total) * 100)),
    usedGb: r1(used / 1e9),
    totalGb: r1(m.total / 1e9)
  }
}

async function disk(): Promise<SystemSnapshot['disk']> {
  const list = await si.fsSize()
  // The volume actually holding the most data (on macOS `/` is the tiny
  // read-only system snapshot; the Data volume is where usage lives).
  const primary = list.length
    ? list.reduce((a, b) => ((b.used ?? 0) > (a.used ?? 0) ? b : a))
    : undefined
  return { usedPct: clampPct(r1(primary?.use ?? 0)), mount: primary?.mount ?? '/' }
}

async function net(): Promise<SystemSnapshot['net']> {
  const stats = await si.networkStats()
  const agg = stats.reduce(
    (a, n) => ({ rx: a.rx + (n.rx_sec || 0), tx: a.tx + (n.tx_sec || 0) }),
    { rx: 0, tx: 0 }
  )
  return { rxMbps: r1(agg.rx / 1e6), txMbps: r1(agg.tx / 1e6) }
}

async function battery(): Promise<SystemSnapshot['battery']> {
  const b = await si.battery()
  return { pct: clampPct(b.percent ?? 0), charging: !!b.isCharging, hasBattery: !!b.hasBattery }
}

async function processes(): Promise<ProcessInfo[]> {
  const p = await si.processes()
  return p.list
    .slice()
    .sort((a, b) => b.cpu - a.cpu)
    .slice(0, 6)
    .map((x) => ({
      pid: x.pid,
      name: x.name,
      cpu: clampPct(r1(x.cpu)),
      mem: Math.round((x.memRss ?? 0) / 1024) // KB → MB
    }))
}

/** Collect one full snapshot. `withProcesses` gates the expensive process scan. */
export async function collect(
  withProcesses: boolean,
  lastProcesses: ProcessInfo[]
): Promise<SystemSnapshot> {
  const [c, m, d, n, b] = await Promise.all([cpu(), mem(), disk(), net(), battery()])
  const procs = withProcesses ? await processes() : lastProcesses
  return {
    cpu: c,
    mem: m,
    disk: d,
    net: n,
    battery: b,
    uptimeSec: si.time().uptime ?? 0,
    processes: procs,
    ts: Date.now()
  }
}

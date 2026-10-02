import type { ReactNode } from 'react'
import { Activity, BatteryMedium, Clock3, Cpu, HardDrive, MemoryStick } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { TechLabel } from '@/components/ui/TechLabel'
import { StatusDot } from '@/components/ui/StatusDot'
import { RadialGauge } from '@/components/monitor/RadialGauge'
import { Sparkline } from '@/components/monitor/Sparkline'
import { formatUptime } from '@/lib/format'
import { cn } from '@/lib/cn'
import { useSystemMetrics } from '../useSystemMetrics'

function Tile({ icon: Icon, label, value, sub, children }: { icon: typeof Cpu; label: string; value: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-hud/50 bg-surface/40 p-3">
      <div className="flex items-center gap-2">
        <Icon size={13} className="text-cyan" />
        <TechLabel className="text-text-secondary">{label}</TechLabel>
        <span className="ml-auto font-mono text-[15px] tabular-nums text-text-primary">{value}</span>
      </div>
      {sub && <p className="mt-0.5 text-right font-mono text-[10.5px] text-text-muted">{sub}</p>}
      {children && <div className="mt-2 [&>svg]:h-12">{children}</div>}
    </div>
  )
}

/**
 * The System module: the right-rail telemetry at full size — gauges, every
 * core, memory and disk in absolute numbers, network split, the process list.
 * Shows the machine the W-ONE core runs on (on a server: the server).
 */
export function SystemView() {
  const { metrics: m, processes, uptimeSec, battery, live, snapshot: s } = useSystemMetrics()
  const pct = (v: number) => `${Math.round(v)}%`
  return (
    <Panel
      title="System"
      corners
      className="min-h-0 flex-1"
      headerRight={
        <span className="flex items-center gap-1.5">
          <StatusDot tone={live ? 'ok' : 'muted'} pulse={live} />
          <span className="font-mono text-[10px] text-text-muted">{live ? 'LIVE' : 'OFFLINE'}</span>
        </span>
      }
      bodyClassName="min-h-0 overflow-y-auto"
    >
      <div className="grid items-start gap-3 lg:grid-cols-[auto_minmax(0,1fr)]">
        <div className="flex items-center justify-around gap-4 rounded-md border border-hud/50 bg-surface/40 px-4 py-4 lg:flex-col lg:justify-start">
          <RadialGauge value={m.cpu.value} size={110} accent="var(--accent-cyan)" label="CPU" />
          <RadialGauge value={m.ram.value} size={110} accent="var(--accent-blue)" label="RAM" />
          <RadialGauge value={m.disk.value} size={110} accent="var(--accent-purple)" label="DISK" />
        </div>

        <div className="grid min-w-0 content-start gap-3 md:grid-cols-2">
          <Tile icon={Cpu} label="CPU" value={pct(m.cpu.value)} sub={s ? `${s.cpu.cores.length} cores` : undefined}>
            <Sparkline data={m.cpu.history} accent="var(--accent-cyan)" />
            {s && s.cpu.cores.length > 0 && (
              <div className="mt-2 grid grid-cols-8 gap-1" aria-label="Per-core load">
                {s.cpu.cores.map((c, i) => (
                  <div key={i} title={`Core ${i + 1}: ${Math.round(c)}%`} className="flex h-6 items-end overflow-hidden rounded-sm bg-elevated/60">
                    <div className="w-full bg-cyan/70" style={{ height: `${Math.max(4, Math.min(100, c))}%` }} />
                  </div>
                ))}
              </div>
            )}
          </Tile>
          <Tile icon={MemoryStick} label="Memory" value={pct(m.ram.value)} sub={s ? `${s.mem.usedGb.toFixed(1)} / ${s.mem.totalGb.toFixed(1)} GB` : undefined}>
            <Sparkline data={m.ram.history} accent="var(--accent-blue)" />
          </Tile>
          <Tile icon={HardDrive} label="Disk" value={pct(m.disk.value)} sub={s ? `used on ${s.disk.mount}` : undefined}>
            <Sparkline data={m.disk.history} accent="var(--accent-purple)" />
          </Tile>
          <Tile
            icon={Activity}
            label="Network"
            value={`${m.network.value.toFixed(1)} MB/s`}
            sub={s ? `↓ ${s.net.rxMbps.toFixed(2)} · ↑ ${s.net.txMbps.toFixed(2)} MB/s` : undefined}
          >
            <Sparkline data={m.network.history} accent="var(--accent-green)" max={Math.max(1, ...m.network.history)} />
          </Tile>
          <Tile
            icon={BatteryMedium}
            label="Battery"
            value={battery.hasBattery ? pct(m.battery.value) : 'N/A'}
            sub={battery.hasBattery ? (battery.charging ? 'charging' : 'on battery') : 'no battery'}
          />
          <Tile icon={Clock3} label="Uptime" value={uptimeSec > 0 ? formatUptime(uptimeSec) : '—'} />
        </div>
      </div>

      <div className="mt-3 rounded-md border border-hud/50 bg-surface/40 p-2">
        <TechLabel className="px-1 text-text-secondary">Top processes</TechLabel>
        <table className="mt-1.5 w-full font-mono text-[12px]">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-text-muted">
              <th className="px-1 py-1 font-normal">PID</th>
              <th className="px-1 py-1 font-normal">Name</th>
              <th className="px-1 py-1 text-right font-normal">CPU %</th>
              <th className="px-1 py-1 text-right font-normal">MEM MB</th>
            </tr>
          </thead>
          <tbody>
            {processes.length === 0 && (
              <tr>
                <td colSpan={4} className="px-1 py-2 text-text-muted">
                  No data yet
                </td>
              </tr>
            )}
            {processes.map((p) => (
              <tr key={p.pid} className="border-t border-hud/30 text-text-secondary">
                <td className="px-1 py-1 text-text-muted">{p.pid}</td>
                <td className="max-w-[240px] truncate px-1 py-1 text-text-primary">{p.name}</td>
                <td className={cn('px-1 py-1 text-right tabular-nums', p.cpu > 50 && 'text-amber')}>{p.cpu.toFixed(1)}</td>
                <td className="px-1 py-1 text-right tabular-nums">{Math.round(p.mem)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

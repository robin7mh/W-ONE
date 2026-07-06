import { Cpu, MemoryStick, HardDrive, Activity, BatteryMedium } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { SystemMetricCard } from './SystemMetricCard'
import { RadialGauge } from './RadialGauge'
import { StatusDot } from '@/components/ui/StatusDot'
import { TechLabel } from '@/components/ui/TechLabel'
import { useMockMetrics } from '@/hooks/useMockMetrics'
import { MOCK_PROCESSES } from '@/data/mockProcesses'

/**
 * Right rail: system telemetry. All values are mock (useMockMetrics). To make
 * real, swap the hook's source for `window.wone.sysinfo` — this file is unchanged.
 */
export function SystemMonitorPanel() {
  const m = useMockMetrics()

  return (
    <Panel
      title="System Monitor"
      corners
      className="w-full"
      headerRight={
        <span className="flex items-center gap-1.5">
          <StatusDot tone="ok" />
          <span className="font-mono text-[10px] text-text-muted">MOCK</span>
        </span>
      }
      bodyClassName="flex flex-col gap-3 overflow-y-auto"
    >
      {/* headline gauges */}
      <div className="flex items-center justify-around rounded-md border border-hud/50 bg-surface/40 py-3">
        <RadialGauge value={m.cpu.value} accent="var(--accent-cyan)" label="CPU" />
        <RadialGauge value={m.ram.value} accent="var(--accent-blue)" label="RAM" />
      </div>

      {/* metric sparklines */}
      <SystemMetricCard label="CPU Load" icon={Cpu} sample={m.cpu} accent="var(--accent-cyan)" />
      <SystemMetricCard label="Memory" icon={MemoryStick} sample={m.ram} accent="var(--accent-blue)" />
      <SystemMetricCard label="Disk I/O" icon={HardDrive} sample={m.disk} accent="var(--accent-purple)" />
      <SystemMetricCard
        label="Network"
        icon={Activity}
        sample={m.network}
        accent="var(--accent-cyan)"
        unit="mb/s"
        format={(v) => (v / 10).toFixed(1)}
      />
      <SystemMetricCard
        label="Battery"
        icon={BatteryMedium}
        sample={m.battery}
        accent="var(--accent-amber)"
      />

      {/* processes preview */}
      <div className="rounded-md border border-hud/50 bg-surface/40 p-2.5">
        <div className="mb-2 flex items-center justify-between">
          <TechLabel className="text-text-secondary">Processes</TechLabel>
          <TechLabel className="text-text-muted">cpu · mem</TechLabel>
        </div>
        <ul className="space-y-1.5">
          {MOCK_PROCESSES.map((p) => (
            <li key={p.pid} className="flex items-center gap-2 font-mono text-[11px]">
              <span className="w-9 shrink-0 text-text-muted">{p.pid}</span>
              <span className="flex-1 truncate text-text-secondary">{p.name}</span>
              <span className="w-10 text-right text-cyan tabular-nums">{p.cpu.toFixed(1)}</span>
              <span className="w-12 text-right text-text-muted tabular-nums">{p.mem}m</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  )
}

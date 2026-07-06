import type { ProcessInfo, SystemSnapshot } from '@shared/types/system'
import { collect } from './collectors'

/**
 * Samples system telemetry and pushes it to the renderer via an injected sender.
 * The interval only runs while there is at least one subscriber AND the window
 * is not paused (minimized/hidden) — so a backgrounded app costs nothing.
 * The expensive process scan runs on a slower cadence than the cheap metrics.
 */
export class SystemService {
  private subscribers = 0
  private paused = false
  private timer: NodeJS.Timeout | null = null
  private tickCount = 0
  private lastProcesses: ProcessInfo[] = []

  constructor(
    private readonly send: (snapshot: SystemSnapshot) => void,
    private readonly intervalMs = 1500,
    private readonly processEveryNTicks = 3
  ) {}

  subscribe(): void {
    this.subscribers += 1
    this.evaluate()
  }

  unsubscribe(): void {
    this.subscribers = Math.max(0, this.subscribers - 1)
    this.evaluate()
  }

  /** Called from window visibility events to stop sampling when hidden. */
  setPaused(paused: boolean): void {
    this.paused = paused
    this.evaluate()
  }

  async snapshot(): Promise<SystemSnapshot> {
    const snap = await collect(true, this.lastProcesses)
    this.lastProcesses = snap.processes
    return snap
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private evaluate(): void {
    const shouldRun = this.subscribers > 0 && !this.paused
    if (shouldRun && !this.timer) {
      void this.tick() // immediate first sample
      this.timer = setInterval(() => void this.tick(), this.intervalMs)
    } else if (!shouldRun && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private async tick(): Promise<void> {
    this.tickCount += 1
    const withProcesses = this.tickCount % this.processEveryNTicks === 1
    try {
      const snap = await collect(withProcesses, this.lastProcesses)
      this.lastProcesses = snap.processes
      this.send(snap)
    } catch {
      // Skip a bad sample rather than crash the sampler.
    }
  }
}

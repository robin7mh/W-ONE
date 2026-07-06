import { useEffect, useRef, useState } from 'react'
import type { Metrics, MetricKind } from '@/types'
import { clamp } from '@/lib/format'

const HISTORY = 40

const SEED: Record<MetricKind, number> = {
  cpu: 24,
  ram: 58,
  disk: 43,
  network: 12,
  battery: 87
}

// Per-metric random-walk volatility so each series behaves distinctly.
const DRIFT: Record<MetricKind, number> = {
  cpu: 9,
  ram: 3,
  disk: 1.2,
  network: 22,
  battery: 0.15
}

function makeInitial(): Metrics {
  const kinds = Object.keys(SEED) as MetricKind[]
  return kinds.reduce((acc, k) => {
    acc[k] = { value: SEED[k], history: Array.from({ length: HISTORY }, () => SEED[k]) }
    return acc
  }, {} as Metrics)
}

/**
 * Smooth random-walk mock metrics. To go real later: replace the interval body
 * with a read from `window.wone.sysinfo` (systeminformation over IPC) — the
 * shape stays identical, so components don't change.
 */
export function useMockMetrics(intervalMs = 1200): Metrics {
  const [metrics, setMetrics] = useState<Metrics>(makeInitial)
  const ref = useRef(metrics)
  ref.current = metrics

  useEffect(() => {
    const id = window.setInterval(() => {
      setMetrics((prev) => {
        const next = {} as Metrics
        ;(Object.keys(prev) as MetricKind[]).forEach((k) => {
          const cur = prev[k].value
          const delta = (Math.random() - 0.5) * 2 * DRIFT[k]
          // battery slowly drains; others mean-revert toward their seed
          const pull = k === 'battery' ? -0.05 : (SEED[k] - cur) * 0.08
          const value = clamp(cur + delta + pull, k === 'battery' ? 5 : 2, 100)
          const history = [...prev[k].history.slice(1), value]
          next[k] = { value, history }
        })
        return next
      })
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])

  return metrics
}

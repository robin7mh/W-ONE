import { useEffect, useState } from 'react'

/**
 * Drives the boot overlay. Returns booted=true once the sequence finishes.
 * Total duration is derived from the caller so BootSequence and the shell agree.
 */
export function useBoot(totalMs: number): { booted: boolean; skip: () => void } {
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    if (booted) return
    const id = window.setTimeout(() => setBooted(true), totalMs)
    return () => window.clearTimeout(id)
  }, [booted, totalMs])

  return { booted, skip: () => setBooted(true) }
}

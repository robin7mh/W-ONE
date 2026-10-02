import { useEffect, type ReactNode } from 'react'
import { useSession } from '../store'
import { ConnectingScreen, PairScreen, UnreachableScreen } from './PairScreen'

/**
 * Renders the app once a core is reachable: immediately in the desktop window
 * (preload bridge), after pairing in a browser (HTTP + WebSocket).
 */
export function SessionGate({ children }: { children: ReactNode }) {
  const status = useSession((s) => s.status)
  const init = useSession((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (status === 'ready') return <>{children}</>
  if (status === 'unpaired') return <PairScreen />
  if (status === 'unreachable') return <UnreachableScreen />
  return <ConnectingScreen />
}

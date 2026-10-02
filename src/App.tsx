import { AppShell } from '@/components/shell/AppShell'
import { SessionGate } from '@/features/session/components/SessionGate'

export default function App() {
  return (
    <SessionGate>
      <AppShell />
    </SessionGate>
  )
}

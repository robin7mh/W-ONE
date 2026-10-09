import { AppShell } from '@/components/shell/AppShell'
import { SessionGate } from '@/features/session/components/SessionGate'
import { LicenseGate } from '@/features/cloud/components/LicenseGate'

/** Reach a core (pairing in a browser), then a licensed W-ONE account, then the app. */
export default function App() {
  return (
    <SessionGate>
      <LicenseGate>
        <AppShell />
      </LicenseGate>
    </SessionGate>
  )
}

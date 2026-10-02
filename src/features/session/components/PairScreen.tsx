import { useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { Panel } from '@/components/ui/Panel'
import { TechLabel } from '@/components/ui/TechLabel'
import { GlowBackground } from '@/components/shell/GlowBackground'
import { defaultDeviceName, useSession } from '../store'

/** XXXX-XXXX as the user types (letters/digits only, uppercase). */
export function formatCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden p-4">
      <GlowBackground />
      <div className="relative z-10 w-full max-w-md">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-md border border-cyan/40 bg-cyan/5 font-mono text-sm font-bold text-cyan text-glow-cyan">
            W1
          </div>
          <div className="leading-none">
            <div className="font-sans text-[15px] font-semibold tracking-wide text-text-primary">W-ONE</div>
            <TechLabel className="text-text-muted">Command Center · Web</TechLabel>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Shown while checking the stored token. */
export function ConnectingScreen() {
  return (
    <Frame>
      <div className="flex items-center justify-center gap-2 font-mono text-[12px] text-text-muted">
        <Loader2 size={14} className="animate-spin text-cyan" /> Connecting to the W-ONE core…
      </div>
    </Frame>
  )
}

export function UnreachableScreen() {
  const { error, init } = useSession()
  return (
    <Frame>
      <Panel title="Core unreachable" corners>
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <WifiOff size={26} className="text-danger" />
          <p className="font-sans text-[13px] text-text-secondary">The W-ONE core did not answer.</p>
          {error && <p className="font-mono text-[11px] text-text-muted">{error}</p>}
          <button
            type="button"
            onClick={() => void init()}
            className="mt-1 flex items-center gap-1.5 rounded-md border border-cyan/40 bg-cyan/[0.06] px-3 py-1.5 font-sans text-[12px] font-medium text-cyan hover:bg-cyan/[0.12]"
          >
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      </Panel>
    </Frame>
  )
}

/** A code handed over in the URL (`#pair=XXXX-XXXX`, from the QR code), consumed once. */
export function codeFromHash(): string {
  const m = /[#&]pair=([^&]+)/.exec(location.hash)
  if (!m) return ''
  history.replaceState(null, '', location.pathname + location.search)
  return formatCode(decodeURIComponent(m[1]))
}

/** First visit from a browser: redeem a one-time pairing code. */
export function PairScreen() {
  const { error, pair } = useSession()
  const [code, setCode] = useState(codeFromHash)
  const [name, setName] = useState(() => defaultDeviceName())
  const [busy, setBusy] = useState(false)
  const complete = code.replace('-', '').length === 8

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!complete || busy) return
    setBusy(true)
    const ok = await pair(code, name)
    if (!ok) setBusy(false)
  }

  return (
    <Frame>
      <Panel title="Pair this browser" corners>
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4 py-1">
          <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
            Enter the one-time pairing code of your W-ONE core. You find it in the server log (
            <code className="font-mono text-cyan">npm run server:pair</code>) or in the desktop app under{' '}
            <span className="text-text-primary">Settings → Devices</span>.
          </p>
          <label className="flex flex-col gap-1.5">
            <TechLabel className="text-text-muted">Pairing code</TechLabel>
            <input
              autoFocus
              aria-label="Pairing code"
              value={code}
              onChange={(e) => setCode(formatCode(e.target.value))}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              className="rounded-md border border-hud/70 bg-surface/70 px-3 py-2 text-center font-mono text-[20px] tracking-[0.3em] text-text-primary outline-none placeholder:text-text-muted/50 focus:border-cyan/60"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <TechLabel className="text-text-muted">Device name</TechLabel>
            <input
              aria-label="Device name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-hud/70 bg-surface/70 px-3 py-1.5 font-sans text-[13px] text-text-primary outline-none focus:border-cyan/60"
            />
          </label>
          {error && <p className="font-mono text-[11px] text-danger">{error}</p>}
          <button
            type="submit"
            disabled={!complete || busy}
            className="flex items-center justify-center gap-2 rounded-md border border-cyan/50 bg-cyan/[0.10] px-3 py-2 font-sans text-[13px] font-medium text-cyan transition-colors hover:bg-cyan/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            Pair device
          </button>
        </form>
      </Panel>
    </Frame>
  )
}

import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, BrainCircuit, Check, Info, KeyRound, Laptop, QrCode, RefreshCw, ShieldCheck, Smartphone, TerminalSquare, Trash2, Wifi, X } from 'lucide-react'
import { EFFORTS, MODELS, type Effort } from '@shared/types/ai'
import { ipc, isDesktop } from '@shared/ipc/client'
import type { VaultStatus } from '@shared/types/memory'
import { Panel } from '@/components/ui/Panel'
import { TechLabel } from '@/components/ui/TechLabel'
import { StatusDot } from '@/components/ui/StatusDot'
import { FolderPicker } from '@/components/ui/FolderPicker'
import { cn } from '@/lib/cn'
import { useSession } from '@/features/session/store'
import { useAssistant } from '@/features/agents/store'
import { useAgents } from '@/features/agents/sessions'
import { relativeTime } from '@/features/agents/format'
import { useSettings } from '../store'

function Card({ icon: Icon, title, children, className }: { icon: typeof Info; title: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-md border border-hud/60 bg-surface/40 p-3.5', className)}>
      <div className="mb-3 flex items-center gap-2">
        <Icon size={14} className="text-cyan" />
        <TechLabel className="text-text-secondary">{title}</TechLabel>
      </div>
      {children}
    </section>
  )
}

function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className={cn('flex items-start gap-3 py-1.5', disabled && 'opacity-50')}>
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-cyan"
      />
      <span>
        <span className="block font-sans text-[13px] text-text-primary">{label}</span>
        {hint && <span className="block font-sans text-[11.5px] text-text-muted">{hint}</span>}
      </span>
    </label>
  )
}

const input =
  'rounded-md border border-hud/70 bg-surface/70 px-2.5 py-1.5 font-mono text-[12px] text-text-primary outline-none focus:border-cyan/60'
const button =
  'flex items-center justify-center gap-1.5 rounded-md border border-hud/60 px-2.5 py-1.5 font-sans text-[12px] text-text-secondary transition-colors hover:border-cyan/50 hover:text-cyan disabled:opacity-40'

/** The coding agents found on this machine — they run on the user's own accounts. */
function AgentsCard() {
  const availability = useAgents((s) => s.availability)
  const detecting = useAgents((s) => s.detecting)
  useEffect(() => {
    void useAgents.getState().detect()
  }, [])
  return (
    <Card icon={TerminalSquare} title="Coding agents">
      <p className="font-sans text-[12px] text-text-secondary">
        Your own agents, signed in with your own accounts — W-ONE starts them, shows their work and asks you before anything risky.
      </p>
      <ul className="mt-2 space-y-1.5">
        {availability.map((a) => (
          <li key={a.kind} className="flex items-start gap-2">
            {a.ready ? <Check size={13} className="mt-0.5 shrink-0 text-green" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" />}
            <span className="min-w-0 flex-1">
              <span className="block font-sans text-[13px] text-text-primary">{a.name}</span>
              <span className="block font-mono text-[10.5px] text-text-muted">
                {a.ready ? [a.account, a.version && `v${a.version}`].filter(Boolean).join(' · ') : a.hint}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <button type="button" className={cn(button, 'mt-3')} disabled={detecting} onClick={() => void useAgents.getState().detect()}>
        <RefreshCw size={12} className={cn(detecting && 'animate-spin')} /> Check again
      </button>
    </Card>
  )
}

function AiCard() {
  const status = useAssistant((s) => s.status)
  const { setKey, clearKey, configure } = useAssistant.getState()
  const [key, setKeyText] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    if (await setKey(key)) setKeyText('')
    setBusy(false)
  }
  return (
    <Card icon={BrainCircuit} title="W-ONE Assistant (API key)">
      <div className="flex items-center gap-2">
        <StatusDot tone={status?.configured ? 'ok' : 'warn'} pulse={false} />
        <span className="font-sans text-[13px] text-text-primary">
          {status?.configured
            ? `Anthropic key ${status.source === 'env' ? 'from the environment' : 'stored'} · …${status.keyHint}`
            : 'No API key yet'}
        </span>
      </div>
      {status?.source !== 'env' && (
        <div className="mt-3 flex gap-2">
          <input
            type="password"
            aria-label="New API key"
            placeholder={status?.configured ? 'Replace key…' : 'sk-ant-…'}
            value={key}
            onChange={(e) => setKeyText(e.target.value)}
            className={cn(input, 'min-w-0 flex-1')}
          />
          <button type="button" className={button} disabled={!key.trim() || busy} onClick={() => void save()}>
            <KeyRound size={13} /> Save
          </button>
          {status?.source === 'stored' && (
            <button type="button" aria-label="Remove key" className={cn(button, 'hover:border-danger/50 hover:text-danger')} onClick={() => void clearKey()}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <TechLabel className="text-text-muted">Model</TechLabel>
          <select aria-label="Model" className={input} value={status?.settings.model ?? MODELS[0].id} onChange={(e) => void configure({ model: e.target.value })}>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} — {m.note}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <TechLabel className="text-text-muted">Effort</TechLabel>
          <select aria-label="Effort" className={input} value={status?.settings.effort ?? 'high'} onChange={(e) => void configure({ effort: e.target.value as Effort })}>
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="mt-2 font-sans text-[11.5px] text-text-muted">Higher effort means deeper reasoning — slower and more tokens. "high" suits most work.</p>
    </Card>
  )
}

function RemoteCard() {
  const s = useSettings()
  const desktop = isDesktop()
  const cfg = s.server?.config
  const editable = desktop && !!s.server?.configurable
  const myDevice = (() => {
    try {
      return localStorage.getItem('wone.deviceId')
    } catch {
      return null
    }
  })()

  return (
    <Card icon={Wifi} title="Remote access · web & mobile" className="lg:row-span-2">
      <div className="flex items-center gap-2">
        <StatusDot tone={s.server?.running ? 'ok' : 'muted'} pulse={false} />
        <span className="font-sans text-[13px] text-text-primary">{s.server?.running ? 'API server running' : 'API server off'}</span>
      </div>
      {s.server?.running && (
        <ul className="mt-1 space-y-0.5">
          {s.server.urls.map((u) => (
            <li key={u} className="font-mono text-[11.5px] text-text-secondary">
              {u}
            </li>
          ))}
        </ul>
      )}
      {s.server?.error && <p className="mt-1 font-mono text-[11px] text-danger">{s.server.error}</p>}

      {cfg && editable && (
        <div className="mt-3 border-t border-hud/40 pt-2">
          <Toggle label="Run the API server" hint="Lets browsers and the W-ONE app connect to this computer." checked={cfg.enabled} disabled={s.busy} onChange={(v) => void s.configureServer({ enabled: v })} />
          <Toggle label="Reachable on the local network" hint="Off: this computer only (127.0.0.1). On: phones on your network can connect — pairing still protects it." checked={cfg.lan} disabled={s.busy || !cfg.enabled} onChange={(v) => void s.configureServer({ lan: v })} />
          <Toggle label="Allow remote shells" hint="Paired devices may open terminals and let agents run commands. Off by default." checked={cfg.remoteTerminal} disabled={s.busy} onChange={(v) => void s.configureServer({ remoteTerminal: v })} />
          <label className="mt-1 flex items-center gap-2">
            <TechLabel className="text-text-muted">Port</TechLabel>
            <input
              aria-label="Port"
              type="number"
              min={1024}
              max={65535}
              defaultValue={cfg.port}
              key={cfg.port}
              onBlur={(e) => {
                const port = Number(e.target.value)
                if (port !== cfg.port && port >= 1024 && port <= 65535) void s.configureServer({ port })
              }}
              className={cn(input, 'w-24')}
            />
          </label>
        </div>
      )}
      {cfg && !editable && (
        <p className="mt-2 font-sans text-[11.5px] text-text-muted">
          {s.server?.configurable ? 'Server settings can only be changed in the desktop app.' : 'This core is configured through its environment (WONE_PORT, WONE_LAN, WONE_REMOTE_TERMINAL).'}
          {' '}Remote shells: {cfg.remoteTerminal ? 'allowed' : 'off'}.
        </p>
      )}

      <div className="mt-3 border-t border-hud/40 pt-3">
        <div className="flex items-center justify-between">
          <TechLabel className="text-text-muted">Paired devices</TechLabel>
          <button type="button" className={button} disabled={s.busy || !s.server?.running} onClick={() => void s.createPairing()}>
            <QrCode size={13} /> Pair a device
          </button>
        </div>
        {s.pairing && (
          <div className="mt-3 flex flex-col items-center gap-2 rounded-md border border-cyan/40 bg-cyan/[0.04] p-3 sm:flex-row sm:items-start">
            {s.pairing.reachable && (
              <div className="w-36 shrink-0 rounded bg-white p-1" aria-label="Pairing QR code" dangerouslySetInnerHTML={{ __html: s.pairing.qr }} />
            )}
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-mono text-[22px] tracking-[0.25em] text-text-primary">{s.pairing.code}</p>
              {s.pairing.reachable ? (
                <>
                  <p className="font-sans text-[12px] text-text-secondary">Scan with the phone camera, or open the address and enter the code. Valid 10 minutes, once.</p>
                  <p className="break-all font-mono text-[11px] text-cyan">{s.pairing.url}</p>
                </>
              ) : (
                <p className="font-sans text-[12px] text-amber">
                  Only this computer can connect right now. Turn on “Reachable on the local network” to pair a phone.
                </p>
              )}
            </div>
            <button type="button" aria-label="Close pairing" onClick={s.closePairing} className="self-start text-text-muted hover:text-text-primary">
              <X size={14} />
            </button>
          </div>
        )}
        <ul className="mt-2 space-y-1">
          {s.devices.length === 0 && <li className="font-mono text-[11px] text-text-muted">No devices paired</li>}
          {s.devices.map((d) => {
            const Icon = /android|ios|phone/i.test(d.name) ? Smartphone : Laptop
            return (
              <li key={d.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-elevated/40">
                <Icon size={13} className="shrink-0 text-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-sans text-[12.5px] text-text-primary">
                    {d.name}
                    {d.id === myDevice && <span className="ml-1.5 font-mono text-[10px] text-cyan">this browser</span>}
                  </span>
                  <span className="block font-mono text-[10px] text-text-muted">
                    paired {relativeTime(d.createdAt)}
                    {d.lastSeenAt ? ` · seen ${relativeTime(d.lastSeenAt)}` : ''}
                  </span>
                </span>
                <button type="button" aria-label={`Revoke ${d.name}`} onClick={() => void s.revokeDevice(d.id)} className="text-text-muted hover:text-danger">
                  <Trash2 size={12} />
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Card>
  )
}

function PermissionsCard() {
  const grants = useSettings((s) => s.grants)
  const revokeGrant = useSettings((s) => s.revokeGrant)
  return (
    <Card icon={ShieldCheck} title="Agent permissions">
      <p className="font-sans text-[12px] text-text-secondary">
        Reading is always allowed. Changes ask first; "Always allow" is remembered per agent and tool. Commands are asked every time.
      </p>
      <ul className="mt-2 space-y-1">
        {grants.length === 0 && <li className="font-mono text-[11px] text-text-muted">No standing permissions</li>}
        {grants.map((g) => (
          <li key={`${g.agentId}:${g.toolName}`} className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-text-primary">
              {g.agentId} → {g.toolName}
            </span>
            <button type="button" aria-label={`Revoke ${g.agentId} ${g.toolName}`} onClick={() => void revokeGrant(g.agentId, g.toolName)} className="text-text-muted hover:text-danger">
              <Trash2 size={12} />
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function VaultCard() {
  const [vault, setVault] = useState<VaultStatus>()
  const [browsing, setBrowsing] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = () => ipc('memory:status').then(setVault, (e: Error) => setError(e.message))
  useEffect(() => {
    void refresh()
  }, [])
  const choose = async (path?: string) => {
    setError(undefined)
    try {
      const next = await (path ? ipc('memory:setVault', { path }) : ipc('memory:pickVault'))
      if (next) setVault(next)
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <Card icon={Info} title="Memory vault">
      {vault ? (
        <>
          <p className="break-all font-mono text-[12px] text-text-primary">{vault.root}</p>
          <p className="mt-0.5 font-sans text-[12px] text-text-muted">
            {vault.exists ? `${vault.noteCount} notes` : 'Not created yet'} · {vault.isDefault ? 'default location' : 'custom folder'}
          </p>
        </>
      ) : (
        <p className="font-mono text-[11px] text-text-muted">Loading…</p>
      )}
      {error && <p className="mt-1 font-mono text-[11px] text-danger">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button type="button" className={button} onClick={() => (isDesktop() ? void choose() : setBrowsing(true))}>
          Choose folder…
        </button>
      </div>
      {browsing && (
        <FolderPicker
          title="Choose a vault folder"
          confirmLabel="Use as vault"
          onClose={() => setBrowsing(false)}
          onPick={(path) => {
            setBrowsing(false)
            void choose(path)
          }}
        />
      )}
    </Card>
  )
}

function AboutCard() {
  const info = useSession((s) => s.info)
  const rows: [string, string][] = info
    ? [
        ['Version', info.version],
        ['Core', info.mode === 'desktop' ? 'Desktop app' : 'Server'],
        ['Host', `${info.hostname} (${info.platform})`],
        ['Database', info.db.connected ? `Postgres · schema v${info.db.schema}` : 'not connected — npm run db:up'],
        ['Client', isDesktop() ? 'Desktop window' : 'Browser (paired)']
      ]
    : []
  return (
    <Card icon={Info} title="About">
      <dl className="space-y-1">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-20 shrink-0 font-mono text-[11px] uppercase tracking-wider text-text-muted">{k}</dt>
            <dd className="min-w-0 break-words font-mono text-[12px] text-text-secondary">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

/** Settings: AI, remote access & devices, permissions, vault, about. */
export function SettingsView() {
  const load = useSettings((s) => s.load)
  const error = useSettings((s) => s.error)
  const clearError = useSettings((s) => s.clearError)
  const aiError = useAssistant((s) => s.error)
  useEffect(() => {
    void load()
  }, [load])
  return (
    <Panel title="Settings" corners flush className="min-h-0 flex-1" bodyClassName="min-h-0 overflow-y-auto">
      {(error || aiError) && (
        <div className="flex items-start gap-2 border-b border-danger/30 bg-danger/[0.06] px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 font-mono text-[11px] text-text-secondary">{error ?? aiError}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => {
              clearError()
              useAssistant.getState().clearError()
            }}
            className="text-text-muted hover:text-text-primary"
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="grid gap-3 p-3 lg:grid-cols-2">
        <AgentsCard />
        <AiCard />
        <RemoteCard />
        <PermissionsCard />
        <VaultCard />
        <AboutCard />
      </div>
    </Panel>
  )
}

import { useState, type FormEvent } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { TechLabel } from '@/components/ui/TechLabel'

/**
 * First-run card: the assistant needs an Anthropic API key. It is verified
 * against the API before it is stored (encrypted on the desktop) and never
 * sent back to any client.
 */
export function KeySetup({ onSave, error }: { onSave: (key: string) => Promise<boolean>; error?: string }) {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!key.trim() || busy) return
    setBusy(true)
    const ok = await onSave(key)
    setBusy(false)
    if (ok) setKey('')
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form onSubmit={(e) => void submit(e)} className="panel w-full max-w-md space-y-3 p-4">
        <div className="flex items-center gap-2">
          <KeyRound size={15} className="text-cyan" />
          <TechLabel className="text-text-secondary">Connect the assistant</TechLabel>
        </div>
        <p className="font-sans text-[13px] leading-relaxed text-text-secondary">
          W-ONE's agents run on Claude. Paste an Anthropic API key — it is checked once, then stored on this W-ONE core only
          (encrypted by the OS keychain on the desktop) and never shown again. Alternatively set{' '}
          <code className="font-mono text-cyan">ANTHROPIC_API_KEY</code> for the core.
        </p>
        <input
          type="password"
          aria-label="Anthropic API key"
          autoComplete="off"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="sk-ant-…"
          className="w-full rounded-md border border-hud/70 bg-surface/70 px-3 py-2 font-mono text-[13px] text-text-primary outline-none focus:border-cyan/60"
        />
        {error && <p className="font-mono text-[11px] text-danger">{error}</p>}
        <button
          type="submit"
          disabled={!key.trim() || busy}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-cyan/50 bg-cyan/[0.10] px-3 py-2 font-sans text-[13px] font-medium text-cyan hover:bg-cyan/[0.16] disabled:opacity-40"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
          Verify & save key
        </button>
      </form>
    </div>
  )
}

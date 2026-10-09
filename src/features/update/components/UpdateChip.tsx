import { useEffect } from 'react'
import { ArrowUpCircle } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { useUpdate } from '../store'

/** Top bar: appears only once a downloaded update waits for a restart. */
export function UpdateChip() {
  const t = useT()
  const status = useUpdate((s) => s.status)
  useEffect(() => useUpdate.getState().connect(), [])
  if (status?.state !== 'ready') return null
  return (
    <button
      type="button"
      onClick={() => void useUpdate.getState().install()}
      title={t.update.install}
      className="flex items-center gap-1.5 rounded-md border border-cyan/50 bg-cyan/[0.10] px-2.5 py-1 font-mono text-[11px] text-cyan transition-colors hover:bg-cyan/[0.18]"
    >
      <ArrowUpCircle size={13} />
      {t.update.chip(status.version ?? '')}
    </button>
  )
}

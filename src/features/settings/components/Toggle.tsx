import { cn } from '@/lib/cn'

/** A setting that is on or off, with what it does. */
export function Toggle({ label, hint, checked, disabled, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
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

/**
 * Ambient backdrop: soft radial glow in the accent colors, a still HUD grid and
 * static noise. Pure CSS — cheap, and it sits behind everything with
 * pointer-events disabled.
 */
export function GlowBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void" aria-hidden>
      {/* radial vignette + accent glows */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%, rgb(var(--accent-2) / 0.06), transparent 55%),' +
            'radial-gradient(90% 70% at 100% 110%, rgb(var(--accent-3) / 0.05), transparent 55%),' +
            'radial-gradient(80% 60% at 0% 100%, rgb(var(--accent-cyan) / 0.035), transparent 55%)'
        }}
      />

      {/* grid */}
      <div className="hud-grid absolute -inset-[40%] opacity-[0.5]" />

      {/* horizon line */}
      <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan/20 to-transparent" />

      {/* fine noise */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"
        }}
      />
    </div>
  )
}

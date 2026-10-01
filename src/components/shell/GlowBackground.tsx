/**
 * Ambient backdrop: deep radial glow, a slowly drifting HUD grid, a faint
 * moving scanline and static noise. Pure CSS — cheap, and it sits behind
 * everything with pointer-events disabled. Motion is disabled automatically for
 * users who prefer reduced motion (see index.css).
 */
export function GlowBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-void" aria-hidden>
      {/* radial vignette + accent glows */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(120% 80% at 50% -10%, rgb(var(--accent-blue) / 0.10), transparent 55%),' +
            'radial-gradient(90% 70% at 100% 110%, rgb(var(--accent-purple) / 0.08), transparent 55%),' +
            'radial-gradient(80% 60% at 0% 100%, rgb(var(--accent-cyan) / 0.06), transparent 55%)'
        }}
      />

      {/* drifting grid */}
      <div
        className="hud-grid absolute -inset-[40%] opacity-[0.5]"
        style={{ animation: 'gridDrift 60s linear infinite' }}
      />

      {/* horizon line */}
      <div className="absolute left-0 right-0 top-1/2 h-px bg-gradient-to-r from-transparent via-cyan/20 to-transparent" />

      {/* moving scanline */}
      <div className="absolute inset-x-0 top-0 h-24 animate-scan bg-gradient-to-b from-cyan/[0.05] to-transparent" />

      {/* fine noise */}
      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"
        }}
      />

      <style>{`
        @keyframes gridDrift {
          0% { transform: translate3d(0,0,0); }
          100% { transform: translate3d(44px,44px,0); }
        }
      `}</style>
    </div>
  )
}

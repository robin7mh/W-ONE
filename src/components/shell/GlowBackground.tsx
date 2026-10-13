/** The app's backdrop: the plain background color, behind everything — no glow, grid or texture. */
export function GlowBackground() {
  return <div className="pointer-events-none fixed inset-0 -z-10 bg-void" aria-hidden />
}

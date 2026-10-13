import { create } from 'zustand'

interface LintStatus {
  /** Per project: ESLint failed (a broken config, a missing plugin) — the message. */
  errors: Record<string, string>
  setError: (projectId: string, message?: string) => void
  /** Start ESLint over and lint the open files again (set once the editor has loaded). */
  restart: () => Promise<void>
}

/** What went wrong with ESLint per project — the status bar shows it (no Monaco here: it loads with the editor). */
export const useLintStatus = create<LintStatus>((set) => ({
  errors: {},
  setError: (projectId, message) =>
    set((s) => {
      const { [projectId]: _old, ...errors } = s.errors
      return { errors: message ? { ...errors, [projectId]: message } : errors }
    }),
  restart: async () => {}
}))

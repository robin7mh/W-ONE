import { create } from 'zustand'

/** The setup's steps, in order. `browserImport` shows only when its slot is filled (see slots.ts). */
export type StepId = 'welcome' | 'agents' | 'project' | 'import' | 'browserImport' | 'done'
export const STEPS: StepId[] = ['welcome', 'agents', 'project', 'import', 'browserImport', 'done']

const KEY = 'mindeck.onboarding'

interface Saved {
  /** Finished or skipped once: it doesn't open by itself again. */
  done: boolean
  /** Where an unfinished setup continues. */
  step: StepId
}

/** What this device remembers (nothing yet: a fresh setup). */
export function loadOnboarding(): Saved {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null
    return { done: saved?.done === true, step: STEPS.includes(saved?.step as StepId) ? (saved!.step as StepId) : 'welcome' }
  } catch {
    return { done: false, step: 'welcome' }
  }
}

function save(saved: Saved): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    /* storage unavailable — the setup shows again next time */
  }
}

interface OnboardingState extends Saved {
  /** Shown now. */
  open: boolean
  /** Go to a step (remembered, so a restart of the app continues there). */
  go: (step: StepId) => void
  /** Finished or skipped: closes, and stays closed on the next start. */
  finish: () => void
  /** From Settings: from the first step again. */
  restart: () => void
}

/**
 * The first-start setup — remembered per device, like the language and the
 * appearance it starts with. Opens by itself until it was finished or skipped.
 */
export const useOnboarding = create<OnboardingState>((set, get) => {
  const saved = loadOnboarding()
  return {
    ...saved,
    open: !saved.done,
    go: (step) => {
      save({ done: get().done, step })
      set({ step })
    },
    finish: () => {
      save({ done: true, step: 'welcome' })
      set({ done: true, step: 'welcome', open: false })
    },
    restart: () => {
      save({ done: get().done, step: 'welcome' })
      set({ step: 'welcome', open: true })
    }
  }
})

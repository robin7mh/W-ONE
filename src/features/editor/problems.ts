import { create } from 'zustand'
import type { LspDiagnostic } from '@shared/types/lsp'

export interface Problem {
  path: string
  line: number
  col: number
  message: string
  severity: 'error' | 'warning'
  code?: number | string
  /** The reporting tool; absent for TypeScript. */
  source?: string
  /** Who reported it: the language service ('lsp') or ESLint ('eslint') — each replaces only its own. */
  owner?: string
}

interface ProblemsState {
  /** Errors and warnings per `projectId:path` (suggestions stay in the editor only). */
  byFile: Record<string, Problem[]>
  /** Fresh diagnostics of these files replace what this owner knew about them. */
  report: (projectId: string, result: Record<string, LspDiagnostic[]>, owner?: string) => void
  /** A file closed: its problems leave the list. */
  forget: (projectId: string, path: string) => void
}

/** The problems the language services and ESLint found in the open files — the status bar counts them, the palette lists them. */
export const useProblems = create<ProblemsState>((set) => ({
  byFile: {},
  report: (projectId, result, owner = 'lsp') =>
    set((s) => {
      const byFile = { ...s.byFile }
      for (const [path, diags] of Object.entries(result)) {
        const key = `${projectId}:${path}`
        const others = (byFile[key] ?? []).filter((p) => (p.owner ?? 'lsp') !== owner)
        const mine = diags
          .filter((d) => d.severity === 'error' || d.severity === 'warning')
          .map((d): Problem => ({ path, line: d.range.start.line, col: d.range.start.offset, message: d.message, severity: d.severity as Problem['severity'], code: d.code, source: d.source, ...(owner === 'lsp' ? {} : { owner }) }))
        byFile[key] = [...others, ...mine].sort((a, b) => a.line - b.line || a.col - b.col)
      }
      return { byFile }
    }),
  forget: (projectId, path) =>
    set((s) => {
      const { [`${projectId}:${path}`]: _gone, ...byFile } = s.byFile
      return { byFile }
    })
}))

/** All problems of a project, errors first, then by file and line. */
export function projectProblems(byFile: Record<string, Problem[]>, projectId: string): Problem[] {
  return Object.entries(byFile)
    .filter(([key]) => key.startsWith(`${projectId}:`))
    .flatMap(([, list]) => list)
    .sort((a, b) => (a.severity === b.severity ? a.path.localeCompare(b.path) || a.line - b.line : a.severity === 'error' ? -1 : 1))
}

// ESLint and Prettier from the project's own node_modules (like the VS Code
// extensions): problems with their fixes, and formatting.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

import type { LspDiagnostic } from './lsp'

/** A text change by offsets into the linted text. */
export interface LintFix {
  start: number
  end: number
  text: string
}

export interface LintDiagnostic extends LspDiagnostic {
  /** The rule's quick fix, when ESLint has one. */
  fix?: LintFix
}

export interface LintResult {
  /** The project lints this file with ESLint (config + module found, not ignored). */
  available: boolean
  diagnostics: LintDiagnostic[]
}

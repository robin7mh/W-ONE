// Live Server and Live Sass Compiler — built into Mindeck.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

import type { LspDiagnostic } from './lsp'

export interface LiveServerStatus {
  projectId: string
  url: string
  port: number
  /** The served folder, relative to the project ('' = the project). */
  root: string
}

export interface SassResult {
  /** Files written, relative to the project. */
  written: string[]
  /** Compile errors per source file (relative), for the problems list. */
  errors: Record<string, LspDiagnostic[]>
}

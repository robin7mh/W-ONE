/**
 * The Monaco editor's own actions (format, fold, rename symbol, …) for the
 * command palette. The view registers itself here, so the palette reaches
 * them without loading Monaco.
 */
export interface EditorActionHost {
  /** Actions that apply to the file on screen. */
  list(): { id: string; label: string }[]
  run(id: string): void
}

let host: EditorActionHost | null = null

export function setEditorActions(next: EditorActionHost | null): void {
  host = next
}

export function editorActions(): EditorActionHost | null {
  return host
}

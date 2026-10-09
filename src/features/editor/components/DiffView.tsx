import { useEffect, useRef } from 'react'
import { applyMonacoTheme, monaco, THEME } from '../monaco/setup'

let seq = 0

/**
 * Side-by-side diff with Monaco's diff editor (the one VS Code uses):
 * before → after, read-only. Loaded lazily, like the editor itself.
 */
export default function DiffView({ path, original, modified }: { path: string; original: string; modified: string }) {
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    applyMonacoTheme()
    const editor = monaco.editor.createDiffEditor(host.current!, {
      theme: THEME,
      readOnly: true,
      originalEditable: false,
      automaticLayout: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 12.5
    })
    // Unique URIs (same file twice is fine); the extension picks the language.
    const n = ++seq
    const before = monaco.editor.createModel(original, undefined, monaco.Uri.file(`/__diff/${n}/before/${path}`))
    const after = monaco.editor.createModel(modified, undefined, monaco.Uri.file(`/__diff/${n}/after/${path}`))
    editor.setModel({ original: before, modified: after })
    return () => {
      editor.dispose()
      before.dispose()
      after.dispose()
    }
  }, [path, original, modified])

  return <div ref={host} className="h-full w-full" />
}

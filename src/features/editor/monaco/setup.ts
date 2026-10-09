import * as monaco from 'monaco-editor'
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker.js?worker'
import CssWorker from 'monaco-editor/language/css/css.worker.js?worker'
import HtmlWorker from 'monaco-editor/language/html/html.worker.js?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker.js?worker'
import { monacoTheme } from './theme'

// Monaco — the editor core of VS Code — loads only with the Editor module
// (this file is reached through a lazy import). Language services run in web
// workers that Vite bundles next to the app: nothing comes from a CDN.
;(globalThis as { MonacoEnvironment?: monaco.Environment }).MonacoEnvironment = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new JsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    return new EditorWorker()
  }
}

// The editor sees one file at a time — no node_modules, no tsconfig — so
// semantic checks and suggestions would flag every import and parameter.
// Syntax errors, hovers and in-file completions stay on.
for (const defaults of [monaco.typescript.typescriptDefaults, monaco.typescript.javascriptDefaults]) {
  defaults.setDiagnosticsOptions({ noSemanticValidation: true, noSuggestionDiagnostics: true, noSyntaxValidation: false })
  defaults.setCompilerOptions({
    ...defaults.getCompilerOptions(),
    target: monaco.typescript.ScriptTarget.ESNext,
    jsx: monaco.typescript.JsxEmit.Preserve,
    allowJs: true,
    allowNonTsExtensions: true
  })
}

export const THEME = 'wone'

/** (Re)define the W-ONE theme from the current tokens and apply it. */
export function applyMonacoTheme(): void {
  monaco.editor.defineTheme(THEME, monacoTheme())
  monaco.editor.setTheme(THEME)
}

/** Display name of a Monaco language id (`typescript` → `TypeScript`). */
export function languageName(id: string): string {
  return monaco.languages.getLanguages().find((l) => l.id === id)?.aliases?.[0] ?? id
}

export { monaco }

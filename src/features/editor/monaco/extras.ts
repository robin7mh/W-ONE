import { getT } from '@/lib/i18n'
import { monaco } from './setup'
import { phpAccessors, phpClassEnd, phpProperties } from '../php'
import { tidyBlankLines } from '../text'
import type { EditorSettings } from '@shared/types/migrate'
import { settingsFor, useEditorPrefs } from '../prefs'
import { fixAll, formatWithPrettier, restartLint } from './lint'

/** Format a model: Prettier where it is responsible, else the editor's own formatter (needs the editor showing it). */
export async function formatModel(model: monaco.editor.ITextModel, prefs: EditorSettings, editor?: monaco.editor.ICodeEditor): Promise<void> {
  if (await formatWithPrettier(model, prefs)) return
  if (editor?.getModel() === model) await editor.getAction('editor.action.formatDocument')?.run()
}

/** Replace a model's whole text as one undoable edit (no-op when nothing changes). */
export function replaceText(model: monaco.editor.ITextModel, text: string): void {
  if (model.getValue() === text) return
  model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null)
}

/** PHP: "Generate getter / setter" for the properties under the cursor or selection (like the VS Code extension). */
export const phpActions: monaco.languages.CodeActionProvider = {
  provideCodeActions(model, range) {
    const lines = model.getLinesContent()
    const props = phpProperties(lines, range.startLineNumber, range.endLineNumber)
    const end = props.length ? phpClassEnd(lines, props[0].line) : undefined
    if (!end) return { actions: [], dispose() {} }
    const t = getT().editorExtras
    const text = model.getValue()
    const action = (title: string, kinds: ('get' | 'set')[]): monaco.languages.CodeAction[] => {
      const code = phpAccessors(text, props, kinds)
      if (!code) return []
      return [{ title, kind: 'refactor', edit: { edits: [{ resource: model.uri, versionId: model.getVersionId(), textEdit: { range: new monaco.Range(end, 1, end, 1), text: code } }] } }]
    }
    const names = props.map((p) => `$${p.name}`).join(', ')
    return {
      actions: [...action(t.getterSetter(names), ['get', 'set']), ...action(t.getter(names), ['get']), ...action(t.setter(names), ['set'])],
      dispose() {}
    }
  }
}

let registered = false

/** Editor additions that aren't language services: PHP accessors. Once. */
export function setupExtras(): void {
  if (registered) return
  registered = true
  monaco.languages.registerCodeActionProvider('php', phpActions)
}

/** Actions of one editor instance (the palette lists them): format (Prettier first), ESLint, tidy blank lines. */
export function addEditorActions(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable[] {
  const t = getT()
  return [
    editor.addAction({
      id: 'wone.formatDocument',
      label: t.palette.editor.format,
      keybindings: [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF],
      run: async (ed) => {
        const model = ed.getModel()
        if (model) await formatModel(model, settingsFor(useEditorPrefs.getState().settings, model.getLanguageId()), ed)
      }
    }),
    editor.addAction({
      id: 'wone.eslint.fixAll',
      label: t.lint.paletteFixAll,
      run: async (ed) => {
        const model = ed.getModel()
        if (model) await fixAll(model)
      }
    }),
    editor.addAction({ id: 'wone.eslint.restart', label: t.lint.restart, run: () => restartLint() }),
    editor.addAction({
      id: 'wone.tidyBlankLines',
      label: getT().editorExtras.tidyBlankLines,
      run: (ed) => {
        const model = ed.getModel()
        if (model) replaceText(model, tidyBlankLines(model.getValue(), true))
      }
    })
  ]
}

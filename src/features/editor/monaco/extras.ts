import { getT } from '@/lib/i18n'
import { monaco } from './setup'
import { phpAccessors, phpClassEnd, phpProperties } from '../php'
import { tidyBlankLines } from '../text'

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

/** Actions of one editor instance (the palette lists them): tidy blank lines. */
export function addEditorActions(editor: monaco.editor.IStandaloneCodeEditor): monaco.IDisposable[] {
  return [
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

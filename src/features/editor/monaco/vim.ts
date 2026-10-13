import { initVimMode, VimMode } from 'monaco-vim'
import type { VimMapping } from '@shared/types/migrate'
import type { monaco } from './setup'
import { useEditorPrefs } from '../prefs'
import { useEditor } from '../store'

interface VimApi {
  map: (before: string, after: string, mode?: string) => void
  mapclear: (mode?: string) => void
  defineEx: (name: string, prefix: string, run: (cm: unknown, params: { argString?: string }) => void) => void
}
const adapter = VimMode as unknown as { Vim: VimApi; commands: Record<string, () => void> }
const vimApi = () => adapter.Vim

let defined = false

/** `:w` saves, `:q` closes the tab (asking first when unsaved, `:q!` doesn't), `:wq` / `:x` both. */
export function defineCommands(): void {
  if (defined) return
  defined = true
  const editor = () => useEditor.getState()
  const close = (force: boolean) => {
    const id = editor().focusedId()
    if (id) (force ? editor().close : editor().requestClose)(id)
  }
  adapter.commands.save = () => void editor().save()
  vimApi().defineEx('quit', 'q', (_cm, params) => close(params.argString?.trim() === '!'))
  const saveAndClose = async () => {
    if (await editor().save()) close(false)
  }
  vimApi().defineEx('wq', 'wq', () => void saveAndClose())
  vimApi().defineEx('xit', 'x', () => void saveAndClose())
}

let applied: VimMapping[] | undefined

/** The user's remappings (global in Vim), set again when they change. */
export function applyMappings(mappings: VimMapping[] = []): void {
  if (applied === mappings) return
  applied = mappings
  const vim = vimApi()
  vim.mapclear()
  for (const m of mappings) vim.map(m.before, m.after, m.mode)
}

/**
 * Vim keys in an editor while the setting is on (VSCodeVim's users find
 * theirs again): modes, motions, operators, `:` commands, with the mode
 * and pending keys in `status`. Returns the detach.
 */
export function attachVim(editor: monaco.editor.IStandaloneCodeEditor, status: HTMLElement): () => void {
  let vim: { dispose(): void } | undefined
  const apply = () => {
    const { vim: on, vimMappings } = useEditorPrefs.getState().settings
    if (on && !vim) {
      defineCommands()
      applyMappings(vimMappings)
      vim = initVimMode(editor, status)
      status.hidden = false
    } else if (!on && vim) {
      vim.dispose()
      vim = undefined
      status.hidden = true
      status.replaceChildren()
    } else if (on) applyMappings(vimMappings)
  }
  status.hidden = true
  apply()
  const unsubscribe = useEditorPrefs.subscribe((s, prev) => {
    if (s.settings !== prev.settings) apply()
  })
  return () => {
    unsubscribe()
    vim?.dispose()
  }
}

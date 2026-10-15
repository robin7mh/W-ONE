import type { Dict } from '@/lib/i18n/en'
import type { PickItem } from '@/features/editor/scm'
import { toggleFullScreen, toggleZen } from './actions'
import { keyLabel, workspaceKey } from './keys'
import { PRESETS } from './layout'
import { useWorkspace } from './store'

/** The workspace in the command palette: layouts, saved workspaces, panes, zen mode and full screen. */
export function workspaceCommands(t: Dict): PickItem[] {
  const w = t.workspace
  const s = () => useWorkspace.getState()
  return [
    ...PRESETS.map((p) => ({ id: `layout.${p}`, label: `${w.layout}: ${w.presets[p]}`, run: () => s().setPreset(p) })),
    ...s().saved.map((x, i) => ({ id: `workspace.${x.id}`, label: `${w.title}: ${x.name}`, keys: workspaceKey(i), run: () => s().apply(x.id) })),
    { id: 'workspace.split', label: `${w.title}: ${w.split}`, keys: keyLabel('split'), run: () => s().split() },
    { id: 'workspace.close', label: `${w.title}: ${w.closePane}`, keys: keyLabel('close'), run: () => s().close() },
    { id: 'workspace.maximize', label: `${w.title}: ${w.maximize}`, keys: keyLabel('maximize'), run: () => s().toggleMaximize() },
    { id: 'workspace.zen', label: `${w.title}: ${w.zen}`, keys: keyLabel('zen'), run: toggleZen },
    { id: 'workspace.fullscreen', label: `${w.title}: ${w.fullScreen}`, keys: keyLabel('fullscreen'), run: toggleFullScreen }
  ]
}

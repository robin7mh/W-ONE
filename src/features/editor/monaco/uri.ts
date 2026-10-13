/** The project file behind a model — the editor's models live at `/<projectId>/<path>`. */
export function fileOf(uri: { scheme: string; path: string }): { projectId: string; path: string } | undefined {
  const m = uri.scheme === 'file' ? /^\/([^/]+)\/(.+)$/.exec(uri.path) : null
  return m ? { projectId: m[1], path: m[2] } : undefined
}

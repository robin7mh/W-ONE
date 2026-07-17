// Deterministic project-context model (no LLM). Everything here is derived by
// reading/parsing files — never by executing project code.

export interface ContextTreeNode {
  path: string // posix, relative to project root
  type: 'file' | 'dir'
}

export type TodoKind = 'TODO' | 'FIXME' | 'HACK' | 'XXX'

export interface ContextTodo {
  file: string // posix, relative to project root
  line: number // 1-based
  kind: TodoKind
  text: string
}

export interface ContextDependency {
  name: string
  version: string
  dev: boolean
}

export interface ContextConfigFile {
  name: string // basename, e.g. tsconfig.json
  kind: string // human label, e.g. "TypeScript"
}

export interface ProjectContext {
  projectId: string
  indexedAt: string // ISO
  fileCount: number
  dirCount: number
  truncated: boolean // scan hit the file cap
  tree: ContextTreeNode[] // bounded, shallow (top levels)
  languages: string[]
  frameworks: string[]
  dependencies: ContextDependency[]
  configFiles: ContextConfigFile[]
  todos: ContextTodo[]
  readme?: { title?: string; sections: string[] }
  packageJson?: { name?: string; version?: string; scripts: string[] }
  gitCommit?: string // HEAD at index time (staleness hint)
}

/** Progress emitted while (re)indexing a large project. */
export interface ContextProgress {
  projectId: string
  filesScanned: number
  done: boolean
}

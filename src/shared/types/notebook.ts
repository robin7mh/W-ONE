// Jupyter notebooks: the .ipynb format (nbformat 4) as W-ONE reads and writes
// it, and the kernels that run its cells.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

/** Text in nbformat: one string, or lines that join to it. */
export type MultiLine = string | string[]

export type NotebookOutput =
  | { output_type: 'stream'; name: 'stdout' | 'stderr'; text: MultiLine }
  | { output_type: 'execute_result'; execution_count: number | null; data: Record<string, unknown>; metadata: Record<string, unknown> }
  | { output_type: 'display_data'; data: Record<string, unknown>; metadata: Record<string, unknown> }
  | { output_type: 'error'; ename: string; evalue: string; traceback: string[] }

export interface NotebookCell {
  /** nbformat 4.5+ (kept when the file has them). */
  id?: string
  cell_type: 'code' | 'markdown' | 'raw'
  source: MultiLine
  metadata: Record<string, unknown>
  execution_count?: number | null
  outputs?: NotebookOutput[]
  attachments?: Record<string, unknown>
}

export interface NotebookDocument {
  cells: NotebookCell[]
  metadata: {
    kernelspec?: { name: string; display_name?: string; language?: string }
    language_info?: { name?: string }
    [key: string]: unknown
  }
  nbformat: number
  nbformat_minor: number
}

/** A Jupyter kernel installed for the project's Python (`jupyter kernelspec list`). */
export interface KernelSpec {
  name: string
  displayName: string
  language: string
}

export interface KernelInfo {
  /** The Python that runs the kernels (the project's virtualenv when it has one). */
  python: string
  /** jupyter_client / ipykernel are there: kernels can start. */
  ready: boolean
  /** The project has a virtualenv (setting up installs ipykernel into it, else creates `.venv`). */
  venv: boolean
  specs: KernelSpec[]
}

export type KernelState = 'starting' | 'idle' | 'busy' | 'restarting' | 'dead'

/** What a running kernel reports, per notebook. */
export type NotebookEvent = { projectId: string; path: string } & (
  | { type: 'status'; state: KernelState }
  | { type: 'output'; cell: string; output: NotebookOutput }
  | { type: 'clear'; cell: string; wait: boolean }
  | { type: 'count'; cell: string; count: number | null }
  | { type: 'done'; cell: string }
)

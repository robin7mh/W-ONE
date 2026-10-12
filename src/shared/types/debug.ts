// The editor's debugger: a Node.js program run under the V8 inspector (what
// VS Code's JavaScript debugger speaks). Lines are 1-based; paths are
// relative to the project root.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export interface DebugBreakpoint {
  path: string
  line: number
}

export interface DebugScope {
  /** V8's scope type: local, closure, block, module, script, global, … */
  type: string
  name?: string
  objectId?: string
}

export interface DebugFrame {
  /** The call frame id (evaluations run in it). */
  id: string
  name: string
  /** Project file of the frame; absent for Node internals and files elsewhere. */
  path?: string
  /** Where V8 says the code came from (file URL, `node:internal/…`). */
  url: string
  line: number
  column: number
  scopes: DebugScope[]
}

export interface DebugSession {
  id: string
  projectId: string
  /** The program, relative to the project. */
  program: string
  status: 'starting' | 'running' | 'paused' | 'exited'
  /** Why it paused: a breakpoint, a step, an exception, the start. */
  reason?: string
  /** The exception that paused it, as V8 describes it. */
  exception?: string
  frames: DebugFrame[]
  exitCode?: number | null
  /** Starting failed (no Node, a bad program, …). */
  error?: string
}

export interface DebugVariable {
  name: string
  /** The value as the debug console prints it. */
  value: string
  type: string
  /** Set for objects, arrays, functions — their properties load on demand. */
  objectId?: string
}

export interface DebugOutput {
  sessionId: string
  stream: 'stdout' | 'stderr' | 'info'
  text: string
}

export type DebugAction = 'continue' | 'pause' | 'stepOver' | 'stepInto' | 'stepOut'

// Interactive terminal sessions (phase PT): a PTY per session in the main
// process, rendered by xterm.js. Pure module — compiles under both tsconfigs.

export interface TerminalInfo {
  id: string
  /** Tab label: project name, or `~` for the home folder. */
  title: string
  cwd: string
  /** `cwd` with the home folder shortened to `~`, for display. */
  cwdLabel: string
  /** Shell binary name, e.g. `zsh`. */
  shell: string
  projectId?: string
  createdAt: string
  /** 'agent': a coding agent's PTY (Agents module) — not listed as a terminal tab. */
  kind?: 'agent'
}

/**
 * Output chunk. `end` is the session's total emitted length after this chunk,
 * so a view that attached mid-stream (see `terminal:attach`) can drop the part
 * it already got from the scrollback buffer.
 */
export interface TerminalData {
  id: string
  data: string
  end: number
}

export interface TerminalExit {
  id: string
  exitCode: number
}

export interface TerminalAttach {
  info: TerminalInfo
  /** Recent output (bounded), for views that mount after the session started. */
  buffer: string
  end: number
}

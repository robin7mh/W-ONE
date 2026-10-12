// SFTP like the popular VS Code extension: configured in .vscode/sftp.json.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export interface SftpTarget {
  /** Its name ("name", or "name/profile" for each profile). */
  name: string
  host: string
  username?: string
  remotePath: string
  /** Local folder (relative to the project) that maps onto remotePath; '' = the project. */
  context: string
  uploadOnSave: boolean
}

export interface SftpEntry {
  name: string
  /** Relative to the target's remotePath. */
  path: string
  type: 'dir' | 'file' | 'link'
  size: number
  modified: number
}

export interface SftpProgress {
  projectId: string
  action: 'upload' | 'download'
  /** Project-relative (upload) or remote-relative (download). */
  file: string
  done: number
  total: number
}

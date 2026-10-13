// Remote-SSH and Dev Containers: Mindeck's core runs on the other machine (or
// in the container), the desktop app tunnels to it and opens a window there.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

/** A host from ~/.ssh/config. */
export interface SshHost {
  name: string
  hostName?: string
  user?: string
  port?: number
}

export type RemoteKind = 'ssh' | 'container'

export type RemoteState = 'connecting' | 'installing' | 'starting' | 'ready' | 'closed' | 'failed'

export interface RemoteConnection {
  id: string
  kind: RemoteKind
  /** "robin@build-box", "Container: my-app" */
  label: string
  state: RemoteState
  error?: string
  /** The tunnel (http://127.0.0.1:port) once ready. */
  url?: string
}

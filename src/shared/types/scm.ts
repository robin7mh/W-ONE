// Source control for the editor: git status, staging, commits, sync,
// branches, history for the graph — plus quick open and text search.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export type ScmChange = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflicted'

export interface ScmFile {
  /** Posix path relative to the project root. */
  path: string
  /** The old path of a rename or copy. */
  from?: string
  /** Change in the index (staged), against HEAD. */
  staged?: ScmChange
  /** Change in the working tree, against the index. */
  unstaged?: ScmChange
}

export interface ScmStatus {
  /** False: the folder is not a git repository (yet). */
  repo: boolean
  /** Undefined while HEAD is detached (or before the first commit: the branch to be born). */
  branch?: string
  /** Short hash of HEAD; undefined before the first commit. */
  head?: string
  upstream?: string
  ahead: number
  behind: number
  /** A merge waits for its conflicts to be resolved and committed. */
  merging: boolean
  files: ScmFile[]
}

export interface ScmBranch {
  /** `main`, or `origin/feature` for a remote branch. */
  name: string
  remote: boolean
  current: boolean
  upstream?: string
}

export interface ScmCommit {
  hash: string
  parents: string[]
  author: string
  /** Unix ms. */
  date: number
  subject: string
  /** Branch and tag names pointing here (`HEAD -> main`, `origin/main`, `tag: v1`). */
  refs: string[]
}

export interface ScmCommitFile {
  path: string
  from?: string
  change: ScmChange
}

export interface ScmCommitDetail {
  hash: string
  author: string
  email: string
  date: number
  /** The full message. */
  message: string
  files: ScmCommitFile[]
}

/** Which two versions of a file to compare. */
export type ScmDiffTarget = { kind: 'unstaged' } | { kind: 'staged' } | { kind: 'commit'; hash: string; from?: string }

export interface SearchQuery {
  query: string
  regex?: boolean
  caseSensitive?: boolean
}

export interface SearchMatch {
  path: string
  line: number
  text: string
}

export interface SearchResult {
  matches: SearchMatch[]
  /** More matches exist than were returned. */
  truncated: boolean
}

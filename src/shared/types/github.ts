// GitHub pull requests through the user's own `gh` CLI (login, tokens, Enterprise).
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export interface GitHubStatus {
  /** `gh` is on the user's PATH. */
  installed: boolean
  /** Signed in as (gh auth). */
  user?: string
  /** The project's GitHub repository, when it has one. */
  repo?: { nameWithOwner: string; url: string; defaultBranch?: string }
  /** Why there is no repository (gh's words). */
  error?: string
}

/** Mine = I opened it; review = waiting for my review. */
export type PullFilter = 'mine' | 'review' | 'all'
export type PullListState = 'open' | 'closed' | 'merged' | 'all'
export type PullState = 'OPEN' | 'CLOSED' | 'MERGED'
export type ReviewDecision = 'APPROVED' | 'CHANGES_REQUESTED' | 'REVIEW_REQUIRED'

export interface PullSummary {
  number: number
  title: string
  author: string
  head: string
  base: string
  draft: boolean
  state: PullState
  updatedAt: string
  url: string
  review?: ReviewDecision
  additions: number
  deletions: number
}

export type CheckState = 'success' | 'failure' | 'pending' | 'neutral' | 'skipped'

export interface PullCheck {
  name: string
  state: CheckState
  url?: string
}

export type PullFileChange = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'changed'

export interface PullFile {
  path: string
  change: PullFileChange
  additions: number
  deletions: number
}

/** A comment or a review, in the order they happened. */
export interface PullEvent {
  author: string
  body: string
  at: string
  kind: 'comment' | 'approved' | 'changes-requested' | 'reviewed' | 'dismissed'
}

export interface PullCommit {
  oid: string
  headline: string
  author: string
  at: string
}

export interface PullDetail extends PullSummary {
  body: string
  createdAt: string
  mergeable: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN'
  labels: string[]
  checks: PullCheck[]
  /** All changed files; `files` holds the first 100 (gh's limit). */
  changedFiles: number
  files: PullFile[]
  events: PullEvent[]
  commits: PullCommit[]
}

/** One file of a pull request: merge base vs. head. */
export interface PullFileDiff {
  path: string
  original: string
  modified: string
}

export interface PullCreate {
  title: string
  body: string
  base?: string
  draft?: boolean
}

export type MergeMethod = 'merge' | 'squash' | 'rebase'
export type ReviewAction = 'approve' | 'request-changes' | 'comment'

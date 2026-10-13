// The test explorer: tests found in the project (without running anything),
// run by the project's own runner — Vitest, Jest, pytest, go test.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

export type TestFramework = 'vitest' | 'jest' | 'pytest' | 'go'

export interface TestItem {
  /** `file`, `file::Suite > test` (JS), pytest's node id, `dir::TestName` (Go). */
  id: string
  name: string
  kind: 'file' | 'suite' | 'test'
  framework: TestFramework
  /** Project-relative file. */
  path: string
  /** 1-based line of the definition. */
  line?: number
  children?: TestItem[]
}

export type TestState = 'running' | 'passed' | 'failed' | 'skipped'

export interface TestResult {
  state: TestState
  durationMs?: number
  /** Why it failed (the assertion's message). */
  message?: string
}

export interface TestRunState {
  projectId: string
  running: boolean
  /** Results by test id (files and suites summarise their tests). */
  results: Record<string, TestResult>
  /** What the runner printed, for the output view. */
  output: string
}

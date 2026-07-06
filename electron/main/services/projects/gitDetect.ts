import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { GitInfo } from '@shared/types/project'

const exec = promisify(execFile)

/** Run a git subcommand read-only in `cwd`. Args are an array — never a shell string. */
async function git(cwd: string, args: string[], timeout = 6000): Promise<string> {
  const { stdout } = await exec('git', args, { cwd, timeout, windowsHide: true })
  return stdout.trim()
}

/**
 * Deterministic, read-only Git inspection. Never mutates the repo. Every optional
 * probe is independently guarded so a shallow/detached/upstream-less repo still
 * returns partial info instead of failing.
 */
export async function detectGit(cwd: string): Promise<GitInfo> {
  try {
    await git(cwd, ['rev-parse', '--is-inside-work-tree'])
  } catch {
    return { isRepo: false }
  }

  const info: GitInfo = { isRepo: true }

  try {
    info.branch = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
  } catch {
    /* detached HEAD or empty repo */
  }

  try {
    const status = await git(cwd, ['status', '--porcelain'], 8000)
    info.dirty = status.length > 0
  } catch {
    /* ignore */
  }

  // ahead/behind vs. upstream (only if an upstream is configured)
  try {
    const counts = await git(cwd, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
    const [behind, ahead] = counts.split(/\s+/).map((n) => Number.parseInt(n, 10))
    if (Number.isFinite(behind)) info.behind = behind
    if (Number.isFinite(ahead)) info.ahead = ahead
  } catch {
    /* no upstream */
  }

  try {
    // %x1f = unit separator, safe against subjects containing spaces/pipes
    const line = await git(cwd, ['log', '-1', '--pretty=%H%x1f%s%x1f%an%x1f%cI'])
    if (line) {
      const [hash, subject, author, date] = line.split('\x1f')
      info.lastCommit = { hash, subject, author, date }
    }
  } catch {
    /* empty repo, no commits */
  }

  return info
}

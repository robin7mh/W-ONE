import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FileChange } from '@shared/types/agents'

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** Run git with array args (never a shell string); optional stdin. Rejects with stderr on failure. */
function git(cwd: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, windowsHide: true })
    let out = ''
    let err = ''
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err += d))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(coded('git', err.trim() || `git ${args[0]} failed (${code})`))))
    child.stdin.end(input)
  })
}

const lines = (s: string) => s.split('\n').filter(Boolean)

/** Pathspecs for "everything except …" (e.g. a node_modules link in a worktree). */
const except = (exclude: string[]) => (exclude.length ? ['--', '.', ...exclude.map((p) => `:(exclude)${p}`)] : [])

/** Where an agent session started: the commit to diff against, plus files that were already untracked. */
export interface GitBaseline {
  base: string
  untracked: string[]
}

/**
 * The git side of the agent cockpit: a baseline when a session starts, what
 * changed since, the old version of a file, and isolated worktrees for agents
 * that work in parallel. Read-only on the user's project except `applyTo`,
 * which the user triggers explicitly ("Übernehmen").
 */
export class GitService {
  async isRepo(cwd: string): Promise<boolean> {
    return git(cwd, ['rev-parse', '--is-inside-work-tree']).then(
      (out) => out.trim() === 'true',
      () => false
    )
  }

  /**
   * The working tree as it is now, without touching it: `git stash create`
   * makes a commit of uncommitted edits (empty output when clean → HEAD).
   * Null outside a repo or before the first commit.
   */
  async baseline(cwd: string): Promise<GitBaseline | null> {
    try {
      const stash = (await git(cwd, ['stash', 'create'])).trim()
      const base = stash || (await git(cwd, ['rev-parse', 'HEAD'])).trim()
      return { base, untracked: lines(await git(cwd, ['ls-files', '--others', '--exclude-standard'])) }
    } catch {
      return null
    }
  }

  /** Files changed since the baseline (tracked diff + files that became untracked since). */
  async changes(cwd: string, from: GitBaseline, exclude: string[] = []): Promise<FileChange[]> {
    const [numstat, names, untracked] = await Promise.all([
      git(cwd, ['diff', '--no-renames', '--numstat', from.base, ...except(exclude)]),
      git(cwd, ['diff', '--no-renames', '--name-status', from.base, ...except(exclude)]),
      git(cwd, ['ls-files', '--others', '--exclude-standard', ...except(exclude)])
    ])
    const status = new Map(lines(names).map((l) => [l.slice(l.indexOf('\t') + 1), l[0]]))
    const changes: FileChange[] = lines(numstat).map((l) => {
      const [added, removed, path] = l.split('\t')
      const s = status.get(path)
      return {
        path,
        status: s === 'A' ? 'added' : s === 'D' ? 'deleted' : 'modified',
        added: added === '-' ? 0 : Number(added),
        removed: removed === '-' ? 0 : Number(removed)
      }
    })
    const before = new Set(from.untracked)
    for (const path of lines(untracked)) {
      if (before.has(path)) continue
      const text = await readFile(join(cwd, path), 'utf8').catch(() => '')
      changes.push({ path, status: 'added', added: text.includes('\0') ? 0 : lines(text).length, removed: 0 })
    }
    return changes.sort((a, b) => a.path.localeCompare(b.path))
  }

  /** A file's content at the baseline ('' if it did not exist then). */
  async fileAt(cwd: string, base: string, path: string): Promise<string> {
    return git(cwd, ['show', `${base}:${path}`]).catch(() => '')
  }

  /** A new worktree on a new branch from HEAD, for an agent working in parallel. */
  async addWorktree(repo: string, dir: string, branch: string): Promise<void> {
    await git(repo, ['worktree', 'add', '-b', branch, dir, 'HEAD'])
  }

  /** Remove a worktree and its branch (best effort for the branch). */
  async removeWorktree(repo: string, dir: string, branch: string): Promise<void> {
    await git(repo, ['worktree', 'remove', '--force', dir])
    await git(repo, ['branch', '-D', branch]).catch(() => '')
  }

  /**
   * Bring a worktree's changes (committed or not, new files included) into the
   * project as uncommitted edits. Refuses with `conflict` — touching nothing —
   * when they don't apply cleanly; the worktree stays as it is.
   */
  async applyTo(repo: string, worktree: string, base: string, exclude: string[] = []): Promise<number> {
    await git(worktree, ['add', '-A', ...except(exclude)])
    const patch = await git(worktree, ['diff', '--binary', '--cached', base])
    if (!patch.trim()) return 0
    await git(repo, ['apply', '--whitespace=nowarn', '-'], patch).catch((err: Error) => {
      throw coded('conflict', `The changes don't apply cleanly to the project: ${err.message}`)
    })
    return lines(await git(worktree, ['diff', '--cached', '--name-only', base])).length
  }
}

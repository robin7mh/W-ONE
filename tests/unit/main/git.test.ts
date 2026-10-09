import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './helpers'
import { GitService, remoteWebUrl } from '../../../electron/main/services/git/GitService'

const sh = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

/** A repo with one commit: a.txt (2 lines) and gone.txt; plus an untracked old.txt. */
async function repo(): Promise<string> {
  const dir = await tempDir('wone-git-')
  sh(dir, 'init', '-q', '-b', 'main')
  sh(dir, 'config', 'user.email', 't@t')
  sh(dir, 'config', 'user.name', 'T')
  await writeFile(join(dir, 'a.txt'), 'one\ntwo\n')
  await writeFile(join(dir, 'gone.txt'), 'x\n')
  sh(dir, 'add', '.')
  sh(dir, 'commit', '-q', '-m', 'init')
  await writeFile(join(dir, 'old.txt'), 'already untracked\n')
  return dir
}

const git = new GitService()

describe('GitService', () => {
  it('knows repos; no baseline outside a repo or before the first commit', async () => {
    const plain = await tempDir()
    expect(await git.isRepo(plain)).toBe(false)
    expect(await git.baseline(plain)).toBeNull()
    sh(plain, 'init', '-q')
    expect(await git.isRepo(plain)).toBe(true)
    expect(await git.baseline(plain)).toBeNull()
  })

  it('baseline keeps uncommitted edits out of the session diff; changes lists what the agent did', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\nmine (before the agent)\n')
    const start = (await git.baseline(dir))!
    expect(start.base).toMatch(/^[0-9a-f]{40}$/)
    expect(start.base).not.toBe(sh(dir, 'rev-parse', 'HEAD').trim()) // the stash commit
    expect(start.untracked).toEqual(['old.txt'])
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toContain('mine') // working tree untouched

    // the agent: edits a.txt, deletes gone.txt, adds new.ts and a binary file
    await writeFile(join(dir, 'a.txt'), 'one\nTWO\nmine (before the agent)\nagent\n')
    await rm(join(dir, 'gone.txt'))
    await mkdir(join(dir, 'src'))
    await writeFile(join(dir, 'src', 'new.ts'), 'export const x = 1\nexport const y = 2\n')
    await writeFile(join(dir, 'logo.bin'), Buffer.from([0, 1, 2]))
    await writeFile(join(dir, 'staged.ts'), 'x\n')
    sh(dir, 'add', 'staged.ts') // a new file the agent already staged
    expect(await git.changes(dir, start)).toEqual([
      { path: 'a.txt', status: 'modified', added: 2, removed: 1 },
      { path: 'gone.txt', status: 'deleted', added: 0, removed: 1 },
      { path: 'logo.bin', status: 'added', added: 0, removed: 0 },
      { path: 'src/new.ts', status: 'added', added: 2, removed: 0 },
      { path: 'staged.ts', status: 'added', added: 1, removed: 0 }
    ])
    expect(await git.fileAt(dir, start.base, 'a.txt')).toBe('one\ntwo\nmine (before the agent)\n')
    expect(await git.fileAt(dir, start.base, 'src/new.ts')).toBe('')
  })

  it('a clean tree uses HEAD; binary diffs count as 0 lines', async () => {
    const dir = await repo()
    await writeFile(join(dir, 'pic.bin'), Buffer.from([0, 9]))
    sh(dir, 'add', 'pic.bin')
    sh(dir, 'commit', '-q', '-m', 'bin')
    const start = (await git.baseline(dir))!
    expect(start.base).toBe(sh(dir, 'rev-parse', 'HEAD').trim())
    await writeFile(join(dir, 'pic.bin'), Buffer.from([0, 8, 7]))
    expect(await git.changes(dir, start)).toEqual([{ path: 'pic.bin', status: 'modified', added: 0, removed: 0 }])
  })

  it('worktrees: add, apply into the project (new files too, a node_modules link left out), remove with the branch', async () => {
    const dir = await repo()
    const wt = join(await tempDir(), 'wt')
    await git.addWorktree(dir, wt, 'wone/test')
    expect(existsSync(join(wt, 'a.txt'))).toBe(true)
    const start = (await git.baseline(wt))!
    expect(await git.applyTo(dir, wt, start.base)).toBe(0) // nothing yet

    await writeFile(join(wt, 'a.txt'), 'one\ntwo\nfrom the agent\n')
    await writeFile(join(wt, 'added.txt'), 'new\n')
    sh(wt, 'add', 'a.txt')
    sh(wt, 'commit', '-q', '-m', 'agent commit') // committed or not — both come over
    await symlink(join(dir, 'a.txt'), join(wt, 'node_modules'))
    expect((await git.changes(wt, start)).map((c) => c.path)).toContain('node_modules')
    expect((await git.changes(wt, start, ['node_modules'])).map((c) => c.path)).toEqual(['a.txt', 'added.txt'])

    expect(await git.applyTo(dir, wt, start.base, ['node_modules'])).toBe(2)
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('one\ntwo\nfrom the agent\n')
    expect(await readFile(join(dir, 'added.txt'), 'utf8')).toBe('new\n')
    expect(existsSync(join(dir, 'node_modules'))).toBe(false)

    await git.removeWorktree(dir, wt, 'wone/test')
    expect(existsSync(wt)).toBe(false)
    expect(sh(dir, 'branch', '--list', 'wone/test')).toBe('')
    await expect(git.removeWorktree(dir, wt, 'wone/test')).rejects.toMatchObject({ code: 'git' })
  })

  it('refuses a patch that does not apply, touching nothing', async () => {
    const dir = await repo()
    const wt = join(await tempDir(), 'wt')
    await git.addWorktree(dir, wt, 'wone/clash')
    const start = (await git.baseline(wt))!
    await writeFile(join(wt, 'a.txt'), 'one\nagent\n')
    await writeFile(join(dir, 'a.txt'), 'totally\ndifferent\n')
    await expect(git.applyTo(dir, wt, start.base)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(join(dir, 'a.txt'), 'utf8')).toBe('totally\ndifferent\n')
    // a branch that exists already: git's own error comes through
    await expect(git.addWorktree(dir, join(await tempDir(), 'wt2'), 'wone/clash')).rejects.toMatchObject({ code: 'git' })
  })

  it('the repo page from origin; none without a remote', async () => {
    const dir = await repo()
    expect(await git.webUrl(dir)).toBeUndefined()
    sh(dir, 'remote', 'add', 'origin', 'git@github.com:me/demo.git')
    expect(await git.webUrl(dir)).toBe('https://github.com/me/demo')
  })

  it('remote addresses become web pages, never with credentials', () => {
    expect(remoteWebUrl('git@github.com:me/demo.git')).toBe('https://github.com/me/demo')
    expect(remoteWebUrl('ssh://git@gitlab.com:22/group/sub/demo.git')).toBe('https://gitlab.com/group/sub/demo')
    expect(remoteWebUrl('ssh://git@example.org/me/demo')).toBe('https://example.org/me/demo')
    expect(remoteWebUrl('https://user:ghp_secret@github.com/me/demo.git\n')).toBe('https://github.com/me/demo')
    expect(remoteWebUrl('https://git.example.org:8443/me/demo/')).toBe('https://git.example.org:8443/me/demo')
    expect(remoteWebUrl('http://github.com/me/demo')).toBe('https://github.com/me/demo')
    expect(remoteWebUrl('/srv/repos/demo.git')).toBeUndefined()
    expect(remoteWebUrl('https://github.com/demo')).toBeUndefined()
    expect(remoteWebUrl('file:///srv/demo.git')).toBeUndefined()
  })

  it('reports a missing git binary as an error', async () => {
    const saved = process.env.PATH
    process.env.PATH = ''
    try {
      await expect(git.addWorktree(await tempDir(), '/x', 'b')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      process.env.PATH = saved
    }
  })
})

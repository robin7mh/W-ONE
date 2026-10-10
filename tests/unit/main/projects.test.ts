import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tempDir } from './helpers'

// --- programmable child_process.execFile -----------------------------------
type Reply = string | Error
const proc = vi.hoisted(() => {
  const calls: { cmd: string; args: string[]; opts?: unknown }[] = []
  let responder: (cmd: string, args: string[]) => Reply = () => ''
  const execFile = Object.assign(vi.fn(), {})
  return {
    calls,
    execFile,
    setResponder: (fn: (cmd: string, args: string[]) => Reply) => {
      responder = fn
    },
    run: async (cmd: string, args: string[], opts?: unknown) => {
      calls.push({ cmd, args, opts })
      const r = responder(cmd, args)
      if (r instanceof Error) throw r
      return { stdout: r, stderr: '' }
    }
  }
})
vi.mock('node:child_process', () => {
  const execFile = (() => {}) as unknown as Record<symbol, unknown>
  execFile[promisify.custom] = proc.run
  return { execFile }
})

const electron = vi.hoisted(() => ({
  showOpenDialog: vi.fn(),
  openPath: vi.fn(async () => ''),
  openExternal: vi.fn(async () => {}),
  appForProtocol: vi.fn((_url: string) => ''),
  encryption: true
}))
vi.mock('electron', () => ({
  app: { getApplicationNameForProtocol: electron.appForProtocol },
  dialog: { showOpenDialog: electron.showOpenDialog },
  shell: { openPath: electron.openPath, openExternal: electron.openExternal },
  safeStorage: {
    isEncryptionAvailable: () => electron.encryption,
    encryptString: (s: string) => Buffer.from(`enc:${s}`),
    decryptString: (b: Buffer) => b.toString().replace(/^enc:/, '')
  }
}))

import { detectGit } from '../../../electron/main/services/projects/gitDetect'
import { detectStack } from '../../../electron/main/services/projects/stackDetect'
import { ProjectService } from '../../../electron/main/services/projects/ProjectService'
import { ProjectRegistry } from '../../../electron/main/services/projects/registry'
import { electronCipher, electronPlatform } from '../../../electron/main/platform/electron'
import { headlessPlatform } from '../../../electron/main/platform/headless'
import { openInVsCode } from '../../../electron/main/lib/openInVsCode'

const realPlatform = process.platform
const setPlatform = (p: NodeJS.Platform) => Object.defineProperty(process, 'platform', { value: p })

beforeEach(() => {
  proc.calls.length = 0
  proc.setResponder(() => '')
})
afterEach(() => setPlatform(realPlatform))

describe('detectGit', () => {
  it('reports non-repos', async () => {
    proc.setResponder(() => new Error('not a git repository'))
    expect(await detectGit('/x')).toEqual({ isRepo: false })
  })

  it('collects branch, dirty state, ahead/behind and the last commit', async () => {
    proc.setResponder((_cmd, args) => {
      const key = args.join(' ')
      if (key.startsWith('rev-parse --is-inside')) return 'true'
      if (key.startsWith('rev-parse --abbrev-ref')) return 'main'
      if (key.startsWith('status')) return ' M file.ts'
      if (key.startsWith('rev-list')) return '2\t5'
      return 'abc123\x1ffix: thing\x1fRobin\x1f2026-10-01T10:00:00+02:00'
    })
    expect(await detectGit('/x')).toEqual({
      isRepo: true,
      branch: 'main',
      dirty: true,
      behind: 2,
      ahead: 5,
      lastCommit: { hash: 'abc123', subject: 'fix: thing', author: 'Robin', date: '2026-10-01T10:00:00+02:00' }
    })
    expect(proc.calls.every((c) => c.cmd === 'git')).toBe(true)
  })

  it('keeps partial info when every optional probe fails or is empty', async () => {
    proc.setResponder((_cmd, args) => (args[0] === 'rev-parse' && args[1] === '--is-inside-work-tree' ? 'true' : new Error('x')))
    expect(await detectGit('/x')).toEqual({ isRepo: true })

    proc.setResponder((_cmd, args) => {
      const key = args.join(' ')
      if (key.startsWith('status')) return ''
      if (key.startsWith('rev-list')) return 'garbage'
      if (key.startsWith('log')) return ''
      return 'HEAD'
    })
    expect(await detectGit('/x')).toEqual({ isRepo: true, branch: 'HEAD', dirty: false })
  })

  it('links the repo page from origin, without credentials', async () => {
    proc.setResponder((_cmd, args) => (args[0] === 'remote' ? 'https://robin:token@github.com/robin7mh/testing-games.git' : 'true'))
    expect((await detectGit('/x')).webUrl).toBe('https://github.com/robin7mh/testing-games')
  })
})

describe('detectStack', () => {
  const make = async (files: Record<string, string>) => {
    const dir = await tempDir()
    for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content)
    return dir
  }

  it('reads package.json: name, version, scripts, TS and frameworks; npm lockfile', async () => {
    const dir = await make({
      'package.json': JSON.stringify({
        name: 'app',
        version: '1.0.0',
        scripts: { dev: 'x', build: 'y' },
        dependencies: { react: '1', next: '1' },
        devDependencies: { typescript: '5', tailwindcss: '3' }
      }),
      'package-lock.json': '{}',
      'README.md': '#',
      'tailwind.config.ts': ''
    })
    expect(await detectStack(dir)).toEqual({
      languages: ['JavaScript', 'TypeScript'],
      frameworks: ['React', 'Next.js', 'Tailwind'],
      packageManager: 'npm',
      hasReadme: true,
      packageJson: { name: 'app', version: '1.0.0', scripts: ['dev', 'build'] }
    })
  })

  it.each([
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'],
    ['nothing.txt', undefined]
  ])('detects the package manager from %s', async (lock, pm) => {
    const dir = await make({ 'package.json': '{}', [lock]: '' })
    const stack = await detectStack(dir)
    expect(stack.packageManager).toBe(pm)
    expect(stack.packageJson).toEqual({ name: undefined, version: undefined, scripts: [] })
  })

  it('survives malformed package.json and non-object scripts; TS via tsconfig', async () => {
    const bad = await make({ 'package.json': '{oops', 'tsconfig.json': '{}' })
    expect(await detectStack(bad)).toMatchObject({ languages: ['JavaScript', 'TypeScript'], frameworks: [], packageJson: undefined })

    const odd = await make({ 'package.json': JSON.stringify({ name: 5, scripts: 'nope' }), 'tsconfig.json': '{}' })
    expect((await detectStack(odd)).packageJson).toEqual({ name: undefined, version: undefined, scripts: [] })
  })

  it('recognizes other ecosystems, Docker, standalone Tailwind and readme variants', async () => {
    const dir = await make({
      'Cargo.toml': '',
      'go.mod': '',
      'pyproject.toml': '',
      'Gemfile': '',
      'build.gradle.kts': '',
      'docker-compose.yml': '',
      'tailwind.config.js': '',
      readme: ''
    })
    expect(await detectStack(dir)).toEqual({
      languages: ['Rust', 'Go', 'Python', 'Ruby', 'Java'],
      frameworks: ['Docker', 'Tailwind'],
      packageManager: undefined,
      hasReadme: true,
      packageJson: undefined
    })
    for (const f of ['requirements.txt', 'setup.py', 'pom.xml', 'build.gradle', 'Dockerfile']) {
      const one = await make({ [f]: '' })
      const s = await detectStack(one)
      expect(s.languages.length + s.frameworks.length).toBe(1)
    }
  })

  it('returns an empty stack for unreadable directories', async () => {
    expect(await detectStack('/definitely/not/here')).toEqual({
      languages: [],
      frameworks: [],
      packageManager: undefined,
      hasReadme: false,
      packageJson: undefined
    })
  })
})

describe('ProjectService', () => {
  const setup = async () => {
    const data = await tempDir()
    const service = new ProjectService(new ProjectRegistry(data), electronPlatform)
    await service.init()
    return service
  }

  it('encrypts secrets with the OS keychain when available', () => {
    const cipher = electronCipher()!
    const stored = cipher.encrypt('key')
    expect(stored).toBe(Buffer.from('enc:key').toString('base64'))
    expect(cipher.decrypt(stored)).toBe('key')
    electron.encryption = false
    expect(electronCipher()).toBeUndefined()
    electron.encryption = true
  })

  it('refuses the picker and opening files on a headless host', async () => {
    const data = await tempDir()
    const s = new ProjectService(new ProjectRegistry(data), headlessPlatform)
    await s.init()
    await expect(s.pickFolder()).rejects.toMatchObject({ code: 'desktop-only' })
    const dir = await tempDir()
    proc.setResponder(() => new Error('nothing installed'))
    const { id } = await s.add(dir)
    await expect(s.openFile(id, '.')).rejects.toMatchObject({ code: 'desktop-only' })
  })

  it('picks a folder via the native dialog, or returns null on cancel', async () => {
    const s = await setup()
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/picked'] })
    expect(await s.pickFolder()).toEqual({ path: '/picked' })
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await s.pickFolder()).toBeNull()
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [] })
    expect(await s.pickFolder()).toBeNull()
  })

  it('adds a project (name from package.json or folder), refreshes duplicates, removes', async () => {
    const s = await setup()
    const dir = await tempDir('my-app-')
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: '  shiny  ' }))
    proc.setResponder(() => new Error('no git'))

    const p = await s.add(dir)
    expect(p).toMatchObject({ name: 'shiny', git: { isRepo: false } })
    expect(s.list()).toHaveLength(1)
    expect(s.getProjectPath(p.id)).toBe(p.path)

    const again = await s.add(dir) // idempotent → refresh
    expect(again.id).toBe(p.id)
    expect(s.list()).toHaveLength(1)

    await writeFile(join(dir, 'package.json'), JSON.stringify({}))
    expect((await s.refresh(p.id)).name).toBe('shiny') // keeps the old name without package name

    const plain = await tempDir('plain-')
    expect((await s.add(plain)).name).toMatch(/^plain-/)

    await s.remove(p.id)
    expect(s.getProjectPath(p.id)).toBeUndefined()
    await expect(s.refresh('nope')).rejects.toThrow('Unknown project: nope')
  })

  it('rejects files and missing paths', async () => {
    const s = await setup()
    const dir = await tempDir()
    await writeFile(join(dir, 'f.txt'), 'x')
    await expect(s.add(join(dir, 'f.txt'))).rejects.toThrow('not a directory')
    await expect(s.add(join(dir, 'missing'))).rejects.toThrow()
  })

  describe('openInEditor', () => {
    it('uses `code`, then `open -a` on macOS, then the OS default', async () => {
      const s = await setup()
      const dir = await tempDir()
      proc.setResponder(() => new Error('no git'))
      const { id } = await s.add(dir)

      proc.setResponder(() => '')
      await s.openInEditor(id)
      expect(proc.calls.at(-1)).toMatchObject({ cmd: 'code' })

      setPlatform('darwin')
      proc.setResponder((cmd) => (cmd === 'code' ? new Error('missing') : ''))
      await s.openInEditor(id)
      expect(proc.calls.at(-1)).toMatchObject({ cmd: 'open', args: ['-a', 'Visual Studio Code', dir.replace(/^\/var\//, '/private/var/')] })

      proc.setResponder(() => new Error('missing'))
      await s.openInEditor(id)
      expect(electron.openPath).toHaveBeenCalled()

      setPlatform('linux')
      electron.openPath.mockResolvedValueOnce('could not open')
      await expect(s.openInEditor(id)).rejects.toThrow('could not open')
    })

    it('without VS Code and without a desktop: desktop-only', async () => {
      proc.setResponder(() => new Error('missing'))
      await expect(openInVsCode('/somewhere', {})).rejects.toMatchObject({ code: 'desktop-only' })
    })
  })

  describe('openFile', () => {
    it('opens inside the project (with a line), falls back, and refuses escapes', async () => {
      const s = await setup()
      const dir = await tempDir()
      await writeFile(join(dir, 'a.ts'), '')
      proc.setResponder(() => new Error('no git'))
      const { id, path } = await s.add(dir)

      proc.setResponder(() => '')
      await s.openFile(id, 'a.ts', 12)
      expect(proc.calls.at(-1)).toMatchObject({ cmd: 'code', args: ['-g', `${join(path, 'a.ts')}:12`] })
      await s.openFile(id, 'a.ts', 0)
      expect(proc.calls.at(-1)?.args).toEqual(['-g', join(path, 'a.ts')])
      await s.openFile(id, '.') // the root itself is allowed
      await s.openFile(id, 'not-yet-there.ts') // realpath fails → lexical target

      proc.setResponder(() => new Error('no code'))
      await s.openFile(id, 'a.ts')
      expect(electron.openPath).toHaveBeenLastCalledWith(join(path, 'a.ts'))
      electron.openPath.mockResolvedValueOnce('nope')
      await expect(s.openFile(id, 'a.ts')).rejects.toThrow('nope')

      await expect(s.openFile(id, '../../etc/passwd')).rejects.toThrow('outside the project')
      const outside = await tempDir()
      await mkdir(join(dir, 'sub'))
      await symlink(outside, join(dir, 'sub', 'link'))
      await expect(s.openFile(id, 'sub/link')).rejects.toThrow('outside the project')
    })
  })

  it("pull: fast-forward only, then fresh detection; git's own reason when it fails", async () => {
    const s = await setup()
    proc.setResponder(() => new Error('no git'))
    const { id } = await s.add(await tempDir())
    proc.setResponder(() => '')
    await s.pull(id)
    expect(proc.calls.find((c) => c.args[0] === 'pull')).toMatchObject({ cmd: 'git', args: ['pull', '--ff-only', '--quiet'] })
    proc.setResponder((_c, args) =>
      args[0] === 'pull' ? Object.assign(new Error('Command failed: git pull'), { stderr: 'fatal: Not possible to fast-forward, aborting.\nmore' }) : ''
    )
    await expect(s.pull(id)).rejects.toMatchObject({ code: 'pull-failed', message: 'fatal: Not possible to fast-forward, aborting.' })
    proc.setResponder((_c, args) => (args[0] === 'pull' ? new Error('spawn git ENOENT') : ''))
    await expect(s.pull(id)).rejects.toMatchObject({ code: 'pull-failed', message: 'spawn git ENOENT' })
  })

  it('GitHub Desktop: found by its link scheme, opens the project folder; absent on a headless host', async () => {
    const s = await setup()
    proc.setResponder(() => new Error('no git'))
    const dir = await tempDir('my repo-')
    const { id } = await s.add(dir)

    expect(s.githubDesktop()).toBeNull()
    electron.appForProtocol.mockReturnValueOnce('GitHub Desktop')
    expect(s.githubDesktop()).toBe('GitHub Desktop')
    expect(electron.appForProtocol).toHaveBeenLastCalledWith('x-github-client://')
    await s.openInGitHubDesktop(id)
    expect(electron.openExternal).toHaveBeenCalledWith(`x-github-client://openLocalRepo/${encodeURIComponent(s.getProjectPath(id)!)}`)

    const headless = new ProjectService(new ProjectRegistry(await tempDir()), headlessPlatform)
    await headless.init()
    const other = await headless.add(dir)
    expect(headless.githubDesktop()).toBeNull()
    await expect(headless.openInGitHubDesktop(other.id)).rejects.toMatchObject({ code: 'desktop-only' })
  })
})

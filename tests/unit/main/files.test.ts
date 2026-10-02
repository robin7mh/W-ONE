import { chmod, mkdir, readFile, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './helpers'
import { FilesService, MAX_EDIT_BYTES } from '../../../electron/main/services/files/FilesService'

async function project(files: Record<string, string | Buffer>) {
  const root = await tempDir('wone-files-')
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true })
    await writeFile(join(root, rel), body)
  }
  const service = new FilesService((id) => (id === 'p' ? root : undefined))
  return { root, service }
}

describe('FilesService', () => {
  it('lists one folder: dirs first, natural order, .git hidden, gitignored marked', async () => {
    const { root, service } = await project({
      '.gitignore': 'node_modules\n*.log\n',
      '.git/HEAD': 'ref',
      '.DS_Store': '',
      'file10.ts': '',
      'file2.ts': '',
      'debug.log': '',
      'src/App.tsx': '',
      'node_modules/react/index.js': '',
      'a-dir/x': ''
    })
    await symlink(join(root, 'src'), join(root, 'linked-src'))
    await symlink(join(root, 'file2.ts'), join(root, 'linked.ts'))
    await symlink(join(root, 'missing'), join(root, 'dangling'))

    const top = await service.list('p')
    expect(top.map((e) => `${e.kind}:${e.path}${e.ignored ? ' (ignored)' : ''}`)).toEqual([
      'dir:a-dir',
      'dir:linked-src',
      'dir:node_modules (ignored)',
      'dir:src',
      'file:.gitignore',
      'file:debug.log (ignored)',
      'file:file2.ts',
      'file:file10.ts',
      'file:linked.ts'
    ])
    expect(await service.list('p', 'node_modules/react')).toEqual([
      { name: 'index.js', path: 'node_modules/react/index.js', kind: 'file', ignored: true }
    ])
    // Any spelling of the folder yields the same normalized paths.
    expect((await service.list('p', './src/'))[0].path).toBe('src/App.tsx')
  })

  it('lists without a .gitignore; refuses unknown projects and paths outside', async () => {
    const { root, service } = await project({ 'a.txt': '' })
    expect(await service.list('p', '')).toEqual([{ name: 'a.txt', path: 'a.txt', kind: 'file', ignored: false }])
    await expect(service.list('nope')).rejects.toMatchObject({ code: 'not-found' })
    await expect(service.list('p', '..')).rejects.toMatchObject({ code: 'outside-project' })
    await symlink(dirname(root), join(root, 'escape'))
    await expect(service.read('p', 'escape/x.txt')).rejects.toMatchObject({ code: 'outside-project' })
  })

  it('reads text, flags binary and oversized files, refuses folders and missing files', async () => {
    const { root, service } = await project({ 'a.ts': 'const a = 1\r\n', 'img.png': Buffer.from([137, 80, 0, 71]), 'dir/x': '' })
    const text = await service.read('p', 'a.ts')
    expect(text).toMatchObject({ path: 'a.ts', content: 'const a = 1\r\n', size: 13 })
    expect(text.mtimeMs).toBe((await stat(join(root, 'a.ts'))).mtimeMs)
    expect(await service.read('p', 'img.png')).toMatchObject({ unsupported: 'binary', size: 4 })
    expect((await service.read('p', 'img.png')).content).toBeUndefined()

    await writeFile(join(root, 'big.txt'), Buffer.alloc(MAX_EDIT_BYTES + 1, 'a'))
    expect(await service.read('p', 'big.txt')).toMatchObject({ unsupported: 'too-large' })

    await expect(service.read('p', 'dir')).rejects.toMatchObject({ code: 'not-a-file' })
    await expect(service.read('p', 'gone.ts')).rejects.toMatchObject({ code: 'not-found' })
    await expect(service.read('p', 'a.ts/x')).rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('stats many paths; gone, folders and outside paths are null', async () => {
    const { root, service } = await project({ 'a.ts': 'abc', 'dir/x': '' })
    const [a, dir, gone, outside] = await service.stat('p', ['a.ts', 'dir', 'gone.ts', '../x'])
    expect(a).toEqual({ mtimeMs: (await stat(join(root, 'a.ts'))).mtimeMs, size: 3 })
    expect([dir, gone, outside]).toEqual([null, null, null])
  })

  it('writes in place, keeps the file mode, and refuses when the disk copy is newer', async () => {
    const { root, service } = await project({ 'run.sh': 'echo 1\n' })
    const file = join(root, 'run.sh')
    await chmod(file, 0o755)
    const opened = await service.read('p', 'run.sh')

    const saved = await service.write('p', 'run.sh', 'echo 2\n', opened.mtimeMs)
    expect(await readFile(file, 'utf8')).toBe('echo 2\n')
    expect(saved).toEqual({ mtimeMs: (await stat(file)).mtimeMs, size: 7 })
    expect((await stat(file)).mode & 0o777).toBe(0o755)

    // Someone else edits the file → the stale editor copy is refused…
    await utimes(file, new Date(), new Date(Date.now() + 5000))
    await expect(service.write('p', 'run.sh', 'mine', saved.mtimeMs)).rejects.toMatchObject({ code: 'conflict' })
    expect(await readFile(file, 'utf8')).toBe('echo 2\n')
    // …unless the user chose to overwrite (no expected mtime).
    await service.write('p', 'run.sh', 'mine')
    expect(await readFile(file, 'utf8')).toBe('mine')
  })

  it('recreates a file deleted meanwhile (with its folder); refuses folders and broken paths', async () => {
    const { root, service } = await project({ 'dir/x': '' })
    await service.write('p', 'new/deep/a.ts', 'x', 123)
    expect(await readFile(join(root, 'new/deep/a.ts'), 'utf8')).toBe('x')
    await expect(service.write('p', 'dir', 'x')).rejects.toMatchObject({ code: 'not-a-file' })
    await expect(service.write('p', 'dir/x/y', 'x')).rejects.toMatchObject({ code: 'ENOTDIR' })
    await expect(service.write('p', '../evil.ts', 'x')).rejects.toMatchObject({ code: 'outside-project' })
  })
})

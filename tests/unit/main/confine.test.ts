import { mkdir, realpath, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { tempDir } from './helpers'

// Every path the disk is asked about.
const probed = vi.hoisted(() => [] as string[])
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    existsSync: (p: string) => {
      probed.push(String(p))
      return real.existsSync(p)
    }
  }
})

import { confine } from '../../../electron/main/lib/confine'

describe('confine', () => {
  it('resolves inside the project, following links; a target may not exist yet', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'src'))
    const real = await realpath(root)
    expect(await confine(root, 'src/new/file.ts')).toBe(join(real, 'src', 'new', 'file.ts'))
    expect(await confine(root, '.')).toBe(real)
    await symlink(await tempDir(), join(root, 'out'))
    await expect(confine(root, 'out/new.ts')).rejects.toMatchObject({ code: 'outside-project' })
  })

  it('refuses a path outside as written before asking the disk (a UNC path would send the user’s credentials)', async () => {
    const root = await tempDir()
    probed.length = 0
    await expect(confine(root, '/somewhere/else')).rejects.toMatchObject({ code: 'outside-project' })
    await expect(confine(root, '../../etc/passwd')).rejects.toMatchObject({ code: 'outside-project' })
    await expect(confine(root, `${root}-sibling/x`)).rejects.toMatchObject({ code: 'outside-project' })
    expect(probed).toEqual([])
  })
})

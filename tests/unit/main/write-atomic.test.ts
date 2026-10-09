import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tempDir } from './helpers'
import { writeAtomic } from '../../../electron/main/lib/writeAtomic'

describe('writeAtomic', () => {
  it('runs concurrent writes to one file in order — none fails, the last one wins', async () => {
    const file = join(await tempDir(), 'deep', 'state.json')
    await Promise.all(['1', '2', '3'].map((d) => writeAtomic(file, d)))
    expect(await readFile(file, 'utf8')).toBe('3')
  })

  it('a failed write rejects without blocking the next; the mode is applied', async () => {
    const dir = await tempDir()
    const file = join(dir, 'state.json')
    await mkdir(join(file, 'child'), { recursive: true }) // a folder in the way: rename fails
    const [first, second] = [writeAtomic(file, 'a'), writeAtomic(file, 'b')]
    await expect(first).rejects.toThrow()
    await expect(second).rejects.toThrow() // it still ran
    expect(await readdir(dir)).toEqual(['state.json']) // no temp files left behind
    await rm(file, { recursive: true })
    await writeAtomic(file, 'c', 0o600)
    expect(await readFile(file, 'utf8')).toBe('c')
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })
})

import { mkdir, rename } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Platform } from './types'

/**
 * Headless host (standalone server / Docker). There is no GUI, so there is no
 * picker and nothing to open; deleted notes go to the vault's `.trash` folder
 * — Obsidian's own "move to .trash" convention, so they stay recoverable.
 */
export const headlessPlatform: Platform = {
  kind: 'server',
  async trashItem(path, root) {
    const dir = join(root, '.trash')
    await mkdir(dir, { recursive: true })
    const ext = extname(path)
    const stem = basename(path, ext)
    await rename(path, join(dir, `${stem} ${Date.now()}${ext}`))
  }
}

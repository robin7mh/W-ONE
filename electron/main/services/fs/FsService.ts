import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { DirListing } from '@shared/types/server'

const MAX_DIRS = 2000

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/**
 * Server-side folder browser — the web and mobile UIs' replacement for the
 * native folder picker (choosing a project or vault folder on the machine the
 * core runs on). Lists sub-folders only, hidden ones excluded; never reads files.
 */
export class FsService {
  constructor(private readonly home: string = homedir()) {}

  async dirs(path?: string): Promise<DirListing> {
    const target = path ? path : this.home
    if (!isAbsolute(target)) throw coded('bad-path', 'Path must be absolute')
    const abs = await realpath(resolve(target)).catch(() => {
      throw coded('not-found', `Folder not found: ${target}`)
    })
    if (!(await stat(abs)).isDirectory()) throw coded('not-found', `Not a folder: ${target}`)
    const entries = await readdir(abs, { withFileTypes: true })
    const dirs = entries
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, MAX_DIRS)
    const parent = dirname(abs)
    return { path: abs, parent: parent === abs ? null : parent, home: this.home, dirs }
  }
}

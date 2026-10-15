import { mkdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { basename, extname, join, sep } from 'node:path'

/**
 * The freedesktop.org trash (`~/.local/share/Trash`), the one GNOME and KDE
 * use — done by Mindeck itself on Linux, so it knows where each item went
 * and can put it back (⌘Z). macOS and Windows hide that from apps: there
 * the OS trash is used and trashing cannot be undone from Mindeck.
 */
export interface RestorableTrash {
  /** Moves `path` into the trash; returns where it now lies. Fails with EXDEV for other disks. */
  trash(path: string): Promise<string>
  /** Puts a trashed item back at `to` (which must be free). */
  restore(trashed: string, to: string): Promise<void>
}

function coded(code: string, message: string): Error {
  return Object.assign(new Error(message), { code })
}

/** `YYYY-MM-DDThh:mm:ss` in local time, as the spec wants it. */
function deletionDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** The desktop's undoable trash: Linux has one Mindeck can use, macOS and Windows do not. */
export function desktopTrash(platform: NodeJS.Platform, env: NodeJS.ProcessEnv, home: string): RestorableTrash | undefined {
  return platform === 'linux' ? freedesktopTrash(env.XDG_DATA_HOME || join(home, '.local', 'share')) : undefined
}

export function freedesktopTrash(dataHome: string, now: () => Date = () => new Date()): RestorableTrash {
  const root = join(dataHome, 'Trash')
  const files = join(root, 'files')
  const info = join(root, 'info')

  return {
    async trash(path) {
      await mkdir(files, { recursive: true, mode: 0o700 })
      await mkdir(info, { recursive: true, mode: 0o700 })
      const ext = extname(basename(path))
      const stem = basename(path).slice(0, basename(path).length - ext.length)
      // The .trashinfo file is created first (exclusively): it reserves the name.
      for (let n = 1; ; n += 1) {
        const name = n === 1 ? basename(path) : `${stem}.${n}${ext}`
        const record = join(info, `${name}.trashinfo`)
        const body = `[Trash Info]\nPath=${path.split(sep).map(encodeURIComponent).join('/')}\nDeletionDate=${deletionDate(now())}\n`
        try {
          await writeFile(record, body, { flag: 'wx', mode: 0o600 })
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue
          throw err
        }
        try {
          await rename(path, join(files, name))
        } catch (err) {
          await unlink(record).catch(() => {})
          throw err
        }
        return join(files, name)
      }
    },

    async restore(trashed, to) {
      // Only what lies directly in this trash — never a path from elsewhere.
      const real = await realpath(trashed).catch(() => {
        throw coded('not-found', 'It is no longer in the trash')
      })
      const realFiles = await realpath(files)
      const name = basename(real)
      if (join(realFiles, name) !== real) throw coded('bad-path', 'Not an item in the trash')
      await rename(real, to)
      await rm(join(info, `${name}.trashinfo`), { force: true })
    }
  }
}

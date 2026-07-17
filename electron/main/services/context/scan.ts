import { readdir, readFile, lstat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import ignore from 'ignore'

// Always excluded regardless of .gitignore — noise or huge.
const ALWAYS_IGNORE = [
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '.turbo',
  '.cache',
  '.vite',
  '.output',
  '.parcel-cache',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.DS_Store'
]

export interface ScanEntry {
  rel: string // posix, relative to root
  abs: string
  type: 'file' | 'dir'
  depth: number
  size: number
  mtimeMs: number
}

export interface ScanResult {
  entries: ScanEntry[]
  fileCount: number
  dirCount: number
  truncated: boolean
}

export interface ScanOptions {
  maxFiles?: number
  maxDepth?: number
  onProgress?: (filesScanned: number) => void
}

async function loadIgnore(root: string): Promise<ReturnType<typeof ignore>> {
  const ig = ignore().add(ALWAYS_IGNORE)
  try {
    ig.add(await readFile(join(root, '.gitignore'), 'utf8'))
  } catch {
    /* no .gitignore */
  }
  return ig
}

/**
 * Recursively walk a project, honouring .gitignore + a hard exclude list.
 * Bounded by maxFiles/maxDepth and safe against symlink loops/escapes
 * (symlinks are recorded shallowly but never traversed). Stays within `root`.
 */
export async function scanProject(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const maxFiles = opts.maxFiles ?? 8000
  const maxDepth = opts.maxDepth ?? 8
  const ig = await loadIgnore(root)

  const entries: ScanEntry[] = []
  let fileCount = 0
  let dirCount = 0
  let truncated = false

  async function walk(dir: string, depth: number): Promise<void> {
    if (truncated || depth > maxDepth) return
    let names: string[]
    try {
      names = await readdir(dir)
    } catch {
      return
    }
    for (const name of names) {
      if (truncated) return
      const abs = join(dir, name)
      const rel = relative(root, abs).split(sep).join('/')

      let st
      try {
        st = await lstat(abs) // lstat: don't follow symlinks
      } catch {
        continue
      }
      if (st.isSymbolicLink()) continue // never traverse — avoids loops/escapes

      const isDir = st.isDirectory()
      if (ig.ignores(isDir ? `${rel}/` : rel)) continue

      if (isDir) {
        dirCount += 1
        entries.push({ rel, abs, type: 'dir', depth, size: 0, mtimeMs: st.mtimeMs })
        await walk(abs, depth + 1)
      } else if (st.isFile()) {
        fileCount += 1
        entries.push({ rel, abs, type: 'file', depth, size: st.size, mtimeMs: st.mtimeMs })
        if (fileCount % 500 === 0) opts.onProgress?.(fileCount)
        if (fileCount >= maxFiles) {
          truncated = true
          return
        }
      }
    }
  }

  await walk(root, 0)
  opts.onProgress?.(fileCount)
  return { entries, fileCount, dirCount, truncated }
}

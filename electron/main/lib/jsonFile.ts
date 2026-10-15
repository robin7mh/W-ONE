import { readFile, rename } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/**
 * What reading a JSON state file found:
 * - `ok`       parsed (the caller still checks the shape)
 * - `missing`  no file yet
 * - `damaged`  unreadable or not JSON — set aside as `backup` when that worked
 */
export type JsonRead<T> = { status: 'ok'; value: T } | { status: 'missing' } | { status: 'damaged'; backup?: string }

/** `sessions.json` → `sessions.corrupt-2026-10-15T09-30-00-000Z.json` (next to it). */
export function corruptName(file: string, now = new Date()): string {
  const ext = extname(file)
  const stamp = now.toISOString().replace(/[:.]/g, '-')
  return join(dirname(file), `${basename(file, ext)}.corrupt-${stamp}${ext}`)
}

/**
 * Reads a JSON file Mindeck keeps its state in. A damaged one (a full disk, a
 * sync conflict, a hand edit) never stops the start: it is moved aside as
 * `<name>.corrupt-<time>.json`, so the next save can't overwrite what may
 * still be rescued, and the problem is logged. The caller starts empty.
 */
export async function readJsonFile<T = unknown>(file: string, now: () => Date = () => new Date()): Promise<JsonRead<T>> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing' }
    console.warn(`[data] cannot read ${file}: ${(err as Error).message}`)
    return { status: 'damaged' }
  }
  try {
    return { status: 'ok', value: JSON.parse(raw) as T }
  } catch (err) {
    const backup = corruptName(file, now())
    try {
      await rename(file, backup)
      console.warn(`[data] ${file} is damaged (${(err as Error).message}) — set aside as ${backup}`)
      return { status: 'damaged', backup }
    } catch (moveErr) {
      console.warn(`[data] ${file} is damaged (${(err as Error).message}) and could not be set aside: ${(moveErr as Error).message}`)
      return { status: 'damaged' }
    }
  }
}

/** The parsed value, or undefined when the file is missing or damaged (see readJsonFile). */
export async function readJson<T = unknown>(file: string): Promise<T | undefined> {
  const read = await readJsonFile<T>(file)
  return read.status === 'ok' ? read.value : undefined
}

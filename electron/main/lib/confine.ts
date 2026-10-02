import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/**
 * Resolve `rel` inside `root`, following symlinks; refuses anything outside
 * (`outside-project`). The deepest existing ancestor decides, so the target
 * itself may not exist yet. Shared by the agent's file tools and the editor.
 */
export async function confine(root: string, rel: string): Promise<string> {
  const rootReal = await realpath(root)
  const target = resolve(rootReal, rel)
  let probe = target
  while (!existsSync(probe)) probe = dirname(probe)
  const real = await realpath(probe)
  const inside = (p: string) => p === rootReal || p.startsWith(rootReal + sep)
  if (!inside(target) || !inside(real)) {
    throw Object.assign(new Error('Path is outside the project'), { code: 'outside-project' })
  }
  return target
}

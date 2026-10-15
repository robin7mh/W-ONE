import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'

/**
 * Resolve `rel` inside `root`, following symlinks; refuses anything outside
 * (`outside-project`). The deepest existing ancestor decides, so the target
 * itself may not exist yet. Shared by the agent's file tools and the editor.
 * A path that is outside as written is refused before the disk is asked:
 * on Windows, merely looking at `\\host\share` sends the user's credentials there.
 */
export async function confine(root: string, rel: string): Promise<string> {
  const rootReal = await realpath(root)
  const target = resolve(rootReal, rel)
  const inside = (p: string) => p === rootReal || p.startsWith(rootReal + sep)
  const outside = () => Object.assign(new Error('Path is outside the project'), { code: 'outside-project' })
  if (!inside(target)) throw outside()
  let probe = target
  while (!existsSync(probe)) probe = dirname(probe)
  if (!inside(await realpath(probe))) throw outside()
  return target
}

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { desktopOnly, type Platform } from '../platform/types'

const exec = promisify(execFile)

/**
 * Open a folder in VS Code: its `code` CLI, else (macOS) the app by name,
 * else whatever the OS opens folders with (Finder, Explorer, …).
 */
export async function openInVsCode(path: string, platform: Pick<Platform, 'openPath'>): Promise<void> {
  try {
    await exec('code', [path], { windowsHide: true })
    return
  } catch {
    // `code` not on PATH — fall back per platform
  }
  if (process.platform === 'darwin') {
    try {
      await exec('open', ['-a', 'Visual Studio Code', path])
      return
    } catch {
      /* VS Code not installed — reveal in Finder as last resort */
    }
  }
  if (!platform.openPath) throw desktopOnly('Opening files on this machine')
  await platform.openPath(path)
}

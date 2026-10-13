// electron-builder afterPack (before signing): keep only this platform's node-pty prebuilds.
// The others would ship for nothing (and a `files` list per platform would replace the shared one).
const { readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName // darwin | win32 | linux
  const resources = platform === 'darwin' ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources') : join(context.appOutDir, 'resources')
  const prebuilds = join(resources, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds')
  let entries = []
  try {
    entries = readdirSync(prebuilds)
  } catch {
    return // Linux: node-pty was compiled, no prebuilds
  }
  for (const entry of entries) if (!entry.startsWith(`${platform}-`)) rmSync(join(prebuilds, entry), { recursive: true, force: true })
}

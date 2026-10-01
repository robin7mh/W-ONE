// node-pty 1.1.0's npm tarball ships prebuilds/*/spawn-helper without the
// executable bit — every PTY spawn then fails with "posix_spawnp failed".
// Runs on postinstall; a no-op on Windows and when node-pty is absent.
const fs = require('node:fs')
const path = require('node:path')

const dir = path.join(__dirname, '..', 'node_modules', 'node-pty', 'prebuilds')
if (process.platform !== 'win32' && fs.existsSync(dir)) {
  for (const target of fs.readdirSync(dir)) {
    const helper = path.join(dir, target, 'spawn-helper')
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755)
  }
}

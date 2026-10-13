// Builds the Mindeck server packages for Remote-SSH / Dev Containers with Docker:
//   npm run remote:bundle              linux-x64 and linux-arm64
//   npm run remote:bundle -- arm64     one architecture
// → out/remote/mindeck-server-<version>-linux-<arch>.tar.gz (release builds attach them to the GitHub release).
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const arches = process.argv.slice(2).length ? process.argv.slice(2) : ['x64', 'arm64']
const out = join(root, 'out', 'remote')
mkdirSync(out, { recursive: true })

for (const arch of arches) {
  const dir = join(out, `linux-${arch}`)
  rmSync(dir, { recursive: true, force: true })
  console.log(`\n▸ linux-${arch}`)
  const args = ['build', '--platform', `linux/${arch === 'x64' ? 'amd64' : 'arm64'}`, '-f', 'remote/Dockerfile', '-o', `type=local,dest=${dir}`]
  for (const name of ['MINDECK_CLOUD_URL', 'MINDECK_CLOUD_KEY']) if (process.env[name]) args.push('--build-arg', `${name}=${process.env[name]}`)
  execFileSync('docker', [...args, '.'], { cwd: root, stdio: 'inherit' })
  const file = join(out, `mindeck-server-${version}-linux-${arch}.tar.gz`)
  execFileSync('tar', ['czf', file, '-C', dir, '.'], { stdio: 'inherit' })
  rmSync(dir, { recursive: true, force: true })
  console.log(`✓ ${file}`)
}

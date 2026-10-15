import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(__dirname, '..', '..', '..')
const builder = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as { electronFuses?: Record<string, boolean>; mac?: { hardenedRuntime?: boolean } }

describe('packaging', () => {
  it('flips Electron’s fuses: no NODE_OPTIONS or --inspect, code only from a checked app.asar, encrypted cookies', () => {
    expect(builder.electronFuses).toEqual({
      // tsserver, the lint worker, a debug adapter and the Dev Containers CLI run as Node in Mindeck's binary.
      runAsNode: true,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true
    })
    expect(builder.mac?.hardenedRuntime).toBe(true)
  })

  it('never lets a debugger attach to the signed macOS app', () => {
    const plist = readFileSync(join(root, 'build', 'entitlements.mac.plist'), 'utf8')
    expect(plist).not.toContain('com.apple.security.get-task-allow')
    expect(plist).not.toContain('com.apple.security.cs.allow-dyld-environment-variables')
  })
})

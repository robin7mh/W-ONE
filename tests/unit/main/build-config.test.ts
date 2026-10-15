import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const root = join(__dirname, '..', '..', '..')
const builder = parse(readFileSync(join(root, 'electron-builder.yml'), 'utf8')) as {
  electronFuses?: Record<string, boolean>
  mac?: { hardenedRuntime?: boolean; entitlements?: string; entitlementsInherit?: string }
}
/** The entitlement keys a plist grants. */
const granted = (file: string) => [...readFileSync(join(root, file), 'utf8').matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g)].map((m) => m[1])

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

  it('grants the signed macOS app only what it needs — the helpers JIT alone', () => {
    expect(builder.mac?.entitlements).toBe('build/entitlements.mac.plist')
    expect(builder.mac?.entitlementsInherit).toBe('build/entitlements.mac.inherit.plist')
    // No debugger, no injected libraries, no unsigned executable memory (V8 uses MAP_JIT). Library validation is off
    // for the main binary only: the lint worker runs the project's ESLint/Prettier plugins and their native addons.
    expect(granted(builder.mac!.entitlements!)).toEqual([
      'com.apple.security.cs.allow-jit',
      'com.apple.security.cs.disable-library-validation',
      'com.apple.security.device.camera',
      'com.apple.security.device.audio-input'
    ])
    expect(granted(builder.mac!.entitlementsInherit!)).toEqual(['com.apple.security.cs.allow-jit'])
  })
})

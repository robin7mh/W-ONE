import { dialog, safeStorage, shell } from 'electron'
import type { Cipher } from '../services/ai/SecretStore'
import type { Platform } from './types'

/** Desktop host: native dialogs, the OS file manager and the OS trash. */
export const electronPlatform: Platform = {
  kind: 'desktop',
  async pickFolder(title) {
    const res = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] })
    if (res.canceled || res.filePaths.length === 0) return null
    return res.filePaths[0]
  },
  async openPath(path) {
    const err = await shell.openPath(path)
    if (err) throw Object.assign(new Error(err), { code: 'open-failed' })
  },
  async trashItem(path) {
    await shell.trashItem(path)
  }
}

/** OS-keychain encryption for stored secrets, when the OS offers it. */
export function electronCipher(): Cipher | undefined {
  if (!safeStorage.isEncryptionAvailable()) return undefined
  return {
    encrypt: (plain) => safeStorage.encryptString(plain).toString('base64'),
    decrypt: (stored) => safeStorage.decryptString(Buffer.from(stored, 'base64'))
  }
}

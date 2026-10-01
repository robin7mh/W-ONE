import { handle } from './registry'
import type { VaultService } from '../main/services/memory/VaultService'

/** Binds the memory:* contract channels to VaultService. */
export function registerMemoryIpc(service: VaultService): void {
  handle('memory:status', () => service.status())
  handle('memory:createVault', () => service.createVault())
  handle('memory:pickVault', () => service.pickVault())
  handle('memory:list', () => service.list())
  handle('memory:read', ({ path }) => service.read(path))
  handle('memory:write', ({ path, raw }) => service.write(path, raw))
  handle('memory:create', ({ title, folder }) => service.create(title, folder))
  handle('memory:trash', ({ path }) => service.trash(path))
  handle('memory:graph', () => service.graph())
  handle('memory:search', ({ query }) => service.search(query))
  handle('memory:setGraphStyle', (style) => service.setGraphStyle(style))
}

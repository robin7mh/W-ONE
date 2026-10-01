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
  handle('memory:reveal', () => service.reveal())
  handle('memory:folders', () => service.folders())
  handle('memory:writeBody', ({ path, body }) => service.writeBody(path, body))
  handle('memory:createFolder', ({ parent, name }) => service.createFolder(parent, name))
  handle('memory:rename', ({ path, title }) => service.rename(path, title))
  handle('memory:move', ({ path, folder }) => service.move(path, folder))
  handle('memory:moveFolder', ({ folder, into }) => service.moveFolder(folder, into))
  handle('memory:link', ({ from, to }) => service.link(from, to))
  handle('memory:unlink', ({ from, to }) => service.unlink(from, to))
}

import { handle } from './registry'
import type { TerminalService } from '../main/services/terminal/TerminalService'

/** Binds the terminal:* contract channels to TerminalService. */
export function registerTerminalIpc(service: TerminalService): void {
  handle('terminal:create', (req) => service.create(req ?? {}))
  handle('terminal:list', () => service.list())
  handle('terminal:attach', ({ id }) => service.attach(id))
  handle('terminal:write', ({ id, data }) => service.write(id, data))
  handle('terminal:resize', ({ id, cols, rows }) => service.resize(id, cols, rows))
  handle('terminal:kill', ({ id }) => service.kill(id))
}

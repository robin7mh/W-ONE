import type { IpcEvent, IpcEvents } from '@shared/ipc/contract'

export type HubListener = <K extends IpcEvent>(channel: K, payload: IpcEvents[K]) => void

/**
 * Fan-out for main→client push events. Services publish once; the desktop
 * window bridge and the network API's WebSocket clients each subscribe.
 */
export class EventHub {
  private readonly listeners = new Set<HubListener>()

  publish<K extends IpcEvent>(channel: K, payload: IpcEvents[K]): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(channel, payload)
      } catch (err) {
        console.error(`[hub] listener failed for ${channel}`, err)
      }
    }
  }

  subscribe(listener: HubListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

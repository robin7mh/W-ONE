import type { Router } from './router'
import type { FinderService } from '../main/services/finder/FinderService'

/** Binds the finder:* contract channels (the Files module) to FinderService. */
export function registerFinderIpc(router: Router, finder: FinderService): void {
  router.register('finder:places', () => finder.places())
  router.register('finder:list', ({ path, hidden }) => finder.list(path, hidden))
  router.register('finder:search', ({ path, query }) => finder.search(path, query))
  router.register('finder:preview', ({ path }) => finder.preview(path))
  router.register('finder:mkdir', ({ parent, name }) => finder.mkdir(parent, name))
  router.register('finder:rename', ({ path, name }) => finder.rename(path, name))
  router.register('finder:trash', ({ paths }) => finder.trash(paths))
  router.register('finder:move', ({ paths, dest }) => finder.move(paths, dest))
  router.register('finder:copy', ({ paths, dest }) => finder.copy(paths, dest))
  router.register('finder:open', ({ path }) => finder.open(path))
  router.register('finder:reveal', ({ path }) => finder.reveal(path))
}

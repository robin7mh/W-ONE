import type { Router } from './router'
import type { MongoService } from '../main/services/mongo/MongoService'

/** Binds the mongo:* channels (the MongoDB for VS Code extension's features) to MongoService. */
export function registerMongoIpc(router: Router, service: MongoService): void {
  router.register('mongo:connections', () => service.connections())
  router.register('mongo:add', ({ name, uri }) => service.add(name, uri))
  router.register('mongo:remove', ({ id }) => service.remove(id))
  router.register('mongo:databases', ({ id }) => service.databases(id))
  router.register('mongo:collections', ({ id, db }) => service.collections(id, db))
  router.register('mongo:createCollection', ({ id, db, name }) => service.createCollection(id, db, name))
  router.register('mongo:dropCollection', ({ id, db, name }) => service.dropCollection(id, db, name))
  router.register('mongo:find', ({ id, db, collection, query }) => service.find(id, db, collection, query))
  router.register('mongo:insert', ({ id, db, collection, document }) => service.insert(id, db, collection, document))
  router.register('mongo:replace', ({ id, db, collection, docId, document }) => service.replace(id, db, collection, docId, document))
  router.register('mongo:delete', ({ id, db, collection, docId }) => service.delete(id, db, collection, docId))
  router.register('mongo:aggregate', ({ id, db, collection, pipeline }) => service.aggregate(id, db, collection, pipeline))
  router.register('mongo:indexes', ({ id, db, collection }) => service.indexes(id, db, collection))
}

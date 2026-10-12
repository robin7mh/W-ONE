// MongoDB like the MongoDB for VS Code extension: saved connections, databases,
// collections, documents (as Extended JSON text), aggregations, indexes.
// Pure module (no DOM/Node/Electron) so it compiles under every tsconfig.

/** A saved connection — its connection string stays in the core (encrypted). */
export interface MongoConnection {
  id: string
  name: string
  /** Where it points, without credentials (mongodb://host:27017). */
  host: string
}

export interface MongoDatabase {
  name: string
  sizeOnDisk: number
  empty: boolean
}

export interface MongoCollection {
  name: string
  /** collection, view, timeseries */
  type: string
}

export interface MongoQuery {
  /** Extended JSON: {"age": {"$gt": 30}} */
  filter?: string
  sort?: string
  projection?: string
  limit?: number
  skip?: number
}

/** Documents as relaxed Extended JSON text (ObjectId → {"$oid": …}). */
export interface MongoDocuments {
  documents: string[]
  /** Matching documents in all (counted up to a cap). */
  total: number
}

export interface MongoIndex {
  name: string
  /** The key as JSON ({"email": 1}). */
  key: string
  unique: boolean
}

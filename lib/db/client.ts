import "server-only"

import { mkdirSync } from "node:fs"
import { dirname, isAbsolute, resolve } from "node:path"

import Database from "better-sqlite3"
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3"

import * as schema from "./schema"

export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database
}

/** Opens (creating if needed) a SQLite file with Plato's settings (§6). */
export function openDb(path: string): Db {
  if (path !== ":memory:")
    mkdirSync(dirname(resolve(path)), { recursive: true })
  const sqlite = new Database(path)
  sqlite.pragma("journal_mode = WAL")
  sqlite.pragma("foreign_keys = ON")
  // One process, but a backup or a second connection may hold the lock briefly.
  sqlite.pragma("busy_timeout = 5000")
  return drizzle({ client: sqlite, schema })
}

/**
 * `PLATO_DB_PATH`. In production it is required and must be absolute: the
 * standalone server changes directory into the build output, so a relative
 * path would put the database where the next build deletes it. Development
 * defaults to `plato.db`.
 */
export function dbPath(
  env: Record<string, string | undefined> = process.env
): string {
  const path = env.PLATO_DB_PATH
  if (env.NODE_ENV === "production") {
    if (!path) throw new Error("PLATO_DB_PATH is not set")
    if (!isAbsolute(path))
      throw new Error(`PLATO_DB_PATH must be an absolute path, got "${path}"`)
  }
  return path || "plato.db"
}

// Kept on globalThis so dev reloads and separately bundled routes share one
// connection.
const g = globalThis as { __platoDb?: Db }

/** The app's database, opened on first use so `next build` never creates one. */
export function getDb(): Db {
  g.__platoDb ??= openDb(dbPath())
  return g.__platoDb
}

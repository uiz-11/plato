import "server-only"

import { join } from "node:path"

import { migrate as applyMigrations } from "drizzle-orm/better-sqlite3/migrator"

import { getDb, type Db } from "./client"

// Traced into the standalone output by next.config.ts. The standalone server
// runs with its own directory as the working directory.
export const migrationsFolder = join(process.cwd(), "lib/db/migrations")

/** Applies pending migrations. Called once at server start (instrumentation.ts). */
export function migrate(db: Db = getDb()): void {
  applyMigrations(db, { migrationsFolder })
}

/**
 * Start-up migration. Next logs a failed `register()` and then serves 500s, so
 * exit instead: the failure is loud and the host's restart policy applies.
 */
export function migrateOrExit(): void {
  try {
    migrate()
  } catch (error) {
    console.error("Database migration failed at start-up:", error)
    process.exit(1)
  }
}

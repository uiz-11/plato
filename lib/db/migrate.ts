import "server-only"

import { join } from "node:path"

import { migrate as applyMigrations } from "drizzle-orm/better-sqlite3/migrator"

import { dbPath, getDb, type Db } from "./client"
import { applyPendingRestore } from "./files"

// Traced into the standalone output by next.config.ts. The standalone server
// runs with its own directory as the working directory.
export const migrationsFolder = join(process.cwd(), "lib/db/migrations")

/** Applies pending migrations. Called once at server start (instrumentation.ts). */
export function migrate(db: Db = getDb()): void {
  applyMigrations(db, { migrationsFolder })
}

/**
 * Start-up: swaps in a restore staged by `db:restore` (§12.2), then applies
 * migrations, so a backup from an older build is brought up to date. Next logs
 * a failed `register()` and then serves 500s, so exit instead: the failure is
 * loud and the host's restart policy applies.
 */
export function migrateOrExit(): void {
  try {
    const path = dbPath()
    const restored = applyPendingRestore(path, { migrationsFolder })
    if (restored?.status === "rejected")
      console.error(
        `Did not restore the staged database: ${restored.reason}. It is now ${restored.movedTo}; starting with the current database.`
      )
    else if (restored?.status === "expired")
      console.warn(
        `Warning: ignored a restore staged more than an hour ago; it is now ${restored.movedTo}. Stage it again with db:restore and restart.`
      )
    else if (restored)
      console.log(
        `Restored the database from ${path}.restore` +
          (restored.previous
            ? `; the previous database is at ${restored.previous}`
            : "") +
          (restored.previousError
            ? `, as it was: it could not be checkpointed (${restored.previousError})`
            : "") +
          ` (${restored.info.requests} requests, ${restored.info.attempts} attempts).`
      )
  } catch (error) {
    console.error("Database restore failed at start-up:", error)
    process.exit(1)
  }
  try {
    migrate()
  } catch (error) {
    console.error("Database migration failed at start-up:", error)
    process.exit(1)
  }
}

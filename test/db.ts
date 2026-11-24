import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { openDb, type Db } from "@/lib/db/client"
import { migrate } from "@/lib/db/migrate"

/**
 * A fresh SQLite file with every migration applied, for DB and DAL tests
 * (§10). Call `close()` in `afterEach`.
 */
export function createTestDb(): { db: Db; path: string; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "plato-test-"))
  const path = join(dir, "plato.db")
  const db = openDb(path)
  migrate(db)
  return {
    db,
    path,
    close() {
      db.$client.close()
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

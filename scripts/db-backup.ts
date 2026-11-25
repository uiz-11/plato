// npm run db:backup [-- <file>]   (§12.2)
//
// Writes a consistent copy of the database at PLATO_DB_PATH (default
// `plato.db`) with `VACUUM INTO`, then checks it. Safe while the server runs.
// Without a file name it writes `backups/plato-<timestamp>.db` beside the
// database. The image ships this script, so on the host run
// `node scripts/db-backup.ts` inside the container.

import { dirname, join, resolve } from "node:path"

import { backupDb, backupFileName } from "../lib/db/files.ts"

const args = process.argv.slice(2)
if (args.length > 1 || args[0]?.startsWith("-")) {
  console.error("usage: npm run db:backup [-- <file>]")
  process.exit(2)
}
const src = resolve(process.env.PLATO_DB_PATH || "plato.db")
const dest = resolve(args[0] ?? join(dirname(src), "backups", backupFileName()))

try {
  const info = backupDb(src, dest)
  console.log(`Backed up ${src} to ${dest}`)
  console.log(
    `${info.migrations} migrations, ${info.requests} requests, ${info.attempts} attempts.`
  )
} catch (error) {
  console.error(
    "Backup failed:",
    error instanceof Error ? error.message : error
  )
  process.exit(1)
}

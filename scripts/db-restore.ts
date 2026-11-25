// npm run db:restore -- <backup file>   (§12.2)
//
// Checks a backup (from `db:backup`) and stages it as `<PLATO_DB_PATH>.restore`.
// The server swaps it in when it next starts, moving the current database
// aside as `<db>.pre-restore-<timestamp>`, so restart the server afterwards,
// within an hour: an older staged file is ignored. To cancel, delete the
// staged file.
// The image ships this script: inside the container run
// `node scripts/db-restore.ts <file>`, then restart the machine.

import { join, resolve } from "node:path"

import { stageRestore } from "../lib/db/files.ts"

const args = process.argv.slice(2)
if (args.length !== 1 || args[0].startsWith("-")) {
  console.error("usage: npm run db:restore -- <backup file>")
  process.exit(2)
}
const dbPath = resolve(process.env.PLATO_DB_PATH || "plato.db")

try {
  const { staged, info } = stageRestore(
    resolve(args[0]),
    dbPath,
    join(import.meta.dirname, "..", "lib", "db", "migrations")
  )
  console.log(`Staged ${resolve(args[0])} as ${staged}`)
  console.log(
    `${info.migrations} migrations, ${info.requests} requests, ${info.attempts} attempts.`
  )
  console.log("Restart the server within an hour to restore it.")
  console.log(`To cancel instead, delete ${staged}.`)
} catch (error) {
  console.error(
    "Restore failed:",
    error instanceof Error ? error.message : error
  )
  process.exit(1)
}

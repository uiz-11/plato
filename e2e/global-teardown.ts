import { rmSync } from "node:fs"

// Each run gets a fresh database (§10.1); remove it and its WAL files after.
export default function globalTeardown() {
  for (const path of [
    process.env.PLATO_E2E_DB_PATH,
    process.env.PLATO_E2E_EMPTY_DB_PATH,
  ]) {
    if (!path) continue
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true })
  }
}

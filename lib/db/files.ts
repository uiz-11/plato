// Backup and restore of the SQLite file (§12.2).
//
// Used by the server at start-up (a staged restore) and by `db:backup` and
// `db:restore`, which also run inside the image with plain `node` (type
// stripping). So this file imports only Node built-ins and better-sqlite3,
// and uses no TypeScript-only runtime syntax.

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { basename, dirname, join, resolve } from "node:path"

import Database from "better-sqlite3"

/** Tables a Plato database must have to be restored (§6). */
const REQUIRED_TABLES = ["__drizzle_migrations", "settings", "course_request"]

/** How long a staged restore stays valid before the server ignores it. */
export const RESTORE_MAX_AGE_MS = 60 * 60 * 1000

export interface DbFileInfo {
  /** Migrations applied to the file. */
  migrations: number
  /** Rows in `course_request` and `attempt`, as a quick sanity read-out. */
  requests: number
  attempts: number
}

/**
 * Opens `path` read-only and checks it is an intact Plato database. A
 * read-only connection to a WAL database creates -wal and -shm files it cannot
 * remove, so empty ones it created are removed afterwards. With
 * `migrationsFolder`, also refuses a file migrated by a newer build than the
 * one whose migrations are in that folder: this build could not read it.
 * Throws with a message naming what is wrong.
 */
export function checkDbFile(
  path: string,
  migrationsFolder?: string
): DbFileInfo {
  if (!existsSync(path)) throw new Error(`${path} does not exist`)
  const hadSideFiles = existsSync(`${path}-wal`) || existsSync(`${path}-shm`)
  let db: Database.Database
  try {
    db = new Database(path, { readonly: true, fileMustExist: true })
  } catch (error) {
    throw new Error(unreadable(path, error))
  }
  try {
    let integrity: unknown
    try {
      integrity = db.pragma("integrity_check", { simple: true })
    } catch (error) {
      throw new Error(unreadable(path, error))
    }
    if (integrity !== "ok")
      throw new Error(`${path} failed its integrity check: ${integrity}`)
    const tables = new Set(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .pluck()
        .all() as string[]
    )
    const missing = REQUIRED_TABLES.filter((t) => !tables.has(t))
    if (missing.length)
      throw new Error(
        `${path} is not a Plato database: no ${missing.join(", ")} table`
      )
    if (migrationsFolder) {
      // Drizzle records each migration's journal `when` as `created_at`.
      const applied = Number(
        db
          .prepare("SELECT max(created_at) FROM __drizzle_migrations")
          .pluck()
          .get() ?? 0
      )
      const known = latestMigration(migrationsFolder)
      if (applied > known)
        throw new Error(
          `${path} was migrated by a newer version of Plato than this one; deploy that version before restoring it`
        )
    }
    const count = (table: string) =>
      tables.has(table)
        ? (db.prepare(`SELECT count(*) FROM ${table}`).pluck().get() as number)
        : 0
    return {
      migrations: count("__drizzle_migrations"),
      requests: count("course_request"),
      attempts: count("attempt"),
    }
  } finally {
    db.close()
    if (!hadSideFiles) removeEmptySideFiles(path)
  }
}

/** Removes `<path>-wal` (if empty) and `<path>-shm`. */
function removeEmptySideFiles(path: string): void {
  const wal = `${path}-wal`
  if (existsSync(wal) && statSync(wal).size > 0) return
  rmSync(wal, { force: true })
  rmSync(`${path}-shm`, { force: true })
}

/** The newest migration's timestamp in drizzle's journal. */
function latestMigration(migrationsFolder: string): number {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")
  ) as { entries: { when: number }[] }
  return Math.max(0, ...journal.entries.map((e) => e.when))
}

/**
 * Writes a consistent copy of the database at `src` to `dest` with
 * `VACUUM INTO`, which is safe while the server is running, then checks the
 * copy. Refuses to overwrite `dest`, and removes the copy if it fails its
 * check.
 */
export function backupDb(src: string, dest: string): DbFileInfo {
  if (!existsSync(src)) throw new Error(`No database at ${src}`)
  if (existsSync(dest)) throw new Error(`${dest} already exists`)
  mkdirSync(dirname(resolve(dest)), { recursive: true })
  // Not read-only: a read-only connection cannot read a WAL database whose
  // -shm file it may not create, and VACUUM INTO never writes to `src`.
  try {
    const db = new Database(src, { fileMustExist: true })
    try {
      db.pragma("busy_timeout = 5000")
      db.prepare("VACUUM INTO ?").run(resolve(dest))
    } finally {
      db.close()
    }
    return checkDbFile(dest)
  } catch (error) {
    // `dest` did not exist before, so anything there is this failed copy.
    rmSync(dest, { force: true })
    throw error
  }
}

/** Where a restore waits for the next start (`<db>.restore`). */
export function pendingRestorePath(dbPath: string): string {
  return `${dbPath}.restore`
}

/**
 * Checks a backup and writes a copy of it beside the live database as
 * `<db>.restore`, with `VACUUM INTO`. So the staged file is one rollback-mode
 * file even when the backup is a WAL database (such as a `pre-restore` file),
 * with its WAL folded in. The server swaps it in at its next start, if that is within
 * `RESTORE_MAX_AGE_MS` (`applyPendingRestore`), so the live file is never
 * replaced under a running connection.
 */
export function stageRestore(
  backup: string,
  dbPath: string,
  migrationsFolder?: string,
  now: Date = new Date()
): { staged: string; info: DbFileInfo } {
  if (resolve(backup) === resolve(dbPath))
    throw new Error("The backup is the live database itself")
  const staged = pendingRestorePath(dbPath)
  if (resolve(backup) === resolve(staged))
    throw new Error(
      `The backup is the staged file itself; it is already staged, so restart within the hour, or copy it elsewhere and stage that`
    )
  checkDbFile(backup, migrationsFolder)
  // Replace an earlier staged file, and any side files it left.
  for (const suffix of ["", "-wal", "-shm"])
    rmSync(staged + suffix, { force: true })
  const info = backupDb(backup, staged)
  // Its age counts from staging (`now` is for tests).
  utimesSync(staged, now, now)
  return { staged, info }
}

export type RestoreResult =
  | {
      status: "restored"
      info: DbFileInfo
      previous: string | null
      /** Why the previous database could not be checkpointed, if it could not. */
      previousError?: string | null
    }
  | { status: "expired"; movedTo: string }
  | { status: "rejected"; movedTo: string; reason: string }

/**
 * At start-up, before the database is opened: if a restore is staged, move
 * the current database aside as `<db>.pre-restore-<stamp>` and put the staged
 * file in its place.
 *
 * - A staged file older than `maxAgeMs` is not applied: it is renamed to
 *   `<db>.restore-expired-<stamp>`, so a forgotten restore never rolls the
 *   data back at some later restart.
 * - The current database is checkpointed first, so it is normally one file
 *   with no WAL. If that fails (a corrupt file), it is moved aside as it is,
 *   with its -wal and -shm, and the restore goes ahead.
 * - With no live database, the staged file is applied whatever its age.
 * - A staged file that is not a Plato database this build can read is
 *   renamed to `<db>.restore-rejected-<stamp>` and the live file is kept, so
 *   the server still starts and the operator can look at the logs. With no
 *   live database it is kept and this throws instead.
 * - Throws if renaming fails.
 *
 * Returns null when nothing is staged.
 */
export function applyPendingRestore(
  dbPath: string,
  options: {
    migrationsFolder?: string
    now?: Date
    maxAgeMs?: number
    /** How long to wait for another connection's lock (tests shorten it). */
    busyTimeoutMs?: number
  } = {}
): RestoreResult | null {
  const now = options.now ?? new Date()
  const maxAgeMs = options.maxAgeMs ?? RESTORE_MAX_AGE_MS
  const staged = pendingRestorePath(dbPath)
  if (!existsSync(staged)) return null
  const stamp = now.toISOString().replace(/[:.]/g, "-")
  // With no live database (a swap cut off after the live file moved), the
  // staged file is the only data there is: apply it whatever its age, and
  // never set it aside, or the server would start on a new, empty database.
  const live = existsSync(dbPath)
  if (live && now.getTime() - statSync(staged).mtimeMs > maxAgeMs) {
    const movedTo = `${dbPath}.restore-expired-${stamp}`
    renameSync(staged, movedTo)
    return { status: "expired", movedTo }
  }
  let info: DbFileInfo
  try {
    info = checkDbFile(staged, options.migrationsFolder)
    // A WAL beside the staged file would be read as part of it once renamed.
    removeEmptySideFiles(staged)
    if (existsSync(`${staged}-wal`))
      throw new Error(`${staged}-wal is not empty; stage the backup again`)
  } catch (error) {
    if (!live) throw error // keep it for the operator; see above
    const movedTo = `${dbPath}.restore-rejected-${stamp}`
    renameSync(staged, movedTo)
    return { status: "rejected", movedTo, reason: message(error) }
  }

  let previous: string | null = null
  let previousError: string | null = null
  if (live) {
    // A move cut off before its main file moved left a `.moving` marker:
    // finish that one, so the main file joins the WAL already moved there.
    const resumed = halfMovedPrevious(dbPath)
    previous = resumed ?? `${dbPath}.pre-restore-${stamp}`
    // When resuming, the main file's real WAL was already moved, so a side
    // file at the live path belongs to some other open: set it aside before
    // SQLite can read it into the main file or it can replace the real one.
    if (resumed) setAsideSideFiles(dbPath, stamp)
    try {
      checkpoint(dbPath, options.busyTimeoutMs ?? 5000)
    } catch (error) {
      // Another process still has the file open: stop, or its later writes
      // would go to the renamed file and be lost.
      if (isLockError(error)) throw error
      // A corrupt or unreadable live database is what a restore is for. Keep
      // it as it is, with its side files, and restore anyway.
      previousError = message(error)
    }
    // Move the side files, then the main file, under a `.moving` marker that
    // lasts until the main file has moved: only a move with a marker is ever
    // resumed. After a checkpoint there are no side files; only a database
    // that could not be checkpointed still has them. Side files go first, so
    // the restored file is never paired with the old WAL. When resuming, a
    // side file already moved is the real one: a new one at the live path is
    // set aside as an orphan, never moved over it.
    writeFileSync(movingMarker(previous), "")
    for (const suffix of ["-wal", "-shm", ""]) {
      if (!existsSync(dbPath + suffix)) continue
      const target =
        suffix && existsSync(previous + suffix)
          ? `${dbPath}.orphan-${stamp}${suffix}`
          : previous + suffix
      renameSync(dbPath + suffix, target)
    }
    rmSync(movingMarker(previous), { force: true })
  }
  // Never let a stray WAL from another database be read as the restored one's.
  setAsideSideFiles(dbPath, stamp)
  renameSync(staged, dbPath)
  return { status: "restored", info, previous, previousError }
}

/**
 * Folds the WAL into the main file and removes the -wal and -shm files, so
 * the database is complete in one file. Throws if the WAL cannot be emptied.
 */
function checkpoint(dbPath: string, busyTimeoutMs: number): void {
  const db = new Database(dbPath, { fileMustExist: true })
  try {
    db.pragma(`busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`)
    const [result] = db.pragma("wal_checkpoint(TRUNCATE)") as {
      busy: number
    }[]
    if (result && result.busy)
      throw Object.assign(
        new Error(`${dbPath} is in use; stop the other process first`),
        { code: "SQLITE_BUSY" }
      )
  } finally {
    db.close()
  }
  const wal = `${dbPath}-wal`
  if (existsSync(wal) && statSync(wal).size > 0)
    // Most likely another connection wrote after the checkpoint: in use.
    throw Object.assign(
      new Error(
        `Could not fold ${wal} into ${dbPath}; another process may have it open`
      ),
      { code: "SQLITE_BUSY" }
    )
  rmSync(wal, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
}

/** SQLite's busy and locked errors, including extended codes. */
function isLockError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return (
    typeof code === "string" &&
    (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"))
  )
}

/** Renames `<db>-wal` and `<db>-shm`, if there, to `<db>.orphan-<stamp>-…`. */
function setAsideSideFiles(dbPath: string, stamp: string): void {
  for (const suffix of ["-wal", "-shm"])
    if (existsSync(dbPath + suffix))
      renameSync(dbPath + suffix, `${dbPath}.orphan-${stamp}${suffix}`)
}

/** `<previous>.moving`: present only while the live files are being moved. */
function movingMarker(previous: string): string {
  return `${previous}.moving`
}

/**
 * The `<db>.pre-restore-<stamp>` of a move that stopped before its main file
 * moved: its marker is there and its main file is not. A side file with no
 * marker (left when someone deleted only the main file) is never reused, so
 * the live database is never paired with another database's WAL. A marker
 * whose main file is there belongs to a move that finished, and is removed.
 */
function halfMovedPrevious(dbPath: string): string | null {
  const dir = dirname(resolve(dbPath))
  const prefix = `${basename(dbPath)}.pre-restore-`
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(prefix) || !name.endsWith(".moving")) continue
    const previous = join(dirname(dbPath), name.slice(0, -".moving".length))
    if (!existsSync(previous)) return previous
    rmSync(join(dir, name), { force: true })
  }
  return null
}

/** `plato-<UTC timestamp>.db`, for backups named by time. */
export function backupFileName(now: Date = new Date()): string {
  return `plato-${now.toISOString().replace(/[:.]/g, "-")}.db`
}

/**
 * Why `path` could not be read. Only SQLite's "not a database" error means the
 * file is not SQLite; others (such as a WAL database in a directory where a
 * read-only connection cannot create its -shm file) keep SQLite's message.
 */
function unreadable(path: string, error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  if (code === "SQLITE_NOTADB")
    return `${path} is not a SQLite database: ${message(error)}`
  return `${path} could not be read (${code ?? "error"}): ${message(error)}. If it is a WAL database, copy it with its -wal file to a writable directory first`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

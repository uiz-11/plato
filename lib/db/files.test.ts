import { execFileSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { openDb, type Db } from "./client"
import {
  applyPendingRestore,
  backupDb,
  checkDbFile,
  pendingRestorePath,
  RESTORE_MAX_AGE_MS,
  stageRestore,
} from "./files"
import { migrate, migrationsFolder } from "./migrate"
import { courseRequest } from "./schema"

let dir: string
let path: string
let db: Db
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "plato-files-"))
  path = join(dir, "plato.db")
  db = openDb(path)
  migrate(db)
})
afterEach(() => {
  if (db.$client.open) db.$client.close()
  rmSync(dir, { recursive: true, force: true })
})

const addRequest = (d: Db, id: string) =>
  d.insert(courseRequest).values({ id, text: id, createdAt: 1 }).run()
const requestIds = (p: string) => {
  const d = openDb(p)
  try {
    return d
      .select({ id: courseRequest.id })
      .from(courseRequest)
      .all()
      .map((r) => r.id)
  } finally {
    d.$client.close()
  }
}

describe("backupDb", () => {
  it("copies a live WAL database, including uncheckpointed writes", () => {
    addRequest(db, "a")
    expect(existsSync(`${path}-wal`)).toBe(true)
    const dest = join(dir, "backups", "b.db")
    const info = backupDb(path, dest)
    expect(info.requests).toBe(1)
    expect(info.migrations).toBeGreaterThan(0)
    expect(requestIds(dest)).toEqual(["a"])
  })

  it("removes a copy that fails its check", () => {
    const other = join(dir, "other.db")
    openDb(other).$client.exec("CREATE TABLE x (y)")
    const dest = join(dir, "b.db")
    expect(() => backupDb(other, dest)).toThrow(/not a Plato database/)
    expect(existsSync(dest)).toBe(false)
  })

  it("refuses to overwrite or to back up a missing file", () => {
    const dest = join(dir, "b.db")
    backupDb(path, dest)
    expect(() => backupDb(path, dest)).toThrow(/already exists/)
    expect(() => backupDb(join(dir, "none.db"), join(dir, "c.db"))).toThrow(
      /No database/
    )
  })
})

describe("checkDbFile", () => {
  it("rejects files that are not Plato databases", () => {
    const junk = join(dir, "junk.db")
    writeFileSync(junk, "not sqlite at all, just some text that is long enough")
    expect(() => checkDbFile(junk)).toThrow(/not a SQLite database/)
    const empty = join(dir, "other.db")
    openDb(empty).$client.exec("CREATE TABLE x (y)")
    expect(() => checkDbFile(empty)).toThrow(/not a Plato database/)
    expect(() => checkDbFile(join(dir, "missing.db"))).toThrow(/does not exist/)
  })
})

describe("restore", () => {
  it("stages a backup and swaps it in at the next start", () => {
    addRequest(db, "kept")
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    addRequest(db, "after-backup")
    db.$client.close() // the server stops

    const { staged } = stageRestore(backup, path, migrationsFolder)
    expect(staged).toBe(pendingRestorePath(path))

    const now = new Date(Date.now() + 1000)
    const result = applyPendingRestore(path, { migrationsFolder, now })
    if (result?.status !== "restored") throw new Error("not restored")
    expect(result.info.requests).toBe(1)
    const stamp = now.toISOString().replace(/[:.]/g, "-")
    expect(result.previous).toBe(`${path}.pre-restore-${stamp}`)
    expect(existsSync(staged)).toBe(false)
    expect(existsSync(`${path}-wal`)).toBe(false)
    expect(requestIds(path)).toEqual(["kept"])
    // The database it replaced is kept whole in one file: its WAL was folded in.
    expect(existsSync(`${result.previous}-wal`)).toBe(false)
    expect(requestIds(result.previous!).sort()).toEqual([
      "after-backup",
      "kept",
    ])
    // Nothing staged: nothing happens.
    expect(applyPendingRestore(path)).toBeNull()
  })

  it("finishes a swap that stopped after the live file was moved", () => {
    const backup = join(dir, "b.db")
    addRequest(db, "x")
    backupDb(path, backup)
    db.$client.close()
    stageRestore(backup, path)
    renameSync(path, `${path}.pre-restore-earlier`)
    rmSync(`${path}-wal`, { force: true })
    rmSync(`${path}-shm`, { force: true })
    const result = applyPendingRestore(path)
    expect(result).toMatchObject({ status: "restored", previous: null })
    expect(requestIds(path)).toEqual(["x"])
  })

  it("restores over a corrupt live database, keeping it as it was", () => {
    const backup = join(dir, "b.db")
    addRequest(db, "good")
    backupDb(path, backup)
    db.$client.close()
    writeFileSync(path, "this is no longer a database, just bytes on disk")
    writeFileSync(`${path}-wal`, "a stray wal")
    stageRestore(backup, path, migrationsFolder)
    const result = applyPendingRestore(path, { migrationsFolder })
    if (result?.status !== "restored") throw new Error("not restored")
    expect(result.previousError).toBeTruthy()
    expect(requestIds(path)).toEqual(["good"])
    // The stray WAL never meets the restored file. (SQLite drops a WAL with
    // an invalid header itself, so this one is not kept.)
    expect(existsSync(`${path}-wal`)).toBe(false)
    expect(existsSync(result.previous!)).toBe(true)
  })

  it("stops, moving nothing, while another process has the database open", () => {
    const backup = join(dir, "b.db")
    addRequest(db, "live")
    backupDb(path, backup)
    stageRestore(backup, path)
    // `db` stays open: hold the write lock, as a running server mid-write would.
    db.$client.exec("BEGIN EXCLUSIVE")
    expect(() => applyPendingRestore(path, { busyTimeoutMs: 50 })).toThrow(
      expect.objectContaining({ code: expect.stringMatching(/^SQLITE_BUSY/) })
    )
    db.$client.exec("ROLLBACK")
    expect(existsSync(path)).toBe(true)
    expect(existsSync(pendingRestorePath(path))).toBe(true)
    expect(requestIds(path)).toEqual(["live"])
  })

  it("finishes a move that stopped after the old WAL moved", () => {
    // A live database with data still in its WAL, copied while open.
    db.$client.pragma("wal_autocheckpoint = 0")
    addRequest(db, "in-wal")
    const snapshot = join(dir, "snap.db")
    copyFileSync(path, snapshot)
    copyFileSync(`${path}-wal`, `${snapshot}-wal`)
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    db.$client.close()
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true })
    stageRestore(backup, path)
    // The crash: the WAL moved under the first stamp, the main file did not.
    const earlier = `${path}.pre-restore-earlier`
    copyFileSync(snapshot, path)
    copyFileSync(`${snapshot}-wal`, `${earlier}-wal`)
    writeFileSync(`${earlier}.moving`, "")

    const result = applyPendingRestore(path)
    if (result?.status !== "restored") throw new Error("not restored")
    expect(result.previous).toBe(earlier)
    // Main file and WAL are back together: the row in the WAL is readable.
    expect(requestIds(earlier)).toEqual(["in-wal"])
    expect(existsSync(`${earlier}.moving`)).toBe(false)
  })

  it("keeps the moved WAL when resuming, setting a new one aside", () => {
    db.$client.pragma("wal_autocheckpoint = 0")
    addRequest(db, "in-wal")
    const snapshot = join(dir, "snap.db")
    copyFileSync(path, snapshot)
    copyFileSync(`${path}-wal`, `${snapshot}-wal`)
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    db.$client.close()
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true })
    stageRestore(backup, path)
    const earlier = `${path}.pre-restore-earlier`
    // The live main file is now corrupt, and a new WAL sits beside it.
    writeFileSync(path, "corrupt corrupt corrupt corrupt corrupt corrupt")
    writeFileSync(`${path}-wal`, "a new wal that must not replace the real one")
    copyFileSync(`${snapshot}-wal`, `${earlier}-wal`)
    writeFileSync(`${earlier}.moving`, "")
    const realWal = readFileSync(`${earlier}-wal`)

    const result = applyPendingRestore(path)
    if (result?.status !== "restored") throw new Error("not restored")
    expect(result.previous).toBe(earlier)
    expect(readFileSync(`${earlier}-wal`).equals(realWal)).toBe(true)
    expect(readdirSync(dir).some((f) => /\.orphan-.*-wal$/.test(f))).toBe(true)
  })

  it("never pairs the live database with a leftover WAL from cleanup", () => {
    const backup = join(dir, "b.db")
    addRequest(db, "live")
    backupDb(path, backup)
    db.$client.close()
    // Someone deleted an old pre-restore file but not its WAL.
    const old = `${path}.pre-restore-old`
    writeFileSync(`${old}-wal`, "an unrelated wal")
    stageRestore(backup, path)
    const result = applyPendingRestore(path)
    if (result?.status !== "restored") throw new Error("not restored")
    expect(result.previous).not.toBe(old)
    expect(requestIds(result.previous!)).toEqual(["live"])
  })

  it("drops the marker of a move that finished", () => {
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    db.$client.close()
    const done = `${path}.pre-restore-done`
    copyFileSync(backup, done)
    writeFileSync(`${done}.moving`, "")
    stageRestore(backup, path)
    const result = applyPendingRestore(path)
    if (result?.status !== "restored") throw new Error("not restored")
    expect(result.previous).not.toBe(done)
    expect(existsSync(`${done}.moving`)).toBe(false)
  })

  it("applies a staged file of any age when there is no live database", () => {
    const backup = join(dir, "b.db")
    addRequest(db, "only-copy")
    backupDb(path, backup)
    db.$client.close()
    const staged = new Date("2026-01-01T00:00:00Z")
    stageRestore(backup, path, undefined, staged)
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true })
    const result = applyPendingRestore(path, {
      now: new Date(staged.getTime() + 10 * RESTORE_MAX_AGE_MS),
    })
    expect(result?.status).toBe("restored")
    expect(requestIds(path)).toEqual(["only-copy"])
  })

  it("keeps a bad staged file, and throws, when there is no live database", () => {
    db.$client.close()
    for (const suffix of ["", "-wal", "-shm"])
      rmSync(path + suffix, { force: true })
    writeFileSync(pendingRestorePath(path), "garbage garbage garbage garbage")
    expect(() => applyPendingRestore(path)).toThrow(/not a SQLite database/)
    expect(existsSync(pendingRestorePath(path))).toBe(true)
  })

  it("ignores a staged restore older than an hour", () => {
    addRequest(db, "live")
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    addRequest(db, "newer")
    db.$client.close()
    const staged = new Date("2026-01-01T00:00:00Z")
    stageRestore(backup, path, undefined, staged)
    const result = applyPendingRestore(path, {
      now: new Date(staged.getTime() + RESTORE_MAX_AGE_MS + 1),
    })
    expect(result).toMatchObject({ status: "expired" })
    if (result?.status !== "expired") return
    expect(existsSync(result.movedTo)).toBe(true)
    expect(existsSync(pendingRestorePath(path))).toBe(false)
    expect(requestIds(path).sort()).toEqual(["live", "newer"])
  })

  it("sets a bad staged file aside and keeps the live database", () => {
    addRequest(db, "live")
    db.$client.close()
    writeFileSync(pendingRestorePath(path), "garbage garbage garbage garbage")
    const result = applyPendingRestore(path)
    expect(result).toMatchObject({ status: "rejected" })
    if (result?.status !== "rejected") return
    expect(result.reason).toMatch(/not a SQLite database/)
    expect(existsSync(result.movedTo)).toBe(true)
    expect(existsSync(pendingRestorePath(path))).toBe(false)
    expect(requestIds(path)).toEqual(["live"])
  })

  it("undoes a restore by staging the pre-restore file", () => {
    addRequest(db, "first")
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    addRequest(db, "second")
    db.$client.close()
    stageRestore(backup, path, migrationsFolder)
    const done = applyPendingRestore(path, { migrationsFolder })
    if (done?.status !== "restored") throw new Error("not restored")
    // The pre-restore file is a WAL-mode database; staging it must work too.
    stageRestore(done.previous!, path, migrationsFolder)
    expect(existsSync(`${pendingRestorePath(path)}-wal`)).toBe(false)
    const undone = applyPendingRestore(path, { migrationsFolder })
    expect(undone?.status).toBe("restored")
    expect(requestIds(path).sort()).toEqual(["first", "second"])
  })

  it("refuses a backup from a newer version of Plato", () => {
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    const b = openDb(backup)
    b.$client
      .prepare(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('future', ?)"
      )
      .run(Date.UTC(2100, 0, 1))
    b.$client.close()
    expect(() => stageRestore(backup, path, migrationsFolder)).toThrow(
      /newer version of Plato/
    )
    // Staged anyway (by an older script, say): set aside at start-up.
    stageRestore(backup, path)
    expect(applyPendingRestore(path, { migrationsFolder })).toMatchObject({
      status: "rejected",
      reason: expect.stringMatching(/newer version/),
    })
    // Without the folder (an older caller) the check is skipped.
    expect(() => checkDbFile(backup)).not.toThrow()
  })

  it("refuses to stage the live file or a bad backup", () => {
    expect(() => stageRestore(path, path)).toThrow(/live database itself/)
    const backup = join(dir, "b.db")
    backupDb(path, backup)
    stageRestore(backup, path)
    expect(() => stageRestore(pendingRestorePath(path), path)).toThrow(
      /staged file itself/
    )
    expect(existsSync(pendingRestorePath(path))).toBe(true)
    rmSync(pendingRestorePath(path))
    expect(() => stageRestore(join(dir, "none.db"), path)).toThrow(
      /does not exist/
    )
    expect(existsSync(pendingRestorePath(path))).toBe(false)
  })
})

describe("db:backup and db:restore", () => {
  // The scripts run with plain `node` in the image (type stripping).
  const run = (script: string, ...args: string[]) =>
    execFileSync(process.execPath, [join("scripts", script), ...args], {
      env: { ...process.env, PLATO_DB_PATH: path },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })

  it("back up to backups/ and stage a restore", () => {
    addRequest(db, "x")
    const out = run("db-backup.ts")
    const match = out.match(/to (\S+backups\/plato-\S+\.db)\n/)
    expect(match).not.toBeNull()
    expect(out).toContain("1 requests")
    expect(run("db-restore.ts", match![1])).toContain("Restart the server")
    // Staged now, not at the backup's time, and with the migrations checked.
    expect(existsSync(pendingRestorePath(path))).toBe(true)
    db.$client.close()
    const result = applyPendingRestore(path, { migrationsFolder })
    expect(result?.status).toBe("restored")
  })

  it("fail with a message", () => {
    expect(() => run("db-restore.ts", join(dir, "none.db"))).toThrow(
      /Restore failed: .*does not exist/
    )
  })
})

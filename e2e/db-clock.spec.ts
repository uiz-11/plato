import Database from "better-sqlite3"
import { expect, test } from "@playwright/test"

const DAY_MS = 24 * 60 * 60 * 1000

test("the server applied migrations at start", () => {
  const db = new Database(process.env.PLATO_E2E_DB_PATH!, {
    readonly: true,
    fileMustExist: true,
  })
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .pluck()
      .all()
    expect(tables).toEqual(expect.arrayContaining(["session", "attempt"]))
  } finally {
    db.close()
  }
})

test.describe("test clock", () => {
  // The server is shared by every spec, so never leave it moved, even on failure.
  test.beforeEach(async ({ request }) => {
    await request.post("/api/test/clock", { data: { days: 0 } })
  })
  test.afterEach(async ({ request }) => {
    await request.post("/api/test/clock", { data: { days: 0 } })
  })

  test("moves now()", async ({ request }) => {
    const before = await (await request.get("/api/test/clock")).json()
    const moved = await request.post("/api/test/clock", { data: { days: 1 } })
    expect(moved.ok()).toBe(true)
    const after = await moved.json()
    expect(after.days).toBe(1)
    expect(after.now - before.now).toBeGreaterThanOrEqual(DAY_MS - 1000)

    for (const days of ["x", 1e300]) {
      const bad = await request.post("/api/test/clock", { data: { days } })
      expect(bad.status()).toBe(400)
    }
  })
})

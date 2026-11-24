import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createTestDb } from "@/test/db"

import type { Db } from "./client"
import { migrate } from "./migrate"
import { lessonProgress, session, settings } from "./schema"

let t: ReturnType<typeof createTestDb>
let db: Db
beforeEach(() => {
  t = createTestDb()
  db = t.db
})
afterEach(() => t.close())

describe("database", () => {
  it("creates every table in §6", () => {
    const tables = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%' ORDER BY name"
      )
      .pluck()
      .all()
    expect(tables).toEqual([
      "answer_note",
      "attempt",
      "concept_schedule",
      "course_request",
      "draft",
      "guess_answer",
      "lesson_progress",
      "session",
      "settings",
      "shown_up_day",
    ])
  })

  it("turns on WAL and foreign keys", () => {
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal")
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1)
  })

  it("is idempotent when migrations run again", () => {
    expect(() => migrate(db)).not.toThrow()
  })

  it("seeds the one settings row with defaults", () => {
    expect(db.select().from(settings).all()).toEqual([
      { id: 1, sessionMinutes: 15, hideTimer: false, updatedAt: 0 },
    ])
  })

  it("rejects a second settings row and unknown session lengths", () => {
    expect(() =>
      db.insert(settings).values({ id: 2, updatedAt: 1 }).run()
    ).toThrow(/CHECK/)
    expect(() =>
      db.$client.prepare("UPDATE settings SET session_minutes = 7").run()
    ).toThrow(/CHECK/)
  })

  it("round-trips JSON positions", () => {
    db.insert(lessonProgress)
      .values({
        courseId: "c",
        lessonId: "l",
        position: { step: "recall", phase: "exercises", index: 1 },
        recallTicked: ["kp1"],
        updatedAt: 1,
      })
      .run()
    const row = db.select().from(lessonProgress).get()
    expect(row?.position).toEqual({
      step: "recall",
      phase: "exercises",
      index: 1,
    })
    expect(row?.recallTicked).toEqual(["kp1"])
    expect(row?.skipped).toBe(false)
  })

  it("allows at most one open session", () => {
    const base = {
      kind: "standard" as const,
      minutes: 15 as const,
      position: { unit: "reviews" as const, index: 0 },
      startedAt: 1,
    }
    db.insert(session)
      .values({ ...base, id: "a" })
      .run()
    expect(() =>
      db
        .insert(session)
        .values({ ...base, id: "b" })
        .run()
    ).toThrow(/UNIQUE/)
    db.update(session).set({ endedAt: 2 }).where(eq(session.id, "a")).run()
    db.insert(session)
      .values({ ...base, id: "b" })
      .run()
    expect(db.select().from(session).all()).toHaveLength(2)
  })
})

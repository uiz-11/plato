import { randomUUID } from "node:crypto"

import Database from "better-sqlite3"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Db } from "@/lib/db/client"
import { draft, session } from "@/lib/db/schema"
import { startNewSession } from "@/lib/dal/sessions"
import { LEAP, putLesson, putSchedule, setNow, setupDal } from "@/test/dal"

import {
  exitSession,
  finishUnit,
  recordEvent,
  saveDraft,
  undoSkip,
} from "./player"

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/cache", () => ({ refresh }))

let db: Db
let close: () => void
const DAY = "2026-11-24"

beforeEach(() => {
  ;({ db, close } = setupDal())
  const at = setNow(`${DAY}T12:00:00Z`)
  refresh.mockClear()
  putLesson(db, LEAP, "leap-rule", { at: at - 3 * 864e5, day: "2026-11-21" })
  putSchedule(db, LEAP, "c-julian", {
    dueDay: DAY,
    lastEventDay: "2026-11-21",
  })
})
afterEach(() => {
  vi.useRealTimers()
  close()
})

const rating = (index: number, answered?: string) => ({
  id: randomUUID(),
  expected: {
    session: { unit: "reviews", index, ...(answered ? { answered } : {}) },
    lesson: null,
  },
  activeMs: 1000,
  event: answered
    ? { kind: "answer-next" }
    : { kind: "answer", answer: { kind: "rating", grade: "partly" } },
})

describe("player actions", () => {
  it("records inside a unit without a refresh, and refreshes at its end", async () => {
    const { id } = await startNewSession({ kind: "reviews_only" })
    const answer = rating(0)
    expect(await recordEvent(id, answer)).toEqual({ ok: true })
    expect(refresh).not.toHaveBeenCalled()
    expect(await finishUnit(id, rating(0, answer.id))).toEqual({ ok: true })
    expect(refresh).toHaveBeenCalledOnce()
    expect(db.select().from(session).get()?.position).toEqual({
      unit: "end",
      screen: "summary",
    })
  })

  it("does not refresh a stale finish", async () => {
    const { id } = await startNewSession({ kind: "reviews_only" })
    expect(await finishUnit(id, rating(3))).toEqual({ ok: false, stale: true })
    expect(refresh).not.toHaveBeenCalled()
  })

  it.each([
    ["a bad session id", "nope", rating(0)],
    ["an unknown event", randomUUID(), { ...rating(0), event: { kind: "x" } }],
    [
      "an extra field",
      randomUUID(),
      { ...rating(0), event: { kind: "answer-next", extra: 1 } },
    ],
    ["a negative active time", randomUUID(), { ...rating(0), activeMs: -1 }],
    [
      "an active time that is not a number",
      randomUUID(),
      { ...rating(0), activeMs: "1" },
    ],
    [
      "a blank sticky note",
      randomUUID(),
      { ...rating(0), event: { kind: "note-stick", text: "  " } },
    ],
    [
      "a guess without an option",
      randomUUID(),
      { ...rating(0), event: { kind: "guess-lock" } },
    ],
  ])("refuses %s", async (_, sessionId, event) => {
    expect(await recordEvent(sessionId, event)).toEqual({
      ok: false,
      refused: true,
    })
  })

  it("refuses an event that does not fit, instead of throwing", async () => {
    const { id } = await startNewSession({ kind: "reviews_only" })
    // answer-next before the review is answered: a DalError.
    const next = { ...rating(0), event: { kind: "answer-next" } }
    expect(await finishUnit(id, next)).toEqual({ ok: false, refused: true })
    expect(refresh).not.toHaveBeenCalled()
  })

  it("clamps an implausible active time instead of refusing the event", async () => {
    const { id } = await startNewSession({ kind: "reviews_only" })
    const answer = { ...rating(0), activeMs: 30 * 24 * 60 * 60 * 1000 }
    expect(await recordEvent(id, answer)).toEqual({ ok: true })
    expect(db.select().from(session).get()?.activeMs).toBe(
      7 * 24 * 60 * 60 * 1000
    )
  })

  it("exits with drafts and refreshes", async () => {
    const { id } = await startNewSession({ kind: "reviews_only" })
    expect(
      await exitSession(id, 5000, [
        { key: "recall:leap-years:leap-rule", text: "x", updatedAt: 1 },
      ])
    ).toEqual({ ok: true })
    expect(refresh).toHaveBeenCalledOnce()
    expect(db.select().from(session).get()?.endedAt).not.toBeNull()
    expect(db.select().from(draft).all()).toHaveLength(1)
  })

  it("saves a draft", async () => {
    await saveDraft({ key: "short:leap-years:e-x", text: "y", updatedAt: 2 })
    expect(db.select().from(draft).all()).toEqual([
      { key: "short:leap-years:e-x", text: "y", updatedAt: 2 },
    ])
    await expect(
      saveDraft({ key: 1, text: "", updatedAt: 0 })
    ).rejects.toThrow()
  })
})

describe("server failures", () => {
  it("throws a transient database error, so the client retries it", async () => {
    const { id } = await startNewSession({ kind: "reviews_only" })
    // Another connection holds the write lock past the busy timeout.
    db.$client.pragma("busy_timeout = 0")
    const other = new Database(db.$client.name)
    other.exec("BEGIN IMMEDIATE")
    try {
      await expect(recordEvent(id, rating(0))).rejects.toMatchObject({
        code: "SQLITE_BUSY",
      })
    } finally {
      other.exec("ROLLBACK")
      other.close()
    }
    // Once the lock is gone, the same event applies.
    expect(await recordEvent(id, rating(0))).toEqual({ ok: true })
  })
})

describe("undoSkip", () => {
  it("refuses a bad lesson id, and refreshes", async () => {
    const { id } = await startNewSession({ kind: "reviews_only" })
    expect(await undoSkip(id, "Not An Id", randomUUID())).toEqual({
      ok: false,
      refused: true,
    })
    expect(refresh).toHaveBeenCalled()
  })
})

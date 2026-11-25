import { randomUUID } from "node:crypto"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Db } from "@/lib/db/client"
import {
  attempt,
  conceptSchedule,
  draft,
  lessonProgress,
  session,
  shownUpDay,
} from "@/lib/db/schema"
import type { ExpectedPosition, PlayerEvent } from "@/lib/engine/player"
import type { ReviewQueueItem } from "@/lib/engine/session"
import type { SessionPosition as SessionRowPosition } from "@/lib/engine/types"
import {
  ENC,
  LEAP,
  lockGate,
  putLesson,
  putSchedule,
  setNow,
  setupDal,
} from "@/test/dal"

import {
  applyPlayerEvent,
  exitPlayerSession,
  getPlayerUnit,
  recallDraftKey,
  saveDraftText,
  type PlayerView,
} from "./player"
import { startNewSession } from "./sessions"

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))

let db: Db
let close: () => void
let at: number
const DAY = "2026-11-24"
const LEAP_CONCEPTS = ["c-tropical-year", "c-julian", "c-gregorian-rule"]

beforeEach(() => {
  ;({ db, close } = setupDal())
  at = setNow(`${DAY}T12:00:00Z`)
})
afterEach(() => {
  vi.useRealTimers()
  close()
})

const digestOf = async (p: Promise<unknown>) =>
  ((await p.catch((e: unknown) => e)) as { digest?: string }).digest ?? ""

/** The leap-years lesson done three days ago, with its concepts due today. */
function leapDue(cursor = 0) {
  putLesson(db, LEAP, "leap-rule", { at: at - 3 * 864e5, day: "2026-11-21" })
  for (const id of LEAP_CONCEPTS)
    putSchedule(db, LEAP, id, {
      dueDay: DAY,
      lastEventDay: "2026-11-21",
      versionCursor: cursor,
    })
}

const sessionRow = (id: string) =>
  db
    .select()
    .from(session)
    .all()
    .find((s) => s.id === id)!

function send(
  sessionId: string,
  view: Pick<PlayerView, "expected">,
  event: PlayerEvent,
  id = randomUUID(),
  activeMs = 1000
) {
  return applyPlayerEvent(sessionId, {
    id,
    expected: view.expected,
    activeMs,
    event,
  })
}

const rate = (grade: "forgot" | "partly" | "remembered" = "remembered") =>
  ({ kind: "answer", answer: { kind: "rating", grade } }) as const

const reviewsAt = (index: number, answered?: string): ExpectedPosition => ({
  session: answered
    ? { unit: "reviews", index, answered }
    : { unit: "reviews", index },
  lesson: null,
})

describe("a reviews-only session", () => {
  it("shows the review block with every item rendered", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "reviews_only" })
    const view = await getPlayerUnit(id)
    expect(view.frame).toMatchObject({
      title: "Reviews",
      timer: "live",
      steps: null,
    })
    expect(view.expected).toEqual(reviewsAt(0))
    expect(view.unitKey).toBe("reviews")
    if (view.unit.kind !== "reviews") throw new Error(view.unit.kind)
    expect(view.unit.index).toBe(0)
    expect(view.unit.answered).toBeNull()
    expect(view.unit.items.map((i) => i.conceptId).sort()).toEqual(
      [...LEAP_CONCEPTS].sort()
    )
    expect(view.unit.items[0]).toMatchObject({
      courseId: LEAP,
      courseTitle: "Why leap years exist",
      version: { kind: "prompt" },
    })
  })

  it("records a rating: attempt, schedule, version and showing up", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "reviews_only" })
    const view = await getPlayerUnit(id)
    const eventId = randomUUID()
    expect(await send(id, view, rate("remembered"), eventId, 4000)).toEqual({
      ok: true,
    })

    const [a] = db.select().from(attempt).all()
    const item = (sessionRow(id).reviewQueue as ReviewQueueItem[])[0]
    expect(a).toMatchObject({
      id: eventId,
      sessionId: id,
      context: "review",
      courseId: LEAP,
      conceptId: item.conceptId,
      exerciseId: null,
      grade: "remembered",
      correct: null,
      isRetry: false,
      day: DAY,
    })
    const sched = db
      .select()
      .from(conceptSchedule)
      .all()
      .find((s) => s.conceptId === item.conceptId)!
    expect(sched).toMatchObject({
      lastEventDay: DAY,
      laterDayReviews: 1,
      lastGrade: "remembered",
      versionCursor: 1,
    })
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "reviews", index: 0, answered: eventId },
      lastEventId: eventId,
      activeMs: 4000,
    })
    expect(db.select().from(shownUpDay).all()).toEqual([{ day: DAY }])

    // A reload shows the answer instead of asking again.
    const reloaded = await getPlayerUnit(id)
    expect(reloaded.expected).toEqual(reviewsAt(0, eventId))
    if (reloaded.unit.kind !== "reviews") throw new Error()
    expect(reloaded.unit.answered).toEqual({
      attemptId: eventId,
      grade: "remembered",
    })
  })

  it("treats a re-sent event as done", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "reviews_only" })
    const view = await getPlayerUnit(id)
    const eventId = randomUUID()
    await send(id, view, rate(), eventId)
    expect(await send(id, view, rate(), eventId)).toEqual({ ok: true })
    expect(db.select().from(attempt).all()).toHaveLength(1)

    const next = randomUUID()
    const answered = { expected: reviewsAt(0, eventId) }
    await send(id, answered, { kind: "answer-next" }, next)
    // The answer, re-sent after a later event: its attempt exists.
    expect(await send(id, view, rate(), eventId)).toEqual({ ok: true })
    expect(await send(id, answered, { kind: "answer-next" }, next)).toEqual({
      ok: true,
    })
    expect(sessionRow(id).position).toEqual({ unit: "reviews", index: 1 })
  })

  it("ignores an event sent from a stale position", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "reviews_only" })
    const before = sessionRow(id)
    expect(await send(id, { expected: reviewsAt(1) }, rate())).toEqual({
      ok: false,
      stale: true,
    })
    expect(db.select().from(attempt).all()).toEqual([])
    expect(sessionRow(id)).toEqual(before)
  })

  it("refuses an answer of the wrong kind", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "reviews_only" })
    const view = await getPlayerUnit(id)
    await expect(
      send(id, view, {
        kind: "answer",
        answer: {
          kind: "exercise",
          response: { type: "mc", optionId: "x" },
          confidence: "sure",
        },
      })
    ).rejects.toThrow(/rating/)
    await expect(send(id, view, { kind: "answer-next" })).rejects.toThrow(
      /not answered/
    )
  })

  it("runs to its end and shows the summary", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "reviews_only" })
    for (let i = 0; i < 3; i++) {
      const eventId = randomUUID()
      await send(id, { expected: reviewsAt(i) }, rate(), eventId)
      await send(
        id,
        { expected: reviewsAt(i, eventId) },
        { kind: "answer-next" }
      )
    }
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "end", screen: "summary" },
      endedAt: at,
    })
    const view = await getPlayerUnit(id)
    expect(view.frame).toMatchObject({
      title: "Session complete",
      timer: "used",
    })
    expect(view.unit).toEqual({
      kind: "summary",
      line: "3 reviews. Next time, Checkpoint 1.",
      // The session continues leap-years; its open checkpoint is a target.
      keepGoing: { courseId: LEAP },
    })
  })

  it("re-queues a wrong Sure on an exercise version", async () => {
    // Cursor 1: c-tropical-year's second version is its fill-in exercise.
    putLesson(db, LEAP, "leap-rule", { at: at - 3 * 864e5, day: "2026-11-21" })
    putSchedule(db, LEAP, "c-tropical-year", {
      dueDay: DAY,
      lastEventDay: "2026-11-21",
      versionCursor: 1,
    })
    const { id } = await startNewSession({ kind: "reviews_only" })
    const view = await getPlayerUnit(id)
    if (view.unit.kind !== "reviews") throw new Error()
    expect(view.unit.items[0].version).toEqual({
      kind: "exercise",
      exerciseId: "e-tropical-review",
      type: "fill",
    })
    await send(id, view, {
      kind: "answer",
      answer: {
        kind: "exercise",
        response: { type: "fill", text: "solar" },
        confidence: "sure",
      },
    })
    const queue = sessionRow(id).reviewQueue as ReviewQueueItem[]
    expect(queue).toHaveLength(2)
    expect(queue[1]).toEqual(queue[0])
    expect(db.select().from(attempt).get()).toMatchObject({
      exerciseId: "e-tropical-review",
      correct: false,
      confidence: "sure",
      grade: "forgot",
    })
  })
})

describe("ending and leaving", () => {
  it("× saves drafts and the active time, then the summary", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "reviews_only" })
    const key = recallDraftKey(ENC, "symmetric-ciphers")
    await exitPlayerSession(id, {
      activeMs: 65_000,
      drafts: [{ key, text: "a shared key", updatedAt: 5 }],
    })
    expect(sessionRow(id)).toMatchObject({
      activeMs: 65_000,
      position: { unit: "end", screen: "summary" },
      endedAt: at,
    })
    expect(db.select().from(draft).all()).toEqual([
      { key, text: "a shared key", updatedAt: 5 },
    ])
    const view = await getPlayerUnit(id)
    expect(view.unit).toMatchObject({
      kind: "summary",
      line: "Nothing recorded. Next time, Checkpoint 1.",
    })
  })

  it("refuses a draft key it does not know", async () => {
    await expect(
      saveDraftText({ key: "other:x", text: "", updatedAt: 1 })
    ).rejects.toThrow(/draft key/)
  })

  it("redirects an ended session to Today once a newer one exists", async () => {
    leapDue()
    const { id: first } = await startNewSession({ kind: "reviews_only" })
    // Still open: the old session is closed by the new one, mid-block.
    vi.setSystemTime(at + 1000)
    await startNewSession({ kind: "reviews_only" })
    expect(await digestOf(getPlayerUnit(first))).toMatch(
      /^NEXT_REDIRECT;[a-z]+;\/;/
    )
    // Its events are stale: the session was closed elsewhere.
    expect(await send(first, { expected: reviewsAt(0) }, rate())).toEqual({
      ok: false,
      stale: true,
    })
  })

  it("breaks a tie between sessions started in the same millisecond", async () => {
    leapDue()
    const { id: first } = await startNewSession({ kind: "reviews_only" })
    await exitPlayerSession(first, { activeMs: 0, drafts: [] })
    const { id: second } = await startNewSession({ kind: "reviews_only" })
    await exitPlayerSession(second, { activeMs: 0, drafts: [] })
    expect(sessionRow(first).startedAt).toBe(sessionRow(second).startedAt)
    expect(await digestOf(getPlayerUnit(first))).toMatch(
      /^NEXT_REDIRECT;[a-z]+;\/;/
    )
    expect((await getPlayerUnit(second)).unit.kind).toBe("summary")
  })

  it("404s an unknown session", async () => {
    expect(await digestOf(getPlayerUnit(randomUUID()))).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404"
    )
  })
})

describe("Recall, write then tick", () => {
  async function atRecall() {
    putLesson(db, ENC, "symmetric-ciphers", {
      at: at - 864e5,
      position: { step: "recall", phase: "write" },
    })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    return id
  }

  it("loads the lesson, picking up where it stopped", async () => {
    const id = await atRecall()
    const key = recallDraftKey(ENC, "symmetric-ciphers")
    await saveDraftText({ key, text: "keys", updatedAt: 7 })
    const view = await getPlayerUnit(id)
    expect(view.frame).toMatchObject({
      title: "Lesson 1 · Locks with one key",
      subtitle: "How encryption keeps secrets",
      steps: { current: "recall", hasWarmup: false },
    })
    expect(view.expected).toEqual({
      session: { unit: "lesson", lessonId: "symmetric-ciphers" },
      lesson: { step: "recall", phase: "write" },
    })
    expect(view.unit).toMatchObject({
      kind: "recall-write-tick",
      phase: "write",
      pickingUp: true,
      draftKey: key,
      draft: { key, text: "keys", updatedAt: 7 },
    })
    const row = db.select().from(lessonProgress).get()!
    expect(row.lastSessionId).toBe(id)
    // A second load in the same session is not "picking up".
    const again = await getPlayerUnit(id)
    expect(again.unit).toMatchObject({ pickingUp: false })
  })

  it("records the text, then the ticks and the exercise queue", async () => {
    const id = await atRecall()
    const key = recallDraftKey(ENC, "symmetric-ciphers")
    await saveDraftText({ key, text: "keys", updatedAt: 7 })
    const view = await getPlayerUnit(id)
    await send(id, view, { kind: "recall-write", text: "a shared key" })
    let row = db.select().from(lessonProgress).get()!
    expect(row).toMatchObject({
      recallText: "a shared key",
      position: { step: "recall", phase: "tick" },
    })
    expect(db.select().from(draft).all()).toEqual([])

    const tick = await getPlayerUnit(id)
    expect(tick.unitKey).toBe(view.unitKey)
    expect(tick.unit).toMatchObject({ phase: "tick", written: "a shared key" })
    await send(id, tick, {
      kind: "recall-tick",
      ticked: ["c-shared-key", "not-a-concept"],
    })
    row = db.select().from(lessonProgress).get()!
    expect(row.recallTicked).toEqual(["c-shared-key"])
    expect(row.recallQueue).toHaveLength(2)
    expect(row.position).toEqual({
      step: "recall",
      phase: "exercises",
      index: 0,
    })
    const next = await getPlayerUnit(id)
    expect(next.unitKey).not.toBe(view.unitKey)
    expect(next.unit).toEqual({
      kind: "pending",
      unit: "recall-exercises-answers",
    })
  })

  it("checks the lesson position as well as the session's", async () => {
    const id = await atRecall()
    const view = await getPlayerUnit(id)
    expect(
      await send(
        id,
        {
          expected: {
            session: view.expected.session,
            lesson: { step: "recall", phase: "tick" },
          },
        },
        { kind: "recall-tick", ticked: [] }
      )
    ).toEqual({ ok: false, stale: true })
  })
})

describe("after the review block, and Continue", () => {
  /** Answers every review in the block, the last with `lastActiveMs`. */
  async function answerAll(id: string, lastActiveMs = 1000) {
    const n = (sessionRow(id).reviewQueue as ReviewQueueItem[]).length
    for (let i = 0; i < n; i++) {
      const eventId = randomUUID()
      await send(id, { expected: reviewsAt(i) }, rate(), eventId)
      await send(
        id,
        { expected: reviewsAt(i, eventId) },
        { kind: "answer-next" },
        randomUUID(),
        i === n - 1 ? lastActiveMs : 1000
      )
    }
  }

  function encAtRecall() {
    putLesson(db, ENC, "symmetric-ciphers", {
      at: at - 864e5,
      position: { step: "recall", phase: "write" },
    })
  }

  it("moves on to the lesson target when the budget allows", async () => {
    leapDue()
    encAtRecall()
    const { id } = await startNewSession({ kind: "standard" })
    expect(sessionRow(id).courseId).toBe(ENC)
    await answerAll(id)
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "lesson", lessonId: "symmetric-ciphers" },
      endedAt: null,
    })
    const view = await getPlayerUnit(id)
    expect(view.unit).toMatchObject({ kind: "recall-write-tick" })
  })

  it("ends the session when the budget has run out", async () => {
    leapDue()
    encAtRecall()
    const { id } = await startNewSession({ kind: "standard" })
    await answerAll(id, 15 * 60_000)
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "end", screen: "summary" },
      activeMs: 15 * 60_000,
      endedAt: at,
    })
  })

  it("gives a checkpoint target its queue", async () => {
    leapDue()
    const { id } = await startNewSession({ kind: "standard", courseId: LEAP })
    await answerAll(id)
    const row = sessionRow(id)
    expect(row.position).toMatchObject({ unit: "checkpoint", index: 0 })
    expect(row.checkpointQueue).toEqual([
      "x-leap-2100",
      "x-leap-drift",
      "x-leap-julian",
      "x-leap-why",
    ])
    expect((await getPlayerUnit(id)).frame).toMatchObject({
      title: "Checkpoint 1",
      tag: "open",
    })
  })

  function insertSession(position: SessionRowPosition, ended: boolean) {
    const id = randomUUID()
    db.insert(session)
      .values({
        id,
        kind: "standard",
        minutes: 15,
        courseId: ENC,
        reviewQueue: [],
        checkpointQueue: null,
        position,
        lastEventId: null,
        activeMs: 0,
        startedAt: at - 60_000,
        endedAt: ended ? at - 1000 : null,
      })
      .run()
    return id
  }

  it("Continue on course complete goes to the summary", async () => {
    const id = insertSession({ unit: "end", screen: "course-complete" }, true)
    const expected = {
      session: { unit: "end", screen: "course-complete" },
      lesson: null,
    } as const
    expect(await send(id, { expected }, { kind: "continue" })).toEqual({
      ok: true,
    })
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "end", screen: "summary" },
      endedAt: at - 1000,
    })
    // Continue is not a progress event.
    expect(db.select().from(shownUpDay).all()).toEqual([])
  })

  it("Continue after a completed lesson takes the next target", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 1000, day: DAY })
    const id = insertSession(
      { unit: "lesson", lessonId: "symmetric-ciphers" },
      false
    )
    const expected = {
      session: { unit: "lesson", lessonId: "symmetric-ciphers" },
      lesson: { step: "done" },
    } as const
    expect(await send(id, { expected }, { kind: "continue" })).toEqual({
      ok: true,
    })
    expect(sessionRow(id).position).toEqual({
      unit: "lesson",
      lessonId: "hash-functions",
    })
  })

  it("refuses Continue before the lesson is done", async () => {
    encAtRecall()
    const id = insertSession(
      { unit: "lesson", lessonId: "symmetric-ciphers" },
      false
    )
    const expected = {
      session: { unit: "lesson", lessonId: "symmetric-ciphers" },
      lesson: { step: "recall", phase: "write" },
    } as const
    await expect(send(id, { expected }, { kind: "continue" })).rejects.toThrow(
      /not done/
    )
  })
})

describe("requireLearner refusals", () => {
  it.each<[string, () => Promise<unknown>]>([
    ["getPlayerUnit", () => getPlayerUnit(randomUUID())],
    [
      "applyPlayerEvent",
      () =>
        applyPlayerEvent(randomUUID(), {
          id: randomUUID(),
          expected: reviewsAt(0),
          activeMs: 0,
          event: { kind: "answer-next" },
        }),
    ],
    [
      "exitPlayerSession",
      () => exitPlayerSession(randomUUID(), { activeMs: 0, drafts: [] }),
    ],
    [
      "saveDraftText",
      () => saveDraftText({ key: "recall:a:b", text: "", updatedAt: 0 }),
    ],
  ])("%s redirects to /unlock", async (_, call) => {
    lockGate()
    expect(await digestOf(call())).toMatch(/^NEXT_REDIRECT;[a-z]+;\/unlock;/)
  })
})

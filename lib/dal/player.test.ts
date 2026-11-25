import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Db } from "@/lib/db/client"
import {
  answerNote,
  attempt,
  conceptSchedule,
  draft,
  guessAnswer,
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
  noteDraftKey,
  recallDraftKey,
  saveDraftText,
  shortDraftKey,
  undoPlayerSkip,
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
      answer: { kind: "rating", grade: "remembered" },
      correct: null,
      confidence: null,
      selfMark: null,
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
    expect(view.unit.items[0].version).toMatchObject({
      kind: "exercise",
      exercise: { id: "e-tropical-review", type: "fill" },
      briefKey: `${LEAP}/leap-rule`,
    })
    // The brief it points to comes once, without the learner's guesses.
    expect(Object.keys(view.unit.briefs)).toEqual([`${LEAP}/leap-rule`])
    expect(view.unit.briefs[`${LEAP}/leap-rule`].guessPicks).toEqual({})
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

    // A reload shows the feedback, and the grown block.
    const reloaded = await getPlayerUnit(id)
    if (reloaded.unit.kind !== "reviews") throw new Error()
    expect(reloaded.unit.items).toHaveLength(2)
    expect(reloaded.unit.answered).toMatchObject({
      answer: {
        kind: "exercise",
        response: { type: "fill", text: "solar" },
        confidence: "sure",
      },
      correct: false,
      confidence: "sure",
      grade: "forgot",
    })

    // The retry is marked as one and leaves the schedule alone.
    const sched = () => db.select().from(conceptSchedule).get()!
    const before = sched()
    await send(id, reloaded, { kind: "answer-next" })
    const retry = await getPlayerUnit(id)
    await send(id, retry, {
      kind: "answer",
      answer: {
        kind: "exercise",
        response: { type: "fill", text: "tropical" },
        confidence: "sure",
      },
    })
    const attempts = db.select().from(attempt).all()
    expect(attempts.map((a) => [a.isRetry, a.correct])).toEqual([
      [false, false],
      [true, true],
    ])
    expect(sched()).toEqual(before)
    // At most once per exercise per session: a wrong retry does not grow it.
    expect(sessionRow(id).reviewQueue).toHaveLength(2)
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
    expect(next.unit).toMatchObject({
      kind: "recall-exercises",
      index: 0,
      answered: null,
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

describe("Recall exercises", () => {
  const LESSON = "symmetric-ciphers"
  const QUEUE = [
    "e-shared-key-recall",
    "e-kerckhoffs-recall",
    "e-key-length-recall",
  ]

  async function atExercises(index = 0) {
    putLesson(db, ENC, LESSON, {
      at: at - 864e5,
      position: { step: "recall", phase: "exercises", index },
    })
    db.update(lessonProgress)
      .set({ recallQueue: QUEUE, recallTicked: [] })
      .run()
    db.insert(guessAnswer)
      .values({
        courseId: ENC,
        lessonId: LESSON,
        guessId: "g-caesar",
        optionId: "g-caesar-thousands",
        answeredAt: at,
      })
      .run()
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    return id
  }

  const lessonRow = () => db.select().from(lessonProgress).get()!
  const mc = (optionId: string, confidence: "sure" | "not_sure" | "guess") =>
    ({
      kind: "answer",
      answer: {
        kind: "exercise",
        response: { type: "mc", optionId },
        confidence,
      },
    }) as const

  it("shows the queue's exercises with the lesson's brief", async () => {
    const id = await atExercises()
    const key = shortDraftKey(ENC, "e-kerckhoffs-recall")
    await saveDraftText({ key, text: "public study", updatedAt: 9 })
    const view = await getPlayerUnit(id)
    expect(view.frame.steps).toEqual({
      lessonId: LESSON,
      current: "recall",
      hasWarmup: false,
    })
    if (view.unit.kind !== "recall-exercises") throw new Error(view.unit.kind)
    expect(view.unit.items.map((i) => i.exercise.id)).toEqual(QUEUE)
    expect(view.unit.items.map((i) => i.draftKey)).toEqual([
      undefined,
      key,
      undefined,
    ])
    expect(view.unit.items[0].rendered.options).toBeDefined()
    expect(view.unit.drafts).toEqual({
      [key]: { key, text: "public study", updatedAt: 9 },
    })
    expect(view.unit.briefs[`${ENC}/${LESSON}`].guessPicks).toEqual({
      "g-caesar": "g-caesar-thousands",
    })
    expect(view.unit.pickingUp).toBe(true)
  })

  it("records an answer, re-queues a wrong Sure and moves on", async () => {
    const id = await atExercises()
    const view = await getPlayerUnit(id)
    const eventId = randomUUID()
    expect(
      await send(id, view, mc("e-shared-key-recall-public", "sure"), eventId)
    ).toEqual({ ok: true })
    expect(db.select().from(attempt).get()).toMatchObject({
      id: eventId,
      context: "recall",
      courseId: ENC,
      conceptId: "c-shared-key",
      exerciseId: "e-shared-key-recall",
      correct: false,
      confidence: "sure",
      grade: "forgot",
      isRetry: false,
    })
    const row = lessonRow()
    expect(row.position).toEqual({
      step: "recall",
      phase: "exercises",
      index: 0,
      answered: eventId,
    })
    expect(row.recallQueue).toEqual([
      "e-shared-key-recall",
      "e-kerckhoffs-recall",
      "e-key-length-recall",
      "e-shared-key-recall",
    ])
    // Recall exercises touch no schedule (R5).
    expect(db.select().from(conceptSchedule).all()).toEqual([])
    expect(sessionRow(id).position).toEqual({
      unit: "lesson",
      lessonId: LESSON,
    })

    // A reload shows the feedback instead of asking again.
    const reloaded = await getPlayerUnit(id)
    expect(reloaded.unitKey).toBe(view.unitKey)
    if (reloaded.unit.kind !== "recall-exercises") throw new Error()
    expect(reloaded.unit.items).toHaveLength(4)
    expect(reloaded.unit.answered).toMatchObject({
      attemptId: eventId,
      correct: false,
      confidence: "sure",
    })
    // A second answer to the same item is refused.
    await expect(
      send(id, reloaded, mc("e-shared-key-recall-same", "sure"))
    ).rejects.toThrow()

    await send(id, reloaded, { kind: "answer-next" })
    expect(lessonRow().position).toEqual({
      step: "recall",
      phase: "exercises",
      index: 1,
    })
  })

  it("records a short answer with its self-mark and drops its draft", async () => {
    const id = await atExercises(1)
    const key = shortDraftKey(ENC, "e-kerckhoffs-recall")
    await saveDraftText({ key, text: "public study", updatedAt: 9 })
    const view = await getPlayerUnit(id)
    await send(id, view, {
      kind: "answer",
      answer: {
        kind: "exercise",
        response: { type: "short", text: "public study", ticked: [0] },
        confidence: null,
      },
    })
    expect(db.select().from(attempt).get()).toMatchObject({
      context: "recall",
      exerciseId: "e-kerckhoffs-recall",
      correct: null,
      confidence: null,
      selfMark: "partial",
      grade: "partly",
    })
    expect(db.select().from(draft).all()).toEqual([])
    expect(lessonRow().recallQueue).toEqual(QUEUE)
  })

  it("goes on to step 5 after the last exercise", async () => {
    const id = await atExercises(2)
    const view = await getPlayerUnit(id)
    await expect(send(id, view, { kind: "answer-next" })).rejects.toThrow()
    await send(id, view, {
      kind: "answer",
      answer: {
        kind: "exercise",
        response: { type: "fill", text: " Doubles! " },
        confidence: "not_sure",
      },
    })
    expect(db.select().from(attempt).get()).toMatchObject({
      correct: true,
      grade: "partly",
    })
    const answered = await getPlayerUnit(id)
    await send(id, answered, { kind: "answer-next" })
    expect(lessonRow().position).toEqual({ step: "answers", index: 0 })
    const next = await getPlayerUnit(id)
    expect(next.unitKey).toBe(view.unitKey)
    expect(next.unit).toMatchObject({
      kind: "recall-exercises",
      stage: "answers",
      index: QUEUE.length,
      boardIndex: 0,
      lessonLabel: "Lesson 1",
      complete: null,
    })
    if (next.unit.kind !== "recall-exercises") throw new Error()
    expect(next.unit.boards.map((b) => b.keyQuestionId)).toEqual(["q2", "q1"])
  })

  it("refuses a response of the wrong type", async () => {
    const id = await atExercises()
    const view = await getPlayerUnit(id)
    await expect(
      send(id, view, {
        kind: "answer",
        answer: {
          kind: "exercise",
          response: { type: "fill", text: "same" },
          confidence: "sure",
        },
      })
    ).rejects.toThrow(/fill response/)
    await expect(send(id, view, rate())).rejects.toThrow(/response/)
    expect(db.select().from(attempt).all()).toEqual([])
  })
})

describe("lesson steps", () => {
  const L1 = "symmetric-ciphers"
  const lessonRow = (lessonId = L1) =>
    db
      .select()
      .from(lessonProgress)
      .all()
      .find((r) => r.lessonId === lessonId)

  it("starts a Ready course at Guess first, then Read, then Recall", async () => {
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const view = await getPlayerUnit(id)
    expect(view.frame).toMatchObject({
      title: "Lesson 1 · Locks with one key",
      steps: { current: "guess", hasWarmup: false },
      skip: { lessonId: L1, number: 1 },
    })
    expect(view.unit).toMatchObject({
      kind: "guess",
      index: 0,
      pickingUp: false,
    })
    if (view.unit.kind !== "guess") throw new Error()
    expect(view.unit.guesses.map((g) => g.id)).toEqual([
      "g-caesar",
      "g-open-design",
    ])
    expect(view.unit.guesses[0].options.map((o) => o.id)).toEqual([
      "g-caesar-25",
      "g-caesar-thousands",
      "g-caesar-millions",
    ])

    // An option of another guess is refused.
    await expect(
      send(id, view, { kind: "guess-lock", optionId: "g-open-design-public" })
    ).rejects.toThrow(/not an option/)
    await send(id, view, { kind: "guess-lock", optionId: "g-caesar-millions" })
    expect(lessonRow()!.position).toEqual({ step: "guess", index: 1 })
    const second = await getPlayerUnit(id)
    await send(id, second, {
      kind: "guess-lock",
      optionId: "g-open-design-public",
    })
    expect(db.select().from(guessAnswer).all()).toHaveLength(2)
    expect(lessonRow()!.position).toEqual({ step: "read" })
    expect(db.select().from(shownUpDay).all()).toEqual([{ day: DAY }])

    const read = await getPlayerUnit(id)
    expect(read.frame.steps).toEqual({
      lessonId: L1,
      current: "read",
      hasWarmup: false,
    })
    if (read.unit.kind !== "read") throw new Error(read.unit.kind)
    expect(read.unit.readMinutes).toBeGreaterThan(0)
    expect(read.unit.brief.guessPicks).toEqual({
      "g-caesar": "g-caesar-millions",
      "g-open-design": "g-open-design-public",
    })
    expect(read.unit.beyond.simplified.map((e) => e.id)).toContain("s-xor-only")
    await send(id, read, { kind: "read-done" })
    expect(lessonRow()!.position).toEqual({ step: "recall", phase: "write" })
    expect(sessionRow(id).position).toEqual({ unit: "lesson", lessonId: L1 })
  })

  it("warms up from the lesson last completed, without touching reviews", async () => {
    putLesson(db, ENC, L1, { at: at - 864e5, day: "2026-11-23" })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const view = await getPlayerUnit(id)
    expect(view.frame).toMatchObject({
      title: "Lesson 2 · Fingerprints for data",
      steps: { current: "warmup", hasWarmup: true },
    })
    expect(view.unit).toMatchObject({
      kind: "warmup",
      sourceNumber: 1,
      index: 0,
    })
    if (view.unit.kind !== "warmup") throw new Error()
    expect(view.unit.prompts).toHaveLength(3)
    for (let i = 0; i < 3; i++) {
      await send(
        id,
        {
          expected: {
            session: { unit: "lesson", lessonId: "hash-functions" },
            lesson: { step: "warmup", index: i },
          },
        },
        { kind: "warmup-next" }
      )
    }
    expect(lessonRow("hash-functions")!.position).toEqual({
      step: "guess",
      index: 0,
    })
    expect(db.select().from(attempt).all()).toEqual([])
    expect(db.select().from(conceptSchedule).all()).toEqual([])
  })

  it("ends the session at a step the budget has no room for", async () => {
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const view = await getPlayerUnit(id)
    await send(id, view, { kind: "read-done" }, randomUUID(), 14 * 60_000)
    // The lesson moved on, so the next session resumes at Recall.
    expect(lessonRow()!.position).toEqual({ step: "recall", phase: "write" })
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "end", screen: "summary" },
      endedAt: at,
    })
  })

  async function atAnswers(index = 0) {
    putLesson(db, ENC, L1, {
      at: at - 864e5,
      position: { step: "answers", index },
    })
    db.update(lessonProgress)
      .set({
        recallTicked: ["c-shared-key", "c-kerckhoffs"],
        recallQueue: ["e-kerckhoffs-recall", "e-key-length-recall"],
      })
      .run()
    // c-kerckhoffs was ticked, but its Recall exercise was forgotten.
    db.insert(attempt)
      .values({
        id: randomUUID(),
        sessionId: randomUUID(),
        context: "recall",
        courseId: ENC,
        conceptId: "c-kerckhoffs",
        exerciseId: "e-kerckhoffs-recall",
        response: null,
        correct: false,
        confidence: "sure",
        selfMark: null,
        grade: "forgot",
        isRetry: false,
        day: "2026-11-23",
        answeredAt: at - 864e5,
      })
      .run()
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    return id
  }

  it("sticks a note per board, then completes the lesson", async () => {
    const id = await atAnswers()
    const key = noteDraftKey(ENC, L1, "q2")
    await saveDraftText({ key, text: "keys", updatedAt: 1 })
    const view = await getPlayerUnit(id)
    if (view.unit.kind !== "recall-exercises") throw new Error()
    expect(view.unit).toMatchObject({ stage: "answers", pickingUp: true })
    expect(view.unit.boards[0]).toMatchObject({
      keyQuestionId: "q2",
      draftKey: key,
      draft: { text: "keys" },
    })

    await send(id, view, { kind: "note-stick", text: "one shared key" })
    expect(db.select().from(answerNote).all()).toMatchObject([
      { keyQuestionId: "q2", lessonId: L1, text: "one shared key" },
    ])
    expect(db.select().from(draft).all()).toEqual([])
    expect(lessonRow()!.position).toEqual({ step: "answers", index: 1 })
    expect(lessonRow()!.completedAt).toBeNull()

    const second = await getPlayerUnit(id)
    if (second.unit.kind !== "recall-exercises") throw new Error()
    expect(second.unit.boardIndex).toBe(1)
    await send(id, second, { kind: "note-stick", text: "open design" })
    expect(lessonRow()).toMatchObject({
      position: { step: "done" },
      completedAt: at,
      completedDay: DAY,
    })
    // Recalled concepts wait 2 days, the rest 1 (R2).
    const sched = db.select().from(conceptSchedule).all()
    expect(
      Object.fromEntries(sched.map((r) => [r.conceptId, r.dueDay]))
    ).toEqual({
      "c-shared-key": "2026-11-26",
      "c-kerckhoffs": "2026-11-25",
      "c-key-length": "2026-11-25",
    })

    const done = await getPlayerUnit(id)
    expect(done.frame).toMatchObject({
      steps: { current: null },
      skip: null,
    })
    if (done.unit.kind !== "recall-exercises") throw new Error()
    expect(done.unit.complete).toEqual({
      heading: "Lesson 1 complete",
      line: "Next, Lesson 2: How can you tell that a file you downloaded is exactly the one its author published?",
    })
    await send(id, done, { kind: "continue" })
    expect(sessionRow(id).position).toEqual({
      unit: "lesson",
      lessonId: "hash-functions",
    })
  })

  it("Skip this step completes the lesson too", async () => {
    const id = await atAnswers(1)
    const view = await getPlayerUnit(id)
    await send(id, view, { kind: "answers-skip" })
    expect(lessonRow()!.position).toEqual({ step: "done" })
    expect(db.select().from(conceptSchedule).all()).toHaveLength(3)
    expect(db.select().from(answerNote).all()).toEqual([])
  })

  it("skips from the player and undoes it", async () => {
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const view = await getPlayerUnit(id)
    const skipId = randomUUID()
    expect(await send(id, view, { kind: "skip-lesson" }, skipId)).toEqual({
      ok: true,
    })
    expect(lessonRow()).toMatchObject({
      skipped: true,
      lastSessionId: id,
      position: { step: "read" },
    })
    // The next target, never the lesson it just skipped (§7.6).
    expect(sessionRow(id).position).toEqual({
      unit: "lesson",
      lessonId: "hash-functions",
    })
    expect(db.select().from(shownUpDay).all()).toEqual([{ day: DAY }])
    // The next lesson loads, which gives it a row in this session.
    await getPlayerUnit(id)
    expect(lessonRow("hash-functions")).toMatchObject({ lastSessionId: id })

    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({ ok: true })
    expect(lessonRow()).toMatchObject({
      skipped: false,
      position: { step: "read" },
    })
    expect(sessionRow(id).position).toEqual({ unit: "lesson", lessonId: L1 })
    // Nothing was done in the lesson the skip moved to: it is untouched again.
    expect(lessonRow("hash-functions")).toBeUndefined()
    // Nothing left to undo.
    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({
      ok: false,
      stale: true,
    })
  })

  it("undo puts back a lesson the skip moved to as it was", async () => {
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    // Lesson 2 was skipped from the Syllabus before it was ever started.
    db.insert(lessonProgress)
      .values({
        courseId: ENC,
        lessonId: "hash-functions",
        skipped: true,
        position: null,
        updatedAt: at - 864e5,
      })
      .run()
    // Lesson 3 was entered in an earlier session and left at its start.
    putLesson(db, ENC, "key-exchange", {
      at: at - 2 * 864e5,
      position: { step: "guess", index: 0 },
      lastSessionId: "earlier",
    })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const skipId = randomUUID()
    await send(id, await getPlayerUnit(id), { kind: "skip-lesson" }, skipId)
    // Lesson 3 is next: Lesson 2 is Skipped, so it waits (§7.6).
    expect(sessionRow(id).position).toEqual({
      unit: "lesson",
      lessonId: "key-exchange",
    })
    await getPlayerUnit(id)
    expect(lessonRow("key-exchange")).toMatchObject({ lastSessionId: id })

    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({ ok: true })
    expect(lessonRow("key-exchange")).toMatchObject({
      lastSessionId: "earlier",
      position: { step: "guess", index: 0 },
      updatedAt: at - 2 * 864e5,
    })
    expect(lessonRow("hash-functions")).toMatchObject({
      skipped: true,
      position: null,
    })
    expect(sessionRow(id).skipUndo).toBeNull()
  })

  it("undo leaves the next lesson alone when it changed elsewhere", async () => {
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const skipId = randomUUID()
    await send(id, await getPlayerUnit(id), { kind: "skip-lesson" }, skipId)
    await getPlayerUnit(id)
    // Another tab skips Lesson 2 from the Syllabus.
    db.update(lessonProgress)
      .set({ skipped: true })
      .where(eq(lessonProgress.lessonId, "hash-functions"))
      .run()
    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({ ok: true })
    expect(lessonRow("hash-functions")).toMatchObject({ skipped: true })
  })

  it("undo restores a Syllabus-skipped lesson the skip moved to", async () => {
    // Every other lesson is Skipped, so the first of them, Lesson 2, is
    // next (§7.6).
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    for (const l of ["hash-functions", "key-exchange", "signatures"])
      db.insert(lessonProgress)
        .values({
          courseId: ENC,
          lessonId: l,
          skipped: true,
          position: null,
          updatedAt: at - 864e5,
        })
        .run()
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const skipId = randomUUID()
    await send(id, await getPlayerUnit(id), { kind: "skip-lesson" }, skipId)
    expect(sessionRow(id).position).toEqual({
      unit: "lesson",
      lessonId: "hash-functions",
    })
    await getPlayerUnit(id)
    expect(lessonRow("hash-functions")!.skipped).toBe(false)

    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({ ok: true })
    expect(lessonRow("hash-functions")).toMatchObject({
      skipped: true,
      position: null,
      lastSessionId: null,
    })
  })

  it("undo keeps a lesson the skip moved to once it was worked on", async () => {
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const skipId = randomUUID()
    await send(id, await getPlayerUnit(id), { kind: "skip-lesson" }, skipId)
    await send(id, await getPlayerUnit(id), {
      kind: "guess-lock",
      optionId: "g-hash-length-same",
    })
    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({ ok: true })
    expect(lessonRow("hash-functions")!.position).toEqual({
      step: "guess",
      index: 1,
    })
  })

  it("undo reopens a session the skip ended", async () => {
    // The course's only other lessons are done, so nothing is left.
    for (const l of ["hash-functions", "key-exchange", "signatures"])
      putLesson(db, ENC, l, { at: at - 864e5, day: "2026-11-23" })
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    const { id } = await startNewSession({ kind: "full_lesson", courseId: ENC })
    const view = await getPlayerUnit(id)
    const skipId = randomUUID()
    await send(id, view, { kind: "skip-lesson" }, skipId)
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "end", screen: "summary" },
      endedAt: at,
    })
    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({ ok: true })
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "lesson", lessonId: L1 },
      endedAt: null,
    })
  })

  it("undo does not reopen a session ended with ×", async () => {
    putLesson(db, ENC, L1, { at: at - 864e5, position: { step: "read" } })
    const { id } = await startNewSession({ kind: "standard", courseId: ENC })
    const skipId = randomUUID()
    await send(id, await getPlayerUnit(id), { kind: "skip-lesson" }, skipId)
    await exitPlayerSession(id, { activeMs: 2000, drafts: [] })
    expect(await undoPlayerSkip(id, L1, skipId)).toEqual({
      ok: false,
      stale: true,
    })
    expect(sessionRow(id)).toMatchObject({
      position: { unit: "end", screen: "summary" },
      endedAt: at,
    })
    expect(lessonRow()!.skipped).toBe(true)
  })

  it("drops the drafts of boards skipped with text on them", async () => {
    const id = await atAnswers()
    await saveDraftText({
      key: noteDraftKey(ENC, L1, "q1"),
      text: "half a thought",
      updatedAt: 1,
    })
    await send(id, await getPlayerUnit(id), { kind: "answers-skip" })
    expect(db.select().from(draft).all()).toEqual([])
  })

  it("refuses to skip a lesson that is done", async () => {
    const id = await atAnswers(1)
    await send(id, await getPlayerUnit(id), { kind: "answers-skip" })
    const done = await getPlayerUnit(id)
    await expect(send(id, done, { kind: "skip-lesson" })).rejects.toThrow(
      /done/
    )
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

import { randomUUID } from "node:crypto"

import { eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { Db } from "@/lib/db/client"
import {
  answerNote,
  attempt,
  courseRequest,
  lessonProgress,
  session,
  settings,
  shownUpDay,
} from "@/lib/db/schema"
import type { ReviewQueueItem } from "@/lib/engine/session"
import {
  draftContent,
  ENC,
  LEAP,
  lockGate,
  putLesson,
  putSchedule,
  setNow,
  setupDal,
} from "@/test/dal"

import { addNote, deleteNote, editNote, restoreNote } from "./notes"
import { createRequest } from "./requests"
import { setHideTimer, setSessionMinutes } from "./settings"
import { skipLesson, unskipLesson } from "./lessons"
import { startSession } from "./sessions"

// No cookie and no bearer header: with the gate on, every request is refused.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/cache", () => ({ refresh }))

let db: Db
let close: () => void
let at: number
const DAY = "2026-11-24"

beforeEach(() => {
  ;({ db, close } = setupDal())
  at = setNow(`${DAY}T12:00:00Z`)
  refresh.mockClear()
})
afterEach(() => {
  vi.useRealTimers()
  close()
})

const lessonRow = (courseId: string, lessonId: string) =>
  db
    .select()
    .from(lessonProgress)
    .all()
    .find((r) => r.courseId === courseId && r.lessonId === lessonId)
const shownUpDays = () =>
  db
    .select()
    .from(shownUpDay)
    .all()
    .map((r) => r.day)
const sessions = () => db.select().from(session).all()

/** Runs an action that ends in `redirect()`, returning the target URL. */
async function redirectOf(p: Promise<unknown>): Promise<string> {
  const error = await p.then(
    () => {
      throw new Error("expected a redirect")
    },
    (e: unknown) => e
  )
  const digest = (error as { digest?: string }).digest ?? ""
  if (!digest.startsWith("NEXT_REDIRECT")) throw error
  return digest.split(";")[2]
}

describe("createRequest", () => {
  it("inserts the trimmed text", async () => {
    await expect(createRequest("  How do vaccines work?  ")).resolves.toEqual({
      ok: true,
    })
    const rows = db.select().from(courseRequest).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      text: "How do vaccines work?",
      createdAt: at,
    })
    expect(rows[0].id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it.each([
    ["too short", "short", /at least 10/],
    ["too short once trimmed", "   short    ", /at least 10/],
    ["too long", "x".repeat(2001), /2,000/],
    ["not text", 42, /./],
  ])("returns an inline error when %s", async (_, text, message) => {
    const result = await createRequest(text)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(message)
    expect(db.select().from(courseRequest).all()).toHaveLength(0)
  })

  it("accepts exactly 10 and 2,000 characters", async () => {
    expect(await createRequest("x".repeat(10))).toEqual({ ok: true })
    expect(await createRequest("x".repeat(2000))).toEqual({ ok: true })
  })

  it("is not a progress event", async () => {
    await createRequest("How do vaccines work?")
    expect(shownUpDays()).toEqual([])
  })
})

describe("settings", () => {
  const row = () => db.select().from(settings).get()!

  it("saves the session length and refreshes", async () => {
    await setSessionMinutes(20)
    expect(row()).toMatchObject({ sessionMinutes: 20, updatedAt: at })
    expect(refresh).toHaveBeenCalledOnce()
  })

  it.each([25, "15", null])("rejects the length %j", async (m) => {
    await expect(setSessionMinutes(m)).rejects.toThrow()
    expect(row().sessionMinutes).toBe(15)
  })

  it("saves hide timer without refreshing", async () => {
    await setHideTimer(true)
    expect(row().hideTimer).toBe(true)
    await setHideTimer(false)
    expect(row().hideTimer).toBe(false)
    expect(refresh).not.toHaveBeenCalled()
    await expect(setHideTimer("yes")).rejects.toThrow()
  })
})

describe("skipLesson and unskipLesson (Syllabus)", () => {
  const ref = { courseId: ENC, lessonId: "hash-functions" }

  it("creates a skipped row with no position and records showing up", async () => {
    await skipLesson(ref)
    expect(lessonRow(ENC, "hash-functions")).toMatchObject({
      skipped: true,
      position: null,
      lastSessionId: null,
      updatedAt: at,
    })
    expect(shownUpDays()).toEqual([DAY])
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("deletes a row the skip created on unskip", async () => {
    await skipLesson(ref)
    await unskipLesson(ref)
    expect(lessonRow(ENC, "hash-functions")).toBeUndefined()
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it("keeps the position and last session of an in-progress lesson", async () => {
    putLesson(db, ENC, "hash-functions", {
      at: at - 1000,
      position: { step: "read" },
      lastSessionId: "s-old",
    })
    await skipLesson(ref)
    expect(lessonRow(ENC, "hash-functions")).toMatchObject({
      skipped: true,
      position: { step: "read" },
      lastSessionId: "s-old",
      updatedAt: at,
    })
    await unskipLesson(ref)
    expect(lessonRow(ENC, "hash-functions")).toMatchObject({
      skipped: false,
      position: { step: "read" },
    })
  })

  it("does not record showing up on unskip", async () => {
    putLesson(db, ENC, "hash-functions", {
      at,
      position: { step: "read" },
      skipped: true,
    })
    await unskipLesson(ref)
    expect(shownUpDays()).toEqual([])
  })

  it("leaves a completed lesson alone and refreshes (a stale menu)", async () => {
    putLesson(db, ENC, "hash-functions", { at: at - 1000, day: DAY })
    await expect(skipLesson(ref)).resolves.toBeUndefined()
    expect(lessonRow(ENC, "hash-functions")).toMatchObject({
      skipped: false,
      updatedAt: at - 1000,
    })
    expect(shownUpDays()).toEqual([])
    expect(refresh).toHaveBeenCalledOnce()
  })

  it("treats a double skip and a double unskip as one", async () => {
    await skipLesson(ref)
    vi.setSystemTime(at + 1000)
    await skipLesson(ref)
    expect(lessonRow(ENC, "hash-functions")?.updatedAt).toBe(at)
    await unskipLesson(ref)
    await expect(unskipLesson(ref)).resolves.toBeUndefined()
    expect(lessonRow(ENC, "hash-functions")).toBeUndefined()
    putLesson(db, ENC, "hash-functions", { at, position: { step: "read" } })
    await unskipLesson(ref)
    expect(lessonRow(ENC, "hash-functions")).toMatchObject({
      skipped: false,
      updatedAt: at,
    })
    expect(refresh).toHaveBeenCalledTimes(5)
  })

  it("refuses unknown courses and lessons", async () => {
    await expect(
      skipLesson({ courseId: "no-such-course", lessonId: "x" })
    ).rejects.toMatchObject({ code: "unknown_course" })
    await expect(
      skipLesson({ courseId: ENC, lessonId: "leap-rule" })
    ).rejects.toMatchObject({ code: "unknown_lesson" })
    await expect(
      skipLesson({ courseId: ENC, lessonId: "Bad Id" })
    ).rejects.toThrow()
    await expect(skipLesson({ ...ref, extra: 1 })).rejects.toThrow()
    expect(db.select().from(lessonProgress).all()).toHaveLength(0)
  })
})

describe("notes", () => {
  const notes = () => db.select().from(answerNote).all()

  it("adds, edits and deletes a note", async () => {
    const { id } = await addNote({
      courseId: ENC,
      keyQuestionId: "q2",
      text: "  Keys stay secret  ",
    })
    expect(notes()).toEqual([
      {
        id,
        courseId: ENC,
        keyQuestionId: "q2",
        lessonId: null,
        text: "Keys stay secret",
        createdAt: at,
        updatedAt: at,
      },
    ])
    vi.setSystemTime(at + 5000)
    await editNote({ id, text: "Keys stay secret; designs are public" })
    expect(notes()[0]).toMatchObject({
      text: "Keys stay secret; designs are public",
      createdAt: at,
      updatedAt: at + 5000,
    })
    await deleteNote({ id })
    expect(notes()).toEqual([])
    expect(refresh).toHaveBeenCalledTimes(3)
  })

  it("restores a deleted note as it was (Undo)", async () => {
    const id = randomUUID()
    db.insert(answerNote)
      .values({
        id,
        courseId: ENC,
        keyQuestionId: "q1",
        lessonId: "key-exchange",
        text: "Mix paint",
        createdAt: at - 1000,
        updatedAt: at - 1000,
      })
      .run()
    const before = notes()[0]
    await deleteNote({ id })
    expect(notes()).toEqual([])
    vi.setSystemTime(at + 5000)
    await restoreNote({ id })
    // The server's copy: same lesson and creation time.
    expect(notes()).toEqual([{ ...before, updatedAt: at + 5000 }])
    expect(refresh).toHaveBeenCalledTimes(2)
    // Each deletion is undone once.
    await expect(restoreNote({ id })).rejects.toMatchObject({
      code: "not_restorable",
    })
    expect(notes()).toHaveLength(1)
  })

  it("restores only notes deleted in the last minute", async () => {
    const { id } = await addNote({
      courseId: ENC,
      keyQuestionId: "q1",
      text: "Mix paint",
    })
    await deleteNote({ id })
    vi.setSystemTime(at + 60_001)
    await expect(restoreNote({ id })).rejects.toMatchObject({
      code: "not_restorable",
    })
    // A note that was never deleted here cannot be conjured.
    await expect(restoreNote({ id: randomUUID() })).rejects.toMatchObject({
      code: "not_restorable",
    })
    await expect(
      restoreNote({ id, courseId: ENC, text: "x" })
    ).rejects.toThrow()
    expect(notes()).toEqual([])
  })

  it("is not a progress event", async () => {
    await addNote({ courseId: ENC, keyQuestionId: "q1", text: "A note" })
    expect(shownUpDays()).toEqual([])
  })

  it("refuses bad input", async () => {
    await expect(
      addNote({ courseId: ENC, keyQuestionId: "q1", text: "   " })
    ).rejects.toThrow()
    await expect(
      addNote({ courseId: ENC, keyQuestionId: "q9", text: "A note" })
    ).rejects.toThrow()
    // q5 is a valid id, but this course has only q1–q4.
    await expect(
      addNote({ courseId: ENC, keyQuestionId: "q5", text: "A note" })
    ).rejects.toMatchObject({ code: "unknown_key_question" })
    await expect(
      addNote({ courseId: "no-such-course", keyQuestionId: "q1", text: "x" })
    ).rejects.toMatchObject({ code: "unknown_course" })
    expect(notes()).toEqual([])
  })

  it("treats editing or deleting a missing note as done (another tab)", async () => {
    const id = "00000000-0000-4000-8000-000000000000"
    await expect(editNote({ id, text: "x" })).resolves.toBeUndefined()
    expect(notes()).toEqual([])
    await expect(deleteNote({ id })).resolves.toBeUndefined()
    expect(refresh).toHaveBeenCalledTimes(2)
    await expect(deleteNote({ id: "not-a-uuid" })).rejects.toThrow()
  })
})

describe("startSession", () => {
  it("starts a course given by id at its first lesson and opens the player", async () => {
    const url = await redirectOf(
      startSession({ kind: "standard", courseId: ENC })
    )
    const [s] = sessions()
    expect(url).toBe(`/session/${s.id}`)
    expect(s).toMatchObject({
      kind: "standard",
      minutes: 15,
      courseId: ENC,
      reviewQueue: [],
      checkpointQueue: null,
      position: { unit: "lesson", lessonId: "symmetric-ciphers" },
      lastEventId: null,
      activeMs: 0,
      startedAt: at,
      endedAt: null,
    })
    // Lesson rows wait for the first unit to load (§6).
    expect(db.select().from(lessonProgress).all()).toEqual([])
    // Starting is not a progress event.
    expect(shownUpDays()).toEqual([])
  })

  it("uses the remembered length", async () => {
    await setSessionMinutes(30)
    await redirectOf(startSession({ kind: "standard", courseId: ENC }))
    expect(sessions()[0].minutes).toBe(30)
  })

  it("closes the open session", async () => {
    await redirectOf(startSession({ kind: "standard", courseId: ENC }))
    vi.setSystemTime(at + 60_000)
    await redirectOf(startSession({ kind: "standard", courseId: LEAP }))
    const [first, second] = sessions().sort((a, b) => a.startedAt - b.startedAt)
    expect(first.endedAt).toBe(at + 60_000)
    expect(second).toMatchObject({ courseId: LEAP, endedAt: null })
  })

  it("continues the most recently used course without a course id", async () => {
    putLesson(db, LEAP, "leap-rule", {
      at: at - 10,
      position: { step: "read" },
    })
    putLesson(db, ENC, "symmetric-ciphers", {
      at: at - 20,
      position: { step: "read" },
    })
    await redirectOf(startSession({ kind: "standard" }))
    expect(sessions()[0]).toMatchObject({
      courseId: LEAP,
      position: { unit: "lesson", lessonId: "leap-rule" },
    })
  })

  it("ends at once when there is nothing to do", async () => {
    // No course in progress and no reviews: no target.
    await redirectOf(startSession({ kind: "standard" }))
    expect(sessions()[0]).toMatchObject({
      courseId: null,
      position: { unit: "end", screen: "summary" },
      endedAt: at,
    })
  })

  it("queues due reviews with their versions, most overdue first", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 1e8, day: "2026-11-20" })
    putSchedule(db, ENC, "c-shared-key", {
      dueDay: "2026-11-23",
      lastEventDay: "2026-11-21",
      versionCursor: 1,
    })
    putSchedule(db, ENC, "c-kerckhoffs", {
      dueDay: "2026-11-22",
      lastEventDay: "2026-11-20",
    })
    // Not due yet.
    putSchedule(db, ENC, "c-key-length", {
      dueDay: "2026-11-25",
      lastEventDay: "2026-11-23",
    })
    // A concept no longer in content is ignored.
    putSchedule(db, ENC, "c-gone", {
      dueDay: "2026-11-01",
      lastEventDay: "2026-10-30",
    })
    await redirectOf(startSession({ kind: "standard" }))
    const [s] = sessions()
    expect(s.courseId).toBe(ENC)
    expect(s.position).toEqual({ unit: "reviews", index: 0 })
    const queue = s.reviewQueue as ReviewQueueItem[]
    expect(queue.map((q) => q.conceptId)).toEqual([
      "c-kerckhoffs",
      "c-shared-key",
    ])
    expect(queue[0].version).toEqual({ kind: "prompt", index: 0 })
    // Cursor 1 of c-shared-key's versions.
    expect(queue[1].version).not.toEqual({ kind: "prompt", index: 0 })
  })

  it("counts reviews answered today against the daily cap", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 1e8, day: "2026-11-20" })
    putSchedule(db, ENC, "c-shared-key", {
      dueDay: "2026-11-23",
      lastEventDay: "2026-11-21",
    })
    for (let i = 0; i < 30; i++)
      db.insert(attempt)
        .values({
          id: `a${i}`,
          sessionId: "s-old",
          context: "review",
          courseId: ENC,
          conceptId: "c-other",
          grade: "remembered",
          day: DAY,
          answeredAt: at - 1000,
        })
        .run()
    await redirectOf(startSession({ kind: "reviews_only" }))
    expect(sessions()[0].reviewQueue).toEqual([])
  })

  it("queues an open checkpoint minus the exercises already answered", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 2e8, day: "2026-11-20" })
    putLesson(db, ENC, "hash-functions", { at: at - 1e8, day: "2026-11-21" })
    db.insert(attempt)
      .values({
        id: "a1",
        sessionId: "s-old",
        context: "checkpoint",
        courseId: ENC,
        exerciseId: "x-secrets-bits",
        correct: true,
        confidence: "sure",
        grade: "remembered",
        day: "2026-11-21",
        answeredAt: at - 1e7,
      })
      .run()
    await redirectOf(startSession({ kind: "standard", courseId: ENC }))
    expect(sessions()[0]).toMatchObject({
      position: { unit: "checkpoint", moduleId: "shared-secrets", index: 0 },
      checkpointQueue: [
        "x-secrets-key",
        "x-secrets-vendor",
        "x-secrets-download",
        "x-secrets-spot",
        "x-secrets-short",
      ],
    })
  })

  it("takes the next lesson, not the checkpoint, for a full lesson", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 2e8, day: "2026-11-20" })
    putLesson(db, ENC, "hash-functions", { at: at - 1e8, day: "2026-11-21" })
    await redirectOf(startSession({ kind: "full_lesson", courseId: ENC }))
    expect(sessions()[0]).toMatchObject({
      kind: "full_lesson",
      position: { unit: "lesson", lessonId: "key-exchange" },
      checkpointQueue: null,
    })
  })

  it("leaves drafts out unless started by id", async () => {
    vi.stubEnv("PLATO_TEST_HOOKS", "1")
    vi.stubEnv("PLATO_CONTENT_DIR", draftContent())
    putLesson(db, ENC, "symmetric-ciphers", { at, position: { step: "read" } })
    putLesson(db, LEAP, "leap-rule", {
      at: at - 1000,
      position: { step: "read" },
    })
    await redirectOf(startSession({ kind: "standard" }))
    // ENC is a draft here, so the published LEAP continues.
    expect(sessions()[0].courseId).toBe(LEAP)
    vi.setSystemTime(at + 1000)
    await redirectOf(startSession({ kind: "standard", courseId: ENC }))
    expect(sessions().find((x) => x.endedAt === null)?.courseId).toBe(ENC)
  })

  it("refuses bad input and unknown courses without closing the open session", async () => {
    await redirectOf(startSession({ kind: "standard", courseId: ENC }))
    await expect(startSession({ kind: "marathon" })).rejects.toThrow()
    await expect(
      startSession({ kind: "standard", courseId: "no-such-course" })
    ).rejects.toMatchObject({ code: "unknown_course" })
    expect(sessions()).toHaveLength(1)
    expect(sessions()[0].endedAt).toBeNull()
  })
})

describe("requireLearner refusals", () => {
  const ref = { courseId: ENC, lessonId: "hash-functions" }

  it.each<[string, () => Promise<unknown>]>([
    ["createRequest", () => createRequest("How do vaccines work?")],
    ["setSessionMinutes", () => setSessionMinutes(20)],
    ["setHideTimer", () => setHideTimer(true)],
    ["skipLesson", () => skipLesson(ref)],
    ["unskipLesson", () => unskipLesson(ref)],
    [
      "addNote",
      () => addNote({ courseId: ENC, keyQuestionId: "q1", text: "x" }),
    ],
    [
      "editNote",
      () => editNote({ id: "00000000-0000-4000-8000-000000000000", text: "x" }),
    ],
    [
      "deleteNote",
      () => deleteNote({ id: "00000000-0000-4000-8000-000000000000" }),
    ],
    [
      "restoreNote",
      () => restoreNote({ id: "00000000-0000-4000-8000-000000000000" }),
    ],
    ["startSession", () => startSession({ kind: "standard", courseId: ENC })],
  ])("%s redirects to /unlock and writes nothing", async (_, run) => {
    lockGate()
    expect(await redirectOf(run())).toBe("/unlock")
    expect(db.select().from(courseRequest).all()).toEqual([])
    expect(db.select().from(lessonProgress).all()).toEqual([])
    expect(db.select().from(answerNote).all()).toEqual([])
    expect(sessions()).toEqual([])
    expect(
      db.select().from(settings).where(eq(settings.id, 1)).get()
    ).toMatchObject({
      sessionMinutes: 15,
      hideTimer: false,
    })
    expect(refresh).not.toHaveBeenCalled()
  })
})

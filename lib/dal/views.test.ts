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

import {
  getAnswersView,
  getCourseHeader,
  getSourcesView,
  getSyllabusView,
} from "./course"
import { getLibraryView } from "./library"
import { sessionExists } from "./sessions"
import { getSettings } from "./settings"
import { getTodayView } from "./today"

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))

let db: Db
let close: () => void
let at: number
const DAY = "2026-11-24"

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

/** Both fixture lessons of module 1 completed, so Checkpoint 1 is open. */
function finishModule1() {
  putLesson(db, ENC, "symmetric-ciphers", { at: at - 2e8, day: "2026-11-20" })
  putLesson(db, ENC, "hash-functions", { at: at - 1e8, day: "2026-11-21" })
}

describe("getTodayView", () => {
  it("offers the newest Ready course on first use", async () => {
    const view = await getTodayView()
    expect(view.shownUpDays).toBe(0)
    expect(view.minutes).toBe(15)
    expect(view.card.kind).toBe("ready")
    expect(view.card.actions).toEqual(["start-lesson-1"])
    expect(view.inProgress).toEqual([])
    expect(view.ready.map((r) => r.courseId).sort()).toEqual([ENC, LEAP])
    expect(view.ready.find((r) => r.courseId === ENC)?.meta).toMatch(
      /^4 lessons · ~/
    )
  })

  it("continues the course in progress with its session line", async () => {
    putLesson(db, ENC, "symmetric-ciphers", {
      at: at - 1000,
      position: { step: "recall", phase: "write" },
    })
    db.insert(shownUpDay)
      .values([{ day: "2026-11-20" }, { day: DAY }])
      .run()
    const view = await getTodayView()
    expect(view.shownUpDays).toBe(2)
    expect(view.card).toMatchObject({
      kind: "next",
      text: "Next: Lesson 1 from Recall.",
    })
    expect(view.inProgress).toEqual([
      {
        courseId: ENC,
        title: "How encryption keeps secrets",
        meta: "0 of 4 completed",
        progress: { completed: 0, total: 4 },
      },
    ])
    expect(view.ready.map((r) => r.courseId)).toEqual([LEAP])
  })

  it("counts due reviews into the session line", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 1e8, day: "2026-11-20" })
    putSchedule(db, ENC, "c-shared-key", {
      dueDay: "2026-11-22",
      lastEventDay: "2026-11-20",
    })
    putSchedule(db, ENC, "c-kerckhoffs", {
      dueDay: DAY,
      lastEventDay: "2026-11-20",
    })
    const view = await getTodayView()
    expect(view.card).toMatchObject({
      kind: "session",
      line: "2 reviews, then Lesson 2",
    })
    expect(view.card.actions).toEqual([
      "start-session",
      "reviews-only",
      "full-lesson",
    ])
    expect(view.inProgress[0].meta).toBe("1 of 4 completed")
  })

  it("names an open checkpoint", async () => {
    finishModule1()
    const view = await getTodayView()
    expect(view.card).toMatchObject({ kind: "next", target: "Checkpoint 1" })
    expect(view.inProgress[0].meta).toBe("2 of 4 completed · Checkpoint 1 open")
  })

  it("says reviews are done after a review today", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 1e8, day: "2026-11-20" })
    db.insert(attempt)
      .values({
        id: "a1",
        sessionId: "s1",
        context: "review",
        courseId: ENC,
        conceptId: "c-shared-key",
        grade: "remembered",
        day: DAY,
        answeredAt: at - 1000,
      })
      .run()
    const view = await getTodayView()
    expect(view.card.text).toBe("Reviews done for today. Next: Lesson 2.")
  })

  it("lists requests newest first", async () => {
    db.insert(courseRequest)
      .values([
        { id: "r1", text: "Older request text", createdAt: at - 2000 },
        { id: "r2", text: "Newer request text", createdAt: at - 1000 },
      ])
      .run()
    const view = await getTodayView()
    expect(view.requested).toEqual([
      { id: "r2", text: "Newer request text" },
      { id: "r1", text: "Older request text" },
    ])
  })

  it("uses the remembered length", async () => {
    db.update(settings).set({ sessionMinutes: 10 }).run()
    expect((await getTodayView()).minutes).toBe(10)
  })
})

describe("drafts (test hooks on)", () => {
  it("leaves drafts off Today and the Library but opens their course page", async () => {
    vi.stubEnv("PLATO_TEST_HOOKS", "1")
    vi.stubEnv("PLATO_CONTENT_DIR", draftContent())
    putLesson(db, ENC, "symmetric-ciphers", { at, position: { step: "read" } })
    const today = await getTodayView()
    expect(today.card).toMatchObject({ kind: "ready", courseId: LEAP })
    expect(today.inProgress).toEqual([])
    const library = await getLibraryView()
    expect(library.inProgress).toEqual([])
    expect(library.ready.map((c) => c.courseId)).toEqual([LEAP])
    expect((await getCourseHeader(ENC)).status).toBe("in_progress")
  })

  it("shows the first-run card when only drafts exist", async () => {
    vi.stubEnv("PLATO_TEST_HOOKS", "1")
    const root = draftContent()
    vi.stubEnv("PLATO_CONTENT_DIR", root)
    const { writeFileSync } = await import("node:fs")
    writeFileSync(`${root}/published.json`, JSON.stringify({ courses: [] }))
    expect((await getTodayView()).card.kind).toBe("first-run")
  })
})

describe("getLibraryView", () => {
  it("sorts courses into sections", async () => {
    putLesson(db, LEAP, "leap-rule", { at: at - 1e8, day: "2026-11-21" })
    db.insert(attempt)
      .values(
        ["x-leap-2100", "x-leap-drift", "x-leap-julian", "x-leap-why"].map(
          (exerciseId, i) => ({
            id: `a${i}`,
            sessionId: "s1",
            context: "checkpoint" as const,
            courseId: LEAP,
            exerciseId,
            correct: true,
            confidence: "sure" as const,
            grade: "remembered" as const,
            day: DAY,
            answeredAt: at - 1000,
          })
        )
      )
      .run()
    db.insert(courseRequest)
      .values({ id: "r1", text: "How do tides work?", createdAt: at })
      .run()
    const view = await getLibraryView()
    expect(view.inProgress).toEqual([])
    expect(view.ready.map((c) => c.courseId)).toEqual([ENC])
    expect(view.ready[0].coverLabel).toBe("Encryption")
    expect(view.complete).toEqual([
      expect.objectContaining({ courseId: LEAP, meta: "1 of 1 completed ✓" }),
    ])
    expect(view.requested).toEqual([{ id: "r1", text: "How do tides work?" }])
  })

  it("ignores checkpoint retries when deciding Done", async () => {
    putLesson(db, LEAP, "leap-rule", { at: at - 1e8, day: "2026-11-21" })
    db.insert(attempt)
      .values(
        ["x-leap-2100", "x-leap-drift", "x-leap-julian", "x-leap-why"].map(
          (exerciseId, i) => ({
            id: `a${i}`,
            sessionId: "s1",
            context: "checkpoint" as const,
            courseId: LEAP,
            exerciseId,
            isRetry: i === 3,
            day: DAY,
            answeredAt: at - 1000,
          })
        )
      )
      .run()
    const view = await getLibraryView()
    expect(view.complete).toEqual([])
    // The Library card leaves out Today's "· Checkpoint 1 open" (WF-H1).
    expect(view.inProgress[0]).toMatchObject({
      courseId: LEAP,
      meta: "1 of 1 completed",
    })
  })

  it("orders In progress by last used, counting session starts", async () => {
    putLesson(db, ENC, "symmetric-ciphers", {
      at: at - 5000,
      position: { step: "read" },
    })
    putLesson(db, LEAP, "leap-rule", {
      at: at - 9000,
      position: { step: "read" },
    })
    db.insert(session)
      .values({
        id: "s1",
        kind: "standard",
        minutes: 15,
        courseId: LEAP,
        position: { unit: "end", screen: "summary" },
        startedAt: at - 1000,
        endedAt: at - 500,
      })
      .run()
    const view = await getLibraryView()
    expect(view.inProgress.map((c) => c.courseId)).toEqual([LEAP, ENC])
  })
})

describe("getCourseHeader", () => {
  it("reads only its own course's progress", async () => {
    putLesson(db, LEAP, "leap-rule", { at, position: { step: "read" } })
    db.insert(session)
      .values({
        id: "s1",
        kind: "standard",
        minutes: 15,
        courseId: LEAP,
        position: { unit: "end", screen: "summary" },
        startedAt: at,
        endedAt: at,
      })
      .run()
    expect((await getCourseHeader(ENC)).status).toBe("ready")
    expect((await getCourseHeader(LEAP)).status).toBe("in_progress")
  })

  it("describes a Ready course", async () => {
    const header = await getCourseHeader(ENC)
    expect(header).toMatchObject({
      courseId: ENC,
      title: "How encryption keeps secrets",
      coverLabel: "Encryption",
      status: "ready",
      badge: null,
      mainButton: { label: "Start Lesson 1" },
    })
    expect(header.meta).toMatch(/^4 lessons · ~.+ · as of Nov 2026$/)
  })

  it("names the main button from the next target", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at, position: { step: "read" } })
    expect(await getCourseHeader(ENC)).toMatchObject({
      badge: "in progress",
      mainButton: { label: "Continue Lesson 1" },
    })
    db.delete(lessonProgress).run()
    finishModule1()
    expect((await getCourseHeader(ENC)).mainButton).toEqual({
      label: "Open Checkpoint 1",
    })
  })

  it("has no main button once Complete", async () => {
    putLesson(db, LEAP, "leap-rule", { at, day: DAY })
    db.insert(attempt)
      .values(
        ["x-leap-2100", "x-leap-drift", "x-leap-julian", "x-leap-why"].map(
          (exerciseId, i) => ({
            id: `a${i}`,
            sessionId: "s1",
            context: "checkpoint" as const,
            courseId: LEAP,
            exerciseId,
            day: DAY,
            answeredAt: at,
          })
        )
      )
      .run()
    expect(await getCourseHeader(LEAP)).toMatchObject({
      status: "complete",
      badge: "complete",
      mainButton: null,
    })
  })

  it("is a 404 for an unknown course", async () => {
    expect(await digestOf(getCourseHeader("no-such-course"))).toMatch(/404/)
    expect(await digestOf(getSyllabusView("no-such-course"))).toMatch(/404/)
    expect(await digestOf(getAnswersView("no-such-course"))).toMatch(/404/)
    expect(await digestOf(getSourcesView("no-such-course"))).toMatch(/404/)
  })
})

describe("getSyllabusView", () => {
  it("shows statuses, steps, menus and checkpoint labels", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 1e8, day: "2026-11-20" })
    putLesson(db, ENC, "hash-functions", {
      at,
      position: { step: "recall", phase: "tick" },
    })
    putLesson(db, ENC, "key-exchange", {
      at,
      position: { step: "guess", index: 0 },
      skipped: true,
    })
    const view = await getSyllabusView(ENC)
    expect(view.completed).toBe("1 of 4 completed")
    expect(view.outOfScope.type).toBe("root")
    const [m1, m2] = view.modules
    expect(m1.lessons.map((l) => [l.number, l.statusLabel, l.menu])).toEqual([
      [1, "Completed", null],
      [2, "In progress · at Recall", "skip"],
    ])
    expect(m1.checkpoint).toEqual({
      number: 1,
      status: "locked",
      label: "Locked · complete Lesson 2",
    })
    expect(m2.lessons.map((l) => [l.number, l.statusLabel, l.menu])).toEqual([
      [3, "Skipped", "unskip"],
      [4, "Not started", "skip"],
    ])
    expect(m2.checkpoint.label).toBe("Locked")
    expect(m1.lessons[1].mastery).toBeNull()
  })

  it("lists a completed lesson's concepts with their mastery", async () => {
    putLesson(db, ENC, "symmetric-ciphers", { at: at - 1e8, day: "2026-11-01" })
    putSchedule(db, ENC, "c-shared-key", {
      dueDay: "2026-12-20",
      lastEventDay: "2026-11-20",
      intervalDays: 30,
      laterDayReviews: 3,
      lastGrade: "remembered",
    })
    putSchedule(db, ENC, "c-kerckhoffs", {
      dueDay: "2026-11-23",
      lastEventDay: "2026-11-21",
      intervalDays: 2,
      laterDayReviews: 1,
      lastGrade: "partly",
    })
    putSchedule(db, ENC, "c-key-length", {
      dueDay: "2026-11-25",
      lastEventDay: "2026-11-01",
    })
    const view = await getSyllabusView(ENC)
    expect(view.modules[0].lessons[0].mastery).toEqual([
      expect.objectContaining({
        conceptId: "c-shared-key",
        mastery: "strong",
        label: "Strong",
        dots: 4,
      }),
      expect.objectContaining({
        conceptId: "c-kerckhoffs",
        mastery: "shaky",
        dots: 1,
      }),
      expect.objectContaining({
        conceptId: "c-key-length",
        mastery: "not_yet_reviewed",
        dots: 0,
      }),
    ])
  })
})

describe("getAnswersView", () => {
  it("lists each key question with its lessons and notes", async () => {
    db.insert(answerNote)
      .values([
        {
          id: "n2",
          courseId: ENC,
          keyQuestionId: "q2",
          lessonId: null,
          text: "Second",
          createdAt: at,
          updatedAt: at,
        },
        {
          id: "n1",
          courseId: ENC,
          keyQuestionId: "q2",
          lessonId: "hash-functions",
          text: "First",
          createdAt: at - 1000,
          updatedAt: at - 1000,
        },
        {
          id: "n3",
          courseId: LEAP,
          keyQuestionId: "q2",
          lessonId: null,
          text: "Other course",
          createdAt: at,
          updatedAt: at,
        },
      ])
      .run()
    const view = await getAnswersView(ENC)
    expect(view.keyQuestions.map((q) => [q.id, q.lessons])).toEqual([
      ["q1", "Lessons 1, 3"],
      ["q2", "Lessons 1, 2, 3"],
      ["q3", "Lessons 2, 4"],
      ["q4", "Lesson 4"],
    ])
    const q2 = view.keyQuestions[1]
    expect(q2.notes.map((n) => [n.id, n.text, n.lessonLabel])).toEqual([
      ["n1", "First", "Lesson 2"],
      ["n2", "Second", null],
    ])
    expect(view.keyQuestions[0].notes).toEqual([])
  })
})

describe("getSourcesView", () => {
  it("groups sources in first-appearance order with their numbers", async () => {
    const view = await getSourcesView(ENC)
    expect(view.groups.map((g) => g.group)).toEqual([
      "Original papers",
      "Standards",
      "Research",
      "Guides",
    ])
    const all = view.groups.flatMap((g) => g.sources)
    expect(all.map((s) => s.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(all[0]).toMatchObject({ id: "src-shannon", anchor: "s1" })
  })
})

describe("getSettings", () => {
  it("reads the seeded defaults", async () => {
    expect(await getSettings()).toEqual({
      sessionMinutes: 15,
      hideTimer: false,
    })
  })
})

describe("sessionExists", () => {
  it("finds a started session and nothing else", async () => {
    db.insert(session)
      .values({
        id: "s1",
        kind: "standard",
        minutes: 15,
        courseId: null,
        reviewQueue: [],
        checkpointQueue: [],
        position: { unit: "end", screen: "summary" },
        activeMs: 0,
        startedAt: 0,
      } as typeof session.$inferInsert)
      .run()
    expect(await sessionExists("s1")).toBe(true)
    expect(await sessionExists("s2")).toBe(false)
  })
})

describe("requireLearner refusals", () => {
  it.each<[string, () => Promise<unknown>]>([
    ["getTodayView", getTodayView],
    ["getLibraryView", getLibraryView],
    ["getSettings", getSettings],
    ["getCourseHeader", () => getCourseHeader(ENC)],
    ["getSyllabusView", () => getSyllabusView(ENC)],
    ["getAnswersView", () => getAnswersView(ENC)],
    ["getSourcesView", () => getSourcesView(ENC)],
    ["sessionExists", () => sessionExists("s1")],
  ])("%s redirects to /unlock", async (_, read) => {
    lockGate()
    expect(await digestOf(read())).toMatch(/^NEXT_REDIRECT;[a-z]+;\/unlock;/)
  })
})

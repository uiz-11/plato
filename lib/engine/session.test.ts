import { describe, expect, it } from "vitest"

import { DAILY_CAP, EST } from "./constants"
import { initialSchedule, type ScheduleRow } from "./schedule"
import {
  assembleSession,
  budgetAllows,
  chooseSessionCourse,
  initialSessionPosition,
  lessonUnitEstimate,
  nextSessionPosition,
  playerUnitKind,
  reviewCount,
  reviewQueueItem,
  startsBudgetUnit,
  unitKey,
  wouldHoldWork,
  type CourseCandidate,
  type LessonEstimateShape,
  type NextUnitInput,
} from "./session"
import type { CourseProgress } from "./status"
import { done, M1, progress, row } from "./test-course"
import type {
  LessonPosition,
  SessionKind,
  SessionMinutes,
  SessionPosition,
} from "./types"

const TODAY = "2026-06-10"

const candidate = (
  id: string,
  p: CourseProgress,
  lastUsedAt: number | null,
  hadSession = false
): CourseCandidate => ({
  ...p,
  course: { ...p.course, id },
  lastUsedAt,
  hadSession,
})

const dueRows = (n: number, courseId = "c"): ScheduleRow[] =>
  Array.from({ length: n }, (_, i) => ({
    courseId,
    conceptId: `k${String(i).padStart(3, "0")}`,
    ...initialSchedule(true, "2026-06-01"),
  }))

describe("session sizing", () => {
  it.each<[SessionKind, SessionMinutes, boolean, number]>([
    ["standard", 10, true, 10],
    ["standard", 15, true, 15],
    ["standard", 20, true, 20],
    ["standard", 30, true, 30],
    ["standard", 10, false, 20],
    ["standard", 15, false, 30],
    ["standard", 20, false, 40],
    ["standard", 30, false, 60],
    ["reviews_only", 10, false, 6],
    ["reviews_only", 30, true, 6],
    ["full_lesson", 30, true, 0],
  ])("%s, %i min, target %s → up to %i", (kind, minutes, hasTarget, n) => {
    expect(
      reviewCount({ kind, minutes, hasTarget, due: 100, capLeft: 100 })
    ).toBe(n)
  })

  it("never exceeds what is due or the cap", () => {
    const base = { kind: "standard" as const, minutes: 15 as const }
    expect(reviewCount({ ...base, hasTarget: true, due: 4, capLeft: 30 })).toBe(
      4
    )
    expect(reviewCount({ ...base, hasTarget: true, due: 40, capLeft: 3 })).toBe(
      3
    )
    expect(
      reviewCount({
        kind: "reviews_only",
        minutes: 15,
        hasTarget: false,
        due: 9,
        capLeft: 2,
      })
    ).toBe(2)
  })
})

describe("course choice", () => {
  const ready = candidate("ready", progress(), null)
  const older = candidate("older", progress([row("l1")]), 10)
  const newer = candidate("newer", progress([row("l1")]), 20)
  const readyUsed = candidate("ready-used", progress(), 30, true)
  const complete = candidate(
    "complete",
    progress(
      ["l1", "l2", "l3", "l4"].map((id) => done(id)),
      [...M1, "y1", "y2", "y3", "y4", "y5", "y6"]
    ),
    40,
    true
  )

  it("takes the given course whatever its status", () => {
    expect(chooseSessionCourse([ready, newer], "ready")?.course.id).toBe(
      "ready"
    )
    expect(chooseSessionCourse([complete, newer], "complete")?.course.id).toBe(
      "complete"
    )
  })

  it("otherwise takes the most recently used In progress course", () => {
    expect(chooseSessionCourse([older, newer, ready])?.course.id).toBe("newer")
  })

  it("a Ready course counts once it was an earlier session's course", () => {
    expect(chooseSessionCourse([older, newer, readyUsed])?.course.id).toBe(
      "ready-used"
    )
  })

  it("never picks a Complete or unused Ready course", () => {
    expect(chooseSessionCourse([ready, complete])).toBeNull()
  })

  it("rejects an unknown course id", () => {
    expect(() => chooseSessionCourse([ready], "nope")).toThrow()
  })
})

describe("assembly", () => {
  const base = {
    kind: "standard" as SessionKind,
    minutes: 15 as SessionMinutes,
    today: TODAY,
    schedules: dueRows(40),
    reviewsAnsweredToday: 0,
    courses: [candidate("c", progress([done("l1"), row("l2")]), 5)],
  }

  it("holds half a session of reviews, then the target", () => {
    const a = assembleSession(base)
    expect(a.courseId).toBe("c")
    expect(a.target).toEqual({ kind: "lesson", lessonId: "l2" })
    expect(a.reviews).toHaveLength(15)
    expect(a.due).toBe(40)
    expect(a.reviews[0].conceptId).toBe("k000")
  })

  it("respects reviews already answered today", () => {
    const a = assembleSession({ ...base, reviewsAnsweredToday: DAILY_CAP - 4 })
    expect(a.reviews).toHaveLength(4)
    expect(a.capLeft).toBe(4)
  })

  it("fills the session with reviews when there is no target", () => {
    const a = assembleSession({ ...base, courses: [] })
    expect(a).toMatchObject({ courseId: null, target: null })
    expect(a.reviews).toHaveLength(30)
  })

  it("full_lesson ignores checkpoints and holds no reviews (R9)", () => {
    const a = assembleSession({
      ...base,
      kind: "full_lesson",
      courses: [candidate("c", progress([done("l1"), done("l2")]), 5)],
    })
    expect(a.target).toEqual({ kind: "lesson", lessonId: "l3" })
    expect(a.reviews).toHaveLength(0)
  })

  it("reviews_only has no target", () => {
    const a = assembleSession({ ...base, kind: "reviews_only" })
    expect(a.target).toBeNull()
    expect(a.reviews).toHaveLength(6)
  })

  it("the given course becomes the session's course", () => {
    const a = assembleSession({
      ...base,
      courseId: "fresh",
      courses: [...base.courses, candidate("fresh", progress(), null)],
    })
    expect(a.courseId).toBe("fresh")
    expect(a.target).toEqual({ kind: "lesson", lessonId: "l1" })
  })

  it("picks each review's version at its cursor", () => {
    const r = { ...dueRows(1)[0], versionCursor: 3 }
    const versions = [
      { kind: "prompt" as const, index: 0 },
      { kind: "exercise" as const, exerciseId: "e1" },
    ]
    expect(reviewQueueItem(r, versions)).toEqual({
      courseId: "c",
      conceptId: "k000",
      version: versions[1],
    })
  })

  it("starts with reviews, else the target, else the summary", () => {
    const t = { kind: "lesson" as const, lessonId: "l1" }
    expect(initialSessionPosition({ reviews: [1], target: t })).toEqual({
      unit: "reviews",
      index: 0,
    })
    expect(initialSessionPosition({ reviews: [], target: t })).toEqual({
      unit: "lesson",
      lessonId: "l1",
    })
    expect(
      initialSessionPosition({
        reviews: [],
        target: { kind: "checkpoint", moduleId: "m1" },
      })
    ).toEqual({ unit: "checkpoint", moduleId: "m1", index: 0 })
    expect(initialSessionPosition({ reviews: [], target: null })).toEqual({
      unit: "end",
      screen: "summary",
    })
  })

  it("Keep going shows only with reviews or a target", () => {
    expect(wouldHoldWork({ reviews: [], target: null })).toBe(false)
    expect(wouldHoldWork({ reviews: dueRows(1), target: null })).toBe(true)
  })
})

describe("the budget rule", () => {
  // 15 minutes = 900 s. A 600 s unit needs 300 s left.
  const at = (remainingSeconds: number) => (900 - remainingSeconds) * 1000
  it.each([
    [301, true],
    [300, true],
    [299.999, false],
  ])("%d s left for a 600 s unit → %s", (left, fits) => {
    expect(
      budgetAllows({
        kind: "standard",
        minutes: 15,
        activeMs: at(left),
        estimateSeconds: 600,
      })
    ).toBe(fits)
  })

  it("full_lesson ignores it", () => {
    expect(
      budgetAllows({
        kind: "full_lesson",
        minutes: 15,
        activeMs: 10_000_000,
        estimateSeconds: 600,
      })
    ).toBe(true)
  })

  it("a checkpoint exercise needs 22.5 s", () => {
    const fits = (left: number) =>
      budgetAllows({
        kind: "standard",
        minutes: 10,
        activeMs: (600 - left) * 1000,
        estimateSeconds: EST.checkpointExercise,
      })
    expect(fits(22.5)).toBe(true)
    expect(fits(22.4)).toBe(false)
  })
})

describe("budget unit estimates", () => {
  const s: LessonEstimateShape = {
    warmupCount: 3,
    guessCount: 2,
    readMinutes: 7,
    recallQueueLength: null,
    keyQuestionCount: 2,
  }
  it.each<[LessonPosition, number]>([
    [{ step: "warmup", index: 0 }, 120],
    [{ step: "warmup", index: 2 }, 40],
    [{ step: "guess", index: 0 }, 60],
    [{ step: "read" }, 420],
    [{ step: "recall", phase: "write" }, 90 + 30 + 3 * 45 + 2 * 45],
    [{ step: "recall", phase: "tick" }, 30 + 3 * 45 + 2 * 45],
    [{ step: "answers", index: 1 }, 45],
    [{ step: "done" }, 0],
  ])("%j → %i s", (p, seconds) => {
    expect(lessonUnitEstimate(p, s)).toBe(seconds)
  })

  it("uses the fixed Recall queue once it exists", () => {
    expect(
      lessonUnitEstimate(
        { step: "recall", phase: "exercises", index: 1 },
        { ...s, recallQueueLength: 2 }
      )
    ).toBe(45 + 2 * 45)
  })

  it.each<[LessonPosition, LessonPosition, boolean]>([
    [{ step: "warmup", index: 2 }, { step: "guess", index: 0 }, true],
    [{ step: "guess", index: 0 }, { step: "guess", index: 1 }, false],
    [{ step: "read" }, { step: "recall", phase: "write" }, true],
    [
      { step: "recall", phase: "tick" },
      { step: "recall", phase: "exercises", index: 0 },
      false,
    ],
    [
      { step: "recall", phase: "exercises", index: 1 },
      { step: "answers", index: 0 },
      false,
    ],
    [{ step: "answers", index: 0 }, { step: "done" }, false],
  ])("%j → %j starts a budget unit: %s", (from, to, starts) => {
    expect(startsBudgetUnit(from, to)).toBe(starts)
  })
})

describe("choosing the next unit", () => {
  const next = {
    target: { kind: "lesson" as const, lessonId: "l2" },
    estimateSeconds: 120,
  }
  const base: NextUnitInput = {
    kind: "standard",
    minutes: 15,
    activeMs: 0,
    finished: "reviews",
    next,
    madeCourseComplete: false,
  }
  const summary: SessionPosition = { unit: "end", screen: "summary" }

  it("moves on to the next target while the budget allows", () => {
    expect(nextSessionPosition(base)).toEqual({
      unit: "lesson",
      lessonId: "l2",
    })
    expect(
      nextSessionPosition({
        ...base,
        finished: "lesson",
        next: {
          target: { kind: "checkpoint", moduleId: "m1" },
          estimateSeconds: 45,
        },
      })
    ).toEqual({ unit: "checkpoint", moduleId: "m1", index: 0 })
  })

  it("ends when the next unit does not fit", () => {
    expect(nextSessionPosition({ ...base, activeMs: 841_000 })).toEqual(summary)
  })

  it("ends with no target left, course complete first if the session made it so", () => {
    expect(nextSessionPosition({ ...base, next: null })).toEqual(summary)
    expect(
      nextSessionPosition({ ...base, next: null, madeCourseComplete: true })
    ).toEqual({ unit: "end", screen: "course-complete" })
  })

  it("budget-end ends when the server agrees the item does not fit", () => {
    const pending = {
      position: { unit: "checkpoint", moduleId: "m1", index: 3 } as const,
      estimateSeconds: 45,
    }
    expect(
      nextSessionPosition({
        ...base,
        finished: "budget-end",
        activeMs: 880_000,
        pending,
      })
    ).toEqual(summary)
  })

  it("budget-end stays put when the server's budget still fits the item", () => {
    const position: SessionPosition = {
      unit: "checkpoint",
      moduleId: "m1",
      index: 3,
    }
    expect(
      nextSessionPosition({
        ...base,
        finished: "budget-end",
        activeMs: 300_000,
        pending: { position, estimateSeconds: 45 },
      })
    ).toEqual(position)
  })

  it("reviews_only ends with its review block, even with a target passed", () => {
    expect(nextSessionPosition({ ...base, kind: "reviews_only" })).toEqual(
      summary
    )
  })

  it("full_lesson ends with its lesson", () => {
    for (const finished of ["lesson", "skip-lesson"] as const) {
      expect(
        nextSessionPosition({ ...base, kind: "full_lesson", finished })
      ).toEqual(summary)
    }
  })

  it("skipping moves on under the budget rule", () => {
    expect(nextSessionPosition({ ...base, finished: "skip-lesson" })).toEqual({
      unit: "lesson",
      lessonId: "l2",
    })
  })
})

describe("player units", () => {
  const lesson: SessionPosition = { unit: "lesson", lessonId: "l1" }
  it.each<[SessionPosition, LessonPosition | null, string]>([
    [{ unit: "reviews", index: 2 }, null, "reviews"],
    [lesson, { step: "warmup", index: 1 }, "warmup"],
    [lesson, { step: "guess", index: 0 }, "guess"],
    [lesson, { step: "read" }, "read"],
    [lesson, { step: "recall", phase: "write" }, "recall-write-tick"],
    [lesson, { step: "recall", phase: "tick" }, "recall-write-tick"],
    [
      lesson,
      { step: "recall", phase: "exercises", index: 0 },
      "recall-exercises-answers",
    ],
    [lesson, { step: "answers", index: 0 }, "recall-exercises-answers"],
    [lesson, { step: "done" }, "recall-exercises-answers"],
    [{ unit: "checkpoint", moduleId: "m1", index: 6 }, null, "checkpoint"],
    [{ unit: "end", screen: "summary" }, null, "end"],
  ])("%j / %j → %s", (s, l, kind) => {
    expect(playerUnitKind(s, l)).toBe(kind)
  })

  it("keys stay the same inside a unit and change between units", () => {
    expect(unitKey(lesson, { step: "recall", phase: "write" })).toBe(
      unitKey(lesson, { step: "recall", phase: "tick" })
    )
    expect(unitKey(lesson, { step: "recall", phase: "tick" })).not.toBe(
      unitKey(lesson, { step: "recall", phase: "exercises", index: 0 })
    )
    expect(unitKey({ unit: "reviews", index: 0 }, null)).toBe(
      unitKey({ unit: "reviews", index: 3, answered: "a" }, null)
    )
  })

  it("a lesson unit needs its position", () => {
    expect(() => playerUnitKind(lesson, null)).toThrow()
  })
})

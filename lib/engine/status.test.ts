import { describe, expect, it } from "vitest"

import {
  checkpointNumber,
  checkpointQueue,
  checkpointScore,
  checkpointStatus,
  completedCount,
  courseStatus,
  lastUsedAt,
  lessonNumber,
  lessonStatus,
  nextTarget,
  requestStatus,
  skippedInSession,
  type CheckpointAttempt,
  type LessonStatus,
  type Target,
} from "./status"
import { done, M1, M2, progress, row, skipped, testCourse } from "./test-course"

describe("lesson status", () => {
  it.each<[string, Parameters<typeof lessonStatus>[0], LessonStatus]>([
    ["no row", undefined, "not_started"],
    ["a row", { completedAt: null, skipped: false }, "in_progress"],
    ["skipped", { completedAt: null, skipped: true }, "skipped"],
    ["completed", { completedAt: 5, skipped: false }, "completed"],
    [
      "completed wins over skipped",
      { completedAt: 5, skipped: true },
      "completed",
    ],
  ])("%s → %s", (_, r, status) => {
    expect(lessonStatus(r)).toBe(status)
  })
})

describe("numbering", () => {
  const course = testCourse()
  it.each([
    ["l1", 1],
    ["l2", 2],
    ["l3", 3],
    ["l4", 4],
  ])("%s is Lesson %i across the course", (id, n) => {
    expect(lessonNumber(course, id)).toBe(n)
  })
  it("numbers checkpoints by module", () => {
    expect(checkpointNumber(course, "m1")).toBe(1)
    expect(checkpointNumber(course, "m2")).toBe(2)
  })
  it("throws on unknown ids", () => {
    expect(() => lessonNumber(course, "nope")).toThrow()
    expect(() => checkpointNumber(course, "nope")).toThrow()
  })
})

describe("checkpoint status", () => {
  it("is Locked until every lesson of its module is Completed", () => {
    expect(checkpointStatus(progress([done("l1")]), "m1")).toBe("locked")
    expect(checkpointStatus(progress([done("l1"), skipped("l2")]), "m1")).toBe(
      "locked"
    )
  })
  it("is Open once they are", () => {
    expect(checkpointStatus(progress([done("l1"), done("l2")]), "m1")).toBe(
      "open"
    )
  })
  it("is Done once every exercise has a non-retry attempt", () => {
    const p = (a: string[]) => progress([done("l1"), done("l2")], a)
    expect(checkpointStatus(p(M1.slice(0, 5)), "m1")).toBe("open")
    expect(checkpointStatus(p(M1), "m1")).toBe("done")
  })
  it("the queue is the authored order minus answered exercises", () => {
    expect(checkpointQueue({ checkpoint: M1 }, new Set(["x2", "x5"]))).toEqual([
      "x1",
      "x3",
      "x4",
      "x6",
    ])
  })
})

describe("checkpoint score", () => {
  const a = (
    exerciseId: string,
    over: Partial<CheckpointAttempt> = {}
  ): CheckpointAttempt => ({
    exerciseId,
    correct: true,
    selfMark: null,
    isRetry: false,
    answeredAt: 1,
    ...over,
  })
  it("counts first attempts that were correct, over the exercise count", () => {
    expect(
      checkpointScore({ checkpoint: M1 }, [
        a("x1"),
        a("x2", { correct: false }),
        a("x2", { correct: true, isRetry: true, answeredAt: 2 }),
        a("x3", { correct: null, selfMark: "full" }),
        a("x4", { correct: null, selfMark: "partial" }),
        a("x5", { correct: false, answeredAt: 1 }),
        a("x5", { correct: true, answeredAt: 3 }),
        a("y1"),
      ])
    ).toEqual({ right: 2, total: 6 })
  })
})

describe("course status", () => {
  it("is Ready with no rows", () => {
    expect(courseStatus(progress())).toBe("ready")
  })
  it("is In progress once any lesson has a row, a skip included", () => {
    expect(courseStatus(progress([skipped("l3", { position: null })]))).toBe(
      "in_progress"
    )
  })
  it("is In progress while a checkpoint is not Done", () => {
    const all = ["l1", "l2", "l3", "l4"].map((id) => done(id))
    expect(courseStatus(progress(all, M1))).toBe("in_progress")
  })
  it("is Complete with every lesson Completed and every checkpoint Done", () => {
    const all = ["l1", "l2", "l3", "l4"].map((id) => done(id))
    expect(courseStatus(progress(all, [...M1, ...M2]))).toBe("complete")
  })
  it("counts completed lessons", () => {
    expect(completedCount(progress([done("l1"), row("l2")]))).toEqual({
      completed: 1,
      total: 4,
    })
  })
})

describe("last used", () => {
  it("is the later of the latest row update and the latest session start", () => {
    expect(lastUsedAt([{ updatedAt: 5 }, { updatedAt: 9 }], [7])).toBe(9)
    expect(lastUsedAt([{ updatedAt: 5 }], [3, 12])).toBe(12)
    expect(lastUsedAt([], [])).toBeNull()
  })
})

describe("next target", () => {
  const lesson = (lessonId: string): Target => ({ kind: "lesson", lessonId })
  it.each<[string, ReturnType<typeof progress>, Target | null]>([
    ["Ready course → Lesson 1", progress(), lesson("l1")],
    ["first Not started or In progress", progress([done("l1")]), lesson("l2")],
    [
      "an In progress lesson before a Not started one",
      progress([row("l3")]),
      lesson("l1"),
    ],
    [
      "an Open checkpoint comes first",
      progress([done("l1"), done("l2"), row("l3")]),
      { kind: "checkpoint", moduleId: "m1" },
    ],
    [
      "Skipped lessons only when nothing else is left",
      progress([skipped("l1"), done("l2"), skipped("l3"), done("l4")]),
      lesson("l1"),
    ],
    [
      "a Skipped lesson waits behind a Not started one",
      progress([skipped("l1")]),
      lesson("l2"),
    ],
    [
      "none for a Complete course",
      progress(
        ["l1", "l2", "l3", "l4"].map((id) => done(id)),
        [...M1, ...M2]
      ),
      null,
    ],
  ])("%s", (_, p, target) => {
    expect(nextTarget(p)).toEqual(target)
  })

  it("skips checkpoints for full_lesson (R9)", () => {
    const p = progress([done("l1"), done("l2")])
    expect(nextTarget(p, { lessonsOnly: true })).toEqual(lesson("l3"))
    const finished = progress(["l1", "l2", "l3", "l4"].map((id) => done(id)))
    expect(nextTarget(finished, { lessonsOnly: true })).toBeNull()
  })

  it("never re-targets a lesson skipped during the session", () => {
    const p = progress([skipped("l1", { lastSessionId: "s1" })])
    const exclude = skippedInSession(p, "s1")
    expect([...exclude]).toEqual(["l1"])
    expect(nextTarget(p, { exclude })).toEqual(lesson("l2"))
    const onlySkipped = progress(
      [
        skipped("l1", { lastSessionId: "s1" }),
        done("l2"),
        done("l3"),
        done("l4"),
      ],
      M2
    )
    expect(
      nextTarget(onlySkipped, { exclude: skippedInSession(onlySkipped, "s1") })
    ).toBeNull()
  })

  it("a skip from an earlier session is still eligible", () => {
    const p = progress([skipped("l1", { lastSessionId: "s0" })])
    expect(skippedInSession(p, "s1").size).toBe(0)
  })
})

describe("request status", () => {
  const published = [{ requestId: "r1" }, { requestId: undefined }]
  const notBuilt = [{ requestId: "r2", reason: "Too broad" }]
  it.each([
    ["r1", { status: "published" }],
    ["r2", { status: "not_built", reason: "Too broad" }],
    ["r3", { status: "requested" }],
  ])("%s", (id, expected) => {
    expect(requestStatus(id, published, notBuilt)).toEqual(expected)
  })
})

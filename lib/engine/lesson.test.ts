import { describe, expect, it } from "vitest"

import {
  advanceLesson,
  celebrationLine,
  completeLesson,
  enterLesson,
  firstLessonPosition,
  LessonStateError,
  PositionError,
  samePosition,
  selectRecallExercises,
  skipLesson,
  unskipLesson,
  warmupPrompts,
  warmupSource,
  type LessonEvent,
  type LessonShape,
} from "./lesson"
import {
  courseStatus,
  lessonStatus,
  skippedInSession,
  type LessonProgress,
} from "./status"
import {
  done,
  progress,
  row,
  skipped,
  testCourse,
  testLesson,
} from "./test-course"
import type { LessonPosition } from "./types"

const shape: LessonShape = {
  warmupCount: 3,
  guessCount: 2,
  recallQueueLength: 2,
  keyQuestionCount: 2,
}

describe("lesson positions", () => {
  it("starts at Warm up, or Guess first without one", () => {
    expect(firstLessonPosition(true)).toEqual({ step: "warmup", index: 0 })
    expect(firstLessonPosition(false)).toEqual({ step: "guess", index: 0 })
  })

  it("walks every step in order", () => {
    const events: LessonEvent[] = [
      { kind: "warmup-next" },
      { kind: "warmup-next" },
      { kind: "warmup-next" },
      { kind: "guess-lock" },
      { kind: "guess-lock" },
      { kind: "read-done" },
      { kind: "recall-write" },
      { kind: "recall-tick" },
      { kind: "answer", attemptId: "a1" },
      { kind: "answer-next" },
      { kind: "answer", attemptId: "a2" },
      { kind: "answer-next" },
      { kind: "note-stick" },
      { kind: "note-stick" },
    ]
    const seen: LessonPosition[] = []
    let p = firstLessonPosition(true)
    for (const e of events) {
      p = advanceLesson(p, e, shape)
      seen.push(p)
    }
    expect(seen).toEqual([
      { step: "warmup", index: 1 },
      { step: "warmup", index: 2 },
      { step: "guess", index: 0 },
      { step: "guess", index: 1 },
      { step: "read" },
      { step: "recall", phase: "write" },
      { step: "recall", phase: "tick" },
      { step: "recall", phase: "exercises", index: 0 },
      { step: "recall", phase: "exercises", index: 0, answered: "a1" },
      { step: "recall", phase: "exercises", index: 1 },
      { step: "recall", phase: "exercises", index: 1, answered: "a2" },
      { step: "answers", index: 0 },
      { step: "answers", index: 1 },
      { step: "done" },
    ])
  })

  it("a grown Recall queue (re-queue) is walked to its end", () => {
    const p: LessonPosition = {
      step: "recall",
      phase: "exercises",
      index: 1,
      answered: "a",
    }
    expect(
      advanceLesson(
        p,
        { kind: "answer-next" },
        { ...shape, recallQueueLength: 3 }
      )
    ).toEqual({ step: "recall", phase: "exercises", index: 2 })
  })

  it("Skip this step finishes from any board", () => {
    expect(
      advanceLesson(
        { step: "answers", index: 0 },
        { kind: "answers-skip" },
        shape
      )
    ).toEqual({ step: "done" })
  })

  it.each<[LessonPosition, LessonEvent]>([
    [{ step: "read" }, { kind: "warmup-next" }],
    [{ step: "guess", index: 0 }, { kind: "read-done" }],
    [{ step: "recall", phase: "write" }, { kind: "recall-tick" }],
    [{ step: "recall", phase: "exercises", index: 0 }, { kind: "answer-next" }],
    [
      { step: "recall", phase: "exercises", index: 0, answered: "a" },
      { kind: "answer", attemptId: "b" },
    ],
    [{ step: "done" }, { kind: "note-stick" }],
  ])("rejects %j then %j", (p, e) => {
    expect(() => advanceLesson(p, e, shape)).toThrow(PositionError)
  })

  it("compares positions structurally, ignoring key order", () => {
    expect(
      samePosition<LessonPosition>(
        { step: "recall", phase: "exercises", index: 1 },
        { index: 1, phase: "exercises", step: "recall" } as LessonPosition
      )
    ).toBe(true)
    expect(
      samePosition<LessonPosition>(
        { step: "recall", phase: "exercises", index: 1 },
        { step: "recall", phase: "exercises", index: 1, answered: "a" }
      )
    ).toBe(false)
  })
})

describe("skip, undo and unskip", () => {
  const now = 100
  const position: LessonPosition = { step: "read" }

  it("skipping with no row creates one with a null position", () => {
    const r = skipLesson(undefined, "l1", { now })
    expect(r).toMatchObject({ lessonId: "l1", skipped: true, position: null })
    expect(lessonStatus(r)).toBe("skipped")
  })

  it("skipping In progress keeps the position", () => {
    const r = skipLesson(row("l1", { position }), "l1", { now })
    expect(r.position).toEqual(position)
    expect(r.skipped).toBe(true)
  })

  it("skipping from the player sets last_session_id", () => {
    expect(
      skipLesson(row("l1"), "l1", { now, sessionId: "s2" }).lastSessionId
    ).toBe("s2")
  })

  it("a Syllabus skip keeps last_session_id, so undo restores it exactly", () => {
    const before = row("l1", { lastSessionId: "s1" })
    const r = skipLesson(before, "l1", { now })
    expect(r.lastSessionId).toBe("s1")
    // While s1 is open, it counts as skipped there and is not re-targeted.
    expect([...skippedInSession(progress([r]), "s1")]).toEqual(["l1"])
    expect(unskipLesson(r, now + 1)).toEqual({ ...before, updatedAt: now + 1 })
  })

  it("re-skipping a Skipped lesson is harmless", () => {
    expect(skipLesson(skipped("l1"), "l1", { now }).skipped).toBe(true)
  })

  it("a Completed lesson cannot be skipped", () => {
    expect(() => skipLesson(done("l1"), "l1", { now })).toThrow(
      LessonStateError
    )
  })

  it("undo after a skip that created the row deletes it, so the course is Ready again", () => {
    const r = skipLesson(undefined, "l1", { now })
    expect(courseStatus(progress([r]))).toBe("in_progress")
    expect(unskipLesson(r, now + 1)).toBeNull()
    expect(courseStatus(progress([]))).toBe("ready")
  })

  it("undo after skipping an In progress lesson keeps the row and position", () => {
    const r = skipLesson(row("l1", { position }), "l1", { now })
    const back = unskipLesson(r, now + 1) as LessonProgress
    expect(back.skipped).toBe(false)
    expect(back.position).toEqual(position)
    expect(lessonStatus(back)).toBe("in_progress")
  })

  it.each([
    ["Not started", undefined],
    ["In progress", row("l1")],
    ["Completed", done("l1")],
  ])("unskip is refused on a %s lesson", (_, r) => {
    expect(() => unskipLesson(r, now)).toThrow(LessonStateError)
  })
})

describe("entering a lesson", () => {
  const opts = { now: 50, sessionId: "s2", hasWarmup: true }

  it("creates the row at the first position", () => {
    const { row: r, pickingUp } = enterLesson(undefined, "l1", opts)
    expect(r.position).toEqual({ step: "warmup", index: 0 })
    expect(r.lastSessionId).toBe("s2")
    expect(pickingUp).toBe(false)
  })

  it("resumes a Skipped lesson from its position, clearing skipped", () => {
    const { row: r, pickingUp } = enterLesson(
      skipped("l1", { position: { step: "read" }, lastSessionId: "s1" }),
      "l1",
      opts
    )
    expect(r.skipped).toBe(false)
    expect(r.position).toEqual({ step: "read" })
    expect(pickingUp).toBe(true)
  })

  it("a row created by a Syllabus skip starts at the first position", () => {
    const { row: r, pickingUp } = enterLesson(
      skipped("l1", { position: null }),
      "l1",
      { ...opts, hasWarmup: false }
    )
    expect(r.position).toEqual({ step: "guess", index: 0 })
    expect(pickingUp).toBe(false)
  })

  it("picks up where you stopped only after an earlier session", () => {
    expect(
      enterLesson(row("l1", { lastSessionId: "s1" }), "l1", opts).pickingUp
    ).toBe(true)
    expect(
      enterLesson(row("l1", { lastSessionId: "s2" }), "l1", opts).pickingUp
    ).toBe(false)
  })

  it("a Completed lesson loads unchanged for its closing screen", () => {
    const r = done("l1", 5, { lastSessionId: "s2" })
    expect(enterLesson(r, "l1", opts)).toEqual({ row: r, pickingUp: false })
  })

  it("skip then unskip from the Syllabus mid-session does not pick up", () => {
    const r = skipLesson(row("l1", { lastSessionId: "s2" }), "l1", { now: 1 })
    const back = unskipLesson(r, 2) as LessonProgress
    expect(enterLesson(back, "l1", opts).pickingUp).toBe(false)
  })
})

describe("warm-up source", () => {
  it("is none when no other lesson is Completed", () => {
    expect(warmupSource(progress(), "l1")).toBeNull()
    expect(warmupSource(progress([row("l1")]), "l2")).toBeNull()
  })

  it("is the lesson with the latest completed_at, after out-of-order completion", () => {
    // l3 was completed after l1, though it comes later in the syllabus.
    const p = progress([done("l3", 10), done("l1", 20)])
    expect(warmupSource(p, "l2")).toBe("l1")
    expect(warmupSource(progress([done("l1", 20), done("l3", 30)]), "l2")).toBe(
      "l3"
    )
  })

  it("breaks ties with the later lesson in syllabus order", () => {
    expect(warmupSource(progress([done("l3", 10), done("l1", 10)]), "l2")).toBe(
      "l3"
    )
  })

  it("never uses the lesson itself", () => {
    expect(warmupSource(progress([done("l2", 10)]), "l2")).toBeNull()
  })

  it("shows the source's first three concepts, first prompt each", () => {
    expect(warmupPrompts(testLesson("l1", { concepts: 5 }))).toEqual([
      { conceptId: "l1-k1", promptIndex: 0 },
      { conceptId: "l1-k2", promptIndex: 0 },
      { conceptId: "l1-k3", promptIndex: 0 },
    ])
  })
})

describe("Recall exercise selection", () => {
  // Concepts k1–k4. Recall exercises: r1 (k1), r2 (k2), r2b (k2), r3 (k3), r4 (k4).
  const lesson = testLesson("l", {
    concepts: 4,
    recall: [
      ["r1", 0],
      ["r2", 1],
      ["r2b", 1],
      ["r3", 2],
      ["r4", 3],
    ],
  })
  const k = (...n: number[]) => n.map((i) => `l-k${i}`)

  it.each<[string, string[], string[]]>([
    ["nothing missed → the first two candidates", k(1, 2, 3, 4), ["r1", "r2"]],
    ["one missed → its exercise, then more on it", k(1, 3, 4), ["r2", "r2b"]],
    [
      "one missed with one candidate → fill from any concept",
      k(1, 2, 4),
      ["r3", "r1"],
    ],
    ["two missed → one each", k(1, 3), ["r2", "r4"]],
    ["three missed → one each in concept order", k(4), ["r1", "r2", "r3"]],
    ["four missed → three, in concept order (R13)", [], ["r1", "r2", "r3"]],
    [
      "two missed, one with a spare → one each, no spare needed",
      k(2, 4),
      ["r1", "r3"],
    ],
  ])("%s", (_, ticked, expected) => {
    expect(selectRecallExercises(lesson, ticked)).toEqual(expected)
  })

  it("fills a third place with a spare on a missed concept", () => {
    // Missed k2 and k3 → n = 2; missing k1, k2, k3 → n = 3.
    expect(selectRecallExercises(lesson, k(1, 4))).toEqual(["r2", "r3"])
    const twoOnly = testLesson("l", {
      concepts: 3,
      recall: [
        ["a", 0],
        ["a2", 0],
        ["b", 1],
        ["c", 2],
      ],
    })
    // Missed only k1 → n = 2: a, then the spare a2 on the missed concept.
    expect(selectRecallExercises(twoOnly, ["l-k2", "l-k3"])).toEqual([
      "a",
      "a2",
    ])
  })
})

describe("completion and the celebration line", () => {
  const lessons = {
    l1: testLesson("l1", { hook: "Why does it break?" }),
    l2: testLesson("l2", { hook: "What about keys?" }),
    l3: testLesson("l3", { hook: "Who signs?" }),
    l4: testLesson("l4"),
  }

  it("sets done, completed_at and completed_day", () => {
    const r = completeLesson(
      row("l1", { position: { step: "answers", index: 1 } }),
      {
        now: 9,
        day: "2026-05-02",
      }
    )
    expect(r).toMatchObject({
      position: { step: "done" },
      completedAt: 9,
      completedDay: "2026-05-02",
    })
    expect(lessonStatus(r)).toBe("completed")
    expect(() => completeLesson(r, { now: 10, day: "2026-05-02" })).toThrow()
  })

  it.each<[string, LessonProgress[], keyof typeof lessons, string | null]>([
    [
      "the hook with the next lesson",
      [done("l1")],
      "l1",
      "Next, Lesson 2: Why does it break?",
    ],
    [
      "the checkpoint when the module is finished",
      [done("l1"), done("l2")],
      "l2",
      "Checkpoint 1 is open.",
    ],
    [
      "the checkpoint, finishing a module out of order",
      [done("l2"), done("l1")],
      "l1",
      "Checkpoint 1 is open.",
    ],
    [
      "the second checkpoint",
      [done("l3"), done("l4")],
      "l3",
      "Checkpoint 2 is open.",
    ],
    ["no line on the course's last lesson", [done("l4")], "l4", null],
  ])("%s", (_, rows, id, line) => {
    expect(celebrationLine(progress(rows), lessons[id])).toBe(line)
  })

  it("drops the prefix when the next lesson is Completed", () => {
    // Module 1 holds three lessons here, so finishing l1 with l2 done does not
    // finish the module.
    const course = testCourse({
      modules: [
        { id: "m1", title: "One", lessons: ["l1", "l2", "l3"], checkpoint: [] },
        { id: "m2", title: "Two", lessons: ["l4"], checkpoint: [] },
      ],
    } as never)
    expect(
      celebrationLine(
        progress([done("l1"), done("l2")], [], course),
        lessons.l1
      )
    ).toBe("Why does it break?")
  })
})

import { describe, expect, it } from "vitest"

import {
  checkpointItemLabel,
  checkpointRowLabel,
  courseCompleteLine,
  exerciseItemLabel,
  guessItemLabel,
  joinAnd,
  lessonRangeLabel,
  mainButtonLabel,
  moduleLessonsLabel,
  notesLabel,
  recallTickButton,
  resultLine,
  reviewBlockTitle,
  reviewItemLabel,
  sessionLine,
  sessionWork,
  shortAnswerTickLine,
  summaryLine,
  syllabusLessonLabel,
  targetLabel,
  warmupItemLabel,
  type SessionWork,
} from "./labels"
import { courseStatus, nextTarget, type CourseProgress } from "./status"
import { done, M1, M2, progress, row, skipped, testCourse } from "./test-course"
import type { Confidence, LessonPosition } from "./types"

const course = testCourse()

describe("helpers", () => {
  it.each([
    [[], ""],
    [["a"], "a"],
    [["a", "b"], "a and b"],
    [["a", "b", "c"], "a, b and c"],
  ])("joinAnd %j", (parts, s) => {
    expect(joinAnd(parts)).toBe(s)
  })
  it.each([
    [[3], "Lesson 3"],
    [[1, 2, 3], "Lessons 1–3"],
    [[1, 2, 3, 7], "Lessons 1–3, 7"],
  ])("lessonRangeLabel %j", (ns, s) => {
    expect(lessonRangeLabel(ns)).toBe(s)
  })
})

describe("targets in Today's format", () => {
  it.each<[string, LessonPosition | null, string]>([
    ["no position", null, "Lesson 2"],
    ["warm up", { step: "warmup", index: 1 }, "Lesson 2 from Warm up"],
    ["guess", { step: "guess", index: 0 }, "Lesson 2 from Guess first"],
    ["read", { step: "read" }, "Lesson 2 from Read"],
    [
      "recall",
      { step: "recall", phase: "exercises", index: 1 },
      "Lesson 2 from Recall",
    ],
    [
      "answers",
      { step: "answers", index: 0 },
      "Lesson 2 from Add to your answers",
    ],
  ])("%s", (_, position, label) => {
    const p = progress(position ? [row("l2", { position })] : [])
    expect(targetLabel(p, { kind: "lesson", lessonId: "l2" })).toBe(label)
  })

  it("a skipped lesson with a position names its step", () => {
    const p = progress([skipped("l2", { position: { step: "read" } })])
    expect(targetLabel(p, { kind: "lesson", lessonId: "l2" })).toBe(
      "Lesson 2 from Read"
    )
  })

  it("a checkpoint", () => {
    expect(
      targetLabel(progress(), { kind: "checkpoint", moduleId: "m2" })
    ).toBe("Checkpoint 2")
  })

  it.each<[number, string | null, string]>([
    [9, "Lesson 4 from Recall", "9 reviews, then Lesson 4 from Recall"],
    [1, "Lesson 5", "1 review, then Lesson 5"],
    [0, "Checkpoint 1", "Checkpoint 1"],
    [6, null, "6 reviews"],
  ])("session line %i, %s", (n, t, line) => {
    expect(sessionLine(n, t)).toBe(line)
  })
})

describe("course page labels", () => {
  const button = (p: CourseProgress) =>
    mainButtonLabel(p, courseStatus(p), nextTarget(p))
  it.each<[string, CourseProgress, string | null]>([
    ["Ready", progress(), "Start Lesson 1"],
    ["In progress", progress([done("l1"), row("l2")]), "Continue Lesson 2"],
    [
      "only a skip",
      progress([skipped("l1", { position: null })]),
      "Continue Lesson 2",
    ],
    [
      "checkpoint open",
      progress([done("l1"), done("l2")]),
      "Open Checkpoint 1",
    ],
    [
      "Complete (R6)",
      progress(
        ["l1", "l2", "l3", "l4"].map((id) => done(id)),
        [...M1, ...M2]
      ),
      null,
    ],
  ])("main button: %s", (_, p, label) => {
    expect(button(p)).toBe(label)
  })

  it.each([
    [
      "in_progress",
      { step: "recall", phase: "write" },
      "In progress · at Recall",
    ],
    ["in_progress", null, "In progress"],
    ["skipped", { step: "read" }, "Skipped"],
    ["completed", { step: "done" }, "Completed"],
    ["not_started", null, "Not started"],
  ] as const)("syllabus row %s %j", (status, position, label) => {
    expect(syllabusLessonLabel(status, position as LessonPosition | null)).toBe(
      label
    )
  })

  it.each<[string, CourseProgress, string]>([
    ["two unfinished", progress(), "Locked"],
    ["one unfinished", progress([done("l1")]), "Locked · complete Lesson 2"],
    ["open", progress([done("l1"), done("l2")]), "Open"],
    ["done", progress([done("l1"), done("l2")], M1), "Done"],
  ])("checkpoint row: %s", (_, p, label) => {
    expect(checkpointRowLabel(p, "m1")).toBe(label)
  })
})

describe("player labels", () => {
  it("frames and items", () => {
    expect(reviewBlockTitle(course, { kind: "lesson", lessonId: "l4" })).toBe(
      "Reviews then Lesson 4"
    )
    expect(
      reviewBlockTitle(course, { kind: "checkpoint", moduleId: "m1" })
    ).toBe("Reviews then Checkpoint 1")
    expect(reviewBlockTitle(null, null)).toBe("Reviews")
    expect(reviewItemLabel(3, 9, "Encryption")).toBe(
      "Review 4 of 9 · Encryption"
    )
    expect(warmupItemLabel(0, 3, 2)).toBe("Warm up 1 of 3 · from Lesson 2")
    expect(guessItemLabel(0, 2)).toBe("Guess 1 of 2 · It's fine to be wrong")
    expect(exerciseItemLabel(0, 3, "fill")).toBe(
      "Exercise 1 of 3 · fill in the blank"
    )
    expect(moduleLessonsLabel(course, "m2")).toBe("Lessons 3–4")
  })

  it("checkpoint items count answers from every session; retries keep the count", () => {
    const lessons = "Lessons 1–3"
    expect(
      checkpointItemLabel({
        answeredBefore: 3,
        total: 10,
        isRetry: false,
        lessons,
      })
    ).toBe("4 of 10 · Lessons 1–3")
    expect(
      checkpointItemLabel({
        answeredBefore: 5,
        total: 10,
        isRetry: true,
        lessons,
      })
    ).toBe("Retry · 5 of 10 · Lessons 1–3")
  })

  it.each<[boolean, Confidence, string]>([
    [true, "sure", "Right"],
    [true, "not_sure", "Right, but you weren't sure"],
    [true, "guess", "Right, but you guessed · Counts as not learned yet"],
    [false, "sure", "Not quite · you said Sure"],
    [false, "not_sure", "Not quite · you said Not sure"],
    [false, "guess", "Not quite · you said Guess"],
  ])("result line: correct %s, %s", (correct, confidence, line) => {
    expect(resultLine(correct, confidence)).toBe(line)
  })

  it("short answer and Recall tick lines", () => {
    expect(shortAnswerTickLine(0, 3)).toBe("0 of 3 · Not recalled")
    expect(shortAnswerTickLine(2, 3)).toBe("2 of 3 · Partly recalled")
    expect(shortAnswerTickLine(3, 3)).toBe("3 of 3 · Fully recalled")
    expect(recallTickButton(2, 2)).toBe("Practice what you missed (2)")
    expect(recallTickButton(0, 2)).toBe("Practice (2)")
  })

  it("course complete and notes", () => {
    expect(courseCompleteLine(course, 14)).toBe(
      "4 lessons · 2 checkpoints · reviews continue for all 14 concepts"
    )
    expect(notesLabel(1)).toBe("1 note")
    expect(notesLabel(3)).toBe("3 notes")
  })
})

describe("summary line", () => {
  const work = (over: Partial<SessionWork> = {}): SessionWork => ({
    reviews: 0,
    lessonsCompleted: [],
    lessonsPartial: [],
    checkpoints: [],
    ...over,
  })
  it.each<[string, SessionWork, string | null, string]>([
    [
      "reviews and a lesson",
      work({ reviews: 9, lessonsCompleted: ["l4"] }),
      "Lesson 5",
      "9 reviews and Lesson 4. Next time, Lesson 5.",
    ],
    [
      "part of a lesson",
      work({ lessonsPartial: ["l1"] }),
      "Lesson 1 from Read",
      "Part of Lesson 1. Next time, Lesson 1 from Read.",
    ],
    [
      "nothing (R8)",
      work(),
      "Lesson 1",
      "Nothing recorded. Next time, Lesson 1.",
    ],
    [
      "just reviews next",
      work({ reviews: 1 }),
      null,
      "1 review. Next time, just reviews.",
    ],
    [
      "consecutive completed lessons collapse",
      work({ lessonsCompleted: ["l1", "l2", "l3"], lessonsPartial: ["l4"] }),
      "Lesson 4 from Guess first",
      "Lessons 1–3 and part of Lesson 4. Next time, Lesson 4 from Guess first.",
    ],
    [
      "a checkpoint made Done, in syllabus order",
      work({
        reviews: 3,
        lessonsCompleted: ["l2"],
        checkpoints: [{ moduleId: "m1", answered: 6, madeDone: true }],
        lessonsPartial: ["l3"],
      }),
      "Lesson 3 from Read",
      "3 reviews, Lesson 2, Checkpoint 1 and part of Lesson 3. Next time, Lesson 3 from Read.",
    ],
    [
      "part of a checkpoint",
      work({ checkpoints: [{ moduleId: "m2", answered: 4, madeDone: false }] }),
      "Checkpoint 2",
      "4 exercises of Checkpoint 2. Next time, Checkpoint 2.",
    ],
    [
      "one exercise",
      work({ checkpoints: [{ moduleId: "m2", answered: 1, madeDone: false }] }),
      "Checkpoint 2",
      "1 exercise of Checkpoint 2. Next time, Checkpoint 2.",
    ],
  ])("%s", (_, w, next, line) => {
    expect(summaryLine(course, w, next)).toBe(line)
  })

  it("derives the work from the session's rows", () => {
    const session = { id: "s2", startedAt: 100, endedAt: 200 }
    const p = progress(
      [
        done("l1", 50, { lastSessionId: "s1" }),
        done("l2", 150, { lastSessionId: "s2" }),
        row("l3", { lastSessionId: "s2" }),
        skipped("l4", { lastSessionId: "s2" }),
      ],
      ["x1", "x2"]
    )
    expect(
      sessionWork({
        session,
        cp: p,
        attempts: [
          { context: "review", exerciseId: null, isRetry: false },
          { context: "review", exerciseId: "e", isRetry: false },
          { context: "review", exerciseId: "e", isRetry: true },
          { context: "recall", exerciseId: "r", isRetry: false },
          { context: "checkpoint", exerciseId: "x1", isRetry: false },
          { context: "checkpoint", exerciseId: "x2", isRetry: false },
          { context: "checkpoint", exerciseId: "x2", isRetry: true },
        ],
      })
    ).toEqual({
      reviews: 2,
      lessonsCompleted: ["l2"],
      lessonsPartial: ["l3"],
      checkpoints: [{ moduleId: "m1", answered: 2, madeDone: false }],
    })
  })

  it("a checkpoint finished in the session reads as made Done", () => {
    const p = progress([done("l1"), done("l2")], M1)
    const w = sessionWork({
      session: { id: "s", startedAt: 0, endedAt: null },
      cp: p,
      attempts: [{ context: "checkpoint", exerciseId: "x6", isRetry: false }],
    })
    expect(w.checkpoints).toEqual([
      { moduleId: "m1", answered: 1, madeDone: true },
    ])
  })
})

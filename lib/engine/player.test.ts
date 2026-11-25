import { describe, expect, it } from "vitest"

import type { Lesson } from "@/lib/content/schema"

import {
  madeCourseComplete,
  markReviewItem,
  minutesUsedLabel,
  nextReviewPosition,
  reviewQueueAfter,
  isReviewRetry,
  timerLabel,
} from "./player"
import type { ReviewQueueItem } from "./session"

const lesson = {
  exercises: [
    {
      id: "e-mc",
      type: "mc",
      concepts: ["c1"],
      pool: "review",
      prompt: "p",
      explanation: "x",
      anchor: "a",
      options: [
        { id: "o1", text: "one" },
        { id: "o2", text: "two" },
        { id: "o3", text: "three" },
      ],
      correct: "o2",
    },
  ],
} as unknown as Pick<Lesson, "exercises">

const prompt: ReviewQueueItem = {
  courseId: "c",
  conceptId: "c1",
  version: { kind: "prompt", index: 0 },
}
const exercise: ReviewQueueItem = {
  courseId: "c",
  conceptId: "c2",
  version: { kind: "exercise", exerciseId: "e-mc" },
}

describe("markReviewItem", () => {
  it("takes a recall prompt's rating as its grade", () => {
    expect(
      markReviewItem(prompt, lesson, { kind: "rating", grade: "partly" })
    ).toEqual({
      correct: null,
      confidence: null,
      selfMark: null,
      grade: "partly",
    })
  })

  it("marks an exercise from content", () => {
    expect(
      markReviewItem(exercise, lesson, {
        kind: "exercise",
        response: { type: "mc", optionId: "o2" },
        confidence: "not_sure",
      })
    ).toMatchObject({ correct: true, grade: "partly" })
    expect(
      markReviewItem(exercise, lesson, {
        kind: "exercise",
        response: { type: "mc", optionId: "o1" },
        confidence: "sure",
      })
    ).toMatchObject({ correct: false, grade: "forgot" })
  })

  it("refuses an answer of the wrong kind", () => {
    expect(() =>
      markReviewItem(prompt, lesson, {
        kind: "exercise",
        response: { type: "mc", optionId: "o1" },
        confidence: "sure",
      })
    ).toThrow(/rating/)
    expect(() =>
      markReviewItem(exercise, lesson, { kind: "rating", grade: "forgot" })
    ).toThrow(/response/)
  })
})

describe("the review queue", () => {
  const a = { ...prompt, conceptId: "a" }
  const b = { ...prompt, conceptId: "b" }
  const queue = [exercise, a, b]
  const wrongSure = {
    correct: false,
    confidence: "sure" as const,
    selfMark: null,
    grade: "forgot" as const,
  }

  it("re-queues a wrong Sure three items later, or at the end", () => {
    expect(reviewQueueAfter(queue, 0, wrongSure)).toEqual([
      exercise,
      a,
      b,
      exercise,
    ])
    expect(
      reviewQueueAfter(queue, 0, { ...wrongSure, confidence: "not_sure" })
    ).toBeNull()
  })

  it("knows a retry, which is never re-queued again", () => {
    const grown = reviewQueueAfter(queue, 0, wrongSure)!
    expect(isReviewRetry(grown, 0)).toBe(false)
    expect(isReviewRetry(grown, 3)).toBe(true)
    expect(reviewQueueAfter(grown, 3, wrongSure)).toBeNull()
  })

  it("moves to the next review, or ends the block", () => {
    expect(nextReviewPosition(0, 3)).toEqual({ unit: "reviews", index: 1 })
    expect(nextReviewPosition(2, 3)).toBeNull()
  })
})

describe("timer", () => {
  it.each([
    ["standard", 15, 0, "15 min left"],
    ["standard", 15, 2 * 60_000 + 1, "13 min left"],
    ["standard", 15, 14 * 60_000 + 59_000, "1 min left"],
    ["standard", 15, 20 * 60_000, "0 min left"],
    ["reviews_only", 10, 30_000, "10 min left"],
    ["full_lesson", 15, 12 * 60_000 + 59_000, "12 min"],
  ] as const)("%s %i min, %i ms → %s", (kind, minutes, ms, want) => {
    expect(timerLabel(kind, minutes, ms)).toBe(want)
  })

  it("rounds the minutes used", () => {
    expect(minutesUsedLabel(15 * 60_000 - 20_000)).toBe("15 min")
    expect(minutesUsedLabel(0)).toBe("0 min")
  })
})

describe("madeCourseComplete", () => {
  const none = { lessonsCompleted: [], checkpoints: [] }
  it.each([
    [true, none, false],
    [true, { ...none, lessonsCompleted: ["l1"] }, true],
    [
      true,
      {
        ...none,
        checkpoints: [{ moduleId: "m", answered: 1, madeDone: true }],
      },
      true,
    ],
    [false, { ...none, lessonsCompleted: ["l1"] }, false],
  ])("complete=%s → %s", (complete, work, want) => {
    expect(madeCourseComplete(complete, work)).toBe(want)
  })
})

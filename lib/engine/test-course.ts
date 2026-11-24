// Small in-memory courses for engine tests. Only the fields the engine reads
// are filled; the content validator has its own fixtures (§10.2).

import type { Course, Exercise, Lesson } from "@/lib/content/schema"

import type { CourseProgress, LessonProgress } from "./status"
import type { LessonPosition } from "./types"

/**
 * A course "c" with two modules: m1 = l1, l2 (checkpoint x1–x6) and
 * m2 = l3, l4 (checkpoint y1–y6).
 */
export function testCourse(over: Partial<Course> = {}): Course {
  return {
    id: "c",
    title: "Test course",
    modules: [
      {
        id: "m1",
        title: "One",
        lessons: ["l1", "l2"],
        checkpoint: ["x1", "x2", "x3", "x4", "x5", "x6"],
      },
      {
        id: "m2",
        title: "Two",
        lessons: ["l3", "l4"],
        checkpoint: ["y1", "y2", "y3", "y4", "y5", "y6"],
      },
    ],
    ...over,
  } as Course
}

const ex = (id: string, pool: Exercise["pool"], concepts: string[]): Exercise =>
  ({
    id,
    pool,
    concepts,
    type: "mc",
    prompt: id,
    explanation: id,
    anchor: "a",
    options: [],
    correct: "o1",
  }) as unknown as Exercise

/**
 * A lesson with concepts `${id}-k1`…, one recall prompt each, two guesses,
 * and `recall` exercises listed as [exercise id, concept index] pairs.
 */
export function testLesson(
  id: string,
  opts: {
    concepts?: number
    recall?: Array<[string, number]>
    review?: Array<[string, number]>
    keyQuestions?: Lesson["keyQuestions"]
    hook?: string
  } = {}
): Lesson {
  const n = opts.concepts ?? 3
  const concepts = Array.from({ length: n }, (_, i) => ({
    id: `${id}-k${i + 1}`,
    statement: `Point ${i + 1}`,
    recallPrompts: [{ prompt: `P${i + 1}`, answer: `A${i + 1}` }],
  }))
  const recall =
    opts.recall ??
    concepts.map((_, i) => [`${id}-r${i + 1}`, i] as [string, number])
  const review =
    opts.review ??
    concepts.map((_, i) => [`${id}-v${i + 1}`, i] as [string, number])
  return {
    id,
    title: `Lesson ${id}`,
    keyQuestions: opts.keyQuestions ?? ["q1", "q2"],
    whyThisMatters: "Why",
    ...(opts.hook ? { hook: { text: opts.hook, keyQuestion: "q1" } } : {}),
    concepts,
    guesses: [{ id: "g1" }, { id: "g2" }],
    misconceptions: [],
    beyond: { simplified: [], notCovered: [] },
    exercises: [
      ...recall.map(([e, c]) => ex(e, "recall", [concepts[c].id])),
      ...review.map(([e, c]) => ex(e, "review", [concepts[c].id])),
    ],
  } as unknown as Lesson
}

export function row(
  lessonId: string,
  over: Partial<LessonProgress> = {}
): LessonProgress {
  return {
    lessonId,
    skipped: false,
    position: { step: "read" } as LessonPosition,
    recallText: null,
    recallTicked: null,
    recallQueue: null,
    lastSessionId: null,
    completedAt: null,
    completedDay: null,
    updatedAt: 1,
    ...over,
  }
}

export const done = (
  lessonId: string,
  at = 1,
  over: Partial<LessonProgress> = {}
) =>
  row(lessonId, {
    position: { step: "done" },
    completedAt: at,
    completedDay: "2026-05-01",
    updatedAt: at,
    ...over,
  })

export const skipped = (lessonId: string, over: Partial<LessonProgress> = {}) =>
  row(lessonId, { skipped: true, ...over })

export function progress(
  rows: LessonProgress[] = [],
  answered: string[] = [],
  course: Course = testCourse()
): CourseProgress {
  return {
    course,
    lessons: new Map(rows.map((r) => [r.lessonId, r])),
    checkpointAnswered: new Set(answered),
  }
}

export const M1 = ["x1", "x2", "x3", "x4", "x5", "x6"]
export const M2 = ["y1", "y2", "y3", "y4", "y5", "y6"]

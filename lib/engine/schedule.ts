// Scheduling: SM-2-lite with three grades (§7.4, D5, R2, R5, R10).

import type { Lesson } from "@/lib/content/schema"

import {
  DAILY_CAP,
  EASE_MAX,
  EASE_MIN,
  EASE_START,
  MAX_INTERVAL_DAYS,
} from "./constants"
import { addDays, daysBetween, minDay } from "./day"
import type { Day, Grade } from "./types"

/** A `concept_schedule` row's learning state (§6). */
export interface ScheduleState {
  lessonDay: Day
  dueDay: Day
  intervalDays: number
  ease: number
  lastEventDay: Day
  laterDayReviews: number
  lastGrade: Grade | null
  versionCursor: number
}

export interface ScheduleRow extends ScheduleState {
  courseId: string
  conceptId: string
}

/**
 * The row a concept gets when its lesson is completed on `day`: due in 2 days
 * if it was recalled in step 4, otherwise in 1 (R2).
 */
export function initialSchedule(recalled: boolean, day: Day): ScheduleState {
  const intervalDays = recalled ? 2 : 1
  return {
    lessonDay: day,
    dueDay: addDays(day, intervalDays),
    intervalDays,
    ease: EASE_START,
    lastEventDay: day,
    laterDayReviews: 0,
    lastGrade: null,
    versionCursor: 0,
  }
}

/** A graded Recall exercise answer, with the concepts its exercise tags. */
export interface RecallResult {
  concepts: readonly string[]
  grade: Grade
  isRetry: boolean
}

/**
 * *Recalled* (R2): the concept's key point was ticked and no Recall exercise
 * on it was graded `forgot`. Retries do not count.
 */
export function isRecalled(
  conceptId: string,
  ticked: readonly string[],
  recallResults: readonly RecallResult[]
): boolean {
  return (
    ticked.includes(conceptId) &&
    !recallResults.some(
      (r) =>
        !r.isRetry && r.grade === "forgot" && r.concepts.includes(conceptId)
    )
  )
}

/** The rows a lesson's completion creates, one per concept in order. */
export function lessonCompletionSchedules(
  lesson: Pick<Lesson, "concepts">,
  ticked: readonly string[],
  recallResults: readonly RecallResult[],
  day: Day
): (ScheduleState & { conceptId: string })[] {
  return lesson.concepts.map((c) => ({
    conceptId: c.id,
    ...initialSchedule(isRecalled(c.id, ticked, recallResults), day),
  }))
}

const clampEase = (ease: number) =>
  // Rounded to two places so repeated ±0.10 steps do not drift.
  Math.round(Math.min(EASE_MAX, Math.max(EASE_MIN, ease)) * 100) / 100

/**
 * Applies one review event graded `grade` on `today`. Only the first event on
 * a day updates the schedule; a later `forgot` that day only pulls the due
 * day in to tomorrow. An event dated before `last_event_day` (the clock moved
 * back) changes nothing.
 */
export function applyReview<T extends ScheduleState>(
  row: T,
  grade: Grade,
  today: Day
): T {
  if (today < row.lastEventDay) return row
  if (today === row.lastEventDay) {
    if (grade !== "forgot") return row
    return { ...row, dueDay: minDay(row.dueDay, addDays(today, 1)) }
  }
  const elapsed = daysBetween(row.lastEventDay, today)
  let interval: number
  let ease = row.ease
  switch (grade) {
    case "remembered":
      interval = Math.min(
        MAX_INTERVAL_DAYS,
        Math.max(
          row.intervalDays + 1,
          Math.round(Math.max(row.intervalDays, elapsed) * row.ease)
        )
      )
      ease += 0.1
      break
    case "partly":
      interval = Math.min(
        MAX_INTERVAL_DAYS,
        Math.max(1, Math.round(row.intervalDays * 1.2))
      )
      ease -= 0.15
      break
    case "forgot":
      interval = 1
      ease -= 0.2
      break
  }
  return {
    ...row,
    intervalDays: interval,
    ease: clampEase(ease),
    dueDay: addDays(today, interval),
    lastEventDay: today,
    laterDayReviews: row.laterDayReviews + 1,
    lastGrade: grade,
  }
}

/** What an answer is, for deciding which schedules it touches. */
export type AnswerEvent =
  /** A review item is for exactly one concept (`attempt.concept_id`). */
  | { context: "review"; isRetry: boolean; conceptId: string }
  /** A checkpoint answer touches every concept its exercise tags. */
  | { context: "checkpoint"; isRetry: boolean; concepts: readonly string[] }
  | { context: "recall"; isRetry: boolean }

/**
 * The concepts whose schedule an answer updates (§7.4, R5):
 * - a review item: its concept;
 * - a checkpoint answer: each tagged concept whose lesson was completed
 *   before today, so a real later-day retrieval;
 * - Recall exercises and retries: none (Recall sets only the first interval).
 *
 * Warm-ups and Guess first are not answers and never reach this.
 *
 * `courseSchedules` holds the answer's own course's rows, keyed by concept
 * id: concept ids are unique only within a course.
 */
export function reviewEventConcepts(
  event: AnswerEvent,
  courseSchedules: ReadonlyMap<string, Pick<ScheduleState, "lessonDay">>,
  today: Day
): string[] {
  if (event.isRetry) return []
  switch (event.context) {
    case "recall":
      return []
    case "review":
      return courseSchedules.has(event.conceptId) ? [event.conceptId] : []
    case "checkpoint":
      return event.concepts.filter((id) => {
        const row = courseSchedules.get(id)
        return row !== undefined && row.lessonDay < today
      })
  }
}

/** One prepared version of a concept's review (§7.4). */
export type ReviewVersion =
  { kind: "prompt"; index: number } | { kind: "exercise"; exerciseId: string }

/**
 * A concept's review versions: its recall prompts, then the `review` exercises
 * that tag it, each in authored order. The validator allows a `review`
 * exercise exactly one concept (§5.5), so no exercise is a version of two
 * concepts and none can appear twice in one review block.
 */
export function reviewVersions(
  lesson: Pick<Lesson, "concepts" | "exercises">,
  conceptId: string
): ReviewVersion[] {
  const concept = lesson.concepts.find((c) => c.id === conceptId)
  if (!concept) {
    throw new Error(`Concept ${conceptId} is not in this lesson`)
  }
  return [
    ...concept.recallPrompts.map((_, index) => ({
      kind: "prompt" as const,
      index,
    })),
    ...lesson.exercises
      .filter((e) => e.pool === "review" && e.concepts.includes(conceptId))
      .map((e) => ({ kind: "exercise" as const, exerciseId: e.id })),
  ]
}

/** The version assembly shows: `versions[version_cursor % n]`. */
export function pickVersion<V>(versions: readonly V[], cursor: number): V {
  if (versions.length === 0) throw new Error("A concept has no versions")
  return versions[cursor % versions.length]
}

/**
 * Moves to the next version. Called when a review item (not a retry) is
 * answered, never at assembly, so an abandoned session skips no versions.
 */
export function advanceVersion<T extends ScheduleState>(row: T): T {
  return { ...row, versionCursor: row.versionCursor + 1 }
}

/** Review items still allowed today, given non-retry reviews answered today. */
export function reviewCapLeft(reviewsAnsweredToday: number): number {
  return Math.max(0, DAILY_CAP - reviewsAnsweredToday)
}

/**
 * The due list (§7.7): rows due by today with no review event today, most
 * overdue first, then by `last_event_day`, then by course and concept id.
 */
export function dueConcepts<T extends ScheduleRow>(
  rows: readonly T[],
  today: Day
): T[] {
  return rows
    .filter((r) => r.dueDay <= today && r.lastEventDay < today)
    .sort(
      (a, b) =>
        cmp(a.dueDay, b.dueDay) ||
        cmp(a.lastEventDay, b.lastEventDay) ||
        cmp(a.courseId, b.courseId) ||
        cmp(a.conceptId, b.conceptId)
    )
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

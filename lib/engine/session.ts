// Sessions (§7.7, spec F8): assembly, the soft budget, player units and
// choosing what comes next.

import { EST, RECALL_EXERCISES_MAX } from "./constants"
import {
  courseStatus,
  nextTarget,
  type CourseProgress,
  type CourseStatus,
  type Target,
} from "./status"
import {
  dueConcepts,
  pickVersion,
  reviewCapLeft,
  type ReviewVersion,
  type ScheduleRow,
} from "./schedule"
import type {
  Day,
  LessonPosition,
  SessionKind,
  SessionMinutes,
  SessionPosition,
} from "./types"

/** `reviews_only` holds at most this many reviews, about 3 minutes. */
export const REVIEWS_ONLY_MAX = 6

/** One entry of `session.review_queue`, with its chosen version (§7.7). */
export interface ReviewQueueItem {
  courseId: string
  conceptId: string
  version: ReviewVersion
}

/** The key that identifies a review's retry in its queue. */
export const reviewKey = (
  item: Pick<ReviewQueueItem, "courseId" | "conceptId">
) => `${item.courseId}:${item.conceptId}`

// --- Assembly ---------------------------------------------------------------

/** How many reviews a session holds (§7.7 step 2). */
export function reviewCount(input: {
  kind: SessionKind
  minutes: SessionMinutes
  hasTarget: boolean
  due: number
  capLeft: number
}): number {
  const { kind, minutes, hasTarget, due, capLeft } = input
  const seconds = minutes * 60
  switch (kind) {
    case "standard":
      return Math.min(
        capLeft,
        due,
        Math.floor((hasTarget ? seconds / 2 : seconds) / EST.review)
      )
    case "reviews_only":
      return Math.min(capLeft, due, REVIEWS_ONLY_MAX)
    case "full_lesson":
      return 0
  }
}

/** A course as session assembly and Today see it. */
export interface CourseCandidate extends CourseProgress {
  lastUsedAt: number | null
  /** Whether an earlier session had this course as `session.course_id`. */
  hadSession: boolean
}

/**
 * `session.course_id` (§7.7 step 3, R16): the given course whatever its
 * status; otherwise the most recently used course that is *In progress*, or
 * that is *Ready* and was an earlier session's course. Null if none.
 */
export function chooseSessionCourse(
  courses: readonly CourseCandidate[],
  courseId?: string
): CourseCandidate | null {
  if (courseId !== undefined) {
    const c = courses.find((c) => c.course.id === courseId)
    if (!c) throw new Error(`No course ${courseId}`)
    return c
  }
  let best: CourseCandidate | null = null
  for (const c of courses) {
    const status: CourseStatus = courseStatus(c)
    const eligible =
      status === "in_progress" || (status === "ready" && c.hadSession)
    if (!eligible) continue
    if (!best || (c.lastUsedAt ?? -Infinity) > (best.lastUsedAt ?? -Infinity)) {
      best = c
    }
  }
  return best
}

/** The target a session of `kind` takes in its course. */
export function sessionTarget(
  kind: SessionKind,
  cp: CourseProgress | null,
  exclude?: ReadonlySet<string>
): Target | null {
  if (!cp || kind === "reviews_only") return null
  return nextTarget(cp, { exclude, lessonsOnly: kind === "full_lesson" })
}

export interface AssemblyInput {
  kind: SessionKind
  minutes: SessionMinutes
  today: Day
  courseId?: string
  /** Every `concept_schedule` row, across courses. */
  schedules: readonly ScheduleRow[]
  /** Non-retry review attempts answered today, across courses. */
  reviewsAnsweredToday: number
  courses: readonly CourseCandidate[]
}

export interface Assembly {
  courseId: string | null
  target: Target | null
  /** The chosen due rows, most overdue first. */
  reviews: ScheduleRow[]
  /** Due concepts before the cap and sizing. */
  due: number
  capLeft: number
}

/** Session assembly at start (§7.7). Today runs it for its line too. */
export function assembleSession(input: AssemblyInput): Assembly {
  const course = chooseSessionCourse(input.courses, input.courseId)
  const target = sessionTarget(input.kind, course)
  const due = dueConcepts(input.schedules, input.today)
  const capLeft = reviewCapLeft(input.reviewsAnsweredToday)
  const n = reviewCount({
    kind: input.kind,
    minutes: input.minutes,
    hasTarget: target !== null,
    due: due.length,
    capLeft,
  })
  return {
    courseId: course?.course.id ?? null,
    target,
    reviews: due.slice(0, n),
    due: due.length,
    capLeft,
  }
}

/** A review-queue entry: the version at the row's cursor (§7.4). */
export function reviewQueueItem(
  row: ScheduleRow,
  versions: readonly ReviewVersion[]
): ReviewQueueItem {
  return {
    courseId: row.courseId,
    conceptId: row.conceptId,
    version: pickVersion(versions, row.versionCursor),
  }
}

// --- Soft budget ------------------------------------------------------------

/** Seconds left: `minutes × 60 − active_ms / 1000`. */
export function remainingSeconds(minutes: number, activeMs: number): number {
  return minutes * 60 - activeMs / 1000
}

/**
 * A budget unit starts only if `remaining ≥ EST(unit) / 2` (§7.7).
 * `full_lesson` ignores the budget.
 */
export function budgetAllows(input: {
  kind: SessionKind
  minutes: number
  activeMs: number
  estimateSeconds: number
}): boolean {
  if (input.kind === "full_lesson") return true
  return (
    remainingSeconds(input.minutes, input.activeMs) >= input.estimateSeconds / 2
  )
}

/** What the lesson step estimates need. */
export interface LessonEstimateShape {
  warmupCount: number
  guessCount: number
  readMinutes: number
  /** `recall_queue`'s length; before the ticks, the most it can be. */
  recallQueueLength: number | null
  keyQuestionCount: number
}

/**
 * The estimate of the rest of the budget unit that contains `position`. Budget
 * units are Warm up, Guess first, Read, and Recall together with step 5
 * (§7.7), so a resumed step is sized by what is left of it.
 */
export function lessonUnitEstimate(
  position: LessonPosition,
  s: LessonEstimateShape
): number {
  const exercises = s.recallQueueLength ?? RECALL_EXERCISES_MAX
  const boards = s.keyQuestionCount * EST.answersBoard
  switch (position.step) {
    case "warmup":
      return (s.warmupCount - position.index) * EST.warmupPrompt
    case "guess":
      return (s.guessCount - position.index) * EST.guess
    case "read":
      return s.readMinutes * 60
    case "recall": {
      const rest = exercises * EST.recallExercise + boards
      if (position.phase === "write") {
        return EST.recallWrite + EST.recallTick + rest
      }
      if (position.phase === "tick") return EST.recallTick + rest
      return (exercises - position.index) * EST.recallExercise + boards
    }
    case "answers":
      return (s.keyQuestionCount - position.index) * EST.answersBoard
    case "done":
      return 0
  }
}

/** The review block's estimate. */
export const reviewBlockEstimate = (count: number) => count * EST.review

/** Each checkpoint exercise is its own budget unit. */
export const checkpointExerciseEstimate = EST.checkpointExercise

/**
 * Whether a lesson position starts a new budget unit, so the budget rule is
 * checked before it. Recall tick → exercises and moves inside a step do not.
 */
export function startsBudgetUnit(
  from: LessonPosition,
  to: LessonPosition
): boolean {
  if (to.step === "done") return false
  if (from.step === to.step) return false
  // Recall and step 5 are one budget unit.
  return !(from.step === "recall" && to.step === "answers")
}

// --- Moving on --------------------------------------------------------------

/** The position a target starts at. A checkpoint starts at its queue's head. */
export function targetPosition(target: Target): SessionPosition {
  return target.kind === "lesson"
    ? { unit: "lesson", lessonId: target.lessonId }
    : { unit: "checkpoint", moduleId: target.moduleId, index: 0 }
}

/** The end screens: course complete first when the session made it so. */
export function endPosition(madeCourseComplete: boolean): SessionPosition {
  return {
    unit: "end",
    screen: madeCourseComplete ? "course-complete" : "summary",
  }
}

/** The first position of a newly assembled session. */
export function initialSessionPosition(a: {
  reviews: readonly unknown[]
  target: Target | null
}): SessionPosition {
  if (a.reviews.length > 0) return { unit: "reviews", index: 0 }
  return a.target ? targetPosition(a.target) : endPosition(false)
}

interface NextUnitBase {
  kind: SessionKind
  minutes: number
  activeMs: number
  /** Whether this session made the course *Complete* (§7.7 Ending). */
  madeCourseComplete: boolean
}

export type NextUnitInput = NextUnitBase &
  (
    | {
        /** A target (or the review block) finished, or was skipped. */
        finished: "reviews" | "lesson" | "skip-lesson" | "checkpoint"
        /**
         * The course's next target, recomputed with the session's skipped
         * lessons excluded, and its first budget unit's estimate.
         */
        next: { target: Target; estimateSeconds: number } | null
      }
    | {
        /** The client's budget check failed between checkpoint exercises. */
        finished: "budget-end"
        /**
         * The item the client stopped before (the next checkpoint exercise)
         * and its estimate. The server checks the rule again with its own
         * `active_ms`, and stays there if the item still fits.
         */
        pending: { position: SessionPosition; estimateSeconds: number }
      }
  )

/**
 * Chooses the next unit when a target (or the review block) finishes (§7.7):
 * the next target under the budget rule, or the end screens. `full_lesson`
 * ends with its lesson and never continues into a checkpoint; `reviews_only`
 * ends with its review block.
 */
export function nextSessionPosition(input: NextUnitInput): SessionPosition {
  const end = endPosition(input.madeCourseComplete)
  const fits = (estimateSeconds: number) =>
    budgetAllows({
      kind: input.kind,
      minutes: input.minutes,
      activeMs: input.activeMs,
      estimateSeconds,
    })
  if (input.finished === "budget-end") {
    // The server checks again (§7.7): a client whose clock disagrees cannot
    // end a session that still has time for the item it stopped before.
    return fits(input.pending.estimateSeconds) ? input.pending.position : end
  }
  if (input.kind === "reviews_only") return end
  if (input.kind === "full_lesson" && input.finished !== "reviews") return end
  if (!input.next) return end
  return fits(input.next.estimateSeconds)
    ? targetPosition(input.next.target)
    : end
}

// --- Player units -----------------------------------------------------------

/** The unit the player loads at once (§8.4). */
export type PlayerUnitKind =
  | "reviews"
  | "warmup"
  | "guess"
  | "read"
  | "recall-write-tick"
  | "recall-exercises-answers"
  | "checkpoint"
  | "end"

export function playerUnitKind(
  session: SessionPosition,
  lesson: LessonPosition | null
): PlayerUnitKind {
  switch (session.unit) {
    case "reviews":
      return "reviews"
    case "checkpoint":
      return "checkpoint"
    case "end":
      return "end"
    case "lesson":
      if (!lesson) throw new Error("A lesson unit needs its lesson position")
      switch (lesson.step) {
        case "warmup":
          return "warmup"
        case "guess":
          return "guess"
        case "read":
          return "read"
        case "recall":
          return lesson.phase === "exercises"
            ? "recall-exercises-answers"
            : "recall-write-tick"
        case "answers":
        case "done":
          return "recall-exercises-answers"
      }
  }
}

/**
 * The client keys its unit component by this, so local state resets with
 * every unit (§8.4).
 */
export function unitKey(
  session: SessionPosition,
  lesson: LessonPosition | null
): string {
  const kind = playerUnitKind(session, lesson)
  switch (session.unit) {
    case "lesson":
      return `lesson:${session.lessonId}:${kind}`
    case "checkpoint":
      return `checkpoint:${session.moduleId}`
    case "end":
      return `end:${session.screen}`
    case "reviews":
      return "reviews"
  }
}

/** Whether a `standard` session started now would hold anything (Keep going). */
export function wouldHoldWork(
  a: Pick<Assembly, "reviews" | "target">
): boolean {
  return a.reviews.length > 0 || a.target !== null
}

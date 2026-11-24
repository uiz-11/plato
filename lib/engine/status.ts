// Lesson, checkpoint, course and request statuses, numbering, last used and
// the next target (§7.3, §7.6, §7.9). All derived from progress rows; never
// stored (§14).

import type {
  Course,
  Module,
  NotBuiltEntry,
  PublishedEntry,
} from "@/lib/content/schema"

import type { Day, LessonPosition, SelfMark } from "./types"

/** The `lesson_progress` columns the engine reads and writes (§6). */
export interface LessonProgress {
  lessonId: string
  skipped: boolean
  position: LessonPosition | null
  recallText: string | null
  recallTicked: string[] | null
  recallQueue: string[] | null
  lastSessionId: string | null
  completedAt: number | null
  completedDay: Day | null
  updatedAt: number
}

/** One course's content with the learner's progress in it. */
export interface CourseProgress {
  course: Course
  /** `lesson_progress` rows by lesson id. No row means *Not started*. */
  lessons: ReadonlyMap<string, LessonProgress>
  /**
   * Checkpoint exercise ids with a non-retry attempt, from every session.
   * Exercise ids are unique within a course, so one set serves all modules.
   */
  checkpointAnswered: ReadonlySet<string>
}

export type LessonStatus =
  "not_started" | "in_progress" | "completed" | "skipped"
export type CheckpointStatus = "locked" | "open" | "done"
export type CourseStatus = "ready" | "in_progress" | "complete"
export type RequestStatus = "requested" | "not_built" | "published"

/** What a session works on inside its course (§7.6). */
export type Target =
  | { kind: "lesson"; lessonId: string }
  | { kind: "checkpoint"; moduleId: string }

// --- Lessons ----------------------------------------------------------------

/**
 * *Completed* if `completed_at` is set; else *Skipped* if `skipped`; else
 * *In progress* if a row exists; else *Not started* (§7.3).
 */
export function lessonStatus(
  row: Pick<LessonProgress, "completedAt" | "skipped"> | undefined
): LessonStatus {
  if (!row) return "not_started"
  if (row.completedAt !== null) return "completed"
  return row.skipped ? "skipped" : "in_progress"
}

/** Every lesson id in syllabus order. */
export function syllabusLessons(course: Course): string[] {
  return course.modules.flatMap((m) => m.lessons)
}

/** "Lesson N": the 1-based position across the whole course (§7.6). */
export function lessonNumber(course: Course, lessonId: string): number {
  const i = syllabusLessons(course).indexOf(lessonId)
  if (i < 0) throw new Error(`Lesson ${lessonId} is not in ${course.id}`)
  return i + 1
}

/** "Checkpoint N": its module's 1-based position (§7.6). */
export function checkpointNumber(course: Course, moduleId: string): number {
  const i = course.modules.findIndex((m) => m.id === moduleId)
  if (i < 0) throw new Error(`Module ${moduleId} is not in ${course.id}`)
  return i + 1
}

export function moduleById(course: Course, moduleId: string): Module {
  const m = course.modules.find((m) => m.id === moduleId)
  if (!m) throw new Error(`Module ${moduleId} is not in ${course.id}`)
  return m
}

export function moduleOfLesson(course: Course, lessonId: string): Module {
  const m = course.modules.find((m) => m.lessons.includes(lessonId))
  if (!m) throw new Error(`Lesson ${lessonId} is not in ${course.id}`)
  return m
}

export function statusOf(cp: CourseProgress, lessonId: string): LessonStatus {
  return lessonStatus(cp.lessons.get(lessonId))
}

/** "k of n completed" counts (WF-A1, WF-C1). */
export function completedCount(cp: CourseProgress): {
  completed: number
  total: number
} {
  const ids = syllabusLessons(cp.course)
  return {
    completed: ids.filter((id) => statusOf(cp, id) === "completed").length,
    total: ids.length,
  }
}

/** Lessons skipped during `sessionId`: `skipped` and last touched there. */
export function skippedInSession(
  cp: CourseProgress,
  sessionId: string
): Set<string> {
  const ids = new Set<string>()
  for (const [id, row] of cp.lessons) {
    if (lessonStatus(row) === "skipped" && row.lastSessionId === sessionId) {
      ids.add(id)
    }
  }
  return ids
}

// --- Checkpoints ------------------------------------------------------------

/**
 * *Locked* until every lesson of the module is *Completed*, then *Open*;
 * *Done* once every checkpoint exercise has a non-retry attempt (§7.6).
 */
export function checkpointStatus(
  cp: CourseProgress,
  moduleId: string
): CheckpointStatus {
  const m = moduleById(cp.course, moduleId)
  if (m.lessons.some((id) => statusOf(cp, id) !== "completed")) return "locked"
  return m.checkpoint.every((id) => cp.checkpointAnswered.has(id))
    ? "done"
    : "open"
}

/** Lessons of the module that are not yet *Completed*, in syllabus order. */
export function unfinishedLessons(cp: CourseProgress, moduleId: string) {
  return moduleById(cp.course, moduleId).lessons.filter(
    (id) => statusOf(cp, id) !== "completed"
  )
}

export function firstOpenCheckpoint(cp: CourseProgress): Module | null {
  return (
    cp.course.modules.find((m) => checkpointStatus(cp, m.id) === "open") ?? null
  )
}

/**
 * The checkpoint queue a session gets when the checkpoint becomes its target:
 * the authored order minus the exercises already answered (§7.6).
 */
export function checkpointQueue(
  module: Pick<Module, "checkpoint">,
  answered: ReadonlySet<string>
): string[] {
  return module.checkpoint.filter((id) => !answered.has(id))
}

/** A checkpoint answer, as the score needs it. */
export interface CheckpointAttempt {
  exerciseId: string
  correct: boolean | null
  selfMark: SelfMark | null
  isRetry: boolean
  answeredAt: number
}

/**
 * The checkpoint score (WF-G2: "7 of 10 right"): first attempts that were
 * correct, counting a short answer as right when self-marked `full`, over the
 * number of exercises. Retries never count.
 */
export function checkpointScore(
  module: Pick<Module, "checkpoint">,
  attempts: readonly CheckpointAttempt[]
): { right: number; total: number } {
  const first = new Map<string, CheckpointAttempt>()
  for (const a of attempts) {
    if (a.isRetry || !module.checkpoint.includes(a.exerciseId)) continue
    const seen = first.get(a.exerciseId)
    if (!seen || a.answeredAt < seen.answeredAt) first.set(a.exerciseId, a)
  }
  let right = 0
  for (const a of first.values()) {
    if (a.correct === true || a.selfMark === "full") right++
  }
  return { right, total: module.checkpoint.length }
}

// --- Courses ----------------------------------------------------------------

/**
 * *Complete* when every lesson is *Completed* and every checkpoint *Done*;
 * *In progress* when any lesson has a row; *Ready* otherwise (§7.6).
 */
export function courseStatus(cp: CourseProgress): CourseStatus {
  const lessons = syllabusLessons(cp.course)
  if (
    lessons.every((id) => statusOf(cp, id) === "completed") &&
    cp.course.modules.every((m) => checkpointStatus(cp, m.id) === "done")
  ) {
    return "complete"
  }
  return lessons.some((id) => cp.lessons.has(id)) ? "in_progress" : "ready"
}

/**
 * A course's last-used time: the later of its latest
 * `lesson_progress.updated_at` and the `started_at` of its latest session
 * (§7.6). Null when neither exists.
 */
export function lastUsedAt(
  lessons: Iterable<Pick<LessonProgress, "updatedAt">>,
  sessionStartedAts: Iterable<number>
): number | null {
  let latest: number | null = null
  for (const r of lessons) latest = Math.max(latest ?? r.updatedAt, r.updatedAt)
  for (const t of sessionStartedAts) latest = Math.max(latest ?? t, t)
  return latest
}

export interface NextTargetOptions {
  /** Lessons skipped during the current session, never re-targeted (§7.6). */
  exclude?: ReadonlySet<string>
  /** `full_lesson` takes the next lesson by the same rule (R9). */
  lessonsOnly?: boolean
}

/**
 * A course's next target (§7.6, spec F8): its first *Open* checkpoint; else
 * the first lesson that is *Not started* or *In progress*; else the first
 * *Skipped* lesson; else none.
 */
export function nextTarget(
  cp: CourseProgress,
  opts: NextTargetOptions = {}
): Target | null {
  if (!opts.lessonsOnly) {
    const m = firstOpenCheckpoint(cp)
    if (m) return { kind: "checkpoint", moduleId: m.id }
  }
  const lessons = syllabusLessons(cp.course).filter(
    (id) => !opts.exclude?.has(id)
  )
  const active = lessons.find((id) => {
    const s = statusOf(cp, id)
    return s === "not_started" || s === "in_progress"
  })
  if (active) return { kind: "lesson", lessonId: active }
  const skipped = lessons.find((id) => statusOf(cp, id) === "skipped")
  return skipped ? { kind: "lesson", lessonId: skipped } : null
}

// --- Requests ---------------------------------------------------------------

/**
 * *Published* if a manifest entry has its `requestId`; *Not built* (with its
 * reason) if `not-built.json` lists it; *Requested* otherwise (§7.9).
 */
export function requestStatus(
  requestId: string,
  published: readonly Pick<PublishedEntry, "requestId">[],
  notBuilt: readonly Pick<NotBuiltEntry, "requestId" | "reason">[]
): { status: RequestStatus; reason?: string } {
  if (published.some((p) => p.requestId === requestId)) {
    return { status: "published" }
  }
  const nb = notBuilt.find((n) => n.requestId === requestId)
  return nb
    ? { status: "not_built", reason: nb.reason }
    : { status: "requested" }
}

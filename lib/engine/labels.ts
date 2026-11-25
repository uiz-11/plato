// On-screen strings derived from engine state (§7.3, §7.6–§7.8, §9.2–§9.4):
// target names, the session line, the summary line, status words and item
// labels. Kept here so Today, the course page and the player cannot disagree.

import type { Course, ExerciseType } from "@/lib/content/schema"

import { MASTERY_LABEL } from "./mastery"
import {
  checkpointNumber,
  checkpointStatus,
  lessonNumber,
  moduleById,
  syllabusLessons,
  unfinishedLessons,
  type CheckpointStatus,
  type CourseProgress,
  type CourseStatus,
  type LessonStatus,
  type Target,
} from "./status"
import type { LessonStep } from "./lesson"
import type { Confidence, Grade, LessonPosition } from "./types"

export { MASTERY_LABEL }

/** "1 review", "9 reviews". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/** "a", "a and b", "a, b and c". */
export function joinAnd(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("")
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export const STEP_LABEL: Record<LessonStep, string> = {
  warmup: "Warm up",
  guess: "Guess first",
  read: "Read",
  recall: "Recall",
  answers: "Add to your answers",
}

export const LESSON_STATUS_LABEL: Record<LessonStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  skipped: "Skipped",
}

export const CHECKPOINT_STATUS_LABEL: Record<CheckpointStatus, string> = {
  locked: "Locked",
  open: "Open",
  done: "Done",
}

export const COURSE_STATUS_LABEL: Record<CourseStatus, string> = {
  ready: "Ready",
  in_progress: "In progress",
  complete: "Complete",
}

/** A status dot's shape (§9.1): each status has its own, not just a shade (WF-J). */
export type DotShape = "full" | "half" | "empty" | "dashed" | "square"

export const LESSON_STATUS_DOT: Record<LessonStatus, DotShape> = {
  completed: "full",
  in_progress: "half",
  not_started: "empty",
  skipped: "dashed",
}

export const CHECKPOINT_STATUS_DOT: Record<CheckpointStatus, DotShape> = {
  done: "full",
  open: "empty",
  locked: "square",
}

export const EXERCISE_TYPE_LABEL: Record<ExerciseType, string> = {
  mc: "multiple choice",
  fill: "fill in the blank",
  spot: "spot the error",
  scenario: "scenario",
  short: "short answer",
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  sure: "Sure",
  not_sure: "Not sure",
  guess: "Guess",
}

export const GRADE_LABEL: Record<Grade, string> = {
  forgot: "Forgot",
  partly: "Partly",
  remembered: "Remembered",
}

/** The step a position names: Warm up, Guess first, Read, Recall, … */
export function stepLabel(position: LessonPosition): string | null {
  return position.step === "done" ? null : STEP_LABEL[position.step]
}

// --- Targets and the session line (§7.8) ------------------------------------

/**
 * A target in Today's format: "Lesson 4 from Recall" for a lesson with a
 * position (whether *In progress* or *Skipped*), "Lesson 5" for one with
 * none, or "Checkpoint 1".
 */
export function targetLabel(cp: CourseProgress, target: Target): string {
  if (target.kind === "checkpoint") {
    return `Checkpoint ${checkpointNumber(cp.course, target.moduleId)}`
  }
  const name = `Lesson ${lessonNumber(cp.course, target.lessonId)}`
  const position = cp.lessons.get(target.lessonId)?.position ?? null
  const step = position && stepLabel(position)
  return step ? `${name} from ${step}` : name
}

/** "9 reviews, then Lesson 4 from Recall" (WF-A1). */
export function sessionLine(reviews: number, target: string | null): string {
  if (target === null) return plural(reviews, "review")
  return reviews > 0 ? `${plural(reviews, "review")}, then ${target}` : target
}

// --- Course page (§7.6, §9.4) -----------------------------------------------

/**
 * The course page's main button (spec F3, R6): "Open Checkpoint N" when a
 * checkpoint is the target, "Start Lesson 1" when the course is *Ready*,
 * "Continue Lesson N" otherwise; none for a *Complete* course.
 */
export function mainButtonLabel(
  cp: CourseProgress,
  status: CourseStatus,
  target: Target | null
): string | null {
  if (status === "complete" || target === null) return null
  if (target.kind === "checkpoint") {
    return `Open Checkpoint ${checkpointNumber(cp.course, target.moduleId)}`
  }
  if (status === "ready") return "Start Lesson 1"
  return `Continue Lesson ${lessonNumber(cp.course, target.lessonId)}`
}

/** "k of n completed" (WF-A1, WF-C1). */
export const completedLabel = (k: number, n: number) => `${k} of ${n} completed`

/** A Syllabus row's status: "In progress · at Recall" names the step. */
export function syllabusLessonLabel(
  status: LessonStatus,
  position: LessonPosition | null
): string {
  const word = LESSON_STATUS_LABEL[status]
  const step = status === "in_progress" && position && stepLabel(position)
  return step ? `${word} · at ${step}` : word
}

/**
 * A checkpoint row: "Locked · complete Lesson N" when exactly one lesson of
 * the module is unfinished, else the status word.
 */
export function checkpointRowLabel(cp: CourseProgress, moduleId: string) {
  const status = checkpointStatus(cp, moduleId)
  if (status === "locked") {
    const left = unfinishedLessons(cp, moduleId)
    if (left.length === 1) {
      return `Locked · complete Lesson ${lessonNumber(cp.course, left[0])}`
    }
  }
  return CHECKPOINT_STATUS_LABEL[status]
}

/** "Lesson 3", or a run of consecutive numbers "Lessons 1–3". */
export function lessonRangeLabel(numbers: readonly number[]): string {
  const runs: number[][] = []
  for (const n of numbers) {
    const run = runs[runs.length - 1]
    if (run && n === run[run.length - 1] + 1) run.push(n)
    else runs.push([n])
  }
  const parts = runs.map((r) =>
    r.length === 1 ? String(r[0]) : `${r[0]}–${r[r.length - 1]}`
  )
  return `${numbers.length === 1 ? "Lesson" : "Lessons"} ${parts.join(", ")}`
}

/** The lessons a checkpoint covers: "Lessons 1–3" (WF-G1). */
export function moduleLessonsLabel(course: Course, moduleId: string): string {
  return lessonRangeLabel(
    moduleById(course, moduleId).lessons.map((id) => lessonNumber(course, id))
  )
}

// --- Player labels (§9.2, §9.3) ---------------------------------------------

/** The review block's title: "Reviews then Lesson 4", or "Reviews". */
export function reviewBlockTitle(course: Course | null, target: Target | null) {
  if (!course || !target) return "Reviews"
  return target.kind === "lesson"
    ? `Reviews then Lesson ${lessonNumber(course, target.lessonId)}`
    : `Reviews then Checkpoint ${checkpointNumber(course, target.moduleId)}`
}

/** "Review 4 of 9 · {course title}" (0-based `index`). */
export const reviewItemLabel = (index: number, total: number, title: string) =>
  `Review ${index + 1} of ${total} · ${title}`

/** "Lesson N · {lesson title}". */
export const lessonTitle = (course: Course, lessonId: string, title: string) =>
  `Lesson ${lessonNumber(course, lessonId)} · ${title}`

/** "Warm up 1 of 3 · from Lesson 2". */
export const warmupItemLabel = (
  index: number,
  total: number,
  sourceNumber: number
) => `Warm up ${index + 1} of ${total} · from Lesson ${sourceNumber}`

/** "Guess 1 of 2 · It's fine to be wrong". */
export const guessItemLabel = (index: number, total: number) =>
  `Guess ${index + 1} of ${total} · It's fine to be wrong`

/** "Exercise 1 of 3 · multiple choice". */
export const exerciseItemLabel = (
  index: number,
  total: number,
  type: ExerciseType
) => `Exercise ${index + 1} of ${total} · ${EXERCISE_TYPE_LABEL[type]}`

/**
 * A checkpoint item's label (§7.6): "4 of 10 · Lessons 1–3", counting answers
 * from every session; a retry reads "Retry · 5 of 10 · Lessons 1–3".
 * `answeredBefore` is the module's distinct exercises with a non-retry
 * attempt before this item.
 */
export function checkpointItemLabel(input: {
  answeredBefore: number
  total: number
  isRetry: boolean
  lessons: string
}): string {
  const k = input.isRetry ? input.answeredBefore : input.answeredBefore + 1
  const count = `${k} of ${input.total} · ${input.lessons}`
  return input.isRetry ? `Retry · ${count}` : count
}

/** The result line of an automatically marked answer (§9.3). */
export function resultLine(correct: boolean, confidence: Confidence): string {
  if (!correct) return `Not quite · you said ${CONFIDENCE_LABEL[confidence]}`
  switch (confidence) {
    case "sure":
      return "Right"
    case "not_sure":
      return "Right, but you weren't sure"
    case "guess":
      return "Right, but you guessed · Counts as not learned yet"
  }
}

/** Shown under a wrong *Sure*, whose exercise is re-queued (§7.2). */
export const REQUEUE_NOTE = "You'll see this again later this session"

/** A short answer's tick line: "2 of 3 · Partly recalled" (§9.3). */
export function shortAnswerTickLine(ticked: number, total: number): string {
  const word =
    ticked <= 0
      ? "Not recalled"
      : ticked >= total
        ? "Fully recalled"
        : "Partly recalled"
  return `${ticked} of ${total} · ${word}`
}

/** Recall tick button: "Practice what you missed (2)", or "Practice (2)". */
export function recallTickButton(missed: number, queueLength: number) {
  return missed > 0
    ? `Practice what you missed (${queueLength})`
    : `Practice (${queueLength})`
}

/** The toast after *Mark as skipped* in the Syllabus (WF-C1.4). */
export const lessonSkippedToast = (n: number) => `Lesson ${n} skipped`

/** "Lesson N complete" (WF-E7). */
export const lessonCompleteHeading = (n: number) => `Lesson ${n} complete`

/** "Module N mastery" and "7 of 10 right" (WF-G2). */
export const moduleMasteryHeading = (n: number) => `Module ${n} mastery`
export const scoreLabel = (right: number, total: number) =>
  `${right} of ${total} right`

/** WF-G3: "4 lessons · 2 checkpoints · reviews continue for all 14 concepts". */
export function courseCompleteLine(course: Course, conceptCount: number) {
  const lessons = syllabusLessons(course).length
  const checkpoints = course.modules.length
  return `${plural(lessons, "lesson")} · ${plural(checkpoints, "checkpoint")} · reviews continue for all ${plural(conceptCount, "concept")}`
}

/** "1 note", "3 notes" (WF-G3). */
export const notesLabel = (n: number) => plural(n, "note")

// --- Summary line (§7.7) ----------------------------------------------------

export interface SessionWork {
  reviews: number
  /** Lessons completed in the session, by id. */
  lessonsCompleted: readonly string[]
  /**
   * Lessons worked on (last touched in the session) but not completed. A
   * lesson skipped in the session is left out: skipping is not work.
   */
  lessonsPartial: readonly string[]
  /** Checkpoints the session answered in, with its distinct answers. */
  checkpoints: ReadonlyArray<{
    moduleId: string
    answered: number
    madeDone: boolean
  }>
}

/** Rows the summary is derived from. */
export interface SummaryInput {
  session: { id: string; startedAt: number; endedAt: number | null }
  /** The session's course after the session, or null without one. */
  cp: CourseProgress | null
  /** The session's attempts. */
  attempts: ReadonlyArray<{
    context: "recall" | "review" | "checkpoint"
    exerciseId: string | null
    isRetry: boolean
  }>
}

/** What a session did, from its rows (§7.7). */
export function sessionWork({
  session,
  cp,
  attempts,
}: SummaryInput): SessionWork {
  const reviews = attempts.filter(
    (a) => a.context === "review" && !a.isRetry
  ).length
  if (!cp) {
    return {
      reviews,
      lessonsCompleted: [],
      lessonsPartial: [],
      checkpoints: [],
    }
  }
  const end = session.endedAt ?? Infinity
  const lessonsCompleted: string[] = []
  const lessonsPartial: string[] = []
  for (const id of syllabusLessons(cp.course)) {
    const row = cp.lessons.get(id)
    if (!row) continue
    if (
      row.completedAt !== null &&
      row.completedAt >= session.startedAt &&
      row.completedAt <= end
    ) {
      lessonsCompleted.push(id)
    } else if (
      row.completedAt === null &&
      !row.skipped &&
      row.lastSessionId === session.id
    ) {
      lessonsPartial.push(id)
    }
  }
  const answered = new Set(
    attempts
      .filter((a) => a.context === "checkpoint" && !a.isRetry && a.exerciseId)
      .map((a) => a.exerciseId as string)
  )
  const checkpoints = cp.course.modules
    .map((m) => ({
      moduleId: m.id,
      answered: m.checkpoint.filter((id) => answered.has(id)).length,
    }))
    .filter((c) => c.answered > 0)
    .map((c) => ({
      ...c,
      madeDone: checkpointStatus(cp, c.moduleId) === "done",
    }))
  return { reviews, lessonsCompleted, lessonsPartial, checkpoints }
}

/**
 * The summary line (§7.7, WF-E8): "9 reviews and Lesson 4. Next time,
 * Lesson 5." or "Nothing recorded. Next time, just reviews." The work is in
 * syllabus order, and consecutive completed lessons collapse to a range.
 * `next` is the next target in Today's format, or null for "just reviews".
 */
export function summaryLine(
  course: Course | null,
  work: SessionWork,
  next: string | null
): string {
  const parts: string[] = []
  if (work.reviews > 0) parts.push(plural(work.reviews, "review"))
  if (course) parts.push(...workParts(course, work))
  const done =
    parts.length > 0 ? capitalize(joinAnd(parts)) : "Nothing recorded"
  return `${done}. Next time, ${next ?? "just reviews"}.`
}

function workParts(course: Course, work: SessionWork): string[] {
  type Item = { kind: "completed"; n: number } | { kind: "text"; text: string }
  const items: Item[] = []
  for (const m of course.modules) {
    for (const id of m.lessons) {
      const n = lessonNumber(course, id)
      if (work.lessonsCompleted.includes(id))
        items.push({ kind: "completed", n })
      else if (work.lessonsPartial.includes(id)) {
        items.push({ kind: "text", text: `part of Lesson ${n}` })
      }
    }
    const c = work.checkpoints.find((c) => c.moduleId === m.id)
    if (c) {
      const n = checkpointNumber(course, m.id)
      items.push({
        kind: "text",
        text: c.madeDone
          ? `Checkpoint ${n}`
          : `${plural(c.answered, "exercise")} of Checkpoint ${n}`,
      })
    }
  }
  const parts: string[] = []
  let run: number[] = []
  const flush = () => {
    if (run.length) parts.push(lessonRangeLabel(run))
    run = []
  }
  for (const item of items) {
    if (item.kind === "completed") {
      if (run.length && item.n !== run[run.length - 1] + 1) flush()
      run.push(item.n)
    } else {
      flush()
      parts.push(item.text)
    }
  }
  flush()
  return parts
}

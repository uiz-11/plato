// Lessons (§7.3, spec F4): positions, skipping, warm-up, Recall exercise
// selection, completion and the celebration line.

import type { Lesson } from "@/lib/content/schema"

import {
  RECALL_EXERCISES_MAX,
  RECALL_EXERCISES_MIN,
  WARMUP_PROMPTS,
} from "./constants"
import {
  lessonNumber,
  lessonStatus,
  moduleOfLesson,
  statusOf,
  syllabusLessons,
  type CourseProgress,
  type LessonProgress,
} from "./status"
import type { Day, LessonPosition } from "./types"

// --- Positions --------------------------------------------------------------

export type LessonStep = "warmup" | "guess" | "read" | "recall" | "answers"

/** Where a lesson starts: Warm up, or Guess first when it has no warm-up. */
export function firstLessonPosition(hasWarmup: boolean): LessonPosition {
  return hasWarmup ? { step: "warmup", index: 0 } : { step: "guess", index: 0 }
}

/** The counts that decide where each step ends. */
export interface LessonShape {
  warmupCount: number
  guessCount: number
  /** `recall_queue`'s length, once the ticks are submitted. */
  recallQueueLength: number
  keyQuestionCount: number
}

export function lessonShape(
  lesson: Pick<Lesson, "guesses" | "keyQuestions">,
  opts: { warmupCount: number; recallQueue: readonly string[] | null }
): LessonShape {
  return {
    warmupCount: opts.warmupCount,
    guessCount: lesson.guesses.length,
    recallQueueLength: opts.recallQueue?.length ?? 0,
    keyQuestionCount: lesson.keyQuestions.length,
  }
}

/** The lesson events (§8.4) that move a lesson position. */
export type LessonEvent =
  | { kind: "warmup-next" }
  | { kind: "guess-lock" }
  | { kind: "read-done" }
  | { kind: "recall-write" }
  | { kind: "recall-tick" }
  | { kind: "answer"; attemptId: string }
  | { kind: "answer-next" }
  | { kind: "note-stick" }
  | { kind: "answers-skip" }

export class PositionError extends Error {}

/**
 * The position after `event`. Throws a `PositionError` when the event does
 * not belong at `position`, so a confused client cannot skip steps.
 * Steps: Warm up → Guess first → Read → Recall (write, tick, exercises) →
 * Add to your answers → done.
 */
export function advanceLesson(
  position: LessonPosition,
  event: LessonEvent,
  shape: LessonShape
): LessonPosition {
  const wrong = () =>
    new PositionError(
      `${event.kind} does not apply at ${JSON.stringify(position)}`
    )
  switch (event.kind) {
    case "warmup-next":
      if (position.step !== "warmup") throw wrong()
      return position.index + 1 < shape.warmupCount
        ? { step: "warmup", index: position.index + 1 }
        : { step: "guess", index: 0 }
    case "guess-lock":
      if (position.step !== "guess") throw wrong()
      return position.index + 1 < shape.guessCount
        ? { step: "guess", index: position.index + 1 }
        : { step: "read" }
    case "read-done":
      if (position.step !== "read") throw wrong()
      return { step: "recall", phase: "write" }
    case "recall-write":
      if (position.step !== "recall" || position.phase !== "write") {
        throw wrong()
      }
      return { step: "recall", phase: "tick" }
    case "recall-tick":
      if (position.step !== "recall" || position.phase !== "tick") {
        throw wrong()
      }
      return { step: "recall", phase: "exercises", index: 0 }
    case "answer":
      if (
        position.step !== "recall" ||
        position.phase !== "exercises" ||
        position.answered !== undefined
      ) {
        throw wrong()
      }
      return { ...position, answered: event.attemptId }
    case "answer-next":
      if (
        position.step !== "recall" ||
        position.phase !== "exercises" ||
        position.answered === undefined
      ) {
        throw wrong()
      }
      return position.index + 1 < shape.recallQueueLength
        ? { step: "recall", phase: "exercises", index: position.index + 1 }
        : { step: "answers", index: 0 }
    case "note-stick":
      if (position.step !== "answers") throw wrong()
      return position.index + 1 < shape.keyQuestionCount
        ? { step: "answers", index: position.index + 1 }
        : { step: "done" }
    case "answers-skip":
      if (position.step !== "answers") throw wrong()
      return { step: "done" }
  }
}

/** The step a position is in; `null` at `done`. */
export function stepOf(position: LessonPosition): LessonStep | null {
  return position.step === "done" ? null : position.step
}

/** Structural equality, for the expected-position check (§8.4). */
export function samePosition<T>(a: T, b: T): boolean {
  return canonical(a) === canonical(b)
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null"
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`
  return `{${Object.keys(v)
    .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
    .sort()
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`
    )
    .join(",")}}`
}

// --- Skipping, undo, unskip, resume -----------------------------------------

export class LessonStateError extends Error {}

/**
 * *Mark as skipped* on any lesson that is not *Completed*, keeping its
 * position. A skip creates the row if there is none (position null). From the
 * player (`skip-lesson`), `sessionId` sets `last_session_id`. From the
 * Syllabus (no `sessionId`) it is kept, so Undo or *Unskip* leaves the lesson
 * exactly as it was. A Syllabus skip while the lesson's session is still open
 * therefore counts as skipped during that session, and that session does not
 * re-target it (§7.6).
 */
export function skipLesson(
  row: LessonProgress | undefined,
  lessonId: string,
  opts: { now: number; sessionId?: string }
): LessonProgress {
  if (lessonStatus(row) === "completed") {
    throw new LessonStateError(`Lesson ${lessonId} is completed`)
  }
  const base = row ?? emptyRow(lessonId, opts.now)
  return {
    ...base,
    skipped: true,
    lastSessionId: opts.sessionId ?? base.lastSessionId,
    updatedAt: opts.now,
  }
}

/**
 * Undo (the toast) and *Unskip* (the Syllabus) clear `skipped`. A row the
 * skip created (position null) is deleted instead, so a course whose only
 * change was that skip returns to *Ready*. Returns null for "delete".
 */
export function unskipLesson(
  row: LessonProgress | undefined,
  now: number
): LessonProgress | null {
  if (!row || lessonStatus(row) !== "skipped") {
    throw new LessonStateError(`Lesson ${row?.lessonId ?? ""} is not skipped`)
  }
  if (row.position === null) return null
  return { ...row, skipped: false, updatedAt: now }
}

export interface EnteredLesson {
  row: LessonProgress
  /** "Picking up where you stopped" (WF-E4.1). */
  pickingUp: boolean
}

/**
 * A lesson unit loads in a session: the row is created at the first position
 * if needed, a *Skipped* lesson resumes from its position (`skipped` cleared),
 * and `last_session_id` is set. "Picking up where you stopped" shows when the
 * lesson has a position from an earlier session.
 *
 * A *Completed* lesson only loads for its closing screen (position `done`,
 * WF-E7), which changes nothing, so its row is returned as it is.
 */
export function enterLesson(
  row: LessonProgress | undefined,
  lessonId: string,
  opts: { now: number; sessionId: string; hasWarmup: boolean }
): EnteredLesson {
  if (row && lessonStatus(row) === "completed") {
    return { row, pickingUp: false }
  }
  const base = row ?? emptyRow(lessonId, opts.now)
  const pickingUp =
    base.position !== null && base.lastSessionId !== opts.sessionId
  const unchanged =
    row !== undefined &&
    !row.skipped &&
    row.position !== null &&
    row.lastSessionId === opts.sessionId
  if (unchanged) return { row, pickingUp: false }
  return {
    row: {
      ...base,
      skipped: false,
      position: base.position ?? firstLessonPosition(opts.hasWarmup),
      lastSessionId: opts.sessionId,
      updatedAt: opts.now,
    },
    pickingUp,
  }
}

function emptyRow(lessonId: string, now: number): LessonProgress {
  return {
    lessonId,
    skipped: false,
    position: null,
    recallText: null,
    recallTicked: null,
    recallQueue: null,
    lastSessionId: null,
    completedAt: null,
    completedDay: null,
    updatedAt: now,
  }
}

// --- Warm up ----------------------------------------------------------------

/**
 * The warm-up's source: the other lesson in this course with the latest
 * `completed_at`, ties going to the later lesson in syllabus order. Null when
 * no other lesson is *Completed*, and then the lesson has no warm-up.
 */
export function warmupSource(
  cp: CourseProgress,
  lessonId: string
): string | null {
  let best: { id: string; at: number } | null = null
  for (const id of syllabusLessons(cp.course)) {
    if (id === lessonId) continue
    const at = cp.lessons.get(id)?.completedAt ?? null
    if (at === null) continue
    // `>=` lets a later lesson in syllabus order win a tie.
    if (!best || at >= best.at) best = { id, at }
  }
  return best?.id ?? null
}

/** A warm-up prompt: a concept's first recall prompt. */
export interface WarmupPrompt {
  conceptId: string
  promptIndex: 0
}

/**
 * The source lesson's first three concepts in authored order, each with its
 * first recall prompt. Warm-ups change nothing in the schedule.
 */
export function warmupPrompts(
  source: Pick<Lesson, "concepts">
): WarmupPrompt[] {
  return source.concepts
    .slice(0, WARMUP_PROMPTS)
    .map((c) => ({ conceptId: c.id, promptIndex: 0 }))
}

// --- Recall exercises -------------------------------------------------------

/**
 * The Recall exercise queue, fixed when the ticks are submitted (§7.3, R13).
 * `n = clamp(missed, 2, 3)`. Candidates are the lesson's `recall` exercises
 * in authored order: first one per missed concept in concept order, then
 * unused ones on missed concepts, then unused ones on any concept. With
 * nothing missed, the first two candidates.
 */
export function selectRecallExercises(
  lesson: Pick<Lesson, "concepts" | "exercises">,
  ticked: readonly string[]
): string[] {
  const candidates = lesson.exercises.filter((e) => e.pool === "recall")
  const missed = lesson.concepts
    .map((c) => c.id)
    .filter((id) => !ticked.includes(id))
  const n = Math.min(
    RECALL_EXERCISES_MAX,
    Math.max(RECALL_EXERCISES_MIN, missed.length)
  )
  if (missed.length === 0) return candidates.slice(0, n).map((e) => e.id)

  const chosen: string[] = []
  const take = (id: string) => {
    if (chosen.length < n && !chosen.includes(id)) chosen.push(id)
  }
  for (const c of missed) {
    const first = candidates.find((e) => e.concepts.includes(c))
    if (first) take(first.id)
  }
  for (const e of candidates) {
    if (e.concepts.some((c) => missed.includes(c))) take(e.id)
  }
  for (const e of candidates) take(e.id)
  return chosen
}

// --- Completion -------------------------------------------------------------

/**
 * Step 5 finished or skipped (R1): position `done` and `completed_at`. The
 * caller creates the concept schedules in the same transaction (§7.4).
 */
export function completeLesson(
  row: LessonProgress,
  opts: { now: number; day: Day }
): LessonProgress {
  if (lessonStatus(row) === "completed") {
    throw new LessonStateError(`Lesson ${row.lessonId} is already completed`)
  }
  return {
    ...row,
    skipped: false,
    position: { step: "done" },
    completedAt: opts.now,
    completedDay: opts.day,
    updatedAt: opts.now,
  }
}

/**
 * The celebration line (spec F4, WF-E7.1), from the course's state after the
 * completion. With *M* the next lesson in syllabus order:
 * - every lesson of the module now *Completed*: "Checkpoint N is open.";
 * - otherwise, on any lesson but the course's last: the hook, prefixed with
 *   "Next, Lesson M:" when *M* is not *Completed*;
 * - otherwise none.
 */
export function celebrationLine(
  cp: CourseProgress,
  lesson: Pick<Lesson, "id" | "hook">
): string | null {
  const { course } = cp
  const mod = moduleOfLesson(course, lesson.id)
  if (mod.lessons.every((id) => statusOf(cp, id) === "completed")) {
    const n = course.modules.indexOf(mod) + 1
    return `Checkpoint ${n} is open.`
  }
  const order = syllabusLessons(course)
  const next = order[order.indexOf(lesson.id) + 1]
  if (next === undefined || !lesson.hook) return null
  return statusOf(cp, next) === "completed"
    ? lesson.hook.text
    : `Next, Lesson ${lessonNumber(course, next)}: ${lesson.hook.text}`
}

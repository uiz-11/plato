// The player's shared rules (§8.4): event shapes, how a review answer is
// marked and re-queued, the review block's local moves, the timer, and
// whether a session made its course *Complete*. The client runs these for
// instant feedback; the server runs them again when it records the event.

import type { Exercise, Lesson } from "@/lib/content/schema"

import { reviewKey, type ReviewQueueItem } from "./session"
import {
  gradeAnswer,
  gradeRecallPrompt,
  isRetryAt,
  isWrongSure,
  requeueWrongSure,
  type ExerciseResponse,
  type MarkedAnswer,
} from "./marking"
import type { SessionWork } from "./labels"
import type {
  Confidence,
  Grade,
  LessonPosition,
  SessionKind,
  SessionPosition,
} from "./types"

// --- Events -----------------------------------------------------------------

/** What the learner gave for one item. */
export type ItemAnswer =
  /** A recall prompt, self-rated (WF-D1). */
  | { kind: "rating"; grade: Grade }
  /** An exercise; automatically marked types carry a confidence. */
  | {
      kind: "exercise"
      response: ExerciseResponse
      confidence: Confidence | null
    }

/** The events the player sends (§8.4), with what each carries. */
export type PlayerEvent =
  | { kind: "warmup-next" }
  | { kind: "guess-lock"; optionId: string }
  | { kind: "read-done" }
  | { kind: "answer"; answer: ItemAnswer }
  | { kind: "answer-next" }
  | { kind: "recall-write"; text: string }
  | { kind: "recall-tick"; ticked: string[] }
  | { kind: "note-stick"; text: string }
  | { kind: "answers-skip" }
  | { kind: "skip-lesson" }
  /** The client's budget check failed before a checkpoint exercise (§7.7). */
  | { kind: "budget-end" }
  | { kind: "continue" }

/** Where the client was when it sent an event (§8.4). */
export interface ExpectedPosition {
  session: SessionPosition
  /** The lesson position inside a lesson unit, otherwise null. */
  lesson: LessonPosition | null
}

/** One event as sent: its id, the expected position and the active time. */
export interface PlayerEnvelope {
  /** Client-generated UUID; also the attempt id of an answer. */
  id: string
  expected: ExpectedPosition
  /** The session's active time so far, in ms (§7.7). */
  activeMs: number
  event: PlayerEvent
}

/** What `recordEvent` and `finishUnit` answer. */
export type EventResult =
  | { ok: true }
  /**
   * The expected position did not match (a second tab, a session closed
   * elsewhere): the event was ignored and the client reloads the true state.
   */
  | { ok: false; stale: true }
  /**
   * The server could not apply the event and never will: a malformed event,
   * or one that does not fit the session (§8.3 typed errors). Retrying cannot
   * help, so the client drops what is queued and reloads the true state.
   */
  | { ok: false; refused: true }

// --- Review items -----------------------------------------------------------

/**
 * Marks one review item. A recall prompt takes a rating; an exercise is marked
 * from content with the same functions the server uses (§7.2).
 */
export function markReviewItem(
  item: Pick<ReviewQueueItem, "version">,
  lesson: Pick<Lesson, "exercises">,
  answer: ItemAnswer
): MarkedAnswer {
  if (item.version.kind === "prompt") {
    if (answer.kind !== "rating")
      throw new Error("A recall prompt is answered with a rating")
    return gradeRecallPrompt(answer.grade)
  }
  if (answer.kind !== "exercise")
    throw new Error("An exercise is answered with a response")
  const { exerciseId } = item.version
  const exercise = lesson.exercises.find((e) => e.id === exerciseId)
  if (!exercise) throw new Error(`No exercise ${exerciseId}`)
  return markExerciseItem(exercise as Exercise, answer)
}

/**
 * Marks an exercise answer from content (§7.2): the same function on the
 * client, for instant feedback, and on the server, which stores its result.
 */
export function markExerciseItem(
  exercise: Exercise,
  answer: ItemAnswer
): MarkedAnswer {
  if (answer.kind !== "exercise")
    throw new Error("An exercise is answered with a response")
  return gradeAnswer(exercise, answer.response, answer.confidence)
}

/** Whether the review at `index` is a wrong *Sure*'s retry. */
export const isReviewRetry = (
  queue: readonly ReviewQueueItem[],
  index: number
) => isRetryAt(queue, index, reviewKey)

/**
 * The review queue after an answer: grown by the retry after a wrong *Sure*
 * (§7.2), or null when it is unchanged.
 */
export function reviewQueueAfter(
  queue: readonly ReviewQueueItem[],
  index: number,
  marked: MarkedAnswer
): ReviewQueueItem[] | null {
  return isWrongSure(marked) ? requeueWrongSure(queue, index, reviewKey) : null
}

/** A Recall exercise's retry key in `recall_queue`: the exercise id. */
const recallKey = (id: string) => id

/** Whether the Recall exercise at `index` is a wrong *Sure*'s retry. */
export const isRecallRetry = (queue: readonly string[], index: number) =>
  isRetryAt(queue, index, recallKey)

/**
 * `recall_queue` after an answer: grown by the retry after a wrong *Sure*
 * (§7.2), or null when it is unchanged.
 */
export function recallQueueAfter(
  queue: readonly string[],
  index: number,
  marked: MarkedAnswer
): string[] | null {
  return isWrongSure(marked) ? requeueWrongSure(queue, index, recallKey) : null
}

/** A checkpoint exercise's retry key in `checkpoint_queue`: the exercise id. */
const checkpointKey = (id: string) => id

/** Whether the checkpoint exercise at `index` is a wrong *Sure*'s retry. */
export const isCheckpointRetry = (queue: readonly string[], index: number) =>
  isRetryAt(queue, index, checkpointKey)

/**
 * `checkpoint_queue` after an answer: grown by the retry after a wrong *Sure*
 * (§7.2), or null when it is unchanged. The label's total does not grow.
 */
export function checkpointQueueAfter(
  queue: readonly string[],
  index: number,
  marked: MarkedAnswer
): string[] | null {
  return isWrongSure(marked)
    ? requeueWrongSure(queue, index, checkpointKey)
    : null
}

/**
 * The module's exercises answered before the checkpoint item at `index`, for
 * its label (§7.6): those answered before the queue was set (the queue is
 * authored order minus them), plus the queue's distinct exercises before it.
 */
export function checkpointAnsweredBefore(
  queue: readonly string[],
  index: number,
  total: number
): number {
  return total - new Set(queue).size + new Set(queue.slice(0, index)).size
}

/**
 * Whether an answered item's feedback says "You'll see this again later this
 * session": a wrong *Sure* on an item that is not itself the retry, so its
 * retry is in the queue. Holds on a reload too, from the grown queue.
 */
export function showsRequeueNote<T>(
  queue: readonly T[],
  index: number,
  key: (item: T) => string,
  marked: Pick<MarkedAnswer, "correct" | "confidence">
): boolean {
  return (
    marked.correct === false &&
    marked.confidence === "sure" &&
    !isRetryAt(queue, index, key) &&
    queue.filter((item) => key(item) === key(queue[index])).length > 1
  )
}

/** The review block's position after `answer-next`; null at its last item. */
export function nextReviewPosition(
  index: number,
  queueLength: number
): SessionPosition | null {
  return index + 1 < queueLength ? { unit: "reviews", index: index + 1 } : null
}

// --- Timer (§8.4) -----------------------------------------------------------

/**
 * The frame's timer: time left, counting down from `minutes × 60 − active`,
 * or elapsed time for `full_lesson`. In whole minutes: "13 min left", "12 min".
 * Reaching zero does nothing by itself (§7.7).
 */
export function timerLabel(
  kind: SessionKind,
  minutes: number,
  activeMs: number
): string {
  if (kind === "full_lesson") return `${Math.floor(activeMs / 60_000)} min`
  const left = Math.max(0, Math.ceil((minutes * 60_000 - activeMs) / 60_000))
  return `${left} min left`
}

/** The session-complete frame's "minutes used" (§9.2): "15 min". */
export const minutesUsedLabel = (activeMs: number) =>
  `${Math.round(activeMs / 60_000)} min`

// --- Ending -----------------------------------------------------------------

/**
 * Whether the session made its course *Complete* (§7.7 Ending): the course is
 * *Complete* now and the session completed a lesson or answered in a
 * checkpoint. A course that was *Complete* before the session can do neither,
 * since a completed lesson cannot be completed again and a *Done* checkpoint
 * is never a target.
 */
export function madeCourseComplete(
  complete: boolean,
  work: Pick<SessionWork, "lessonsCompleted" | "checkpoints">
): boolean {
  return (
    complete &&
    (work.lessonsCompleted.length > 0 || work.checkpoints.length > 0)
  )
}

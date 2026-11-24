// Marking, grades, explanations and the wrong-Sure re-queue (§7.2, spec F5).
// The player calls these for instant feedback; the server calls them again
// from content and stores its own result.

import { normalizeAnswer } from "@/lib/content/normalize"
import type { Exercise } from "@/lib/content/schema"

import { REQUEUE_OFFSET } from "./constants"
import type { Confidence, Grade, SelfMark } from "./types"

/** What the learner submitted, by exercise type. */
export type ExerciseResponse =
  | { type: "mc"; optionId: string }
  | { type: "scenario"; optionId: string }
  | { type: "fill"; text: string }
  | { type: "spot"; sentenceId: string; fixId: string }
  /** `ticked` holds indexes into the exercise's checklist. */
  | { type: "short"; text: string; ticked: number[] }

/** An automatically marked answer, or a self-marked short answer. */
export type Marked =
  { kind: "auto"; correct: boolean } | { kind: "self"; selfMark: SelfMark }

/** Every checklist point ticked → `full`, some → `partial`, none → `none`. */
export function selfMarkFromTicks(ticked: number, total: number): SelfMark {
  if (ticked <= 0) return "none"
  return ticked >= total ? "full" : "partial"
}

/** Whether a fill-in answer may be submitted: it must not normalize to "". */
export function canSubmitFill(input: string): boolean {
  return normalizeAnswer(input) !== ""
}

export function markExercise(
  exercise: Exercise,
  response: ExerciseResponse
): Marked {
  if (response.type !== exercise.type) {
    throw new Error(
      `A ${response.type} response for ${exercise.type} exercise ${exercise.id}`
    )
  }
  switch (exercise.type) {
    case "mc":
    case "scenario": {
      const r = response as { optionId: string }
      return { kind: "auto", correct: r.optionId === exercise.correct }
    }
    case "fill": {
      const input = normalizeAnswer((response as { text: string }).text)
      return {
        kind: "auto",
        correct:
          input !== "" &&
          exercise.accepted.some((a) => normalizeAnswer(a) === input),
      }
    }
    case "spot": {
      const r = response as { sentenceId: string; fixId: string }
      return {
        kind: "auto",
        correct:
          r.sentenceId === exercise.faulty && r.fixId === exercise.correctFix,
      }
    }
    case "short": {
      const ticked = new Set(
        (response as { ticked: number[] }).ticked.filter(
          (i) => Number.isInteger(i) && i >= 0 && i < exercise.checklist.length
        )
      )
      return {
        kind: "self",
        selfMark: selfMarkFromTicks(ticked.size, exercise.checklist.length),
      }
    }
  }
}

/**
 * The grade of an automatically marked answer. A correct *Guess* counts as
 * not yet learned (spec F5); a correct *Not sure* is `partly` (R4).
 */
export function gradeFromConfidence(
  correct: boolean,
  confidence: Confidence
): Grade {
  if (!correct) return "forgot"
  if (confidence === "sure") return "remembered"
  return confidence === "not_sure" ? "partly" : "forgot"
}

const SELF_MARK_GRADE: Record<SelfMark, Grade> = {
  full: "remembered",
  partial: "partly",
  none: "forgot",
}

export function gradeFromSelfMark(mark: SelfMark): Grade {
  return SELF_MARK_GRADE[mark]
}

/** The `attempt` columns an exercise answer fills (§6). */
export interface MarkedAnswer {
  correct: boolean | null
  confidence: Confidence | null
  selfMark: SelfMark | null
  grade: Grade
}

/**
 * Marks and grades one exercise answer. Automatically marked types need the
 * confidence the learner submitted with; short answers ignore it.
 */
export function gradeAnswer(
  exercise: Exercise,
  response: ExerciseResponse,
  confidence: Confidence | null
): MarkedAnswer {
  const marked = markExercise(exercise, response)
  if (marked.kind === "self") {
    return {
      correct: null,
      confidence: null,
      selfMark: marked.selfMark,
      grade: gradeFromSelfMark(marked.selfMark),
    }
  }
  if (!confidence) {
    throw new Error(`Exercise ${exercise.id} needs a confidence`)
  }
  return {
    correct: marked.correct,
    confidence,
    selfMark: null,
    grade: gradeFromConfidence(marked.correct, confidence),
  }
}

/** A recall prompt is self-rated: the rating is the grade (§7.2). */
export function gradeRecallPrompt(rating: Grade): MarkedAnswer {
  return { correct: null, confidence: null, selfMark: null, grade: rating }
}

/**
 * Whether the explanation opens by itself (spec F5, WF-F3.1): always, except
 * after a correct *Sure*, when it is one click away behind "Why?". Short
 * answers always open it.
 */
export function explanationOpens(answer: MarkedAnswer): boolean {
  return !(answer.correct === true && answer.confidence === "sure")
}

/** A wrong *Sure* comes back later in the same session (spec F5). */
export function isWrongSure(answer: MarkedAnswer): boolean {
  return answer.correct === false && answer.confidence === "sure"
}

/**
 * Whether the item at `index` is a retry: the same key appears earlier in the
 * queue. Retries are stored with `is_retry` and never touch the schedule,
 * mastery or the checkpoint score.
 */
export function isRetryAt<T>(
  queue: readonly T[],
  index: number,
  key: (item: T) => string
): boolean {
  checkIndex(queue, index)
  const k = key(queue[index])
  return queue.slice(0, index).some((item) => key(item) === k)
}

function checkIndex(queue: readonly unknown[], index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) {
    throw new RangeError(`No item at ${index} in a queue of ${queue.length}`)
  }
}

/**
 * Re-queues the item at `index` after a wrong *Sure* (§7.2): inserted three
 * items later, or at the block's end if fewer remain, at most once per
 * exercise per session. Returns the grown queue, or `null` when the item was
 * already re-queued (or is itself the retry). In the review block and Recall
 * exercises the total grows by one: it is the new queue's length. In a
 * checkpoint it stays the number of exercises, and the retry is labelled
 * "Retry · 5 of 10" (§7.6).
 */
export function requeueWrongSure<T>(
  queue: readonly T[],
  index: number,
  key: (item: T) => string
): T[] | null {
  checkIndex(queue, index)
  const k = key(queue[index])
  if (queue.filter((item) => key(item) === k).length > 1) return null
  const at = Math.min(index + REQUEUE_OFFSET, queue.length)
  return [...queue.slice(0, at), queue[index], ...queue.slice(at)]
}

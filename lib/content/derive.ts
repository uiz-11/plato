// Values derived from content alone, never authored (§5.2): reading time,
// lesson and course length, lesson count and citation numbers.

import {
  EST,
  READ_WORDS_PER_MINUTE,
  RECALL_EXERCISES_MAX,
  WARMUP_PROMPTS,
} from "@/lib/engine/constants"

import type { Course, Lesson } from "./schema"

/**
 * Words a reader reads in a brief. Directive syntax is not prose: leaf and
 * container directive lines (`::anchor{#a}`, `:::analogy{#x}`, `:::`) and
 * `:cite[…]` count nothing, and a text directive such as `:uncertain[…]`
 * counts only its content, which may hold one level of brackets (a link).
 * Code-fence lines and `{…}` attributes after a directive count nothing.
 * Only the closed directive set (§5.3) is recognized. Markdown punctuation is
 * ignored; any token with a letter or digit is a word.
 */
export function briefWordCount(markdown: string): number {
  const text = markdown
    .split("\n")
    .filter((line) => !LEAF_OR_CONTAINER.test(line) && !FENCE.test(line))
    .join("\n")
    .replace(CITE, " ")
    .replace(LABEL, " $1 ")
  return text.split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length
}

const LEAF_OR_CONTAINER =
  /^\s*(::(anchor|guess|misconception|figure)\{.*\}|:::(analogy\{.*\})?)\s*$/
const BRACKETED = String.raw`\[((?:[^\[\]]|\[[^\[\]]*\])*)\]`
const ATTRS = String.raw`(?:\{[^}]*\})?`
const CITE = new RegExp(String.raw`:cite${BRACKETED}${ATTRS}`, "g")
const LABEL = new RegExp(
  `:(?:uncertain|general|contested)${BRACKETED}${ATTRS}`,
  "g"
)
/** A code fence's opening or closing line, with its info string. */
const FENCE = /^\s*(`{3,}|~{3,})/

/** "~7 min read" (WF-E3): words ÷ 220, rounded up, at least 1. */
export function readMinutes(markdown: string): number {
  return Math.max(
    1,
    Math.ceil(briefWordCount(markdown) / READ_WORDS_PER_MINUTE)
  )
}

/**
 * A lesson's estimate in seconds (§7.7): warm-up (when it has one), Guess
 * first, Read, Recall with the most Recall exercises, and one Add-to-your-
 * answers board per key question.
 */
export function lessonEstimateSeconds(
  lesson: Lesson,
  readMin: number,
  opts: { warmup: boolean }
): number {
  return (
    (opts.warmup ? WARMUP_PROMPTS * EST.warmupPrompt : 0) +
    lesson.guesses.length * EST.guess +
    readMin * 60 +
    EST.recallWrite +
    EST.recallTick +
    RECALL_EXERCISES_MAX * EST.recallExercise +
    lesson.keyQuestions.length * EST.answersBoard
  )
}

export function checkpointEstimateSeconds(module: Course["modules"][number]) {
  return module.checkpoint.length * EST.checkpointExercise
}

/**
 * The course length in seconds: every lesson and checkpoint estimate. The
 * first lesson has no warm-up, since no other lesson is completed yet.
 */
export function courseLengthSeconds(
  course: Course,
  lessons: ReadonlyArray<{ lesson: Lesson; readMinutes: number }>
): number {
  const lessonSeconds = lessons.reduce(
    (sum, l, i) =>
      sum + lessonEstimateSeconds(l.lesson, l.readMinutes, { warmup: i > 0 }),
    0
  )
  const checkpointSeconds = course.modules.reduce(
    (sum, m) => sum + checkpointEstimateSeconds(m),
    0
  )
  return lessonSeconds + checkpointSeconds
}

/**
 * "~40 min" under an hour, otherwise hours to the nearest half hour: "~1 hr",
 * "~4.5 hrs" (§5.2).
 */
export function formatCourseLength(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60))
  if (minutes < 60) return `~${minutes} min`
  const hours = Math.round(minutes / 30) / 2
  return `~${hours} ${hours === 1 ? "hr" : "hrs"}`
}

/** "12 lessons", counted from the modules. */
export function lessonCount(course: Course): number {
  return course.modules.reduce((n, m) => n + m.lessons.length, 0)
}

/**
 * Citation numbers: each source's 1-based position in the course's source
 * list (§9.4). Chips, the Sources tab and its `#s<n>` anchors all use it.
 */
export function sourceNumbers(course: Course): ReadonlyMap<string, number> {
  return new Map(course.sources.map((s, i) => [s.id, i + 1]))
}

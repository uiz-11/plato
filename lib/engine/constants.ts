// Learning-engine constants (§7). All tunable numbers live in this file.

/**
 * Time estimates in seconds (§7.7), used only for session sizing, the soft
 * budget and course length. Reading time is per lesson: `readMinutes * 60`.
 */
export const EST = {
  review: 30,
  warmupPrompt: 40,
  guess: 30,
  recallWrite: 90,
  recallTick: 30,
  recallExercise: 45,
  answersBoard: 45,
  checkpointExercise: 45,
} as const

/** Brief reading speed: words per minute, rounded up (§5.2). */
export const READ_WORDS_PER_MINUTE = 220

/** Warm-up prompts: the source lesson's first three concepts (§7.3). */
export const WARMUP_PROMPTS = 3

/** Recall exercises per lesson: `clamp(missed, 2, 3)` (§7.3). */
export const RECALL_EXERCISES_MIN = 2
export const RECALL_EXERCISES_MAX = 3

/** The learning day starts at 04:00 local time (§7.1, R7). */
export const DAY_START_HOUR = 4

/** `PLATO_TIME_ZONE` when unset (§7.1). */
export const DEFAULT_TIME_ZONE = "UTC"

/** Days since the last shown-up day that make a break (§7.4, WF-A2). */
export const BREAK_DAYS = 14

/** Scheduling (§7.4, D5). */
export const EASE_START = 2.5
export const EASE_MIN = 1.3
export const EASE_MAX = 2.8
export const MAX_INTERVAL_DAYS = 180

/** At most this many review items a day across all courses (§7.4, R10). */
export const DAILY_CAP = 30

/** A wrong *Sure* comes back this many items later in its block (§7.2). */
export const REQUEUE_OFFSET = 3

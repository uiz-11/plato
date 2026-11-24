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

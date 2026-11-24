import "server-only"

import { testHooksEnabled } from "./test-hooks"

export const DAY_MS = 24 * 60 * 60 * 1000

// Kept on globalThis so every route bundle in the process sees the same offset.
const g = globalThis as { __platoClockOffsetMs?: number }

/**
 * The current time in epoch milliseconds. All server code reads time here and
 * passes it to the engine (§1). With test hooks on, a test can shift it.
 */
export function now(): number {
  return Date.now() + (testHooksEnabled() ? (g.__platoClockOffsetMs ?? 0) : 0)
}

/** Sets the test offset, in days from the real clock (`POST /api/test/clock`). */
export function setClockOffsetDays(days: number): void {
  if (!testHooksEnabled()) throw new Error("Test hooks are off")
  g.__platoClockOffsetMs = days * DAY_MS
}

export function clockOffsetDays(): number {
  return (g.__platoClockOffsetMs ?? 0) / DAY_MS
}

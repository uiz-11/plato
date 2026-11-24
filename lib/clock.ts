import "server-only"

import { DEFAULT_TIME_ZONE } from "./engine/constants"
import { isValidTimeZone, learningDay } from "./engine/day"
import type { Day } from "./engine/types"
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

/** `PLATO_TIME_ZONE`, an IANA name, defaulting to UTC (§7.1). */
export function timeZone(
  env: Record<string, string | undefined> = process.env
): string {
  const tz = env.PLATO_TIME_ZONE || DEFAULT_TIME_ZONE
  if (!isValidTimeZone(tz))
    throw new Error(`PLATO_TIME_ZONE is not a known time zone: "${tz}"`)
  return tz
}

/** The learning day that contains `at` (default `now()`), in `PLATO_TIME_ZONE`. */
export function today(at: number = now()): Day {
  return learningDay(at, timeZone())
}

/**
 * Start-up check (instrumentation.ts): an unknown `PLATO_TIME_ZONE` would
 * otherwise fail every request, so the server refuses to start.
 */
export function checkTimeZoneOrExit(): void {
  try {
    timeZone()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

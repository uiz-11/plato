// Learning days and showing up (§7.1, R7). Days are `YYYY-MM-DD` strings, so
// they compare in order as plain strings.

import { BREAK_DAYS, DAY_START_HOUR, DEFAULT_TIME_ZONE } from "./constants"
import type { Day, PlayerEventKind } from "./types"

const DAY_MS = 24 * 60 * 60 * 1000
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const formatters = new Map<string, Intl.DateTimeFormat>()

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone)
  if (!f) {
    // Throws a RangeError for an unknown time zone.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
    formatters.set(timeZone, f)
  }
  return f
}

/** Whether `timeZone` is an IANA name this runtime knows. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatter(timeZone)
    return true
  } catch {
    return false
  }
}

/**
 * The learning day that contains `nowMs`: the local date in `timeZone`, with
 * the day starting at 04:00, so 01:00 belongs to the previous day.
 */
export function learningDay(
  nowMs: number,
  timeZone: string = DEFAULT_TIME_ZONE
): Day {
  const parts: Record<string, string> = {}
  for (const p of formatter(timeZone).formatToParts(nowMs)) {
    parts[p.type] = p.value
  }
  const date: Day = `${parts.year}-${parts.month}-${parts.day}`
  return Number(parts.hour) < DAY_START_HOUR ? addDays(date, -1) : date
}

/** Parses a day, rejecting impossible dates such as `2026-02-31`. */
function toUtcMs(day: Day): number {
  const m = DAY_RE.exec(day)
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
    const ms = Date.UTC(y, mo - 1, d)
    const date = new Date(ms)
    if (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === mo - 1 &&
      date.getUTCDate() === d
    ) {
      return ms
    }
  }
  throw new Error(`Not a day: ${JSON.stringify(day)}`)
}

/** `day` moved by `n` calendar days (negative moves back). */
export function addDays(day: Day, n: number): Day {
  return new Date(toUtcMs(day) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Calendar days from `from` to `to`: positive when `to` is later. */
export function daysBetween(from: Day, to: Day): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS)
}

export function minDay(a: Day, b: Day): Day {
  return a <= b ? a : b
}

/**
 * Whether an event counts as showing up (§7.1): every player event except
 * `continue` and `budget-end`, and a skip from the Syllabus. Opening the app
 * and editing notes on the Answers tab do not count.
 */
export function isProgressEvent(
  kind: PlayerEventKind | "syllabus-skip"
): boolean {
  return kind !== "continue" && kind !== "budget-end"
}

/**
 * "Back after a break" (§7.4, WF-A2): the latest shown-up day is at least
 * `BREAK_DAYS` before today. Never true before the first shown-up day.
 */
export function isBackAfterBreak(latestShownUp: Day | null, today: Day) {
  return (
    latestShownUp !== null && daysBetween(latestShownUp, today) >= BREAK_DAYS
  )
}

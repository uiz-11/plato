// Mastery: how well the learner currently remembers a concept (§7.5, spec §4,
// F6, F8). Derived from the schedule row; never stored.

import { daysBetween } from "./day"
import type { ScheduleState } from "./schedule"
import type { Day } from "./types"

export type Mastery = "not_yet_reviewed" | "shaky" | "good" | "strong"

export const MASTERY_LABEL: Record<Mastery, string> = {
  not_yet_reviewed: "Not yet reviewed",
  shaky: "Shaky",
  good: "Good",
  strong: "Strong",
}

/** Filled dots out of four on the meter (WF-C1, WF-G2). */
export const MASTERY_DOTS: Record<Mastery, number> = {
  not_yet_reviewed: 0,
  shaky: 1,
  good: 3,
  strong: 4,
}

type MasteryInput = Pick<
  ScheduleState,
  "laterDayReviews" | "lastGrade" | "intervalDays" | "dueDay"
>

/** The mastery rule table, first match wins, before decay. */
export function baseMastery(row: MasteryInput): Mastery {
  if (row.laterDayReviews === 0) return "not_yet_reviewed"
  if (row.lastGrade === "forgot" || row.intervalDays <= 2) return "shaky"
  if (row.lastGrade === "remembered" && row.intervalDays >= 14) return "strong"
  return "good"
}

const DECAY: Record<Mastery, Mastery> = {
  not_yet_reviewed: "not_yet_reviewed",
  shaky: "shaky",
  good: "shaky",
  strong: "good",
}

/**
 * Mastery on `today`. A review overdue by more than its interval drops one
 * step (Strong → Good → Shaky); *Not yet reviewed* never drops.
 */
export function mastery(row: MasteryInput, today: Day): Mastery {
  const base = baseMastery(row)
  return daysBetween(row.dueDay, today) > row.intervalDays ? DECAY[base] : base
}

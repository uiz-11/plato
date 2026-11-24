import { describe, expect, it } from "vitest"

import {
  baseMastery,
  mastery,
  MASTERY_DOTS,
  MASTERY_LABEL,
  type Mastery,
} from "./mastery"
import { applyReview, initialSchedule } from "./schedule"
import type { Grade } from "./types"

type Row = Parameters<typeof mastery>[0]
const row = (
  laterDayReviews: number,
  lastGrade: Grade | null,
  intervalDays: number,
  dueDay = "2026-06-01"
): Row => ({ laterDayReviews, lastGrade, intervalDays, dueDay })

describe("mastery rules (first match)", () => {
  it.each<[string, Row, Mastery]>([
    ["never reviewed", row(0, null, 2), "not_yet_reviewed"],
    ["never reviewed, long interval", row(0, null, 30), "not_yet_reviewed"],
    ["forgot", row(3, "forgot", 1), "shaky"],
    ["forgot beats a long interval", row(3, "forgot", 20), "shaky"],
    ["short interval", row(1, "remembered", 2), "shaky"],
    ["short interval, partly", row(1, "partly", 1), "shaky"],
    ["remembered, 14 days", row(4, "remembered", 14), "strong"],
    ["remembered, 180 days", row(8, "remembered", 180), "strong"],
    ["remembered, 13 days", row(4, "remembered", 13), "good"],
    ["remembered, 3 days", row(1, "remembered", 3), "good"],
    ["partly, 20 days", row(5, "partly", 20), "good"],
  ])("%s → %s", (_, r, expected) => {
    expect(baseMastery(r)).toBe(expected)
    // Not overdue: no decay.
    expect(mastery(r, r.dueDay)).toBe(expected)
  })
})

describe("decay", () => {
  // Due 2026-06-01. Decay starts when today − due_day > interval.
  it.each<[Row, string, Mastery]>([
    [row(4, "remembered", 20), "2026-06-21", "strong"], // overdue by exactly the interval
    [row(4, "remembered", 20), "2026-06-22", "good"],
    [row(4, "remembered", 20), "2027-06-01", "good"], // drops one step only
    [row(2, "remembered", 5), "2026-06-06", "good"],
    [row(2, "remembered", 5), "2026-06-07", "shaky"],
    [row(2, "forgot", 1), "2026-07-01", "shaky"], // Shaky stays Shaky
    [row(0, null, 1), "2027-01-01", "not_yet_reviewed"], // never drops
    [row(4, "remembered", 20), "2026-05-01", "strong"], // before due
  ])("%j on %s → %s", (r, today, expected) => {
    expect(mastery(r, today)).toBe(expected)
  })
})

describe("mastery from real schedule rows", () => {
  it("moves from Not yet reviewed to Strong with on-time reviews", () => {
    let r = initialSchedule(true, "2026-05-01")
    const levels: Mastery[] = [mastery(r, r.dueDay)]
    for (let i = 0; i < 3; i++) {
      r = applyReview(r, "remembered", r.dueDay)
      levels.push(mastery(r, r.dueDay))
    }
    // intervals: 2 → 5 → 13 → 35
    expect(levels).toEqual(["not_yet_reviewed", "good", "good", "strong"])
  })
})

describe("meter and labels", () => {
  it.each<[Mastery, number, string]>([
    ["not_yet_reviewed", 0, "Not yet reviewed"],
    ["shaky", 1, "Shaky"],
    ["good", 3, "Good"],
    ["strong", 4, "Strong"],
  ])("%s → %i dots, %s", (m, dots, label) => {
    expect(MASTERY_DOTS[m]).toBe(dots)
    expect(MASTERY_LABEL[m]).toBe(label)
  })
})

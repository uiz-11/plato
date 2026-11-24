// Engine simulation (§10): a year of one 15-minute session a day across two
// courses, with a 3-week break. The cap and most-overdue-first ordering must
// keep the due backlog bounded and drain it within two weeks of returning
// (§7.4, R10, spec F8).
//
// The session here is a small model of §7.7 built from the engine's own
// functions: reviews first, up to half the session while a lesson is left,
// then one lesson. The learner is a seeded random model whose recall fades
// with how overdue a review is.

import { describe, expect, it } from "vitest"

import { DAILY_CAP, EST } from "./constants"
import { addDays, daysBetween } from "./day"
import {
  applyReview,
  dueConcepts,
  initialSchedule,
  reviewCapLeft,
  type ScheduleRow,
} from "./schedule"
import type { Day, Grade } from "./types"

const MINUTES = 15
const START: Day = "2026-01-05"
const DAYS = 365

/** Mulberry32: a small seeded PRNG, so the run is the same every time. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Course {
  id: string
  lessons: string[][] // concept ids per lesson
  next: number // index of the next lesson
}

const course = (id: string, lessons: number, concepts: number): Course => ({
  id,
  lessons: Array.from({ length: lessons }, (_, l) =>
    Array.from({ length: concepts }, (_, c) => `${id}-l${l}-c${c}`)
  ),
  next: 0,
})

interface Day_ {
  day: Day
  dueAtStart: number
  reviewed: number
  dueAfter: number
}

function simulate(breakStart: number, breakDays: number, seed = 1) {
  const random = rng(seed)
  const courses = [course("alpha", 24, 4), course("beta", 16, 5)]
  const rows = new Map<string, ScheduleRow>()
  const log: Day_[] = []

  const grade = (r: ScheduleRow, today: Day): Grade => {
    // Recall fades with time since the last review relative to the interval.
    const overdueRatio = daysBetween(r.lastEventDay, today) / r.intervalDays
    const p = Math.min(0.95, 0.9 ** overdueRatio + 0.05 * (r.ease - 1.3))
    const x = random()
    if (x < p) return "remembered"
    return x < p + (1 - p) / 3 ? "partly" : "forgot"
  }

  for (let d = 0; d < DAYS; d++) {
    const today = addDays(START, d)
    if (d >= breakStart && d < breakStart + breakDays) continue

    const target = courses.find((c) => c.next < c.lessons.length)
    const due = dueConcepts([...rows.values()], today)
    const sizing = target
      ? Math.floor((MINUTES * 60) / 2 / EST.review)
      : Math.floor((MINUTES * 60) / EST.review)
    let n = Math.min(reviewCapLeft(0), due.length, sizing)
    for (const r of due.slice(0, n)) {
      rows.set(r.conceptId, applyReview(r, grade(r, today), today))
    }

    if (target) {
      for (const conceptId of target.lessons[target.next]) {
        rows.set(conceptId, {
          courseId: target.id,
          conceptId,
          ...initialSchedule(random() < 0.7, today),
        })
      }
      target.next++
    }

    // Every third day the learner presses Keep going: a second session with
    // no lesson, limited by the reviews already answered today.
    if (d % 3 === 0) {
      const more = dueConcepts([...rows.values()], today)
      const m = Math.min(
        reviewCapLeft(n),
        more.length,
        Math.floor((MINUTES * 60) / EST.review)
      )
      for (const r of more.slice(0, m)) {
        rows.set(r.conceptId, applyReview(r, grade(r, today), today))
      }
      n += m
    }

    log.push({
      day: today,
      dueAtStart: due.length,
      reviewed: n,
      dueAfter: dueConcepts([...rows.values()], today).length,
    })
  }
  return { log, rows }
}

/** First day on or after `from` whose session cleared the due list. */
function drainedOn(log: Day_[], from: Day): Day | undefined {
  return log.find((l) => l.day >= from && l.dueAfter === 0)?.day
}

/** Due reviews left after a session, outside the two weeks after a break. */
const STEADY_LEFTOVER = 10

describe.each([
  // The break comes while both courses still have lessons left, so sessions
  // after it hold at most 15 reviews: the harder case.
  ["while lessons are left", 30, 1, true],
  ["right after the last lesson", 40, 7, true],
  // Little is due on return: intervals are long late in the year, and few
  // concepts exist after a week.
  ["late in the year, courses done", 200, 7, false],
  ["in the first week", 5, 7, false],
])("365 days with a 3-week break %s", (_, breakStart, seed, backlog) => {
  const BREAK_DAYS = 21
  const { log, rows } = simulate(breakStart, BREAK_DAYS, seed)
  const returnDay = addDays(START, breakStart + BREAK_DAYS)
  const back = log.find((l) => l.day === returnDay)!

  it("runs a session on every day but the break", () => {
    expect(log).toHaveLength(DAYS - BREAK_DAYS)
    expect(rows.size).toBe(24 * 4 + 16 * 5)
  })

  it("never shows more than the cap in a day, across sessions", () => {
    for (const l of log) expect(l.reviewed).toBeLessThanOrEqual(DAILY_CAP)
  })

  // Only these runs return to more due reviews than one session holds.
  const big = backlog ? it : () => {}

  big("returns to a backlog", () => {
    expect(back.dueAtStart).toBeGreaterThan(back.reviewed)
  })

  big("stops at the cap while a backlog is left", () => {
    expect(log.some((l) => l.reviewed === DAILY_CAP && l.dueAfter > 0)).toBe(
      true
    )
  })

  big("keeps the backlog bounded: it only shrinks after the return", () => {
    for (const l of log.filter((l) => l.day > returnDay)) {
      expect(l.dueAtStart, l.day).toBeLessThanOrEqual(back.dueAtStart)
    }
    expect(back.dueAtStart).toBeLessThan(5 * DAILY_CAP)
  })

  it("drains the backlog within two weeks of returning", () => {
    const drained = drainedOn(log, returnDay)
    expect(drained).toBeDefined()
    expect(daysBetween(returnDay, drained!)).toBeLessThanOrEqual(14)
  })

  it("leaves at most a few reviews over on every other day", () => {
    const outside = log.filter(
      (l) => l.day < returnDay || daysBetween(returnDay, l.day) > 14
    )
    for (const l of outside) {
      expect(l.dueAfter, l.day).toBeLessThanOrEqual(STEADY_LEFTOVER)
    }
  })

  big("reviews every concept again after the break", () => {
    for (const r of rows.values()) {
      expect(r.lastEventDay > returnDay, r.conceptId).toBe(true)
    }
  })
})

// Today (§7.8, spec F8, WF-A1, WF-A2): the session line, the card and the
// rows below it. Everything here is derived on read.

import type { NotBuiltEntry, PublishedEntry } from "@/lib/content/schema"

import { addDays, daysBetween, isBackAfterBreak } from "./day"
import {
  checkpointNumber,
  completedCount,
  courseStatus,
  firstOpenCheckpoint,
  nextTarget,
  requestStatus,
  type Target,
} from "./status"
import { assembleSession, type CourseCandidate } from "./session"
import { completedLabel, plural, sessionLine, targetLabel } from "./labels"
import type { ScheduleRow } from "./schedule"
import type { Day, SessionMinutes } from "./types"

/** What Today offers to do (WF-A2). */
export type TodayAction =
  | "start-session" // with the length menu
  | "reviews-only"
  | "full-lesson"
  | "start-reviews"
  | "start-lesson-1"
  | "request-course"

export type TodayCard =
  | { kind: "welcome-back"; text: string; actions: TodayAction[] }
  | { kind: "session"; line: string; text: string; actions: TodayAction[] }
  | { kind: "next"; target: string; text: string; actions: TodayAction[] }
  | { kind: "reviews-due"; count: number; text: string; actions: TodayAction[] }
  | {
      kind: "ready"
      courseId: string
      title: string
      meta: string
      text: string
      actions: TodayAction[]
    }
  | { kind: "first-run"; text: string; actions: TodayAction[] }
  | { kind: "caught-up"; text: string; actions: TodayAction[] }

/** A published course with what Today shows about it. */
export interface TodayCourse extends CourseCandidate {
  publishedAt: string
  /** "~40 min", from `formatCourseLength` (§5.2). */
  length: string
}

export interface TodayInput {
  today: Day
  /** The remembered session length (`settings.session_minutes`). */
  minutes: SessionMinutes
  latestShownUpDay: Day | null
  reviewsAnsweredToday: number
  schedules: readonly ScheduleRow[]
  /** Published courses only. */
  courses: readonly TodayCourse[]
  requests: ReadonlyArray<{ id: string; text: string; createdAt: number }>
  published: readonly Pick<PublishedEntry, "requestId">[]
  notBuilt: readonly Pick<NotBuiltEntry, "requestId" | "reason">[]
}

export interface TodayView {
  card: TodayCard
  /** *In progress* rows, most recently used first. */
  inProgress: Array<{ courseId: string; title: string; meta: string }>
  /** *Ready* rows, newest published first. */
  ready: Array<{ courseId: string; title: string; meta: string }>
  /** *Requested* and *Not built* requests, newest first. */
  requested: Array<{ id: string; text: string; reason?: string }>
}

/** "{n} lessons · {length}" (WF-A1, WF-H1). */
export const readyMeta = (c: TodayCourse) =>
  `${plural(completedCount(c).total, "lesson")} · ${c.length}`

export function todayView(input: TodayInput): TodayView {
  return {
    card: todayCard(input),
    ...todayRows(input),
  }
}

/** The card (§7.8): the first matching row of the table wins. */
export function todayCard(input: TodayInput): TodayCard {
  const a = assembleSession({
    kind: "standard",
    minutes: input.minutes,
    today: input.today,
    schedules: input.schedules,
    reviewsAnsweredToday: input.reviewsAnsweredToday,
    courses: input.courses,
  })
  const course = a.courseId
    ? (input.courses.find((c) => c.course.id === a.courseId) ?? null)
    : null
  const target: Target | null = a.target
  const reviewFits = a.due > 0 && a.capLeft > 0
  const fullLesson =
    course !== null && nextTarget(course, { lessonsOnly: true }) !== null

  // 1. Back after a break, with something to do.
  if (
    isBackAfterBreak(input.latestShownUpDay, input.today) &&
    (a.due > 0 || target !== null)
  ) {
    return {
      kind: "welcome-back",
      text: "Welcome back. Overdue reviews are spread over the next few days.",
      actions: ["start-session"],
    }
  }

  if (course && target) {
    const t = targetLabel(course, target)
    // 2. A target, and the session holds reviews.
    if (a.reviews.length > 0) {
      const line = sessionLine(a.reviews.length, t)
      return {
        kind: "session",
        line,
        text: `Your session: ${line}`,
        actions: [
          "start-session",
          ...(reviewFits ? (["reviews-only"] as const) : []),
          ...(fullLesson ? (["full-lesson"] as const) : []),
        ],
      }
    }
    // 3. A target, and no reviews fit.
    const reviewedToday = input.reviewsAnsweredToday > 0 || a.capLeft === 0
    return {
      kind: "next",
      target: t,
      text: reviewedToday
        ? `Reviews done for today. Next: ${t}.`
        : `Next: ${t}.`,
      actions: [
        "start-session",
        ...(fullLesson ? (["full-lesson"] as const) : []),
      ],
    }
  }

  // 4. No target; reviews due and the cap not reached.
  if (reviewFits) {
    const count = Math.min(a.due, a.capLeft)
    return {
      kind: "reviews-due",
      count,
      text: `${plural(count, "review")} due`,
      actions: ["start-reviews"],
    }
  }

  // 5. A Ready course: the most recently published one.
  const ready = newestFirst(
    input.courses.filter((c) => courseStatus(c) === "ready")
  )[0]
  if (ready) {
    return {
      kind: "ready",
      courseId: ready.course.id,
      title: ready.course.title,
      meta: readyMeta(ready),
      text: `${ready.course.title} is ready`,
      actions: ["start-lesson-1"],
    }
  }

  // 6. Nothing published.
  if (input.courses.length === 0) {
    return {
      kind: "first-run",
      text: "What do you want to learn?",
      actions: ["request-course"],
    }
  }

  // 7. All caught up.
  const next = nextReviewsIn(input, a.due > 0 && a.capLeft === 0)
  return {
    kind: "caught-up",
    text:
      next === null
        ? "All caught up."
        : `All caught up. Next reviews ${next === 1 ? "tomorrow" : `in ${next} days`}.`,
    actions: ["request-course"],
  }
}

/**
 * Days until the next reviews: 1 when the cap is reached with reviews still
 * due, otherwise until the earliest due day after today. Null when nothing is
 * scheduled.
 */
function nextReviewsIn(input: TodayInput, capped: boolean): number | null {
  if (capped) return 1
  if (input.schedules.length === 0) return null
  const tomorrow = addDays(input.today, 1)
  const earliest = input.schedules
    .map((r) => (r.dueDay < tomorrow ? tomorrow : r.dueDay))
    .reduce((a, b) => (a < b ? a : b))
  return daysBetween(input.today, earliest)
}

const newestFirst = (cs: readonly TodayCourse[]) =>
  [...cs].sort((a, b) =>
    a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0
  )

/** The rows below the card (§7.8). */
export function todayRows(
  input: Pick<TodayInput, "courses" | "requests" | "published" | "notBuilt">
): Omit<TodayView, "card"> {
  const inProgress = input.courses
    .filter((c) => courseStatus(c) === "in_progress")
    .sort((a, b) => (b.lastUsedAt ?? -Infinity) - (a.lastUsedAt ?? -Infinity))
    .map((c) => {
      const { completed, total } = completedCount(c)
      const open = firstOpenCheckpoint(c)
      const cpOpen = open
        ? ` · Checkpoint ${checkpointNumber(c.course, open.id)} open`
        : ""
      return {
        courseId: c.course.id,
        title: c.course.title,
        meta: `${completedLabel(completed, total)}${cpOpen}`,
      }
    })
  const ready = newestFirst(
    input.courses.filter((c) => courseStatus(c) === "ready")
  ).map((c) => ({
    courseId: c.course.id,
    title: c.course.title,
    meta: readyMeta(c),
  }))
  const requested = [...input.requests]
    .sort((a, b) => b.createdAt - a.createdAt)
    .flatMap((r) => {
      const s = requestStatus(r.id, input.published, input.notBuilt)
      if (s.status === "published") return []
      return [
        { id: r.id, text: r.text, ...(s.reason ? { reason: s.reason } : {}) },
      ]
    })
  return { inProgress, ready, requested }
}

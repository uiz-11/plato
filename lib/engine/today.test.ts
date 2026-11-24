import { describe, expect, it } from "vitest"

import { DAILY_CAP } from "./constants"
import { initialSchedule, type ScheduleRow } from "./schedule"
import type { CourseProgress } from "./status"
import { done, M1, M2, progress, row, skipped } from "./test-course"
import {
  todayCard,
  todayRows,
  todayView,
  type TodayCourse,
  type TodayInput,
} from "./today"

const TODAY = "2026-06-10"

const course = (
  id: string,
  p: CourseProgress,
  over: Partial<TodayCourse> = {}
): TodayCourse => ({
  ...p,
  course: { ...p.course, id, title: `Course ${id}` },
  lastUsedAt: null,
  hadSession: false,
  publishedAt: "2026-01-01T00:00:00Z",
  length: "~1 hr",
  ...over,
})

const due = (n: number, dueDay = TODAY): ScheduleRow[] =>
  Array.from({ length: n }, (_, i) => ({
    courseId: "a",
    conceptId: `k${i}`,
    ...initialSchedule(true, "2026-06-01"),
    dueDay,
  }))

const inProgress = (
  p = progress([
    done("l1"),
    row("l2", { position: { step: "recall", phase: "tick" } }),
  ])
) => course("a", p, { lastUsedAt: 10 })

const input = (over: Partial<TodayInput> = {}): TodayInput => ({
  today: TODAY,
  minutes: 15,
  latestShownUpDay: "2026-06-09",
  reviewsAnsweredToday: 0,
  schedules: [],
  courses: [],
  requests: [],
  published: [],
  notBuilt: [],
  ...over,
})

describe("Today's card", () => {
  it("1. welcome back after 14 days, with work to do", () => {
    const card = todayCard(
      input({
        latestShownUpDay: "2026-05-27",
        schedules: due(3),
        courses: [inProgress()],
      })
    )
    expect(card).toEqual({
      kind: "welcome-back",
      text: "Welcome back. Overdue reviews are spread over the next few days.",
      actions: ["start-session"],
    })
  })

  it("1 is not shown after 13 days, or with nothing to do", () => {
    expect(
      todayCard(
        input({
          latestShownUpDay: "2026-05-28",
          schedules: due(3),
          courses: [inProgress()],
        })
      ).kind
    ).toBe("session")
    expect(
      todayCard(
        input({
          latestShownUpDay: "2026-05-01",
          courses: [course("r", progress())],
        })
      ).kind
    ).toBe("ready")
  })

  it("2. a target and reviews: the session line", () => {
    const card = todayCard(
      input({ schedules: due(9), courses: [inProgress()] })
    )
    expect(card).toEqual({
      kind: "session",
      line: "9 reviews, then Lesson 2 from Recall",
      text: "Your session: 9 reviews, then Lesson 2 from Recall",
      actions: ["start-session", "reviews-only", "full-lesson"],
    })
  })

  it("2. one review reads singular, and the line follows the session length", () => {
    expect(
      todayCard(input({ schedules: due(1), courses: [inProgress()] }))
    ).toMatchObject({
      line: "1 review, then Lesson 2 from Recall",
    })
    expect(
      todayCard(
        input({ minutes: 10, schedules: due(40), courses: [inProgress()] })
      )
    ).toMatchObject({ line: "10 reviews, then Lesson 2 from Recall" })
  })

  it("2. a lesson with no position, a checkpoint, and no Full lesson when no lesson is left", () => {
    const next = progress([done("l1")])
    expect(
      todayCard(input({ schedules: due(2), courses: [inProgress(next)] }))
    ).toMatchObject({
      line: "2 reviews, then Lesson 2",
    })
    const lastCheckpoint = progress(
      ["l1", "l2", "l3", "l4"].map((id) => done(id)),
      M1
    )
    expect(
      todayCard(
        input({ schedules: due(2), courses: [inProgress(lastCheckpoint)] })
      )
    ).toMatchObject({
      line: "2 reviews, then Checkpoint 2",
      actions: ["start-session", "reviews-only"],
    })
  })

  it("2. a Skipped target names its step", () => {
    const p = progress(
      [
        skipped("l1", { position: { step: "read" } }),
        done("l2"),
        done("l3"),
        done("l4"),
      ],
      [...M2]
    )
    expect(
      todayCard(input({ schedules: due(2), courses: [inProgress(p)] }))
    ).toMatchObject({
      line: "2 reviews, then Lesson 1 from Read",
    })
  })

  it("3. a target and no reviews due: Next", () => {
    expect(todayCard(input({ courses: [inProgress()] }))).toEqual({
      kind: "next",
      target: "Lesson 2 from Recall",
      text: "Next: Lesson 2 from Recall.",
      actions: ["start-session", "full-lesson"],
    })
  })

  it("3. reviews done for today, after a review or at the cap", () => {
    expect(
      todayCard(input({ reviewsAnsweredToday: 4, courses: [inProgress()] }))
        .text
    ).toBe("Reviews done for today. Next: Lesson 2 from Recall.")
    const capped = todayCard(
      input({
        reviewsAnsweredToday: DAILY_CAP,
        schedules: due(5),
        courses: [inProgress()],
      })
    )
    expect(capped).toMatchObject({
      kind: "next",
      text: "Reviews done for today. Next: Lesson 2 from Recall.",
    })
  })

  it("4. no target, reviews due", () => {
    expect(todayCard(input({ schedules: due(7) }))).toEqual({
      kind: "reviews-due",
      count: 7,
      text: "7 reviews due",
      actions: ["start-reviews"],
    })
    expect(
      todayCard(
        input({ schedules: due(7), reviewsAnsweredToday: DAILY_CAP - 1 })
      )
    ).toMatchObject({ text: "1 review due" })
  })

  it("5. a Ready course: the most recently published one", () => {
    const card = todayCard(
      input({
        courses: [
          course("old", progress(), { publishedAt: "2026-01-01T00:00:00Z" }),
          course("new", progress(), {
            publishedAt: "2026-03-01T00:00:00Z",
            length: "~40 min",
          }),
        ],
      })
    )
    expect(card).toEqual({
      kind: "ready",
      courseId: "new",
      title: "Course new",
      meta: "4 lessons · ~40 min",
      text: "Course new is ready",
      actions: ["start-lesson-1"],
    })
  })

  it("6. nothing published", () => {
    expect(todayCard(input())).toEqual({
      kind: "first-run",
      text: "What do you want to learn?",
      actions: ["request-course"],
    })
  })

  describe("7. all caught up", () => {
    const complete = course(
      "x",
      progress(
        ["l1", "l2", "l3", "l4"].map((id) => done(id)),
        [...M1, ...M2]
      )
    )
    it.each<[string, Partial<TodayInput>, string]>([
      ["nothing scheduled", {}, "All caught up."],
      [
        "due tomorrow",
        { schedules: due(2, "2026-06-11") },
        "All caught up. Next reviews tomorrow.",
      ],
      [
        "due in 5 days",
        { schedules: [...due(1, "2026-06-15"), ...due(1, "2026-06-20")] },
        "All caught up. Next reviews in 5 days.",
      ],
      [
        "the cap reached with reviews still due",
        { schedules: due(4), reviewsAnsweredToday: DAILY_CAP },
        "All caught up. Next reviews tomorrow.",
      ],
    ])("%s", (_, over, text) => {
      expect(todayCard(input({ courses: [complete], ...over }))).toEqual({
        kind: "caught-up",
        text,
        actions: ["request-course"],
      })
    })
  })
})

describe("rows below the card", () => {
  it("In progress rows, most recently used first, with an open checkpoint", () => {
    const rows = todayRows({
      courses: [
        course("a", progress([done("l1")]), { lastUsedAt: 5 }),
        course("b", progress([done("l1"), done("l2")]), { lastUsedAt: 9 }),
        course("r", progress()),
      ],
      requests: [],
      published: [],
      notBuilt: [],
    })
    expect(rows.inProgress).toEqual([
      {
        courseId: "b",
        title: "Course b",
        meta: "2 of 4 completed · Checkpoint 1 open",
      },
      { courseId: "a", title: "Course a", meta: "1 of 4 completed" },
    ])
    expect(rows.ready).toEqual([
      { courseId: "r", title: "Course r", meta: "4 lessons · ~1 hr" },
    ])
  })

  it("requests that are Requested or Not built, newest first", () => {
    const rows = todayRows({
      courses: [],
      requests: [
        { id: "r1", text: "Old", createdAt: 1 },
        { id: "r2", text: "Built", createdAt: 2 },
        { id: "r3", text: "Refused", createdAt: 3 },
      ],
      published: [{ requestId: "r2" }],
      notBuilt: [{ requestId: "r3", reason: "Too broad" }],
    })
    expect(rows.requested).toEqual([
      { id: "r3", text: "Refused", reason: "Too broad" },
      { id: "r1", text: "Old" },
    ])
  })

  it("todayView combines the card and rows", () => {
    const v = todayView(input())
    expect(v.card.kind).toBe("first-run")
    expect(v).toMatchObject({ inProgress: [], ready: [], requested: [] })
  })
})

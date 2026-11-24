import { describe, expect, it } from "vitest"

import type { Exercise } from "@/lib/content/schema"

import { DAILY_CAP, EASE_START } from "./constants"
import {
  advanceVersion,
  applyReview,
  dueConcepts,
  initialSchedule,
  isRecalled,
  lessonCompletionSchedules,
  pickVersion,
  reviewCapLeft,
  reviewEventConcepts,
  reviewVersions,
  type ScheduleRow,
  type ScheduleState,
} from "./schedule"
import type { Grade } from "./types"

const D = "2026-05-01"

const row = (over: Partial<ScheduleState> = {}): ScheduleState => ({
  ...initialSchedule(true, D),
  ...over,
})

describe("initial rows", () => {
  it.each([
    [true, 2, "2026-05-03"],
    [false, 1, "2026-05-02"],
  ])("recalled %s → interval %i, due %s", (recalled, interval, due) => {
    expect(initialSchedule(recalled, D)).toEqual({
      lessonDay: D,
      dueDay: due,
      intervalDays: interval,
      ease: EASE_START,
      lastEventDay: D,
      laterDayReviews: 0,
      lastGrade: null,
      versionCursor: 0,
    })
  })

  const r = (concepts: string[], grade: Grade, isRetry = false) => ({
    concepts,
    grade,
    isRetry,
  })

  it.each([
    ["ticked, no exercises", ["c1"], [], true],
    ["not ticked", [], [], false],
    ["ticked, exercise remembered", ["c1"], [r(["c1"], "remembered")], true],
    ["ticked, exercise partly", ["c1"], [r(["c1"], "partly")], true],
    ["ticked, exercise forgot", ["c1"], [r(["c1"], "forgot")], false],
    [
      "ticked, multi-concept exercise forgot",
      ["c1"],
      [r(["c2", "c1"], "forgot")],
      false,
    ],
    ["ticked, another concept forgot", ["c1"], [r(["c2"], "forgot")], true],
    ["ticked, only a retry forgot", ["c1"], [r(["c1"], "forgot", true)], true],
    ["not ticked, exercise remembered", [], [r(["c1"], "remembered")], false],
  ])("%s → recalled %s", (_, ticked, results, recalled) => {
    expect(isRecalled("c1", ticked, results)).toBe(recalled)
  })

  it("creates one row per concept on completion", () => {
    const lesson = { concepts: [{ id: "c1" }, { id: "c2" }, { id: "c3" }] }
    const rows = lessonCompletionSchedules(
      lesson as never,
      ["c1", "c2"],
      [r(["c2"], "forgot")],
      D
    )
    expect(rows.map((x) => [x.conceptId, x.intervalDays, x.dueDay])).toEqual([
      ["c1", 2, "2026-05-03"],
      ["c2", 1, "2026-05-02"],
      ["c3", 1, "2026-05-02"],
    ])
  })
})

describe("applyReview", () => {
  it.each<
    [string, Partial<ScheduleState>, Grade, string, Partial<ScheduleState>]
  >([
    // remembered
    [
      "on time",
      { intervalDays: 2 },
      "remembered",
      "2026-05-03",
      { intervalDays: 5, ease: 2.6, dueDay: "2026-05-08" },
    ],
    [
      "after a long gap",
      { intervalDays: 2 },
      "remembered",
      "2026-05-21",
      { intervalDays: 50, ease: 2.6, dueDay: "2026-07-10" },
    ],
    [
      "early",
      { intervalDays: 10 },
      "remembered",
      "2026-05-04",
      { intervalDays: 25, ease: 2.6 },
    ],
    [
      "grows by at least one",
      { intervalDays: 1, ease: 1.3 },
      "remembered",
      "2026-05-02",
      { intervalDays: 2, ease: 1.4 },
    ],
    [
      "capped at 180 days",
      { intervalDays: 98, ease: 2.8 },
      "remembered",
      "2026-08-07",
      { intervalDays: 180, ease: 2.8, dueDay: "2027-02-03" },
    ],
    [
      "ease capped at 2.8",
      { intervalDays: 13, ease: 2.75 },
      "remembered",
      "2026-05-14",
      { intervalDays: 36, ease: 2.8 },
    ],
    // partly
    [
      "partly",
      { intervalDays: 10 },
      "partly",
      "2026-05-11",
      { intervalDays: 12, ease: 2.35, dueDay: "2026-05-23" },
    ],
    [
      "partly rounds",
      { intervalDays: 3 },
      "partly",
      "2026-05-04",
      { intervalDays: 4 },
    ],
    [
      "partly keeps at least one",
      { intervalDays: 1 },
      "partly",
      "2026-05-02",
      { intervalDays: 1 },
    ],
    [
      "partly ease floor",
      { intervalDays: 5, ease: 1.35 },
      "partly",
      "2026-05-06",
      { intervalDays: 6, ease: 1.3 },
    ],
    [
      "partly capped at 180 days",
      { intervalDays: 180 },
      "partly",
      "2026-10-28",
      { intervalDays: 180, dueDay: "2027-04-26" },
    ],
    [
      "partly just over the cap",
      { intervalDays: 151 },
      "partly",
      "2026-09-29",
      { intervalDays: 180 },
    ],
    [
      "partly just under the cap",
      { intervalDays: 150 },
      "partly",
      "2026-09-28",
      { intervalDays: 180 },
    ],
    // forgot
    [
      "forgot",
      { intervalDays: 40 },
      "forgot",
      "2026-06-10",
      { intervalDays: 1, ease: 2.3, dueDay: "2026-06-11" },
    ],
    [
      "forgot ease floor",
      { intervalDays: 3, ease: 1.4 },
      "forgot",
      "2026-05-04",
      { intervalDays: 1, ease: 1.3 },
    ],
  ])("%s", (_, before, grade, today, expected) => {
    const after = applyReview(row(before), grade, today)
    expect(after).toMatchObject({
      ...expected,
      lastEventDay: today,
      laterDayReviews: 1,
      lastGrade: grade,
    })
    expect(after.lessonDay).toBe(D)
    expect(after.versionCursor).toBe(0)
  })

  it("follows a sequence of on-time remembered reviews", () => {
    let r: ScheduleState = initialSchedule(true, D)
    const intervals: number[] = []
    const eases: number[] = []
    for (let i = 0; i < 6; i++) {
      r = applyReview(r, "remembered", r.dueDay)
      intervals.push(r.intervalDays)
      eases.push(r.ease)
    }
    expect(intervals).toEqual([5, 13, 35, 98, 180, 180])
    expect(eases).toEqual([2.6, 2.7, 2.8, 2.8, 2.8, 2.8])
    expect(r.laterDayReviews).toBe(6)
  })

  it("recovers after a lapse", () => {
    let r = applyReview(row({ intervalDays: 30 }), "forgot", "2026-06-01")
    expect(r).toMatchObject({
      intervalDays: 1,
      ease: 2.3,
      dueDay: "2026-06-02",
    })
    r = applyReview(r, "remembered", "2026-06-02")
    expect(r).toMatchObject({
      intervalDays: 2,
      ease: 2.4,
      dueDay: "2026-06-04",
    })
  })

  it("keeps other columns", () => {
    const r = { ...row(), courseId: "k", conceptId: "c", versionCursor: 3 }
    expect(applyReview(r, "partly", "2026-05-03")).toMatchObject({
      courseId: "k",
      conceptId: "c",
      versionCursor: 3,
    })
  })

  describe("same-day events", () => {
    const reviewed = applyReview(
      row({ intervalDays: 10 }),
      "remembered",
      "2026-05-11"
    )
    // interval 25, due 2026-06-05

    it.each(["remembered", "partly"] as const)(
      "a later %s changes nothing",
      (grade) => {
        expect(applyReview(reviewed, grade, "2026-05-11")).toBe(reviewed)
      }
    )

    it("a later forgot pulls the due day in to tomorrow, and nothing else", () => {
      expect(applyReview(reviewed, "forgot", "2026-05-11")).toEqual({
        ...reviewed,
        dueDay: "2026-05-12",
      })
    })

    it("a later forgot never pushes the due day out", () => {
      const forgot = applyReview(row(), "forgot", "2026-05-03") // due 05-04
      expect(applyReview(forgot, "forgot", "2026-05-03")).toEqual(forgot)
    })

    it("on the completion day, too", () => {
      // A checkpoint on the day its module was finished is not a review
      // event (R5), but the rule holds for any event on `last_event_day`.
      const fresh = initialSchedule(true, D)
      expect(applyReview(fresh, "remembered", D)).toBe(fresh)
      expect(applyReview(fresh, "forgot", D).dueDay).toBe("2026-05-02")
      expect(applyReview(fresh, "forgot", D).laterDayReviews).toBe(0)
    })
  })

  it.each(["remembered", "partly", "forgot"] as const)(
    "a %s dated before the last event (clock moved back) changes nothing",
    (grade) => {
      const reviewed = applyReview(row(), "remembered", "2026-05-11")
      expect(applyReview(reviewed, grade, "2026-05-09")).toBe(reviewed)
    }
  )
})

describe("reviewEventConcepts", () => {
  const schedules = new Map([
    ["old", { lessonDay: "2026-04-20" }],
    ["new", { lessonDay: D }],
  ])

  it.each([
    [
      "a review item",
      { context: "review", isRetry: false, conceptId: "old" },
      ["old"],
    ],
    [
      "a review item on its lesson day",
      { context: "review", isRetry: false, conceptId: "new" },
      ["new"],
    ],
    [
      "a review item for a concept with no row",
      { context: "review", isRetry: false, conceptId: "none" },
      [],
    ],
    [
      "a review retry",
      { context: "review", isRetry: true, conceptId: "old" },
      [],
    ],
    [
      "a checkpoint answer",
      {
        context: "checkpoint",
        isRetry: false,
        concepts: ["old", "new", "none"],
      },
      ["old"],
    ],
    [
      "a checkpoint retry",
      { context: "checkpoint", isRetry: true, concepts: ["old"] },
      [],
    ],
    ["a Recall exercise", { context: "recall", isRetry: false }, []],
  ] as const)("%s", (_, event, expected) => {
    expect(reviewEventConcepts(event, schedules, D)).toEqual(expected)
  })

  it("counts a checkpoint on the next day", () => {
    expect(
      reviewEventConcepts(
        { context: "checkpoint", isRetry: false, concepts: ["new"] },
        schedules,
        "2026-05-02"
      )
    ).toEqual(["new"])
  })
})

describe("version rotation", () => {
  const ex = (id: string, pool: Exercise["pool"], concepts: string[]) =>
    ({ id, pool, concepts }) as Exercise
  const lesson = {
    concepts: [
      {
        id: "c1",
        statement: "",
        recallPrompts: [
          { prompt: "1", answer: "" },
          { prompt: "2", answer: "" },
        ],
      },
      { id: "c2", statement: "", recallPrompts: [{ prompt: "3", answer: "" }] },
    ],
    exercises: [
      ex("e1", "review", ["c1"]),
      ex("e2", "recall", ["c1"]),
      ex("e3", "review", ["c2"]),
      ex("e4", "review", ["c1"]),
      ex("e5", "checkpoint", ["c1"]),
    ],
  }

  it("orders recall prompts first, then review exercises, in authored order", () => {
    expect(reviewVersions(lesson, "c1")).toEqual([
      { kind: "prompt", index: 0 },
      { kind: "prompt", index: 1 },
      { kind: "exercise", exerciseId: "e1" },
      { kind: "exercise", exerciseId: "e4" },
    ])
    expect(reviewVersions(lesson, "c2")).toEqual([
      { kind: "prompt", index: 0 },
      { kind: "exercise", exerciseId: "e3" },
    ])
  })

  it("rotates by the cursor and never repeats a version twice in a row", () => {
    const versions = reviewVersions(lesson, "c1")
    let r = row()
    const shown = []
    for (let i = 0; i < 6; i++) {
      shown.push(pickVersion(versions, r.versionCursor))
      r = advanceVersion(r)
    }
    expect(shown).toEqual([...versions, versions[0], versions[1]])
    for (let i = 1; i < shown.length; i++)
      expect(shown[i]).not.toEqual(shown[i - 1])
  })

  it("does not advance the cursor at assembly", () => {
    const r = row({ versionCursor: 2 })
    pickVersion(reviewVersions(lesson, "c1"), r.versionCursor)
    expect(r.versionCursor).toBe(2)
    expect(advanceVersion(r).versionCursor).toBe(3)
  })

  it("rejects an unknown concept", () => {
    expect(() => reviewVersions(lesson, "nope")).toThrow()
  })
})

describe("daily cap", () => {
  it.each([
    [0, DAILY_CAP],
    [12, 18],
    [30, 0],
    [31, 0],
  ])("%i answered → %i left", (answered, left) => {
    expect(reviewCapLeft(answered)).toBe(left)
  })
})

describe("dueConcepts", () => {
  const r = (
    courseId: string,
    conceptId: string,
    dueDay: string,
    lastEventDay: string
  ): ScheduleRow => ({
    ...row({ dueDay, lastEventDay }),
    courseId,
    conceptId,
  })
  const today = "2026-05-10"

  it("lists rows due by today, most overdue first", () => {
    const rows = [
      r("a", "x", "2026-05-10", "2026-05-08"),
      // Due later but reviewed longer ago: due day decides, not last event.
      r("a", "long", "2026-05-05", "2026-04-05"),
      r("a", "future", "2026-05-11", "2026-05-09"),
      r("a", "y", "2026-05-02", "2026-05-01"),
      r("b", "z", "2026-05-02", "2026-04-28"), // same due day, earlier last event
      r("b", "w", "2026-05-10", "2026-05-08"), // tie with a/x: by course
      r("a", "v", "2026-05-10", "2026-05-08"), // tie with a/x: by concept
      r("a", "today", "2026-05-11", today), // reviewed today
      r("a", "pulled", "2026-05-10", today), // reviewed today, then forgot
    ]
    expect(
      dueConcepts(rows, today).map((x) => `${x.courseId}/${x.conceptId}`)
    ).toEqual(["b/z", "a/y", "a/long", "a/v", "a/x", "b/w"])
  })
})

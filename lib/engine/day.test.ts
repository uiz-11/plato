import { describe, expect, it } from "vitest"

import {
  addDays,
  daysBetween,
  isBackAfterBreak,
  isProgressEvent,
  isValidTimeZone,
  learningDay,
} from "./day"
import type { PlayerEventKind } from "./types"

const at = (iso: string) => new Date(iso).getTime()

describe("learningDay", () => {
  it.each([
    // UTC (the default)
    ["2026-03-10T12:00:00Z", "UTC", "2026-03-10"],
    ["2026-03-10T04:00:00Z", "UTC", "2026-03-10"], // the day starts at 04:00
    ["2026-03-10T03:59:59Z", "UTC", "2026-03-09"],
    ["2026-03-10T01:00:00Z", "UTC", "2026-03-09"], // a 01:00 session counts as yesterday
    ["2026-03-01T02:00:00Z", "UTC", "2026-02-28"], // across a month
    ["2026-01-01T03:00:00Z", "UTC", "2025-12-31"], // across a year
    ["2028-03-01T03:00:00Z", "UTC", "2028-02-29"], // leap day
    // Local time, not UTC
    ["2026-03-10T08:30:00Z", "America/New_York", "2026-03-10"], // 04:30 EDT
    ["2026-03-10T07:30:00Z", "America/New_York", "2026-03-09"], // 03:30 local
    ["2026-07-01T02:00:00Z", "Asia/Tokyo", "2026-07-01"], // 11:00 local
    ["2026-06-30T18:30:00Z", "Asia/Tokyo", "2026-06-30"], // 03:30 local on 1 July
    ["2026-06-30T19:00:00Z", "Asia/Tokyo", "2026-07-01"], // 04:00 local
    ["2026-03-10T23:00:00Z", "Asia/Kolkata", "2026-03-11"], // 04:30 local, half-hour zone
  ])("%s in %s → %s", (iso, tz, day) => {
    expect(learningDay(at(iso), tz)).toBe(day)
  })

  it("defaults to UTC", () => {
    expect(learningDay(at("2026-03-10T03:00:00Z"))).toBe("2026-03-09")
  })

  it("keeps the 04:00 start across a DST change", () => {
    // Europe/London springs forward at 01:00 UTC on 29 March 2026.
    expect(learningDay(at("2026-03-29T02:59:00Z"), "Europe/London")).toBe(
      "2026-03-28"
    ) // 03:59 BST
    expect(learningDay(at("2026-03-29T03:00:00Z"), "Europe/London")).toBe(
      "2026-03-29"
    ) // 04:00 BST
  })

  it("rejects an unknown time zone", () => {
    expect(() => learningDay(0, "Mars/Olympus")).toThrow(RangeError)
    expect(isValidTimeZone("Mars/Olympus")).toBe(false)
    expect(isValidTimeZone("Europe/Paris")).toBe(true)
  })
})

describe("day arithmetic", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-03-01", -1, "2026-02-28"],
    ["2028-02-28", 1, "2028-02-29"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-03-28", 2, "2026-03-30"], // no DST effect on calendar days
    ["2026-05-05", 0, "2026-05-05"],
    ["2026-01-01", 180, "2026-06-30"],
  ])("%s + %i = %s", (day, n, expected) => {
    expect(addDays(day, n)).toBe(expected)
    expect(daysBetween(day, expected)).toBe(n)
  })

  it.each([
    "2026-1-1",
    "2026-02-31",
    "2026-02-29", // not a leap year
    "2026-13-01",
    "2026-00-10",
    "2026-04-31",
    "2026-05-00",
    "0099-01-01", // Date.UTC maps years 0–99 to 1900–1999
    "",
  ])("rejects %j", (day) => {
    expect(() => addDays(day, 1)).toThrow(/Not a day/)
    expect(() => daysBetween("2026-01-01", day)).toThrow(/Not a day/)
  })

  it("accepts a real leap day", () => {
    expect(addDays("2028-02-29", 1)).toBe("2028-03-01")
  })
})

describe("showing up", () => {
  const kinds: [PlayerEventKind | "syllabus-skip", boolean][] = [
    ["warmup-next", true],
    ["guess-lock", true],
    ["read-done", true],
    ["recall-write", true],
    ["recall-tick", true],
    ["answer", true],
    ["answer-next", true],
    ["note-stick", true],
    ["answers-skip", true],
    ["skip-lesson", true],
    ["syllabus-skip", true],
    ["budget-end", false],
    ["continue", false],
  ]
  it.each(kinds)("%s counts: %s", (kind, counts) => {
    expect(isProgressEvent(kind)).toBe(counts)
  })

  it.each([
    [null, "2026-05-01", false],
    ["2026-04-30", "2026-05-01", false],
    ["2026-04-18", "2026-05-01", false], // 13 days
    ["2026-04-17", "2026-05-01", true], // 14 days
    ["2026-01-01", "2026-05-01", true],
  ])("back after a break: last %s, today %s → %s", (last, today, back) => {
    expect(isBackAfterBreak(last, today)).toBe(back)
  })
})

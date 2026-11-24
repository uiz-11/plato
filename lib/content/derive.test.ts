import { describe, expect, it } from "vitest"

import { makeCourse, makeLesson, words } from "@/test/content"

import {
  briefWordCount,
  courseLengthSeconds,
  formatCourseLength,
  lessonCount,
  lessonEstimateSeconds,
  readMinutes,
  sourceNumbers,
} from "./derive"

describe("briefWordCount", () => {
  it("counts prose and ignores directive syntax", () => {
    const md = [
      "# The cell",
      "",
      "::anchor{#top}",
      "",
      "Cells are **small** :cite[src-a,src-b] and :uncertain[probably very old].",
      "",
      "::guess{#g1}",
      "",
      ":::analogy{#factory}",
      "A cell is like a factory.",
      ":::",
      "",
      "- one — two",
      "",
      '::figure{src="cell.svg" alt="A cell" caption="A cell"}',
    ].join("\n")
    // The cell (2) + Cells are small and probably very old (7)
    // + A cell is like a factory (6) + one two (2)
    expect(briefWordCount(md)).toBe(17)
  })

  it("handles links inside labels and only the closed directive set", () => {
    const md = [
      ":contested[some say [X](https://x.org) is true] :cite[src-a]",
      "::not-a-directive and prose",
      "The ratio is 3:1[^] here.",
    ].join("\n")
    // some say [X](…) is true (5) + ::not-a-directive and prose (3)
    // + The ratio is 3:1[^] here. (5)
    expect(briefWordCount(md)).toBe(13)
  })
})

it("skips code-fence lines and directive attributes", () => {
  const md =
    "```ts\nconst x = 1\n```\n:uncertain[a claim]{#u1} :cite[src-a]{.x}"
  // const x = 1 (3, "=" has no letter) + a claim (2)
  expect(briefWordCount(md)).toBe(5)
})

describe("readMinutes", () => {
  it.each([
    [0, 1],
    [1, 1],
    [220, 1],
    [221, 2],
    [1540, 7],
  ])("%i words → %i min", (n, min) => {
    expect(readMinutes(words(n))).toBe(min)
  })
})

describe("lessonEstimateSeconds", () => {
  it("sums the steps", () => {
    const lesson = makeLesson("one", { keyQuestions: ["q1", "q2"] })
    // guesses 2×30 + read 5×60 + write 90 + tick 30 + 3×45 + boards 2×45
    const noWarmup = 60 + 300 + 90 + 30 + 135 + 90
    expect(lessonEstimateSeconds(lesson, 5, { warmup: false })).toBe(noWarmup)
    expect(lessonEstimateSeconds(lesson, 5, { warmup: true })).toBe(
      noWarmup + 120
    )
  })
})

describe("course length", () => {
  it("sums lessons (warm-up after the first) and checkpoints", () => {
    const course = makeCourse("c")
    const lessons = ["one", "two", "three"].map((id) => ({
      lesson: makeLesson(id),
      readMinutes: 7,
    }))
    const lesson = 60 + 420 + 90 + 30 + 135 + 45
    expect(courseLengthSeconds(course, lessons)).toBe(
      3 * lesson + 2 * 120 + 12 * 45
    )
  })

  it.each([
    [0, "~1 min"],
    [29, "~1 min"],
    [40 * 60, "~40 min"],
    [59 * 60 + 29, "~59 min"],
    [59 * 60 + 31, "~1 hr"],
    [74 * 60, "~1 hr"],
    [75 * 60, "~1.5 hrs"],
    [100 * 60, "~1.5 hrs"],
    [105 * 60, "~2 hrs"],
    [4.4 * 3600, "~4.5 hrs"],
  ])("%is → %s", (s, label) => {
    expect(formatCourseLength(s)).toBe(label)
  })

  it("counts lessons from the modules", () => {
    expect(lessonCount(makeCourse("c"))).toBe(3)
  })
})

it("numbers sources by their position in the source list", () => {
  const numbers = sourceNumbers(makeCourse("c"))
  expect(numbers.get("src-a")).toBe(1)
  expect(numbers.get("src-b")).toBe(2)
  expect(numbers.get("nope")).toBeUndefined()
})

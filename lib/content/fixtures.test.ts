import { existsSync } from "node:fs"
import { join } from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { clearContentCache, listCourses, readNotBuilt } from "./load"

// The fixture courses (§10.2) are test data for e2e and demo content. These
// tests pin what they must contain; the validator's structure checks (T07)
// cover the rest.

const root = join(process.cwd(), "e2e/fixtures/content")

afterEach(() => clearContentCache())

const DIRECTIVES = [
  ":cite[",
  ":uncertain[",
  ":general[",
  ":contested[",
  "::anchor{#",
  "::guess{#",
  "::misconception{#",
  ":::analogy{#",
  "::figure{",
]

describe("fixture courses", () => {
  const courses = () => listCourses({ root, includeDrafts: true })

  it("both parse with the schema and are published", () => {
    expect(courses().map((c) => [c.id, c.published !== null])).toEqual([
      ["how-encryption-works", true],
      ["leap-years", true],
    ])
    // One decision, for the Not built request in e2e/pipeline-export.spec.ts.
    expect(readNotBuilt(root).map((n) => n.requestId)).toEqual([
      "5d0c3b8e-7a41-4f2e-9c6d-1e2f3a4b5c6d",
    ])
  })

  it("the main course has two modules, four lessons and everything a brief can hold", () => {
    const c = courses().find((c) => c.id === "how-encryption-works")!
    expect(c.course.kind).toBe("standard")
    expect(c.course.modules.map((m) => m.lessons.length)).toEqual([2, 2])

    const types = new Set(
      c.lessons.flatMap((l) => l.lesson.exercises.map((e) => e.type))
    )
    expect([...types].sort()).toEqual([
      "fill",
      "mc",
      "scenario",
      "short",
      "spot",
    ])

    const briefs = c.lessons.map((l) => l.brief).join("\n")
    for (const d of DIRECTIVES) expect(briefs, d).toContain(d)
    expect(briefs).toMatch(/\$\$\n/) // display math
    expect(briefs).toMatch(/\$[^$\n]+\$/) // inline math
    expect(briefs).toMatch(/^```\w+$/m) // fenced code
    expect(briefs).toMatch(/^\|.+\|$/m) // GFM table
    expect(briefs).toMatch(/^> /m) // blockquote

    for (const [, src] of briefs.matchAll(/::figure\{src="([^"]+)"/g))
      expect(existsSync(join(root, "courses", c.id, "assets", src)), src).toBe(
        true
      )
  })

  it("the second course is a mini-course", () => {
    const c = courses().find((c) => c.id === "leap-years")!
    expect(c.course.kind).toBe("mini")
    expect(c.course.modules).toHaveLength(1)
    expect(c.lessonCount).toBe(1)
  })
})

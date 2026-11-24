import { describe, expect, it } from "vitest"

import { makeCourse, makeLesson } from "@/test/content"

import {
  Course,
  Exercise,
  Lesson,
  NotBuiltList,
  PublishedManifest,
  wordCount,
} from "./schema"

function issues(
  schema: {
    safeParse: (v: unknown) => {
      success: boolean
      error?: { issues: { path: PropertyKey[]; message: string }[] }
    }
  },
  value: unknown
) {
  const r = schema.safeParse(value)
  return r.success
    ? []
    : r.error!.issues.map((i) => `${i.path.join(".")}: ${i.message}`)
}

const base = {
  id: "e1",
  concepts: ["c1"],
  pool: "recall",
  prompt: "Prompt",
  explanation: "Because.",
  anchor: "a1",
}
const opts = [
  { id: "a", text: "A" },
  { id: "b", text: "B" },
  { id: "c", text: "C" },
]

describe("Course", () => {
  it("accepts a valid course", () => {
    expect(issues(Course, makeCourse("valid-course"))).toEqual([])
  })

  it("accepts real dates, including leap days", () => {
    for (const date of ["2024", "2024-02", "2024-02-29", "2023-12-31"])
      expect(
        issues(Course, {
          ...makeCourse("c"),
          sources: [
            {
              id: "s",
              group: "g",
              title: "t",
              publisher: "p",
              date,
              url: "https://x.org",
            },
          ],
        })
      ).toEqual([])
  })

  // One mutation per row; each must fail at the given path.
  it.each<[string, Record<string, unknown>, string]>([
    ["non-kebab id", { id: "Bad_Id" }, "id"],
    ["trailing hyphen id", { id: "bad-" }, "id"],
    ["schema version", { schemaVersion: 2 }, "schemaVersion"],
    ["request id not a uuid", { requestId: "abc" }, "requestId"],
    ["cover label > 12 chars", { coverLabel: "Thirteen chrs" }, "coverLabel"],
    ["kind", { kind: "long" }, "kind"],
    ["asOf format", { asOf: "2026-13" }, "asOf"],
    ["unknown policy", { policies: ["weird"] }, "policies.0"],
    [
      "2 key questions",
      {
        keyQuestions: [
          { id: "q1", text: "a" },
          { id: "q2", text: "b" },
        ],
      },
      "keyQuestions",
    ],
    [
      "key question id",
      {
        keyQuestions: [
          { id: "q6", text: "a" },
          { id: "q2", text: "b" },
          { id: "q3", text: "c" },
        ],
      },
      "keyQuestions.0.id",
    ],
    ["no modules", { modules: [] }, "modules"],
    [
      "module without lessons",
      { modules: [{ id: "m1", title: "M", lessons: [], checkpoint: [] }] },
      "modules.0.lessons",
    ],
    [
      "source date",
      {
        sources: [
          {
            id: "s",
            group: "g",
            title: "t",
            publisher: "p",
            date: "24",
            url: "https://x.org",
          },
        ],
      },
      "sources.0.date",
    ],
    [
      "source url",
      {
        sources: [
          {
            id: "s",
            group: "g",
            title: "t",
            publisher: "p",
            date: "2024",
            url: "ftp://x.org",
          },
        ],
      },
      "sources.0.url",
    ],
    [
      "impossible source date",
      {
        sources: [
          {
            id: "s",
            group: "g",
            title: "t",
            publisher: "p",
            date: "2024-02-31",
            url: "https://x.org",
          },
        ],
      },
      "sources.0.date",
    ],
    [
      "non-leap-year date",
      {
        sources: [
          {
            id: "s",
            group: "g",
            title: "t",
            publisher: "p",
            date: "2023-02-29",
            url: "https://x.org",
          },
        ],
      },
      "sources.0.date",
    ],
    ["empty title", { title: "  " }, "title"],
    ["unknown key", { extra: true }, ""],
  ])("rejects %s", (_name, mutation, path) => {
    const found = issues(Course, { ...makeCourse("c"), ...mutation })
    expect(found.some((i) => i.startsWith(`${path}:`))).toBe(true)
  })
})

describe("Lesson", () => {
  it("accepts a valid lesson", () => {
    expect(issues(Lesson, makeLesson("one"))).toEqual([])
  })

  const l = makeLesson("one")
  it.each<[string, Record<string, unknown>, string]>([
    ["no key questions", { keyQuestions: [] }, "keyQuestions"],
    ["2 concepts", { concepts: l.concepts.slice(0, 2) }, "concepts"],
    [
      "7 concepts",
      { concepts: [...l.concepts, ...l.concepts, l.concepts[0]] },
      "concepts",
    ],
    [
      "concept without recall prompt",
      { concepts: l.concepts.map((c) => ({ ...c, recallPrompts: [] })) },
      "concepts.0.recallPrompts",
    ],
    ["1 guess", { guesses: l.guesses.slice(0, 1) }, "guesses"],
    [
      "guess with 2 options",
      {
        guesses: l.guesses.map((g) => ({
          ...g,
          options: g.options.slice(0, 2),
        })),
      },
      "guesses.0.options",
    ],
    [
      "hook without key question",
      { hook: { text: "Next…" } },
      "hook.keyQuestion",
    ],
    [
      "link level",
      {
        beyond: {
          simplified: [],
          notCovered: [
            {
              id: "n",
              topic: "t",
              why: "w",
              links: [
                {
                  title: "t",
                  url: "https://x.org",
                  adds: "a",
                  minutes: 5,
                  level: "expert",
                },
              ],
            },
          ],
        },
      },
      "beyond.notCovered.0.links.0.level",
    ],
    [
      "link minutes",
      {
        beyond: {
          simplified: [],
          notCovered: [
            {
              id: "n",
              topic: "t",
              why: "w",
              links: [
                {
                  title: "t",
                  url: "https://x.org",
                  adds: "a",
                  minutes: 2.5,
                  level: "intro",
                },
              ],
            },
          ],
        },
      },
      "beyond.notCovered.0.links.0.minutes",
    ],
  ])("rejects %s", (_name, mutation, path) => {
    const found = issues(Lesson, { ...l, ...mutation })
    expect(found.some((i) => i.startsWith(`${path}:`))).toBe(true)
  })
})

it("number fields read numeric text and report the real problem", () => {
  const link = (minutes: unknown) => ({
    ...makeLesson("one"),
    beyond: {
      simplified: [],
      notCovered: [
        {
          id: "n",
          topic: "t",
          why: "w",
          links: [
            {
              title: "t",
              url: "https://x.org",
              adds: "a",
              minutes,
              level: "intro",
            },
          ],
        },
      ],
    },
  })
  expect(issues(Lesson, link("5"))).toEqual([])
  for (const bad of ["2.5", "5.5e0", "-5", "0"]) {
    const found = issues(Lesson, link(bad))
    expect(found).toHaveLength(1)
    expect(found[0]).not.toContain("received string")
  }
  expect(issues(Course, { ...makeCourse("c"), schemaVersion: "1" })).toEqual([])
})

describe("Exercise", () => {
  it.each([
    { ...base, type: "mc", options: opts, correct: "a" },
    {
      ...base,
      type: "scenario",
      scenario: "You are…",
      options: opts,
      correct: "a",
    },
    { ...base, type: "fill", prompt: "The ___ is red.", accepted: ["sky"] },
    {
      ...base,
      type: "spot",
      sentences: opts,
      faulty: "b",
      fixes: opts.slice(0, 2),
      correctFix: "a",
    },
    {
      ...base,
      type: "short",
      sample: "A short sample answer.",
      checklist: ["one", "two"],
    },
  ])("accepts a valid $type exercise", (ex) => {
    expect(issues(Exercise, ex)).toEqual([])
  })

  it.each<[string, Record<string, unknown>, string]>([
    ["unknown type", { ...base, type: "essay" }, "type"],
    [
      "mc with 5 options",
      {
        ...base,
        type: "mc",
        options: [...opts, ...opts.slice(0, 2)],
        correct: "a",
      },
      "options",
    ],
    [
      "scenario without scenario",
      { ...base, type: "scenario", options: opts, correct: "a" },
      "scenario",
    ],
    [
      "fill without answers",
      { ...base, type: "fill", accepted: [] },
      "accepted",
    ],
    [
      "spot with 4 fixes",
      {
        ...base,
        type: "spot",
        sentences: opts,
        faulty: "b",
        fixes: [...opts, opts[0]],
        correctFix: "a",
      },
      "fixes",
    ],
    [
      "short sample > 25 words",
      {
        ...base,
        type: "short",
        sample: Array(26).fill("w").join(" "),
        checklist: ["a", "b"],
      },
      "sample",
    ],
    [
      "short with 1 checklist point",
      { ...base, type: "short", sample: "s", checklist: ["a"] },
      "checklist",
    ],
    [
      "no concepts",
      { ...base, concepts: [], type: "fill", accepted: ["x"] },
      "concepts",
    ],
    [
      "pool",
      { ...base, pool: "warmup", type: "fill", accepted: ["x"] },
      "pool",
    ],
    [
      "mc field on fill",
      { ...base, type: "fill", accepted: ["x"], correct: "a" },
      "",
    ],
  ])("rejects %s", (_name, ex, path) => {
    const found = issues(Exercise, ex)
    expect(found.some((i) => i.startsWith(`${path}:`))).toBe(true)
  })
})

describe("manifests", () => {
  it("parses published.json", () => {
    expect(
      issues(PublishedManifest, {
        courses: [
          { id: "a", publishedAt: "2026-11-01T00:00:00Z" },
          {
            id: "b",
            requestId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
            publishedAt: "2026-11-02T10:00:00+01:00",
          },
        ],
      })
    ).toEqual([])
    expect(
      issues(PublishedManifest, {
        courses: [{ id: "a", publishedAt: "yesterday" }],
      })
    ).not.toEqual([])
  })

  it("parses not-built.json", () => {
    expect(
      issues(NotBuiltList, [
        {
          requestId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
          reason: "A support request, not a topic to learn",
          decidedAt: "2026-11-01T00:00:00Z",
        },
      ])
    ).toEqual([])
    expect(
      issues(NotBuiltList, [
        { requestId: "x", reason: "", decidedAt: "2026-11-01T00:00:00Z" },
      ])
    ).toHaveLength(2)
  })
})

it("wordCount", () => {
  expect(wordCount("")).toBe(0)
  expect(wordCount("  one two\nthree ")).toBe(3)
})

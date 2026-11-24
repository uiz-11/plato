import { renameSync, symlinkSync } from "node:fs"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { stringify } from "yaml"

import {
  createTestContent,
  makeCourse,
  makeLesson,
  type TestContent,
} from "@/test/content"

import {
  clearContentCache,
  ContentError,
  contentRoot,
  getCourse,
  listCourses,
  loadCourseDir,
  readNotBuilt,
  readPublished,
} from "./load"

let content: TestContent
beforeEach(() => {
  content = createTestContent()
})
afterEach(() => {
  content.close()
  clearContentCache()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("contentRoot", () => {
  it("defaults to <cwd>/content and makes PLATO_CONTENT_DIR absolute", () => {
    expect(contentRoot({})).toBe(`${process.cwd()}/content`)
    expect(contentRoot({ PLATO_CONTENT_DIR: "e2e/fixtures/content" })).toBe(
      `${process.cwd()}/e2e/fixtures/content`
    )
    expect(contentRoot({ PLATO_CONTENT_DIR: "/srv/content" })).toBe(
      "/srv/content"
    )
  })

  it("the repository's content root loads", () => {
    expect(Array.isArray(listCourses({ includeDrafts: false }))).toBe(true)
    expect(Array.isArray(readNotBuilt())).toBe(true)
  })
})

describe("loading a course", () => {
  it("returns typed lessons in syllabus order with derived values", () => {
    content.writeCourse(makeCourse("cells"))
    content.writePublished(["cells"])
    const c = getCourse("cells", { root: content.root })!
    expect(c.id).toBe("cells")
    expect(c.course.title).toBe("Course cells")
    expect(c.published).toEqual({
      id: "cells",
      publishedAt: "2026-11-01T00:00:00Z",
    })
    expect(c.lessons.map((l) => [l.lesson.id, l.moduleId])).toEqual([
      ["one", "m1"],
      ["two", "m1"],
      ["three", "m2"],
    ])
    expect(c.lessonsById.get("two")!.brief).toContain("# Title")
    expect(c.lessons[0].readMinutes).toBe(1)
    expect(c.lessonCount).toBe(3)
    expect(c.sourceNumbers.get("src-b")).toBe(2)
    expect(c.lengthLabel).toMatch(/^~\d+ min$/)
    expect(c.lengthSeconds).toBeGreaterThan(0)
  })

  it("reports schema errors with file and path", () => {
    content.writeCourse(
      makeCourse("cells", { coverLabel: "Far too long a label" })
    )
    expect(() => loadCourseDir(`${content.root}/courses/cells`)).toThrow(
      "courses/cells/course.yaml: coverLabel: "
    )
  })

  it("reports a lesson error inside its file", () => {
    content.writeCourse(makeCourse("cells"), [
      makeLesson("one"),
      makeLesson("two", { guesses: [] }),
      makeLesson("three"),
    ])
    try {
      loadCourseDir(`${content.root}/courses/cells`)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ContentError)
      const err = e as ContentError
      expect(err.file).toBe("courses/cells/lessons/two.yaml")
      expect(err.issues[0].path).toEqual(["guesses"])
    }
  })

  it("rejects a missing lesson file", () => {
    content.writeCourse(makeCourse("cells"), [
      makeLesson("one"),
      makeLesson("two"),
    ])
    expect(() => loadCourseDir(`${content.root}/courses/cells`)).toThrow(
      "courses/cells/lessons/three.yaml: file not found"
    )
  })

  it("rejects ids that do not match their files", () => {
    content.writeCourse(makeCourse("cells"))
    // JSON is valid YAML.
    content.writeFile(
      "courses/cells/lessons/two.yaml",
      JSON.stringify(makeLesson("deux"))
    )
    expect(() => loadCourseDir(`${content.root}/courses/cells`)).toThrow(
      'courses/cells/lessons/two.yaml: id: "deux" does not match the file name "two"'
    )

    content.writeFile(
      "courses/moved/course.yaml",
      JSON.stringify(makeCourse("renamed"))
    )
    expect(() => loadCourseDir(`${content.root}/courses/moved`)).toThrow(
      'id: "renamed" does not match the folder "moved"'
    )
  })

  it("rejects a lesson listed twice", () => {
    const course = makeCourse("cells")
    course.modules[1].lessons = ["three", "two"]
    content.writeCourse(
      course,
      ["one", "two", "three"].map((l) => makeLesson(l))
    )
    expect(() => loadCourseDir(`${content.root}/courses/cells`)).toThrow(
      'courses/cells/course.yaml: modules[1].lessons[1]: lesson "two" is listed more than once'
    )
  })

  it("rejects invalid YAML", () => {
    content.writeFile("courses/bad/course.yaml", "id: [unclosed")
    expect(() => loadCourseDir(`${content.root}/courses/bad`)).toThrow(
      ContentError
    )
  })

  it("hints at the usual cause of a YAML syntax error in prose", () => {
    content.writeFile("courses/bad/course.yaml", "title: Note: a colon\n")
    expect(() => loadCourseDir(`${content.root}/courses/bad`)).toThrow(
      "must be a block scalar (|-) or quoted"
    )
  })

  it("hints at an unquoted comma in a flow mapping", () => {
    content.writeCourse(makeCourse("cells"))
    content.writeFile(
      "courses/cells/lessons/two.yaml",
      stringify(makeLesson("two")).replace(
        /^title: .*$/m,
        "title: Two\nhook: { text: Red, or blue, keyQuestion: q1 }"
      )
    )
    expect(() => loadCourseDir(`${content.root}/courses/cells`)).toThrow(
      'Unrecognized key: "or blue". A key with spaces usually means an unquoted comma'
    )
  })

  it("gives no prose hint for other YAML errors", () => {
    for (const text of ["title: A\ntitle: B\n", "modules:\n\t- id: x\n"]) {
      content.writeFile("courses/bad/course.yaml", text)
      let message = ""
      try {
        loadCourseDir(`${content.root}/courses/bad`)
      } catch (error) {
        message = (error as Error).message
      }
      expect(message, text).not.toBe("")
      expect(message, text).not.toContain("Hint:")
    }
  })

  it("gives no flow-mapping hint for a block-style key with spaces", () => {
    content.writeCourse(makeCourse("cells"))
    content.writeFile(
      "courses/cells/lessons/two.yaml",
      stringify({ ...makeLesson("two"), "why this matters": "x" })
    )
    expect(() => loadCourseDir(`${content.root}/courses/cells`)).toThrow(
      'Unrecognized key: "why this matters"'
    )
    expect(() => loadCourseDir(`${content.root}/courses/cells`)).not.toThrow(
      "{ … } mapping"
    )
  })
})

describe("manifest and drafts", () => {
  beforeEach(() => {
    content.writeCourse(makeCourse("zeta"))
    content.writeCourse(makeCourse("alpha"))
    content.writeCourse(makeCourse("draft-b"))
    content.writeCourse(makeCourse("draft-a"))
    content.writePublished(["zeta", "alpha"])
  })

  it("lists only published courses, in manifest order", () => {
    const ids = listCourses({ root: content.root, includeDrafts: false }).map(
      (c) => c.id
    )
    expect(ids).toEqual(["zeta", "alpha"])
  })

  it("adds drafts after them when drafts are on", () => {
    const courses = listCourses({ root: content.root, includeDrafts: true })
    expect(courses.map((c) => [c.id, c.published !== null])).toEqual([
      ["zeta", true],
      ["alpha", true],
      ["draft-a", false],
      ["draft-b", false],
    ])
  })

  it("skips drafts that are missing or fail to load", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    content.writeFile("courses/half-made/lessons/one.md", "# Title")
    content.writeCourse(
      makeCourse("broken", { coverLabel: "Far too long a label" })
    )
    const ids = listCourses({ root: content.root, includeDrafts: true }).map(
      (c) => c.id
    )
    expect(ids).toEqual(["zeta", "alpha", "draft-a", "draft-b"])
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0][0]).toContain('Skipping draft course "broken"')
    const opts = { root: content.root, includeDrafts: true }
    expect(getCourse("half-made", opts)).toBeNull()
    expect(() => getCourse("broken", opts)).toThrow(ContentError)
  })

  it("warns once per broken draft and error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    content.writeCourse(
      makeCourse("broken", { coverLabel: "Far too long a label" })
    )
    const opts = { root: content.root, includeDrafts: true }
    listCourses(opts)
    listCourses(opts)
    expect(warn).toHaveBeenCalledOnce()
    content.writeCourse(makeCourse("broken", { title: " " }))
    listCourses(opts)
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it("ignores dangling symlinks and follows real ones", () => {
    symlinkSync(
      join(content.root, "nowhere"),
      join(content.root, "courses", "dangling")
    )
    content.writeCourse(makeCourse("linked"), undefined)
    renameSync(
      join(content.root, "courses", "linked"),
      join(content.root, "real-linked")
    )
    symlinkSync(
      join(content.root, "real-linked"),
      join(content.root, "courses", "linked")
    )
    const ids = listCourses({ root: content.root, includeDrafts: true }).map(
      (c) => c.id
    )
    expect(ids).toEqual(["zeta", "alpha", "draft-a", "draft-b", "linked"])
  })

  it("follows test hooks by default", () => {
    vi.stubEnv("PLATO_TEST_HOOKS", "")
    expect(listCourses({ root: content.root })).toHaveLength(2)
    expect(getCourse("draft-a", { root: content.root })).toBeNull()
    vi.stubEnv("PLATO_TEST_HOOKS", "1")
    expect(listCourses({ root: content.root })).toHaveLength(4)
    expect(getCourse("draft-a", { root: content.root })?.published).toBeNull()
  })

  it("returns null for unknown or malformed ids", () => {
    const opts = { root: content.root, includeDrafts: true }
    expect(getCourse("missing", opts)).toBeNull()
    expect(getCourse("../zeta", opts)).toBeNull()
    expect(getCourse("Zeta", opts)).toBeNull()
  })

  it("throws when a published course's folder is missing", () => {
    content.writePublished(["zeta", "gone"])
    expect(() => listCourses({ root: content.root })).toThrow(
      "courses/gone/course.yaml: file not found"
    )
  })

  it("rejects a course listed twice", () => {
    content.writePublished(["zeta", "zeta"])
    expect(() => readPublished(content.root)).toThrow('"zeta" is listed twice')
  })

  it("rejects a missing manifest", () => {
    content.writeFile("published.json", "{")
    expect(() => readPublished(content.root)).toThrow("published.json")
  })
})

describe("hand-written YAML", () => {
  it("keeps unquoted numbers and booleans as written", () => {
    content.writeCourse(makeCourse("cells"))
    const course = [
      "schemaVersion: 1",
      "id: cells",
      "title: 1984",
      "coverLabel: true",
      "kind: standard",
      "asOf: 2026-11",
      "outOfScope: Everything else.",
      "policies: [broad]",
      "keyQuestions:",
      "  - { id: q1, text: Why? }",
      "  - { id: q2, text: How? }",
      "  - { id: q3, text: What? }",
      "modules:",
      "  - id: m1",
      "    title: Module 1",
      "    lessons: [one, two]",
      "    checkpoint: []",
      "  - id: m2",
      "    title: Module 2",
      "    lessons: [three]",
      "    checkpoint: []",
      "sources:",
      "  - id: src-a",
      "    group: Papers",
      "    title: A",
      "    publisher: P",
      "    date: 2024",
      "    url: https://example.org/a",
    ].join("\n")
    content.writeFile("courses/cells/course.yaml", course)
    const lesson = makeLesson("one", {
      beyond: {
        simplified: [],
        notCovered: [
          {
            id: "n1",
            topic: "T",
            why: "W",
            links: [
              {
                title: "L",
                url: "https://example.org",
                adds: "A",
                minutes: 5,
                level: "intro",
              },
            ],
          },
        ],
      },
      exercises: [
        {
          id: "one-e1",
          type: "fill",
          concepts: ["one-c1"],
          pool: "recall",
          prompt: "Price: ___",
          explanation: "E",
          anchor: "top",
          accepted: ["placeholder"],
        },
      ],
    })
    // JSON is YAML; replace the accepted answers with unquoted numbers.
    content.writeFile(
      "courses/cells/lessons/one.yaml",
      JSON.stringify(lesson).replace('["placeholder"]', "[1.50, 007]")
    )
    const c = loadCourseDir(`${content.root}/courses/cells`)
    expect(c.course.title).toBe("1984")
    expect(c.course.coverLabel).toBe("true")
    expect(c.course.sources[0].date).toBe("2024")
    expect(c.course.schemaVersion).toBe(1)
    const ex = c.lessons[0].lesson.exercises[0]
    expect(ex.type === "fill" && ex.accepted).toEqual(["1.50", "007"])
    expect(c.lessons[0].lesson.beyond.notCovered[0].links[0].minutes).toBe(5)
  })
})

describe("memoization", () => {
  it("rereads files outside production", () => {
    content.writeCourse(makeCourse("cells"))
    content.writePublished(["cells"])
    expect(getCourse("cells", { root: content.root })!.course.title).toBe(
      "Course cells"
    )
    content.writeCourse(makeCourse("cells", { title: "Edited" }))
    expect(getCourse("cells", { root: content.root })!.course.title).toBe(
      "Edited"
    )
  })

  it("keeps the first read in production", () => {
    vi.stubEnv("NODE_ENV", "production")
    content.writeCourse(makeCourse("cells"))
    content.writePublished(["cells"])
    const first = getCourse("cells", { root: content.root })
    content.writeCourse(makeCourse("cells", { title: "Edited" }))
    expect(getCourse("cells", { root: content.root })).toBe(first)
  })
})

it("reads not-built.json", () => {
  content.writeFile(
    "not-built.json",
    JSON.stringify([
      {
        requestId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        reason: "Not a topic",
        decidedAt: "2026-11-01T00:00:00Z",
      },
    ])
  )
  expect(readNotBuilt(content.root)[0].reason).toBe("Not a topic")
})
